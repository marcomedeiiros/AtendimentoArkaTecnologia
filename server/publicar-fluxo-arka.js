// PUBLICA `docs/fluxo-arka.json` NO BANCO -- `node publicar-fluxo-arka.js`.
//
// ── POR QUE ESTE SCRIPT EXISTE ───────────────────────────────────────────────
//
// O fluxo que atende o cliente vive no BANCO de cada instalação; o JSON em
// `docs/` é o retrato versionado dele. Trazer o retrato para o banco já era
// possível pela tela (Fluxos → Importar), e continua sendo o caminho normal.
//
// O que não era possível é fazer isso de forma repetível e conferível: os
// scripts `corrigir-espera-*.js` e `corrigir-fluxo-completo.js` que existem aqui
// mexiam em blocos por UUID chumbado, um campo por vez, sem dizer o que estavam
// sobrescrevendo -- e um deles gravava `esperaEscolha: true` na opção curinga,
// que é exatamente o botão "resposta livre" debaixo da pergunta.
//
// Aqui o fluxo inteiro é gravado de uma vez, pelo MESMO caminho da tela
// (`fluxoService.atualizar` → `fluxoRepository.update`), então as ligações são
// remapeadas e a validação do DTO roda igual. E antes de gravar, o script:
//
//   1. converte o JSON pelo import do front (o mesmo código que o navegador usa);
//   2. confere as invariantes de interface (teto de 3 botões, texto livre sem
//      opção, todo destino existindo);
//   3. mostra o que vai acontecer e exige confirmação, salvo com `--sim`.
//
// Uso:
//   node publicar-fluxo-arka.js              mostra o plano e pede confirmação
//   node publicar-fluxo-arka.js --sim        grava
//   node publicar-fluxo-arka.js --dry        só confere e mostra, nunca grava
//   node publicar-fluxo-arka.js --backup     salva o fluxo atual em docs/ antes
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "error";

// O `.env` do servidor, como o resto da aplicacao. Sem isto o script exigia
// DATABASE_URL na linha de comando mesmo com o arquivo no lugar -- e quem tem o
// ambiente configurado nao deveria precisar repetir a variavel.
require("dotenv").config();

const path = require("path");
const { readFileSync, writeFileSync } = require("fs");
const readline = require("readline");

const ARQUIVO = path.join(__dirname, "..", "docs", "fluxo-arka.json");
const CONVERSOR = path.join(__dirname, "..", "client", "src", "components", "flow", "fluxoJson.js");

const argv = process.argv.slice(2);
const SIM = argv.includes("--sim");
const DRY = argv.includes("--dry");
const BACKUP = argv.includes("--backup");

// ── 1. converte pelo import do FRONT ────────────────────────────────────────
//
// O conversor é um módulo ES do navegador e este script roda em CommonJS. Avaliá-lo
// aqui exercita exatamente o código que a tela usa, em vez de uma cópia que
// envelheceria sozinha -- é a mesma costura de verificar-fluxo-arka.js.
function converter(json) {
  const fonte = readFileSync(CONVERSOR, "utf8");
  const mod = {};
  new Function(
    "exports",
    "const hojeISO = () => '1970-01-01';\n" +
      fonte
        .replace(/^\s*import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, "")
        .replace(/export /g, "") +
      "\n;exports.extrair = extrairFluxosImportados;"
  )(mod);
  const [convertido] = mod.extrair(json);
  if (!convertido) throw new Error("o conversor não devolveu nenhum fluxo");
  return convertido;
}

// ── 2. invariantes de INTERFACE ─────────────────────────────────────────────
//
// As mesmas regras que a matriz de testes cobra, conferidas aqui porque um fluxo
// publicado com elas violadas produz defeito na tela do CLIENTE (botão recusado
// pela Evolution, ou botão debaixo de uma pergunta aberta) -- e não uma falha de
// teste que alguém vê.
const LIMITE_BOTOES = 3;

