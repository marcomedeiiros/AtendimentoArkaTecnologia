/**
 * O CARD DO BLOCO MOSTRA O CONTEUDO REAL?
 *
 * ── O DEFEITO ──────────────────────────────────────────────────────────────
 *
 * Blocos apareciam em branco no desenho, com "Clique para configurar...", mesmo
 * tendo conteudo configurado -- conteudo que o bot ENVIA ao cliente.
 *
 * A causa: o card lia UM campo (`node.desc`), e o motor nunca concordou com essa
 * definicao. `chatbot.engine.textoDoPasso` le quatro, em ordem:
 *
 *     passo.texto || passo.config?.mensagem || passo.descricao || passo.titulo
 *
 * Um bloco com `texto` e sem `desc` tem conteudo para o motor e estava "por
 * configurar" para a tela. E isso esta no fluxo de PRODUCAO deles: no
 * docs/fluxo-arka.json o passo "COMERCIAL" tem `desc: ""` e a mensagem inteira
 * em `texto`.
 *
 * E a forma geral e pior: avaliacao, espera e condicao guardam o conteudo em
 * `config`, e nascem com `desc: ''`. Dava para configurar o bloco inteiro pelo
 * painel e o card continuar dizendo que ele estava vazio.
 *
 * ── O QUE ESTE ARQUIVO MEDE ────────────────────────────────────────────────
 *
 * Roda a previa REAL do card (extraida do VisualFlowEditor, e nao uma copia)
 * contra o fluxo canonico convertido pelo importador REAL. Duas perguntas:
 *
 *   1. todo bloco com conteudo mostra conteudo? (nenhum falso "vazio")
 *   2. bloco genuinamente vazio ainda mostra o placeholder? (a orientacao de
 *      tela nao foi removida -- ela so parou de mentir)
 *
 * E a terceira, que e sobre o BANCO: nenhum texto de placeholder pode estar
 * gravado como conteudo de bloco.
 *
 *   cd server && node verificar-blocos-conteudo.js
 */
process.env.TURNSTILE_SITE_KEY = "";
process.env.TURNSTILE_SECRET_KEY = "";

const fs = require("fs");
const path = require("path");
const prisma = require("./src/infrastructure/database/prisma.client");
const { ChatbotEngine } = require("./src/modules/chatbot/chatbot.engine");

const erros = [];
let secao = "";
const titulo = (t) => { secao = t; console.log(`\n=== ${t} ===`); };
const check = (ok, rotulo) => {
  console.log(`  ${ok ? "OK  " : "FALHA"} ${rotulo}`);
  if (!ok) erros.push(`[${secao}] ${rotulo}`);
};

const RAIZ = path.join(__dirname, "..");

// ── Carrega funcoes do FRONT sem duplica-las ───────────────────────────────
//
// Mesma tecnica de verificar-tudo.js: avalia o modulo ES do front aqui dentro,
// para exercitar EXATAMENTE o codigo que o navegador usa. Uma copia colada
// envelheceria e passaria a concordar com ela mesma.
function carregarDoFront(arquivo, exportar) {
  const fonte = fs.readFileSync(path.join(RAIZ, "client", "src", arquivo), "utf8");
  const mod = {};
  const cjs = fonte
    .replace(/^\s*import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, "")
    .replace(/export /g, "");
  new Function("exports", "const hojeISO = () => '1970-01-01';\n" + cjs + "\n" + exportar)(mod);
  return mod;
}

// A previa do card. O VisualFlowEditor e um componente JSX inteiro e nao da
// para avaliar como CommonJS, entao recortamos SO a funcao -- delimitada por
// nome, de modo que renomea-la quebra este teste em vez de silencia-lo.
function carregarPreviaDoCard() {
  const fonte = fs.readFileSync(
    path.join(RAIZ, "client", "src", "components", "flow", "VisualFlowEditor.jsx"),
    "utf8"
  );
  const inicio = fonte.indexOf("function previaDoBloco(node) {");
  if (inicio === -1) {
    throw new Error("previaDoBloco nao encontrada no VisualFlowEditor -- foi renomeada?");
  }
  const fim = fonte.indexOf("\nfunction formatNodesPositions", inicio);
  const trecho = fonte.slice(inicio, fim);
  const mod = {};
  new Function("exports", trecho + "\n;exports.previa = previaDoBloco;")(mod);
  return mod.previa;
}

