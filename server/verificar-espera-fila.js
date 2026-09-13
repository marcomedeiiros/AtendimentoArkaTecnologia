/**
 * A ESPERA NA FILA NAO PODE SER ZERADA PELO PROPRIO SISTEMA.
 *
 * ── O QUE ACONTECIA ────────────────────────────────────────────────────────
 *
 * O cartao da fila do Modo TV contava a espera a partir da ULTIMA MENSAGEM da
 * conversa -- qualquer uma, de qualquer lado. Aos 10 minutos o varredor manda
 * "Ei! Estamos com uma demanda alta no momento...", essa mensagem vira a ultima
 * do fio, e o painel voltava a marcar "agora".
 *
 * Tres estragos de uma vez, e o do meio era o pior:
 *
 *   O RELOGIO zerava, entao a espera mostrada nunca passava de 10 minutos.
 *   A ORDEM invertia: a fila e ordenada pela mesma data, e a conversa recem
 *     avisada passava a ser a de mensagem mais recente -- quem mais esperou ia
 *     para o FIM da lista.
 *   A COR voltava ao verde, e o painel parava de sinalizar justamente o cliente
 *     mais abandonado.
 *
 * ── O QUE ESTA TRAVADO AQUI ────────────────────────────────────────────────
 *
 * Que a ancora seja "entrou na fila" e nao "ultima mensagem"; que a escada de
 * fallback seja a mesma do motor; que a sessao -- de onde sai o instante --
 * viaje TAMBEM nos eventos de tempo real, que e onde um campo somem sem
 * ninguem notar; e que os tres lugares que respondem a esta pergunta usem o
 * mesmo helper, em vez de tres contas parecidas.
 */
const path = require("path");
const fs = require("fs");

const erros = [];
function check(nome, problemas) {
  if (problemas.length) {
    erros.push(nome);
    console.log("  FALHA " + nome);
    for (const p of problemas) console.log("        " + p);
  } else {
    console.log("  OK   " + nome);
  }
}

console.log("=== Espera na fila ===");

// ── 1. A ESCADA, EXECUTADA ───────────────────────────────────────────────────
//
// Nao e leitura de texto: a funcao roda, com os quatro formatos de conversa que
// existem de verdade.
{
  const { entrouNaFilaEm } = require(path.join(__dirname, "src/shared/helpers/espera.helper"));
  const handoff = new Date("2026-09-13T11:30:00Z");
  const aberto = new Date("2026-09-13T11:20:00Z");
  const criado = new Date("2026-01-01T00:00:00Z");
  const problemas = [];

  const casos = [
    [
      "handoff do bot vence tudo",
      { sessao: { concluidoEm: handoff }, atendimentoAtualId: "x", atendimentos: [{ id: "x", abertoEm: aberto }], criadoEm: criado },
      handoff,
    ],
    [
      "sem handoff, vale a abertura da OS em curso",
      { atendimentoAtualId: "x", atendimentos: [{ id: "x", abertoEm: aberto }], criadoEm: criado },
      aberto,
    ],
    [
      "sessao sem concluidoEm desce um degrau",
      { sessao: { concluidoEm: null }, atendimentoAtualId: "x", atendimentos: [{ id: "x", abertoEm: aberto }], criadoEm: criado },
      aberto,
    ],
    ["fio antigo, sem OS nenhuma", { atendimentos: [], criadoEm: criado }, criado],
    ["conversa vazia nao explode", {}, null],
    ["null nao explode", null, null],
  ];

  for (const [nome, entrada, esperado] of casos) {
    const obtido = entrouNaFilaEm(entrada);
    if (String(obtido) !== String(esperado)) {
      problemas.push(nome + ": esperado " + esperado + ", veio " + obtido);
    }
  }
  check("a escada da ancora: handoff, OS, criacao", problemas);
}

