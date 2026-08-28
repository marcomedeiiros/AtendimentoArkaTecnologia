// Verificacao de ponta a ponta do FLUXO -- `npm test`.
//
// Nao e mais "temporario": este script roda o MOTOR REAL (com repositorios em
// memoria, via chatbot.simulador) contra o fluxo publicado em
// docs/fluxo-arka.json, conversando com ele mensagem por mensagem.
//
// Ele ficou tempo demais sem ser executado e apodreceu em silencio: nao
// compilava (o conversor do front ganhou um `import`), cobrava um `closeTicket`
// que o fluxo nao tem mais, esperava o setor "Suporte" -- nome que nao existe na
// lista canonica -- e conferia um timeout de 10 minutos que o bot nao usa. Um
// teste que ninguem roda e pior do que teste nenhum: ele da a impressao de
// cobertura. Rode-o antes de mexer no fluxo ou no motor.
//
// Cobre:
//  1. o caminho completo do Tecnico com contrato (menu -> CNPJ -> fila 33)
//  2. Comercial e Financeiro: confirmacao antes da fila, e setor correto
//  3. CNPJ esgotado: entrega para a fila COM aviso (regressao do handoff mudo)
//  4. mapa de filas invalido nao rebaixa o setor escolhido pelo cliente
//  5. o log interno da validacao de CNPJ nao vaza para o cliente
//  6. pesquisa de satisfacao, fora do horario e encerramento por inatividade
const path = require("path");
const { readFileSync } = require("fs");

const raiz = path.join(__dirname, "src");
const { ChatbotEngine } = require(path.join(raiz, "modules/chatbot/chatbot.engine"));
const simulador = require(path.join(raiz, "modules/chatbot/chatbot.simulador"));
const { paramsTempos } = require(path.join(raiz, "modules/fluxos/fluxo.automacao"));

// ── converte o JSON da ARKA como o import faria, no formato do repositorio ----
const fonte = readFileSync(
  path.join(__dirname, "..", "client", "src", "components", "flow", "fluxoJson.js"),
  "utf8"
);
// O conversor e um modulo ES do front, e este script roda em CommonJS: o jeito
// de exercitar EXATAMENTE o codigo que o navegador usa (em vez de uma copia que
// envelhece) e avalia-lo aqui dentro.
//
// As linhas `import` precisam sair -- `new Function` nao as aceita. Antes o
// script so removia `export `, e no dia em que o conversor ganhou um import ele
// parou de rodar por completo: nao era um teste falhando, era um teste que nao
// executava mais. `hojeISO` so serve para montar o nome do arquivo exportado e
// nao participa da conversao, entao um stub basta.
const mod = {};
const fonteCJS = fonte
  .replace(/^\s*import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, "")
  .replace(/export /g, "");
