// POR QUE O FLUXO NÃO ESTÁ SE COMPORTANDO COMO O DESENHO?
//
//   node diagnosticar-instalacao.js
//
// ── O PROBLEMA QUE ESTE SCRIPT EXISTE PARA MATAR ─────────────────────────────
//
// A espera do bot é um CONTRATO ENTRE DUAS METADES que vivem em lugares
// diferentes e sobem por caminhos diferentes:
//
//   o FLUXO   declara `config.aguardar: "texto"`   -- vive no BANCO de cada
//                                                     instalação, sobe por
//                                                     import/publicação
//   o MOTOR   honra essa declaração                -- vive no CÓDIGO, sobe por
//                                                     git pull + rebuild
//
// Quando só uma das metades chega, o sintoma é confuso e aponta para o lado
// errado. Foi o que aconteceu: o fluxo do banco tinha os TEXTOS novos
// ("Identificação", "Descreva sua solicitação") e o motor era o antigo, sem
// `aguardar: "texto"` -- então o bot mandava as duas perguntas de uma vez e
// parecia que o fluxo estava errado. O fluxo estava; o motor também; nenhum dos
// dois era o entregue.
//
// Este script compara as duas metades e diz, bloco por bloco, o que o cliente
// VAI receber. Ele é somente leitura: não grava nada, em banco nenhum.
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "error";
require("dotenv").config();

const { execSync } = require("child_process");

const problemas = [];
const avisos = [];

function titulo(t) {
  console.log(`\n${"═".repeat(72)}\n${t}\n${"═".repeat(72)}`);
}