function conferir(passos) {
  const erros = [];
  const ids = new Set(passos.map((p) => p.id));

  for (const p of passos) {
    const cfg = p.config || {};
    const opcoes = Array.isArray(cfg.opcoes) ? cfg.opcoes : [];
    const escolhas = opcoes.filter(
      (o) => o?.esperaEscolha === true || (o?.palavrasChave || []).some((k) => String(k || "").trim())
    );

    if (escolhas.length > LIMITE_BOTOES) {
      erros.push(`"${p.titulo}": ${escolhas.length} opções de escolha (limite ${LIMITE_BOTOES})`);
    }
    if (cfg.aguardar === "texto") {
      if (escolhas.length) erros.push(`"${p.titulo}": bloco de texto livre com opção de escolha`);
      if (!p.targetId) erros.push(`"${p.titulo}": bloco de texto livre sem saída (targetId)`);
    }
    if (cfg.aguardar === "nada" && !opcoes.some((o) => o?.acao === "transferir" || o?.acao === "encerrar")) {
      erros.push(`"${p.titulo}": declara "não aguarda nada" mas não transfere nem encerra`);
    }
    if (p.targetId && !ids.has(p.targetId)) {
      erros.push(`"${p.titulo}": targetId aponta para bloco inexistente`);
    }
    if (cfg.targetIdNaoCadastrado && !ids.has(cfg.targetIdNaoCadastrado)) {
      erros.push(`"${p.titulo}": targetIdNaoCadastrado aponta para bloco inexistente`);
    }
    for (const o of opcoes) {
      if (o?.targetId && !ids.has(o.targetId)) {
        erros.push(`"${p.titulo}"/${o.id}: targetId aponta para bloco inexistente`);
      }
    }
  }

  // Alcançabilidade a partir do gatilho. `comentario`, `espera` e `avaliacao` são
  // regras SOBRE a conversa, e não destinos -- por isso ficam fora da conta.
  const gatilho = passos.find((p) => p.tipo === "gatilho");
  if (!gatilho) {
    erros.push("o fluxo não tem bloco de gatilho");
  } else {
    const vistos = new Set();
    const pilha = [gatilho.id];
    while (pilha.length) {
      const atual = pilha.pop();
      if (vistos.has(atual)) continue;
      vistos.add(atual);
      const p = passos.find((x) => x.id === atual);
      if (!p) continue;
      const cfg = p.config || {};
      for (const t of [p.targetId, cfg.targetIdNaoCadastrado, ...(cfg.opcoes || []).map((o) => o?.targetId)]) {
        if (t) pilha.push(t);
      }
    }
    const orfaos = passos.filter(
      (p) => !vistos.has(p.id) && !["comentario", "espera", "avaliacao"].includes(p.tipo)
    );
    if (orfaos.length) {
      erros.push("blocos inalcançáveis: " + orfaos.map((p) => `"${p.titulo}"`).join(", "));
    }
  }

  return erros;
}

function resumir(passos) {
  const linhas = [];
  for (const p of passos) {
    const cfg = p.config || {};
    const opcoes = Array.isArray(cfg.opcoes) ? cfg.opcoes : [];
    const escolhas = opcoes.filter(
      (o) => o?.esperaEscolha === true || (o?.palavrasChave || []).some((k) => String(k || "").trim())
    );
    const marca = escolhas.length
      ? `${escolhas.length} botão(ões): ${escolhas.map((o) => o.botao || o.id).join(" | ")}`
      : cfg.aguardar === "texto"
        ? "TEXTO LIVRE (sem botões)"
        : cfg.aguardar === "cnpj"
          ? "CNPJ (texto livre)"
          : cfg.aguardar === "nada"
            ? `entrega para ${opcoes[0]?.setor || "a fila geral"}`
            : "-";
    linhas.push(`  [${String(p.ordem).padStart(2)}] ${p.tipo.padEnd(10)} ${String(p.titulo).padEnd(28)} ${marca}`);
  }
  return linhas.join("\n");
}

async function perguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const resposta = await new Promise((r) => rl.question(texto, r));
  rl.close();
  return String(resposta || "").trim().toLowerCase();
}

