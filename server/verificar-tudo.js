// Script temporario de verificacao. Cobre:
//  1. o simulador (motor real com deps em memoria) contra o fluxo ARKA
//  2. mapa de filas -> setor
//  3. fora do horario de atendimento
//  4. encerramento por inatividade
const path = require("path");
const { readFileSync } = require("fs");

const raiz = path.join(__dirname, "src");
const { ChatbotEngine } = require(path.join(raiz, "modules/chatbot/chatbot.engine"));
const simulador = require(path.join(raiz, "modules/chatbot/chatbot.simulador"));

// ── converte o JSON da ARKA como o import faria, no formato do repositorio ----
const fonte = readFileSync(
  path.join(__dirname, "..", "client", "src", "components", "flow", "fluxoJson.js"),
  "utf8"
);
const mod = {};
new Function("exports", fonte.replace(/export /g, "") + "\n;exports.extrair = extrairFluxosImportados;")(mod);
const [convertido] = mod.extrair(
  JSON.parse(readFileSync(path.join(__dirname, "..", "docs", "fluxo-arka.json"), "utf8"))
);

const fluxo = {
  id: "f-arka",
  nome: convertido.nome,
  gatilho: convertido.gatilho,
  ativo: true,
  passos: convertido.passos.map((p) => ({
    id: p.id,
    tipo: p.tipo,
    titulo: p.titulo,
    descricao: p.desc,
    texto: p.texto || null,
    config: p.config || null,
    targetId: p.targetId,
    ordem: p.ordem,
  })),
};

const erros = [];
const check = (cond, msg) => { if (!cond) erros.push(msg); };
const linha1 = (t) => String(t || "").split("\n")[0].slice(0, 58);

function mostrar(titulo, r) {
  console.log(`\n=== ${titulo} ===`);
  for (const t of r.turnos) {
    console.log(`  cliente: "${t.entrada}"`);
    t.respostas.forEach((x) => console.log(`     bot: ${linha1(x)}`));
    if (!t.respostas.length) console.log("     bot: (silencio)");
    const tags = [
      t.passoAtualTitulo && `em=${t.passoAtualTitulo}`,
      t.aguardando && `aguardando=${t.aguardando}`,
      `status=${t.status}`,
      t.setor && t.setor !== "Geral" && `setor=${t.setor}`,
      t.filaId != null && `fila=${t.filaId}`,
      t.transferido && "TRANSFERIDO",
      t.encerrado && "ENCERRADO",
    ].filter(Boolean);
    console.log(`     [${tags.join(" ")}]`);
  }
}