(async () => {
  titulo("1. O MOTOR que está rodando neste código");

  // ── A IMPRESSÃO DIGITAL DO MOTOR ─────────────────────────────────────────
  //
  // Não se pergunta a versão (não há uma): pergunta-se se o RECURSO existe. É a
  // única checagem que não mente -- um `package.json` bumpado à mão diria a
  // versão nova sobre um código antigo.
  const engine = require("./src/modules/chatbot/chatbot.engine");
  const recursos = [
    ["espera por resposta livre (aguardar: \"texto\")", engine.AGUARDANDO?.TEXTO === "texto"],
    ["entrega sem esperar (aguardar: \"nada\")", typeof engine.passoNaoAguarda === "function"],
    ["teto de 3 botões exportado", engine.MAX_BOTOES_POR_MENSAGEM === 3],
    ["resposta livre expira por inatividade", (engine.AGUARDA_RESPOSTA_DO_CLIENTE || []).includes("texto")],
    ["módulo de horário de atendimento", (() => { try { require("./src/modules/chatbot/chatbot.horario"); return true; } catch { return false; } })()],
  ];
  for (const [nome, ok] of recursos) {
    console.log(`  ${ok ? "OK     " : "AUSENTE"} ${nome}`);
    if (!ok) problemas.push(`o motor deste código não tem: ${nome}`);
  }

  try {
    const head = execSync("git rev-parse --short HEAD", { cwd: __dirname + "/..", stdio: ["ignore", "pipe", "ignore"] })
      .toString().trim();
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: __dirname + "/..", stdio: ["ignore", "pipe", "ignore"] })
      .toString().trim();
    console.log(`\n  git: ${branch} @ ${head}`);
  } catch {
    console.log("\n  git: (não é um clone, ou o git não está disponível)");
  }

  if (problemas.length) {
    console.log(
      "\n  ⚠ O MOTOR ESTÁ DESATUALIZADO. Nenhuma publicação de fluxo vai fazer o bot\n" +
        "    esperar, porque é o motor que honra a declaração. Atualize o código antes:\n" +
        "        bash deploy/atualizar.sh"
    );
  }

  titulo("2. O FLUXO que está no BANCO desta instalação");

  if (!process.env.DATABASE_URL) {
    console.log("  DATABASE_URL não definida -- não há banco para conferir.");
    console.log("  (rode na VM, ou defina DATABASE_URL apontando para o banco desta instalação)");
    console.log(
      "\n" + (problemas.length ? `PROBLEMAS (${problemas.length}):\n  - ` + problemas.join("\n  - ") : "Motor OK.")
    );
    process.exit(problemas.length ? 1 : 0);
  }

  const fluxoRepository = require("./src/infrastructure/repositories/fluxo.repository");
  const ativos = (await fluxoRepository.findAtivos()) || [];
  const curingas = ativos.filter((f) => String(f.gatilho || "").trim() === "*");

  console.log(`  fluxos ativos: ${ativos.length}   com gatilho "*": ${curingas.length}`);
  if (curingas.length === 0) problemas.push('nenhum fluxo ATIVO com gatilho "*": o bot não abre na primeira mensagem');
  if (curingas.length > 1) {
    problemas.push(
      `${curingas.length} fluxos ativos com gatilho "*" -- o motor atende por UM só, e qual é indefinido`
    );
    for (const f of curingas) console.log(`    - ${f.nome} (${f.id})`);
  }

  const fluxo = curingas[0] || ativos[0];
  if (!fluxo) {
    console.log("  (nenhum fluxo ativo)");
    console.log(`\nPROBLEMAS (${problemas.length}):\n  - ` + problemas.join("\n  - "));
    process.exit(1);
  }

  console.log(`\n  Conferindo: "${fluxo.nome}" (${fluxo.id}) -- ${fluxo.passos.length} blocos\n`);

  const eng = new engine.ChatbotEngine();
  const LIMITE = engine.MAX_BOTOES_POR_MENSAGEM || 3;
  const porId = new Map(fluxo.passos.map((p) => [p.id, p]));

  for (const p of eng.ordenarPassos(fluxo.passos)) {
    if (["comentario", "espera", "avaliacao", "gatilho"].includes(p.tipo)) continue;

    const cfg = p.config || {};
    const opcoes = eng.opcoesDoPasso(p);
    const escolhas = opcoes.filter((o) => eng._opcaoEhEscolha(o));
    const aguardar = cfg.aguardar || null;

    // O QUE O CLIENTE VAI RECEBER, segundo o motor DESTE código.
    let veredito;
    if (aguardar === "texto" && engine.AGUARDANDO?.TEXTO) {
      veredito = "texto puro, e PARA esperando a resposta";
    } else if (aguardar === "texto") {
      veredito = "SEGUE SEM ESPERAR (o motor deste código não conhece aguardar:\"texto\")";
      problemas.push(`"${p.titulo}" declara aguardar:"texto" mas o motor é antigo: não vai esperar`);
    } else if (aguardar === "cnpj" || (!opcoes.length && eng.passoAguardaCnpj(p))) {
      veredito = "texto puro, e PARA esperando o CNPJ";
    } else if (aguardar === "nada") {
      veredito = engine.passoNaoAguarda
        ? "fala e ENTREGA na mesma volta"
        : "ESTACIONA indevidamente (motor antigo não conhece aguardar:\"nada\")";
      if (!engine.passoNaoAguarda) problemas.push(`"${p.titulo}" declara aguardar:"nada" mas o motor é antigo`);
    } else if (escolhas.length) {
      veredito = `${escolhas.length} botão(ões)`;
      if (escolhas.length > LIMITE) {
        problemas.push(`"${p.titulo}" tem ${escolhas.length} opções de escolha (o WhatsApp aceita ${LIMITE})`);
        veredito += ` -- ACIMA DO LIMITE de ${LIMITE}`;
      }
    } else if (opcoes.length) {
      // Opção sem palavra-chave: o curinga que virava o botão "resposta livre".
      const espera = eng.decidirEsperaDoPasso(p, fluxo.passos);
      if (espera.estaciona) {
        veredito = `1 BOTÃO indesejado ("${opcoes[0].botao || opcoes[0].rotulo || opcoes[0].id}") -- é o curinga`;
        problemas.push(
          `"${p.titulo}" espera por meio de uma opção curinga: ela aparece como BOTÃO debaixo da pergunta. ` +
            `Troque por config.aguardar:"texto" e remova as opções.`
        );
      } else {
        veredito = "fim do fluxo (entrega)";
      }
    } else if (p.targetId) {
      veredito = "SEGUE SEM ESPERAR para o bloco seguinte";
      avisos.push(
        `"${p.titulo}" não tem opção nem declaração: o motor envia e SEGUE na mesma volta. ` +
          `Se este bloco faz uma pergunta, ele precisa de config.aguardar:"texto".`
      );
    } else {
      veredito = "fala e termina (a conversa vai para a fila sem OS garantida)";
      avisos.push(`"${p.titulo}" não tem saída nem opção: o fluxo morre nele`);
    }

    const destino = p.targetId ? porId.get(p.targetId)?.titulo || "(id morto)" : "—";
    console.log(`  ${String(p.ordem).padStart(2)} ${String(p.titulo).slice(0, 26).padEnd(26)} ${veredito}`);
    console.log(`     ${" ".repeat(26)} segue para: ${destino}`);

    if (p.targetId && !porId.has(p.targetId)) {
      problemas.push(`"${p.titulo}": targetId aponta para um bloco que não existe`);
    }
    if (cfg.targetIdNaoCadastrado && !porId.has(cfg.targetIdNaoCadastrado)) {
      problemas.push(`"${p.titulo}": targetIdNaoCadastrado aponta para um bloco que não existe`);
    }
  }

  titulo("3. HORÁRIO DE ATENDIMENTO");
  try {
    const cfgSvc = require("./src/modules/configuracoes/configuracao.service");
    const h = await cfgSvc.horarioAtendimento();
    const mod = require("./src/modules/chatbot/chatbot.horario");
    if (!h.ativo) {
      console.log("  regra DESLIGADA -- o bot atende a qualquer hora (padrão do sistema)");
    } else if (!mod.temAlgumPeriodo(h)) {
      console.log("  regra ATIVA mas sem nenhum período legível");
      problemas.push("o horário está ativo e sem período válido: o bot considera a empresa sempre fechada");
    } else {
      console.log(`  regra ATIVA  fuso=${h.timezone}  exceções=${h.excecoes.length}`);
      console.log(mod.resumoHorario(h, { incluirFechados: true }).split("\n").map((l) => "    " + l).join("\n"));
      console.log(`  agora: ${mod.foraDoHorario(h) ? "FORA do expediente" : "dentro do expediente"}`);
    }
  } catch (e) {
    console.log(`  (não foi possível ler: ${e.message})`);
  }

  titulo("VEREDITO");
  if (avisos.length) {
    console.log(`AVISOS (${avisos.length}) -- podem ser intencionais:`);
    for (const a of avisos) console.log("  · " + a);
    console.log("");
  }
  if (problemas.length) {
    console.log(`PROBLEMAS (${problemas.length}):`);
    for (const p of problemas) console.log("  - " + p);
    console.log(
      "\nAS DUAS METADES, na ordem:\n" +
        "  1. o MOTOR:  bash deploy/atualizar.sh          (git pull + rebuild)\n" +
        "  2. o FLUXO:  node publicar-fluxo-arka.js --backup --dry   e depois sem --dry\n" +
        "\nNa ordem inversa não funciona: o fluxo declara, o motor honra."
    );
  } else {
    console.log("As duas metades batem: o motor honra o que o fluxo declara.");
  }
  process.exit(problemas.length ? 1 : 0);
})().catch((e) => {
  console.error("ERRO", e.message || e);
  process.exit(1);
});