(async () => {
  if (!process.env.DATABASE_URL && !DRY) {
    console.error(
      "DATABASE_URL não está definida.\n" +
        "Defina-a (ou rode com --dry para só conferir o JSON, sem banco)."
    );
    process.exit(1);
  }

  const json = JSON.parse(readFileSync(ARQUIVO, "utf8"));
  const convertido = converter(json);
  const passos = convertido.passos;

  console.log(`\nFLUXO NO ARQUIVO: "${convertido.nome}"  gatilho "${convertido.gatilho}"  ${passos.length} blocos\n`);
  console.log(resumir(passos));

  const erros = conferir(passos);
  if (erros.length) {
    console.error(`\nINVARIANTES VIOLADAS (${erros.length}) -- nada foi gravado:`);
    for (const e of erros) console.error("  - " + e);
    process.exit(1);
  }
  console.log("\n✓ invariantes de interface OK (teto de 3 botões, texto livre sem opção, destinos válidos)");

  if (DRY) {
    console.log("\n--dry: nada foi gravado.");
    process.exit(0);
  }

  // Só agora o Prisma entra em cena: com `--dry` este script não precisa de banco.
  const fluxoRepository = require("./src/infrastructure/repositories/fluxo.repository");

  // QUAL FLUXO ATUALIZAR: o que tem o gatilho curinga, ou o de nome igual.
  //
  // Criar um segundo fluxo curinga seria pior do que não fazer nada: o motor
  // escolhe UM (`fluxoPadrao` devolve o primeiro que encontra), e a instalação
  // passaria a atender por um fluxo que ninguém sabe qual é.
  const existentes = await fluxoRepository.findAll();
  const alvo =
    existentes.find((f) => String(f.gatilho || "").trim() === "*") ||
    existentes.find((f) => f.nome === convertido.nome) ||
    null;

  const curingas = existentes.filter((f) => String(f.gatilho || "").trim() === "*");
  if (curingas.length > 1) {
    console.error(
      `\nHÁ ${curingas.length} FLUXOS COM O GATILHO "*" no banco:\n` +
        curingas.map((f) => `  - ${f.nome} (${f.id}, ${f.ativo ? "ativo" : "pausado"})`).join("\n") +
        "\nResolva a ambiguidade pela tela antes de publicar: o motor atende por um só."
    );
    process.exit(1);
  }

  if (BACKUP && alvo) {
    const destino = path.join(
      __dirname,
      "..",
      "docs",
      `fluxo-arka-antes-de-publicar-${new Date().toISOString().slice(0, 10)}.json`
    );
    writeFileSync(
      destino,
      JSON.stringify(
        {
          versao: 2,
          exportadoEm: new Date().toISOString().slice(0, 10),
          nome: alvo.nome,
          gatilho: alvo.gatilho,
          ativo: alvo.ativo,
          passos: (alvo.passos || []).map((p) => ({
            id: p.id, tipo: p.tipo, titulo: p.titulo, desc: p.descricao,
            texto: p.texto, config: p.config, x: p.posX, y: p.posY,
            targetId: p.targetId, ordem: p.ordem,
          })),
        },
        null,
        2
      ) + "\n",
      "utf8"
    );
    console.log(`\n✓ backup do fluxo atual: ${destino}`);
  }

  console.log(
    alvo
      ? `\nVAI SOBRESCREVER: "${alvo.nome}" (${alvo.id}) -- ${alvo.passos?.length || 0} blocos atuais`
      : "\nVAI CRIAR um fluxo novo (não há fluxo com gatilho \"*\" nem com este nome)"
  );

  if (!SIM) {
    const r = await perguntar('\nConfirma? digite "sim" para gravar: ');
    if (r !== "sim") {
      console.log("Cancelado. Nada foi gravado.");
      process.exit(0);
    }
  }

  // O MESMO caminho da tela: `update` remapeia as ligações e preserva o id dos
  // blocos que já existem (ver resolverIds/remapearConfig no repositório).
  const dados = {
    nome: convertido.nome,
    gatilho: convertido.gatilho,
    ativo: convertido.ativo !== false,
  };
  const gravado = alvo
    ? await fluxoRepository.update(alvo.id, dados, passos)
    : await fluxoRepository.create(dados, passos);

  console.log(`\n✓ gravado: "${gravado.nome}" (${gravado.id}) com ${gravado.passos.length} blocos`);
  console.log(
    "\nPróximo passo: `node verificar-fluxo-arka.js` valida o ARQUIVO.\n" +
      "Para conferir o que ficou no BANCO, use Fluxos → Testar na tela."
  );
  process.exit(0);
})().catch((e) => {
  console.error("ERRO", e.message || e);
  process.exit(1);
});