(async () => {
  // ---- 1. simulador: caminho completo do suporte -------------------------
  let r = await simulador.simular(fluxo, ["oi", "1", "tenho contrato", "Empresa X, Joao, TI", "trocar toner"], {
    nomeCliente: "Maria",
    filas: { 33: "Suporte", 35: "Comercial" },
  });
  mostrar("simulador: suporte com contrato (fila 33 -> Suporte)", r);
  check(r.turnos.length === 5, `esperava 5 turnos, veio ${r.turnos.length}`);
  check(
    r.turnos[0].respostas[0]?.includes("Maria"),
    "nao interpolou {{name}} com o nome informado na simulacao"
  );
  check(r.turnos[0].passoAtualTitulo === "Boas Vindas", `parou em ${r.turnos[0].passoAtualTitulo}`);
  check(r.turnos[1].passoAtualTitulo === "SUPORTE", `parou em ${r.turnos[1].passoAtualTitulo}`);
  const ultimo = r.turnos[4];
  check(ultimo.transferido, "nao transferiu no fim do caminho");
  check(ultimo.filaId === 33, `filaId=${ultimo.filaId}`);
  check(ultimo.setor === "Suporte", `setor=${ultimo.setor}, esperado Suporte (mapa de filas)`);
  check(r.finalizado === true, "finalizado deveria ser true");

  // ---- 2. simulador: comercial -> vendedor (fila 35 -> Comercial) --------
  r = await simulador.simular(fluxo, ["ola", "2", "produtos", "quero um notebook"], {
    filas: { 33: "Suporte", 35: "Comercial" },
  });
  mostrar("simulador: comercial (fila 35 -> Comercial)", r);
  check(r.turnos[3].setor === "Comercial", `setor=${r.turnos[3].setor}`);
  check(r.turnos[3].filaId === 35, `filaId=${r.turnos[3].filaId}`);

  // ---- 3. simulador: encerrar pelo menu ---------------------------------
  r = await simulador.simular(fluxo, ["oi", "4"], {});
  mostrar("simulador: encerrar pela opcao 4", r);
  check(r.turnos[1].encerrado, "nao encerrou");
  check(r.turnos[1].status === "fechada", `status=${r.turnos[1].status}`);
  check(/Arka agradece/.test(r.turnos[1].respostas[0] || ""), "nao usou o closeTicket do fluxo");

  // ---- 4. simulador para depois de finalizar ----------------------------
  r = await simulador.simular(fluxo, ["oi", "4", "ainda esta ai?"], {});
  check(r.turnos.length === 2, `deveria parar em 2 turnos, veio ${r.turnos.length}`);

  // ---- 5. sem gatilho casando e sem curinga -> nao entra no fluxo -------
  const fluxoComGatilho = { ...fluxo, gatilho: "orcamento" };
  r = await simulador.simular(fluxoComGatilho, ["oi"], {});
  mostrar('simulador: gatilho "orcamento" nao casa com "oi"', r);
  check(!r.turnos[0].respostas.length, "respondeu sem o gatilho casar");
  r = await simulador.simular(fluxoComGatilho, ["quero um orcamento"], {});
  check(
    /Bem-vindo\(a\) à ARKA/.test(r.turnos[0].respostas[0] || ""),
    "gatilho por palavra-chave nao abriu o fluxo"
  );

  // ---- 6. fora do horario de atendimento -------------------------------
  const engine = new ChatbotEngine();
  const seg10h = new Date("2026-08-17T10:00:00");   // segunda
  const seg20h = new Date("2026-08-17T20:00:00");
  const dom10h = new Date("2026-08-16T10:00:00");   // domingo
  const comercial = { ativo: true, inicio: "08:00", fim: "18:00", dias: [1, 2, 3, 4, 5] };

  console.log("\n=== fora do horario ===");
  const casos = [
    [comercial, seg10h, false, "segunda 10h dentro do comercial"],
    [comercial, seg20h, true, "segunda 20h fora"],
    [comercial, dom10h, true, "domingo fora (dia nao atendido)"],
    [{ ativo: false, inicio: "08:00", fim: "18:00", dias: [1] }, seg20h, false, "config desligada atende sempre"],
    [{ ativo: true, inicio: "xx:yy", fim: "18:00", dias: [1] }, seg20h, false, "horario invalido nao bloqueia"],
    // Janela virando a meia-noite: plantao 22h-06h de segunda a sexta.
    [{ ativo: true, inicio: "22:00", fim: "06:00", dias: [1, 2, 3, 4, 5] }, new Date("2026-08-17T23:30:00"), false, "plantao 23h30 dentro"],
    [{ ativo: true, inicio: "22:00", fim: "06:00", dias: [1, 2, 3, 4, 5] }, new Date("2026-08-18T03:00:00"), false, "plantao 3h (madrugada de terca) dentro"],
    [{ ativo: true, inicio: "22:00", fim: "06:00", dias: [1, 2, 3, 4, 5] }, new Date("2026-08-18T12:00:00"), true, "plantao meio-dia fora"],
  ];
  for (const [cfg, quando, esperado, rotulo] of casos) {
    const obtido = engine.foraDoHorario(cfg, quando);
    const ok = obtido === esperado;
    if (!ok) erros.push(`horario "${rotulo}": esperado fora=${esperado}, obtido ${obtido}`);
    console.log(`  ${ok ? "OK  " : "FALHA"} ${rotulo} -> fora=${obtido}`);
  }

  // ---- 7. inatividade --------------------------------------------------
  console.log("\n=== inatividade ===");
  const cfgInatividade = engine.configuracaoInatividade(fluxo);
  check(cfgInatividade !== null, "nao leu o notResponseMessage do fluxo importado");
  check(cfgInatividade?.minutos === 10, `minutos=${cfgInatividade?.minutos}, esperado 10`);
  check(cfgInatividade?.encerrar === true, "type 3 deveria encerrar");
  console.log(`  config lida do fluxo: ${JSON.stringify(cfgInatividade)}`);

  // Sessao parada ha mais tempo que o limite: tem que encerrar com a mensagem.
  const enviadasInat = [];
  const conversaInat = { id: "c9", cliente: "Joana", telefone: "551188", statusAtendimento: "pendente" };
  const engineInat = new ChatbotEngine({
    fluxoRepository: { findById: async () => fluxo, createLog: async () => {} },
    conversaRepository: {
      findById: async () => conversaInat,
      addMensagem: async (_i, origem, texto) => { if (origem === "bot") enviadasInat.push(texto); return { id: "m" }; },
      vincularWaMessageId: async () => {},
      update: async (_i, d) => Object.assign(conversaInat, d),
    },
    sessaoRepository: { upsert: async () => ({}), update: async () => ({}) },
    evolutionApi: { sendText: async () => ({ key: { id: "x" } }) },
    bus: { emitConversa: () => {} },
  });

  const sessaoVelha = {
    id: "s9", ativo: true, fluxoAtualId: fluxo.id, telefone: "551188",
    aguardando: "opcao",
    atualizadoEm: new Date(Date.now() - 11 * 60 * 1000),
  };
  const resInat = await engineInat.aplicarInatividade(sessaoVelha, {
    conversa: conversaInat, instanciaId: "i1", instanceName: "arka",
  });
  console.log(`  sessao parada 11min -> ${resInat ? "agiu" : "nada"} | bot: ${linha1(enviadasInat[0])}`);
  check(resInat?.encerrado === true, "nao encerrou por inatividade");
  check(conversaInat.statusAtendimento === "fechada", `status=${conversaInat.statusAtendimento}`);
  check(
    /por falta de intera/i.test(enviadasInat[0] || ""),
    "nao enviou a mensagem de inatividade do fluxo"
  );

  // Sessao recente: nao pode mexer.
  const sessaoNova = { ...sessaoVelha, atualizadoEm: new Date(Date.now() - 60 * 1000) };
  const resNova = await engineInat.aplicarInatividade(sessaoNova, {
    conversa: conversaInat, instanciaId: "i1", instanceName: "arka",
  });
  console.log(`  sessao parada 1min -> ${resNova ? "agiu (ERRADO)" : "nada (ok)"}`);
  check(resNova === null, "agiu numa sessao que ainda nao estourou o tempo");

  // Conversa entregue ao humano nao e mais do bot.
  const resHumano = await engineInat.aplicarInatividade(
    { ...sessaoVelha, aguardando: "humano" },
    { conversa: conversaInat, instanciaId: "i1", instanceName: "arka" }
  );
  check(resHumano === null, "mexeu numa conversa que ja estava com atendente");

  console.log(
    "\n" + (erros.length ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ") : "TODAS AS VERIFICACOES PASSARAM")
  );
  process.exit(erros.length ? 1 : 0);
})().catch((e) => { console.error("ERRO", e); process.exit(1); });
