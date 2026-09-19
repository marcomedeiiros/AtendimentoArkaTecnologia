/**
 * INJEÇÃO: a entrada do usuário não pode virar COMANDO.
 *
 * ── POR QUE ESTE ARQUIVO EXISTE ────────────────────────────────────────────
 *
 * "Está seguro porque usamos Prisma" é verdade hoje e não é garantia nenhuma
 * amanhã: basta um `$queryRawUnsafe` com um `${}` dentro, escrito às pressas
 * para resolver uma consulta que o ORM não fazia. O buraco não anuncia -- ele
 * funciona igual até o dia em que alguém digita uma aspa.
 *
 * Então este arquivo faz as três perguntas que importam, e as duas últimas com
 * ATAQUE DE VERDADE, e não por leitura:
 *
 *   1. existe SQL montado por concatenação em algum lugar do servidor?
 *   2. o que passa pelas buscas e pelos formulários volta como DADO?
 *   3. a borda continua validando o corpo de toda rota de escrita?
 *
 * ── O QUE ELE NÃO PROMETE ──────────────────────────────────────────────────
 *
 * Injeção de SQL é UMA porta. Isto não fala de XSS, de CSRF nem de permissão --
 * cada uma tem o guarda dela (`verificar-cabecalhos`, o `authMiddleware`, o
 * recorte por dono nos services). Aqui é só a porta do banco.
 *
 *   cd server && node verificar-injecao.js
 */
const fs = require("fs");
const path = require("path");

const prisma = require("./src/infrastructure/database/prisma.client");
const mapeamentoService = require("./src/modules/rankings/mapeamento.service");

const MARCA = "teste-inj";
const erros = [];
let secao = "";
const titulo = (t) => { secao = t; console.log(`\n=== ${t} ===`); };
const check = (ok, rotulo) => {
  console.log(`  ${ok ? "OK  " : "FALHA"} ${rotulo}`);
  if (!ok) erros.push(`[${secao}] ${rotulo}`);
};

/**
 * AS CARGAS. Cada uma quebra um jeito diferente de montar SQL na mão:
 * fechar a string, encerrar o comando, comentar o resto, empilhar um segundo
 * comando. Numa consulta parametrizada, todas elas são só texto.
 */
const CARGAS = [
  "' OR '1'='1",
  "'; DROP TABLE mensagens; --",
  "\" OR 1=1 --",
  "%' UNION SELECT name FROM sqlite_master --",
  "admin'--",
  "1; DELETE FROM usuarios WHERE '1'='1",
];

// ---------------------------------------------------------------------------
titulo("1. SQL montado na mão: não pode existir");

function listarJs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return listarJs(p);
    return e.name.endsWith(".js") ? [p] : [];
  });
}