new Function(
  "exports",
  "const hojeISO = () => '1970-01-01';\n" +
    fonteCJS +
    "\n;exports.extrair = extrairFluxosImportados;"
)(mod);
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
  // ---- 1. simulador: caminho completo do tecnico com contrato -------------
  //
  // O roteiro percorre o fluxo INTEIRO, um passo por resposta:
  //   menu -> Tecnico -> "tenho contrato" -> CNPJ -> confirma o resultado ->
  //   nome/setor -> descricao do problema -> fila 33.
  //
  // Antes ele pulava do "tenho contrato" direto para "Empresa X, Joao, TI",
  // como se o passo de CNPJ nao existisse -- o bot respondia "nao entendemos o
  // que voce falou" duas vezes e o script ainda assim se dizia satisfeito.
  const CNPJ_TESTE = "11.222.333/0001-81"; // valido nos digitos, sem parceiro na base
  let r = await simulador.simular(
    fluxo,
    ["oi", "1", "tenho contrato", CNPJ_TESTE, "1", "Joao, TI", "trocar toner"],
    { nomeCliente: "Maria", filas: { 33: "Técnico", 35: "Comercial" } }
  );
  mostrar("simulador: tecnico com contrato (fila 33 -> Técnico)", r);
  check(r.turnos.length === 7, `esperava 7 turnos, veio ${r.turnos.length}`);
  check(
    r.turnos[0].respostas[0]?.includes("Maria"),
    "nao interpolou {{name}} com o nome informado na simulacao"
  );
  check(r.turnos[0].passoAtualTitulo === "Boas Vindas", `parou em ${r.turnos[0].passoAtualTitulo}`);
  check(r.turnos[1].passoAtualTitulo === "SUPORTE", `parou em ${r.turnos[1].passoAtualTitulo}`);
  check(
    r.turnos[2].aguardando === "cnpj",
    `depois de "tenho contrato" o bot deveria pedir o CNPJ, veio ${r.turnos[2].aguardando}`
  );
  const ultimo = r.turnos[r.turnos.length - 1];
  check(ultimo.transferido, "nao transferiu no fim do caminho");
  check(ultimo.filaId === 33, `filaId=${ultimo.filaId}`);
  check(ultimo.setor === "Técnico", `setor=${ultimo.setor}, esperado Técnico (escolha do menu)`);
  check(r.finalizado === true, "finalizado deveria ser true");

  // A CONFIRMACAO DE ENCAMINHAMENTO SAI, e nao e a `welcomeMessage`.
  // Regressao do `if (avisar) {}` vazio: o cliente ia para a fila em silencio.
  const fechoTec = ultimo.respostas.join("\n");
  check(/Chamado aberto com sucesso/.test(fechoTec), `sem confirmacao no handoff tecnico: ${fechoTec}`);
  check(!/Agora sim/.test(fechoTec), "ainda usa a welcomeMessage como aviso de transferencia");

  // O RESULTADO DA CONSULTA DE CNPJ E INTERNO: nao pode aparecer em bolha
  // nenhuma da conversa.
  const tudoQueOBotFalou = r.turnos.flatMap((t) => t.respostas).join("\n");
  check(
    !/Cliente identificado/.test(tudoQueOBotFalou),
    "vazou o log interno da validacao de CNPJ para o cliente"
  );

  // ---- 2. simulador: comercial -> vendedor (fila 35 -> Comercial) --------
  r = await simulador.simular(fluxo, ["ola", "2", "produtos", "quero um notebook"], {
    filas: { 33: "Técnico", 35: "Comercial" },
  });
  mostrar("simulador: comercial (fila 35 -> Comercial)", r);
  check(r.turnos[3].setor === "Comercial", `setor=${r.turnos[3].setor}`);
  check(r.turnos[3].filaId === 35, `filaId=${r.turnos[3].filaId}`);
  check(
    /Solicita..o comercial registrada/.test(r.turnos[3].respostas.join("\n")),
    "comercial nao confirmou a solicitacao antes da fila"
  );

  // ---- 2b. FINANCEIRO: confirma e cai no setor certo apesar da fila 35 ----
  //
  // A fila 35 e a MESMA do Comercial neste fluxo (o ID real da fila financeira
  // ainda precisa ser confirmado na instalacao). O que garante o roteamento e o
  // `setor` declarado na opcao, e este teste existe para que trocar o JSON sem
  // ele volte a mandar cobranca para o Comercial.
  r = await simulador.simular(fluxo, ["ola", "3", "Ana, segunda via do boleto"], {
    filas: { 33: "Técnico", 35: "Comercial" },
  });
  mostrar("simulador: financeiro (fila 35, mas setor declarado)", r);
  const fin = r.turnos[2];
  check(fin.transferido, "financeiro nao transferiu");
  check(fin.setor === "Financeiro", `setor=${fin.setor}, esperado Financeiro (nao Comercial)`);
  check(
    /Solicita..o encaminhada/.test(fin.respostas.join("\n")),
    "financeiro nao confirmou o encaminhamento antes da fila"
  );

  // ---- 2c. mapa de filas com nome FORA da lista canonica ------------------
  //
  // "Suporte" nao e setor. Antes ele vencia a escolha do cliente e rebaixava a
  // conversa para "Geral" -- e quem decide quem enxerga a conversa e o setor.
  r = await simulador.simular(fluxo, ["oi", "1", "avulso", "sim", "impressora travada"], {
    filas: { 33: "Suporte" },
  });
  const ultAvulso = r.turnos[r.turnos.length - 1];
  check(
    ultAvulso.setor === "Técnico",
    `mapa de filas invalido rebaixou o setor para ${ultAvulso.setor}`
  );

  // ---- 2d. CNPJ ESGOTADO NAO PODE IR PARA A FILA EM SILENCIO -------------
  //
  // ESTE E O CASO QUE MOTIVOU A CORRECAO. `transferirParaHumano` tinha um
  // `if (avisar) { }` VAZIO: o fluxo desiste do CNPJ depois de 2 tentativas
  // (`aoEsgotarTentativasCnpj: "transferir"`) e mandava o cliente para a fila
  // sem dizer absolutamente nada. Do lado dele, o bot parava de responder.
  r = await simulador.simular(
    fluxo,
    ["oi", "1", "tenho contrato", "12345678901234", "98765432109876"],
    { filas: { 33: "Técnico", 35: "Comercial" } }
  );
  mostrar("simulador: CNPJ errado duas vezes -> fila", r);
  const ultCnpj = r.turnos[r.turnos.length - 1];
  check(ultCnpj.transferido, "nao transferiu ao esgotar as tentativas de CNPJ");
  check(
    ultCnpj.respostas.length > 0,
    "handoff MUDO: o cliente foi para a fila sem nenhuma mensagem"
  );
  check(
    /Chamado aberto|Solicita..o registrada/.test(ultCnpj.respostas.join("\n")),
    `sem confirmacao de encaminhamento: ${ultCnpj.respostas.join(" | ")}`
  );

  // ---- 2e. quem JA falou com o cliente nao fala duas vezes ---------------
  //
  // O outro lado da mesma moeda: `avisar: false` continua valendo. Sem gatilho
  // casando, a conversa vai para um atendente sem o bot inventar uma
  // confirmacao de algo que o cliente nao pediu.
  const soPalavraChave = { ...fluxo, gatilho: "orcamento" };
  r = await simulador.simular(soPalavraChave, ["oi"], {});
  check(
    !r.turnos[0].respostas.length,
    `handoff sem gatilho deveria ser silencioso: ${r.turnos[0].respostas.join(" | ")}`
  );

  // ---- 3. simulador: encerrar pelo menu ---------------------------------
  //
  // A opcao 4 nao encerra mais em silencio: ela cai no no de Pesquisa de
  // Satisfacao. O `closeTicket` que este teste cobrava ("Arka agradece") nao
  // existe mais no fluxo -- a assercao passou anos verde porque ninguem rodava
  // o script.
  r = await simulador.simular(fluxo, ["oi", "4"], {});
  mostrar("simulador: encerrar pela opcao 4", r);
  // A OS fecha na hora; a sessao segue viva so para colher a nota -- por isso
  // `status` e "fechada" mas `encerrado` ainda nao (o ciclo do bot nao acabou).
  check(r.turnos[1].status === "fechada", `status=${r.turnos[1].status}`);
  check(
    r.turnos[1].aguardando === "avaliacao_nota",
    `deveria aguardar a nota, veio ${r.turnos[1].aguardando}`
  );
  check(
    /de 1 a 5/.test(r.turnos[1].respostas.join("\n")),
    `nao abriu a pesquisa de satisfacao: ${r.turnos[1].respostas.join(" | ")}`
  );

  // ---- 4. depois de entregar ao humano, o bot cala a boca ---------------
  //
  // Antes este caso usava a opcao 4 e contava 2 turnos -- de um tempo em que
  // ela encerrava seco. Hoje ela abre a pesquisa de satisfacao e o terceiro
  // turno vira resposta de nota, entao o cenario nao testava mais o que dizia.
  // O corte que importa de verdade e o do handoff: entregue a conversa, o
  // motor nao pode responder por cima do atendente.
  r = await simulador.simular(fluxo, ["ola", "3", "Ana, segunda via do boleto", "ainda esta ai?"], {});
  check(r.turnos.length === 3, `deveria parar em 3 turnos (apos o handoff), veio ${r.turnos.length}`);
  check(r.turnos[2].transferido, "o terceiro turno deveria ser o handoff");

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
  // O VALOR EFETIVO, e nao o do campo legado.
  //
  // Isto chamava `engine.configuracaoInatividade`, que lia
  // `notResponseMessage` direto e devolvia 10 minutos -- enquanto o bot esperava
  // 5, vindos do bloco de espera do canvas. O metodo nao era usado em producao e
  // foi removido; quem manda e `paramsTempos`, a mesma funcao que o motor usa.
  const cfgInatividade = paramsTempos(fluxo).semResposta;
  check(cfgInatividade.minutos === 5, `minutos=${cfgInatividade.minutos}, esperado 5 (bloco de espera)`);
  check(cfgInatividade.acao === "encerrar", `acao=${cfgInatividade.acao}, esperado encerrar`);
  check(!!cfgInatividade.passoId, "o bloco de espera do canvas nao foi encontrado no fluxo");
  console.log(`  config lida do fluxo: ${JSON.stringify(cfgInatividade)}`);

  // Sessao parada ha mais tempo que o limite: tem que encerrar com a mensagem.
  const enviadasInat = [];
  const conversaInat = { id: "c9", cliente: "Joana", telefone: "551188", statusAtendimento: "pendente" };
  // `sessaoAtual` e lida de volta pelo motor ANTES de agir: entre a varredura
  // ler a sessao e o timeout disparar, o cliente pode ter respondido. O mock
  // precisa desse `findByConversa` -- sem ele o metodo estourava
  // "findByConversa is not a function" e este bloco inteiro nunca rodava.
  let sessaoAtual = null;
  // Carimbos das mensagens do CLIENTE nesta conversa de teste.
  let mensagensDoCliente = [];
  const engineInat = new ChatbotEngine({
    fluxoRepository: { findById: async () => fluxo, createLog: async () => {} },
    conversaRepository: {
      findById: async () => conversaInat,
      addMensagem: async (_i, origem, texto) => { if (origem === "bot") enviadasInat.push(texto); return { id: "m" }; },
      vincularWaMessageId: async () => {},
      update: async (_i, d) => Object.assign(conversaInat, d),
      atualizarAtendimentoAtual: async () => null,
      atualizarAtendimento: async () => null,
      garantirAtendimentoAberto: async () => ({ atendimento: null, nova: false }),
      // Condicao "o cliente respondeu A PERGUNTA do bot": o motor consulta o
      // historico no instante de agir. `mensagensDoCliente` e controlada por
      // cada caso abaixo.
      respondeuDepoisDe: async (_i, desde) =>
        mensagensDoCliente.some((m) => m > new Date(desde)),
    },
    sessaoRepository: {
      findByConversa: async () => sessaoAtual,
      upsert: async () => ({}),
      update: async () => ({}),
      // UPDATE condicional que reivindica a inatividade: uma vez por espera.
      reivindicarInatividade: async () => {
        if (!sessaoAtual || sessaoAtual.inatividadeEm) return { count: 0 };
        sessaoAtual.inatividadeEm = new Date();
        return { count: 1 };
      },
    },
    evolutionApi: { sendText: async () => ({ key: { id: "x" } }) },
    bus: { emitConversa: () => {} },
  });

  // O RELOGIO E `aguardandoDesde`, e so ele.
  //
  // `aguardandoDesde` e gravado quando o bot pede algo cuja resposta MUDA o rumo
  // (menu, roteamento, CNPJ). Um passo que so confirma -- cuja unica opcao e um
  // curinga que transfere -- estaciona sem gravar o relogio, e por isso nao pode
  // ser encerrado por falta de resposta. Ver ChatbotEngine.decidirEsperaDoPasso
  // e .planning/phases/08-inatividade/.
  const desdeAPerguntaVelha = new Date(Date.now() - 11 * 60 * 1000);
  const sessaoVelha = {
    id: "s9", ativo: true, fluxoAtualId: fluxo.id, telefone: "551188",
    aguardando: "opcao",
    aguardandoDesde: desdeAPerguntaVelha,
    atualizadoEm: desdeAPerguntaVelha,
  };
  sessaoAtual = sessaoVelha;
  const resInat = await engineInat.aplicarInatividade(sessaoVelha, {
    conversa: conversaInat, instanciaId: "i1", instanceName: "arka",
  });
  console.log(`  sessao parada 11min -> ${resInat ? "agiu" : "nada"} | bot: ${linha1(enviadasInat[0])}`);
  check(resInat?.encerrado === true, "nao encerrou por inatividade");
  check(conversaInat.statusAtendimento === "fechada", `status=${conversaInat.statusAtendimento}`);
  // O texto vem do BLOCO DE ESPERA do canvas. Antes esta assercao cobrava "por
  // falta de interacao", frase do `notResponseMessage` legado que o fluxo nao
  // usa mais -- e que ficou 5 minutos atras do valor real.
  check(
    /abra um chamado novamente/i.test(enviadasInat[0] || ""),
    `nao enviou a mensagem do bloco de espera: ${enviadasInat[0]}`
  );

  // Sessao recente: nao pode mexer.
  const sessaoNova = { ...sessaoVelha, atualizadoEm: new Date(Date.now() - 60 * 1000) };
  sessaoAtual = sessaoNova;
  const resNova = await engineInat.aplicarInatividade(sessaoNova, {
    conversa: conversaInat, instanciaId: "i1", instanceName: "arka",
  });
  console.log(`  sessao parada 1min -> ${resNova ? "agiu (ERRADO)" : "nada (ok)"}`);
  check(resNova === null, "agiu numa sessao que ainda nao estourou o tempo");

  // Conversa entregue ao humano nao e mais do bot.
  const sessaoHumano = { ...sessaoVelha, aguardando: "humano" };
  sessaoAtual = sessaoHumano;
  const resHumano = await engineInat.aplicarInatividade(
    sessaoHumano,
    { conversa: conversaInat, instanciaId: "i1", instanceName: "arka" }
  );
  check(resHumano === null, "mexeu numa conversa que ja estava com atendente");

  // ── O CASO DO RELATO: AUTOMACAO CONCLUIDA ──────────────────────────────────
  //
  // Cliente respondeu tudo, o bot abriu o chamado ("Chamado aberto com
  // sucesso") e a conversa ficou em Pendentes esperando o tecnico. Por mais
  // tempo que passe, nao ha inatividade a cobrar. Ver
  // .planning/phases/08-inatividade/. A prova completa dos sete cenarios esta
  // em verificar-inatividade.js.
  conversaInat.statusAtendimento = "pendente";
  const sessaoConcluida = {
    ...sessaoVelha,
    aguardando: "opcao",
    aguardandoDesde: new Date(Date.now() - 60 * 60 * 1000),
    concluidoEm: new Date(Date.now() - 50 * 60 * 1000),
  };
  sessaoAtual = sessaoConcluida;
  const resConcluida = await engineInat.aplicarInatividade(
    sessaoConcluida,
    { conversa: conversaInat, instanciaId: "i1", instanceName: "arka" }
  );
  console.log(`  automacao concluida -> ${resConcluida ? "agiu (ERRADO)" : "nada (ok)"}`);
  check(resConcluida === null, "encerrou por inatividade uma automacao JA CONCLUIDA");

  // SEM RELOGIO DE COBRANCA, SEM INATIVIDADE.
  //
  // E o caso do passo que so confirma ("Chamado aberto com sucesso", cuja unica
  // opcao e um curinga que transfere): a sessao fica estacionada, mas
  // `aguardandoDesde` e null porque nao ha resposta a cobrar -- qualquer coisa
  // que o cliente diga termina na mesma fila. Tambem cobre as sessoes anteriores
  // a essa coluna, que saem pelo TTL da sessao em vez de por inatividade.
  const sessaoSemRelogio = {
    ...sessaoVelha,
    aguardandoDesde: null,
    atualizadoEm: new Date(Date.now() - 60 * 60 * 1000),
  };
  sessaoAtual = sessaoSemRelogio;
  const resSemRelogio = await engineInat.aplicarInatividade(
    sessaoSemRelogio,
    { conversa: conversaInat, instanciaId: "i1", instanceName: "arka" }
  );
  console.log(`  parada 1h sem relogio de cobranca -> ${resSemRelogio ? "agiu (ERRADO)" : "nada (ok)"}`);
  check(resSemRelogio === null, "encerrou uma espera que nao cobra resposta");

  // Allowlist positiva: sem pergunta em aberto (`aguardando: null`) nao ha o que
  // cobrar. Antes o criterio era `aguardando !== "humano"`, e `null` passava.
  const sessaoSemPergunta = { ...sessaoVelha, aguardando: null };
  sessaoAtual = sessaoSemPergunta;
  const resSemPergunta = await engineInat.aplicarInatividade(
    sessaoSemPergunta,
    { conversa: conversaInat, instanciaId: "i1", instanceName: "arka" }
  );
  check(resSemPergunta === null, "encerrou uma sessao sem pergunta em aberto (aguardando null)");

  // O cliente respondeu a pergunta depois de ela ter sido feita: o prazo nao
  // vale mais, mesmo que a linha da sessao nao tenha sido tocada.
  const desdeAPergunta = new Date(Date.now() - 11 * 60 * 1000);
  const sessaoRespondida = { ...sessaoVelha, aguardandoDesde: desdeAPergunta };
  sessaoAtual = sessaoRespondida;
  mensagensDoCliente = [new Date(Date.now() - 60 * 1000)]; // respondeu 1 min atras
  const resRespondida = await engineInat.aplicarInatividade(
    sessaoRespondida,
    { conversa: conversaInat, instanciaId: "i1", instanceName: "arka" }
  );
  console.log(`  cliente respondeu ha 1min -> ${resRespondida ? "agiu (ERRADO)" : "nada (ok)"}`);
  check(resRespondida === null, "encerrou por inatividade quem acabou de responder");
  mensagensDoCliente = [];

  console.log(
    "\n" + (erros.length ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ") : "TODAS AS VERIFICACOES PASSARAM")
  );
  process.exit(erros.length ? 1 : 0);
})().catch((e) => { console.error("ERRO", e); process.exit(1); });