const previaDoBloco = carregarPreviaDoCard();
const { extrair } = carregarDoFront(
  "components/flow/fluxoJson.js",
  ";exports.extrair = extrairFluxosImportados;"
);

// O motor de verdade, so para perguntar "o que voce enviaria deste passo?".
const motor = new ChatbotEngine({});
const conteudoDoMotor = (p) => String(motor.textoDoPasso({ ...p, descricao: p.descricao ?? p.desc }, {}) || "").trim();

// Textos que sao ORIENTACAO DE TELA e nunca podem virar conteudo gravado.
const PLACEHOLDERS = [
  "Clique para configurar",
  "Digite sua mensagem",
  "Digite a mensagem ou descrição da etapa",
  "Nome da etapa",
  "ex: orçamento, boleto, suporte",
  "Enter your message here",
];

async function main() {
  const [fluxo] = extrair(
    JSON.parse(fs.readFileSync(path.join(RAIZ, "docs", "fluxo-arka.json"), "utf8"))
  );

  // ─────────────────────────────────────────────────────────────────────────
  titulo("1. Nenhum bloco COM conteudo aparece como vazio");

  const falsosVazios = [];
  for (const p of fluxo.passos) {
    const previa = previaDoBloco(p);
    const doMotor = conteudoDoMotor(p);
    // O motor cai no `titulo` como ultimo recurso; isso NAO conta como
    // "conteudo configurado" -- senao todo bloco pareceria preenchido.
    const temConteudoReal = doMotor && doMotor !== String(p.titulo || "").trim();
    if (temConteudoReal && !previa) falsosVazios.push(`${p.tipo} "${p.titulo}"`);
  }
  check(
    falsosVazios.length === 0,
    `nenhum falso vazio entre os ${fluxo.passos.length} blocos do fluxo da Arka` +
      (falsosVazios.length ? ` -- ainda em branco: ${falsosVazios.join(", ")}` : "")
  );

  // O caso concreto que foi reportado, citado pelo nome.
  const comercial = fluxo.passos.find((p) => p.titulo === "COMERCIAL");
  check(!!comercial, "o passo COMERCIAL existe no fluxo canonico");
  check(
    !comercial.desc && !!comercial.texto,
    "e ele tem desc vazio com texto preenchido (a assimetria que causava o defeito)"
  );
  check(
    previaDoBloco(comercial).startsWith(comercial.texto.trim().slice(0, 20)),
    `o card agora mostra o texto dele: "${previaDoBloco(comercial).slice(0, 45)}..."`
  );

  // ─────────────────────────────────────────────────────────────────────────
  titulo("2. Blocos cujo conteudo mora no config deixam de parecer vazios");

  // Recem-criados pela biblioteca: `desc` vazio, tudo em `config`. Antes, todos
  // estes mostravam "Clique para configurar..." mesmo configurados.
  const casos = [
    {
      nome: "avaliacao configurada",
      no: { tipo: "avaliacao", titulo: "Pesquisa", config: { mensagemNota: "De 1 a 5, como foi?" } },
      esperado: "De 1 a 5, como foi?",
    },
    {
      nome: "espera (sem resposta)",
      no: { tipo: "espera", titulo: "Timeout", config: { modo: "sem_resposta", minutos: 7, acao: "encerrar" } },
      contem: "7 min",
    },
    {
      nome: "espera (fila)",
      no: { tipo: "espera", titulo: "Fila", config: { modo: "fila", minutos: 12, acao: "transferir" } },
      contem: "na fila",
    },
    {
      nome: "condicao (validar CNPJ)",
      no: { tipo: "condicao", titulo: "CNPJ", config: { maxTentativasCnpj: 3, aoEsgotarTentativasCnpj: "avulso" } },
      contem: "avulso",
    },
    {
      nome: "delay",
      no: { tipo: "delay", titulo: "Pausa", config: { ms: 2500 } },
      contem: "2.5s",
    },
    {
      nome: "acao ERP",
      no: { tipo: "acao", titulo: "Desconto", config: { acao: "desconto_parceiro" } },
      contem: "desconto_parceiro",
    },
    {
      nome: "menu so com opcoes",
      no: { tipo: "mensagem", titulo: "Menu", config: { opcoes: [{ rotulo: "1" }, { rotulo: "2" }] } },
      contem: "2 opç",
    },
  ];

  for (const c of casos) {
    const previa = previaDoBloco(c.no);
    const ok = c.esperado ? previa === c.esperado : previa.includes(c.contem);
    check(ok, `${c.nome} -> "${previa}"`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  titulo("3. O placeholder continua existindo -- para bloco de verdade vazio");

  check(previaDoBloco({ tipo: "mensagem", titulo: "Nova Mensagem" }) === "",
    "bloco novo sem nada configurado -> sem previa (a tela mostra a orientacao)");
  check(previaDoBloco({ tipo: "mensagem", titulo: "X", texto: "   " }) === "",
    "texto so com espaco em branco nao conta como conteudo");
  check(previaDoBloco({ tipo: "mensagem", titulo: "X", texto: null, config: null }) === "",
    "null em texto/config nao quebra a previa");
  check(previaDoBloco({ tipo: "delay", titulo: "Pausa" }) === "",
    "delay sem config.ms -> sem previa");

  // ─────────────────────────────────────────────────────────────────────────
  titulo("4. A previa NUNCA inventa conteudo: ela so mostra o que existe");

  // O motor cai no titulo como ultimo recurso; a previa nao pode fazer isso,
  // senao todo bloco vazio pareceria configurado.
  check(previaDoBloco({ tipo: "mensagem", titulo: "Boas Vindas" }) === "",
    "titulo NAO e usado como previa (o motor o usa como ultimo recurso; o card nao)");

  // ─────────────────────────────────────────────────────────────────────────
  titulo("5. O tempo do Delay tem onde ser gravado, e e o campo que o motor le");

  const painel = fs.readFileSync(
    path.join(RAIZ, "client", "src", "components", "flow", "FlowPropertyPanel.jsx"),
    "utf8"
  );
  // Olha o CODIGO, com os comentarios removidos. O comentario que explica o
  // defeito cita `delaySeconds` de proposito, e um teste que casse a palavra
  // crua falharia por causa da propria documentacao dele -- ou, pior, seria
  // "consertado" reescrevendo o comentario, o que nao prova nada.
  const soCodigo = (js) => js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  check(
    !/delaySeconds/.test(soCodigo(painel)),
    "o campo fantasma `delaySeconds` nao e mais lido nem escrito pelo painel"
  );
  check(/config:\s*\{\s*\.\.\.\(node\.config \|\| \{\}\), ms \}/.test(painel),
    "o editor de Delay grava em config.ms");

  const engine = fs.readFileSync(path.join(__dirname, "src/modules/chatbot/chatbot.engine.js"), "utf8");
  check(/Number\(passo\.config\?\.ms\)/.test(engine),
    "e config.ms e exatamente o que o motor le (se isto mudar, o teste avisa)");

  // Round-trip pelo schema: o valor precisa ATRAVESSAR a borda.
  const { atualizarPassoSchema } = require("./src/modules/fluxos/fluxo.dto");
  const antes = { config: { ms: 2500 } };
  const depois = atualizarPassoSchema.safeParse(antes);
  check(depois.success && depois.data.config.ms === 2500,
    "PATCH de bloco com config.ms atravessa o Zod sem perder o valor");

  const comoEra = atualizarPassoSchema.safeParse({ delaySeconds: 2.5 });
  check(comoEra.success && comoEra.data.delaySeconds === undefined,
    "e o campo antigo continua sendo descartado -- era ISSO que acontecia com o valor digitado");

  // ─────────────────────────────────────────────────────────────────────────
  titulo("6. Nenhum placeholder gravado como conteudo, no banco");

  const passos = await prisma.passoFluxo.findMany({
    select: { id: true, titulo: true, texto: true, descricao: true, config: true },
  });
  const sujos = [];
  for (const p of passos) {
    const alvo = `${p.texto || ""}\n${p.descricao || ""}\n${JSON.stringify(p.config || {})}`;
    for (const ph of PLACEHOLDERS) {
      if (alvo.includes(ph)) sujos.push(`${p.titulo}: "${ph}"`);
    }
  }
  check(
    sujos.length === 0,
    `nenhum texto de orientacao gravado como dado (${passos.length} passos no banco)` +
      (sujos.length ? ` -- encontrados: ${sujos.join("; ")}` : "")
  );
}

main()
  .catch((e) => { erros.push(`excecao: ${e.message}`); console.error(e); })
  .finally(async () => {
    await prisma.$disconnect();
    if (erros.length) {
      console.log(`\nFALHAS (${erros.length}):`);
      for (const e of erros) console.log(`  ${e}`);
      process.exit(1);
    }
    console.log("\nCONTEUDO DOS BLOCOS: TUDO CONFERE");
  });