const arquivosServidor = listarJs(path.join(__dirname, "src"));
const cru = [];
for (const f of arquivosServidor) {
  const texto = fs.readFileSync(f, "utf8");
  texto.split("\n").forEach((l, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(l)) return;
    // `$queryRawUnsafe`/`$executeRawUnsafe` com interpolação ou concatenação.
    // Com string literal pura eles são aceitáveis (é como se roda um PRAGMA).
    const m = l.match(/\$(?:query|execute)RawUnsafe\s*\(([^)]*)/);
    if (m && /[`'"]\s*\+|\$\{/.test(m[1])) {
      cru.push(`${path.relative(__dirname, f)}:${i + 1}  SQL concatenado`);
    }
  });
}
check(cru.length === 0, `nenhum SQL concatenado no servidor${cru.length ? `: ${cru.join(", ")}` : ""}`);

// `$queryRaw` com template é parametrizado pelo Prisma -- mas só quando é
// TEMPLATE. `$queryRaw(texto)` com uma string montada antes não é.
const rawSemTemplate = [];
for (const f of arquivosServidor) {
  fs.readFileSync(f, "utf8").split("\n").forEach((l, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(l)) return;
    if (/\$(?:query|execute)Raw\s*\(/.test(l)) {
      rawSemTemplate.push(`${path.relative(__dirname, f)}:${i + 1}  use a forma de template`);
    }
  });
}
check(rawSemTemplate.length === 0, `todo $queryRaw é template${rawSemTemplate.length ? `: ${rawSemTemplate.join(", ")}` : ""}`);

// ---------------------------------------------------------------------------
titulo("2. Ataque de verdade: a carga volta como DADO");

async function main() {
  const antes = {
    usuarios: await prisma.usuario.count(),
    parceiros: await prisma.parceiro.count(),
    mapeamentos: await prisma.mapeamentoTecnico.count(),
  };

  // A BUSCA DE EMPRESA: `contains` com o que a pessoa digitou. É o caminho mais
  // exposto da tela de Relatórios -- uma consulta por tecla.
  let buscaOk = true;
  for (const carga of CARGAS) {
    try {
      const r = await mapeamentoService.empresasParaBusca(carga);
      // Nenhuma carga pode CASAR com alguma coisa: são todas texto que não
      // existe em razão social nenhuma. Voltar com linha significaria que a
      // consulta foi interpretada, e não comparada.
      if (Array.isArray(r) && r.length > 0) {
        buscaOk = false;
        console.log(`        ${carga} devolveu ${r.length} linha(s)`);
      }
    } catch (e) {
      buscaOk = false;
      console.log(`        ${carga} estourou: ${e.message}`);
    }
  }
  check(buscaOk, "a busca de empresa trata a carga como texto (sem casar, sem estourar)");

  // O FORMULÁRIO: a carga é gravada e lida de volta INTEIRA. Se o banco a
  // interpretasse, o texto voltaria diferente -- ou a tabela sumiria.
  const usuario = await prisma.usuario.findFirst({ select: { id: true, nome: true } });
  let gravouIgual = true;
  const criados = [];
  if (usuario) {
    for (const carga of CARGAS.slice(0, 3)) {
      const m = await mapeamentoService.criar(
        {
          empresa: `${MARCA} ${carga}`.slice(0, 160),
          dataVisita: new Date().toISOString().slice(0, 10),
          descricao: `Relato com carga: ${carga}`,
          itens: {}, evidencias: [],
        },
        { sub: usuario.id, nome: usuario.nome }
      );
      criados.push(m.id);
      const linha = await prisma.mapeamentoTecnico.findUnique({ where: { id: m.id } });
      if (!linha || !linha.empresa.includes(carga.slice(0, 20))) {
        gravouIgual = false;
        console.log(`        "${carga}" voltou como "${linha?.empresa}"`);
      }
    }
  }
  check(gravouIgual, "o formulário grava e devolve a carga sem alteração");

  const depois = {
    usuarios: await prisma.usuario.count(),
    parceiros: await prisma.parceiro.count(),
    mapeamentos: await prisma.mapeamentoTecnico.count(),
  };
  check(
    depois.usuarios === antes.usuarios && depois.parceiros === antes.parceiros,
    `nada foi apagado: usuários ${antes.usuarios}->${depois.usuarios}, clientes ${antes.parceiros}->${depois.parceiros}`
  );
  check(
    depois.mapeamentos === antes.mapeamentos + criados.length,
    `e só entrou o que o teste criou (${criados.length})`
  );

  // A TABELA continua de pé -- a carga do "DROP TABLE" é a que este teste
  // existe para desmentir.
  const tabelas = await prisma.$queryRaw`SELECT name FROM sqlite_master WHERE type='table'`;
  const nomes = tabelas.map((t) => t.name);
  check(
    nomes.includes("mensagens") && nomes.includes("usuarios"),
    `as tabelas continuam existindo (${nomes.length} no banco)`
  );

  // Limpeza: o teste não deixa lixo.
  for (const id of criados) await prisma.mapeamentoTecnico.delete({ where: { id } }).catch(() => {});

  // -------------------------------------------------------------------------
  titulo("3. A borda continua validando o corpo");

  const dirModulos = path.join(__dirname, "src", "modules");
  const semValidacao = [];
  for (const mod of fs.readdirSync(dirModulos)) {
    const pasta = path.join(dirModulos, mod);
    if (!fs.statSync(pasta).isDirectory()) continue;
    for (const arq of fs.readdirSync(pasta).filter((f) => f.endsWith(".routes.js"))) {
      const linhas = fs.readFileSync(path.join(pasta, arq), "utf8").split("\n");
      linhas.forEach((l, i) => {
        const m = l.match(/router\.(post|put|patch)\(\s*"([^"]+)"/);
        if (!m) return;
        let bloco = "";
        for (let j = i; j < Math.min(linhas.length, i + 25); j += 1) {
          bloco += linhas[j] + "\n";
          if (/^\);\s*$/.test(linhas[j]) || (j > i && /^router\./.test(linhas[j]))) break;
        }
        if (/validate\(/.test(bloco)) return;
        // Rota de AÇÃO não tem corpo: "atender", "pausar", "marcar lido". O que
        // ela recebe é o `:id` do caminho, que vira parâmetro do Prisma.
        if (/req\.body/.test(bloco)) semValidacao.push(`${mod}/${arq}:${i + 1} ${m[1].toUpperCase()} ${m[2]}`);
      });
    }
  }
  check(
    semValidacao.length === 0,
    `toda rota de escrita que lê corpo valida na borda${semValidacao.length ? `: ${semValidacao.join(", ")}` : ""}`
  );

  console.log("");
  if (erros.length) {
    console.log(`FALHAS (${erros.length}):`);
    for (const e of erros) console.log(`  ${e}`);
    process.exitCode = 1;
  } else {
    console.log("INJEÇÃO: TUDO CONFERE");
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  process.exitCode = 1;
  await prisma.$disconnect();
});