// ── 2. A SESSAO VIAJA NO EVENTO DE TEMPO REAL ────────────────────────────────
//
// ESTE E O CHECK QUE MAIS IMPORTA, e o menos obvio. O payload dos eventos SSE
// tem `include` PROPRIO -- ele nao usa o INCLUDE_CONVERSA. Sem a sessao ali, o
// campo viria certo no carregamento e sumiria a cada evento: a tela trocaria o
// valor bom por vazio exatamente quando a conversa se mexe, que e o momento em
// que alguem esta olhando.
{
  const repo = fs.readFileSync(
    path.join(__dirname, "src/infrastructure/repositories/conversa.repository.js"),
    "utf8"
  );
  const problemas = [];

  const inc = repo.match(/const INCLUDE_CONVERSA = \{[\s\S]*?\n\};/);
  if (!inc) problemas.push("nao achei o INCLUDE_CONVERSA");
  else if (!/^\s*sessao: true,/m.test(inc[0])) {
    problemas.push("o INCLUDE_CONVERSA nao carrega mais a sessao -- a ancora cai para criadoEm");
  }

  const evento = repo.match(/async findByIdParaEvento\([\s\S]*?\n  \}/);
  if (!evento) problemas.push("nao achei o findByIdParaEvento");
  else if (!/^\s*sessao: true,/m.test(evento[0])) {
    problemas.push("o evento de tempo real nao leva a sessao -- o campo some a cada SSE");
  }

  check("a sessao viaja no carregamento E no evento", problemas);
}

// ── 3. NINGUEM VOLTOU A CONTAR PELA ULTIMA MENSAGEM ──────────────────────────
{
  const dto = fs.readFileSync(path.join(__dirname, "src/shared/helpers/mapper.helper.js"), "utf8");
  const painel = fs.readFileSync(
    path.join(__dirname, "src/modules/dashboard/painel.service.js"),
    "utf8"
  );
  const central = fs.readFileSync(
    path.join(__dirname, "../client/src/components/pages/AtendimentoView.jsx"),
    "utf8"
  );
  const problemas = [];

  if (!dto.includes("entrouNaFilaEm: entrouNaFilaISO(c)")) {
    problemas.push("o DTO da conversa nao expoe mais o entrouNaFilaEm");
  }
  if (!painel.includes("esperaDesde: entrouNaFilaISO(c)")) {
    problemas.push("o _fila do painel voltou a calcular a espera por conta propria");
  }
  if (/esperaDesde: new Date\(c\.atualizadoEm\)/.test(painel)) {
    problemas.push("o _fila voltou ao atualizadoEm, que anda a cada gravacao na linha");
  }
  if (!central.includes("esperaDesde: c.entrouNaFilaEm || c.ultimaMensagemEm")) {
    problemas.push("a fila da Central nao usa mais a ancora (ou perdeu o fallback do payload antigo)");
  }
  // A ORDEM, que era o estrago mais silencioso dos tres.
  if (!/\.sort\(\(a, b\) => new Date\(a\.entrouNaFilaEm \|\| a\.ultimaMensagemEm/.test(central)) {
    problemas.push("a fila voltou a ser ordenada pela ultima mensagem -- quem mais espera cai para o fim");
  }

  check("os tres lugares usam a mesma ancora", problemas);
}

// ── 4. O MOTOR CONTINUA COM O RELOGIO DELE ───────────────────────────────────
//
// O aviso dispara pela mesma ideia ("entrou na fila"), e e de la que a escada
// deste helper foi copiada. Se o motor voltar a contar da abertura da OS, o
// aviso volta a chegar no meio da triagem -- defeito ja corrigido uma vez.
{
  const engine = fs.readFileSync(
    path.join(__dirname, "src/modules/chatbot/chatbot.engine.js"),
    "utf8"
  );
  const problemas = [];
  if (!engine.includes("const entrouNaFila = conversa.sessao?.concluidoEm || null;")) {
    problemas.push("o motor nao conta mais do handoff -- o aviso volta a incluir a triagem do bot");
  }
  check("o disparo do aviso continua ancorado no handoff", problemas);
}

console.log(
  "\n" + (erros.length ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ") : "ESPERA NA FILA: TUDO CONFERE")
);
process.exit(erros.length ? 1 : 0);
