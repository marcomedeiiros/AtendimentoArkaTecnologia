// Prova do encerramento por inatividade -- os sete cenarios do relato.
//
// O defeito: o cliente respondia toda a automacao, recebia "Chamado aberto com
// sucesso" e, minutos depois, "Atendimento encerrado por inatividade". Ver
// .planning/phases/08-inatividade/FINDINGS.md.
//
// Duas partes, de proposito:
//
//   PARTE A -- a DECISAO, contra o motor real e o fluxo real da ARKA
//   (docs/fluxo-arka.json), com repositorios em memoria. Roda a conversa turno a
//   turno e depois pergunta ao motor se ele encerraria. E aqui que os sete casos
//   ficam legiveis.
//
//   PARTE B -- a VARREDURA real (chatbot.inatividade.varrer) contra o dev.db:
//   a consulta, a fila `comLock`, o `tratarSessao` e o UPDATE condicional de
//   verdade, com Prisma no meio. Sem isto a Parte A provaria a regra e nao o
//   caminho que roda em producao. As linhas semeadas sao removidas no final.
//
// Uso: node verificar-inatividade.js
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "error";

const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");
const { ChatbotEngine, AGUARDANDO } = require("./src/modules/chatbot/chatbot.engine");

const erros = [];
function check(condicao, mensagem) {
  if (condicao) {
    console.log(`  OK   ${mensagem}`);
  } else {
    erros.push(mensagem);
    console.log(`  FALHA ${mensagem}`);
  }
}

const MIN = 60 * 1000;
const TEL = "5511987650000";

// ── PARTE A: ambiente em memoria com o MESMO contrato dos repositorios ───────

function ambiente(fluxo) {
  const est = {
    conversa: {
      id: "c-inat",
      instanciaId: "i-inat",
      cliente: "Marco",
      telefone: TEL,
      statusAtendimento: "pendente",
      setor: "Geral",
      atendenteId: null,
      atendimentoAtualId: "os-inat",
      cnpj: null,
      cnpjVerificado: false,
      criadoEm: new Date(),
      mensagens: [],
      atendimentos: [{ id: "os-inat", abertoEm: new Date(), avisoEsperaEm: null }],
    },
    sessao: null,
  };
  const doBot = [];

  const deps = {
    fluxoRepository: {
      findAtivos: async () => (fluxo.ativo === false ? [] : [fluxo]),
      findById: async (id) => (id === fluxo.id ? fluxo : null),
      findByGatilho: async () => null,
      createLog: async () => {},
    },
    conversaRepository: {
      findById: async () => est.conversa,
      findByIdParaEvento: async () => est.conversa,
      findByTelefone: async () => est.conversa,
      findByTelefoneParaMotor: async () => est.conversa,
      create: async () => est.conversa,
      existeMensagemWa: async () => false,
      addMensagem: async (_id, origem, texto, _meta, _wa, extras = {}) => {
        const msg = {
          id: `m${est.conversa.mensagens.length + 1}`,
          origem,
          texto,
          criadoEm: new Date(),
          status: extras.status || null,
        };
        est.conversa.mensagens.push(msg);
        if (origem === "bot") doBot.push(texto);
        return msg;
      },
      // Mesmo contrato de producao: a retentativa reaproveita a bolha que falhou.
      ultimaMensagemBotComErro: async (_id, texto) =>
        [...est.conversa.mensagens]
          .reverse()
          .find((m) => m.origem === "bot" && m.status === "erro" && m.texto === texto) || null,
      // Mesmo contrato do repositorio real: "chegou mensagem do CLIENTE depois
      // de `desde`?". E a condicao 4 do plano.
      respondeuDepoisDe: async (_id, desde) =>
        est.conversa.mensagens.some(
          (m) => m.origem === "cliente" && m.criadoEm > new Date(desde)
        ),
      vincularWaMessageId: async (id, waId, status) => {
        const m = est.conversa.mensagens.find((x) => x.id === id);
        if (m) { m.status = status; m.waMessageId = waId; }
      },
      update: async (_id, d) => Object.assign(est.conversa, d),
      garantirAtendimento: async () => null,
      garantirAtendimentoAberto: async () => ({ atendimento: est.conversa.atendimentos[0], nova: false }),
      atualizarAtendimentoAtual: async () => null,
      atualizarAtendimento: async (id, dados) => {
        const os = est.conversa.atendimentos.find((x) => x.id === id);
        if (os) Object.assign(os, dados);
        return os || null;
      },
      ultimoCnpjDoTelefone: async () => null,
    },
    sessaoRepository: {
      findByTelefone: async () => est.sessao,
      findByConversa: async () => est.sessao,
      upsert: async (instanciaId, conversaId, telefone, d) => {
        est.sessao = {
          id: "s-inat",
          instanciaId,
          conversaId,
          telefone,
          criadoEm: est.sessao?.criadoEm || new Date(),
          ...(est.sessao || {}),
          ...d,
          atualizadoEm: new Date(),
        };
        return est.sessao;
      },
      update: async (_id, d) => {
        est.sessao = { ...est.sessao, ...d, atualizadoEm: new Date() };
        return est.sessao;
      },
      // UPDATE condicional: check-and-set num unico bloco sincrono, que e o que
      // o `updateMany` do Prisma garante. Sem `await` no meio de proposito.
      reivindicarInatividade: async (id, aguardandoDesde) => {
        const s = est.sessao;
        const mesmaEspera =
          (s?.aguardandoDesde ? new Date(s.aguardandoDesde).getTime() : null) ===
          (aguardandoDesde ? new Date(aguardandoDesde).getTime() : null);
        if (!s || s.id !== id || !s.ativo || s.inatividadeEm || s.concluidoEm || !mesmaEspera) {
          return { count: 0 };
        }
        s.inatividadeEm = new Date();
        return { count: 1 };
      },
    },
    parceiroRepository: { findAtivoByCnpj: async () => null },
    mockErp: {
      aplicarDescontoParceiro: async () => ({ mensagem: "x" }),
      gerarBoleto: async () => ({ mensagem: "x", linhaDigitavel: "", pixCopiaCola: "", vencimento: "" }),
    },
    evolutionApi: {
      // `est.falharEnvio` simula a Evolution fora do ar -- o caso de 19:19,
      // quando o container reiniciou no meio de um deploy.
      sendText: async () => {
        if (est.falharEnvio) throw new Error("Evolution API indisponivel");
        return { key: { id: "w" } };
      },
      sendButtons: async () => ({ key: { id: "w" } }),
      sendList: async () => ({ key: { id: "w" } }),
      fetchProfilePictureUrl: async () => null,
    },
    n8nClient: { encaminharMensagem: async () => ({ encaminhado: false }) },
    configuracaoService: {
      modoAtendimento: async () => "local",
      horarioAtendimento: async () => ({ ativo: false }),
      filasParaSetor: async () => ({}),
    },
    bus: { emitConversa: () => {} },
  };

  const engine = new ChatbotEngine(deps);
  const cliente = (texto) =>
    engine.processarMensagemEntrada({
      instanciaId: "i-inat",
      instanceName: "arka",
      telefone: TEL,
      texto,
      nomeCliente: "Marco",
    });

  // O motor usa Date.now(); "passar o tempo" e envelhecer os carimbos.
  const envelhecer = (minutos) => {
    const ms = minutos * MIN;
    const s = est.sessao;
    if (s) {
      for (const campo of ["atualizadoEm", "criadoEm", "aguardandoDesde", "concluidoEm"]) {
        if (s[campo]) s[campo] = new Date(new Date(s[campo]).getTime() - ms);
      }
    }
    for (const m of est.conversa.mensagens) m.criadoEm = new Date(m.criadoEm.getTime() - ms);
    est.conversa.criadoEm = new Date(est.conversa.criadoEm.getTime() - ms);
    est.conversa.atendimentos[0].abertoEm = new Date(est.conversa.atendimentos[0].abertoEm.getTime() - ms);
  };

  // Reproduz os filtros do varredor (chatbot.inatividade) e chama a decisao.
  // O motor repete cada guard por dentro -- ele e publico e nao pode depender de
  // quem chama --, entao o resultado aqui e o de producao.
  const varrer = async () => {
    const s = est.sessao;
    if (!s?.ativo || s.fluxoAtualId == null) return { agiu: false, fora: "query do varredor" };
    if (!fluxo.ativo) return { agiu: false, fora: "fluxo pausado" };
    if (engine.aguardandoAvaliacao(s)) return { agiu: false, fora: "prazo da avaliacao" };
    if (est.conversa.statusAtendimento !== "pendente") return { agiu: false, fora: "conversa nao pendente" };
    if (s.concluidoEm) return { agiu: false, fora: "automacao concluida" };
    const r = await engine.aplicarInatividade(s, {
      conversa: est.conversa,
      instanciaId: s.instanciaId,
      instanceName: "arka",
    });
    return { agiu: !!r, resultado: r };
  };

  const inatividadesEnviadas = () =>
    doBot.filter((t) => /abra um chamado novamente/i.test(String(t))).length;

  return { engine, est, doBot, cliente, envelhecer, varrer, inatividadesEnviadas };
}

// Caminho completo do fluxo da ARKA ate o handoff.
//
// Sete respostas: menu -> Tecnico -> tenho contrato -> CNPJ -> confirma ->
// nome/setor -> descricao. O que este arquivo mede e se a automacao chega ao
// handoff MARCADA COMO CONCLUIDA (e portanto imune a inatividade); o texto de
// cada bolha e o desenho do fluxo sao assunto de verificar-fluxo-arka.js.
const ATE_O_FIM = ["oi", "1", "1", "11222333000181", "1", "Marco - TI", "meu sistema nao funciona"];

async function rodarAteConcluir(a) {
  let fim = null;
  for (const m of ATE_O_FIM) {
    const r = await a.cliente(m);
    if (r?.transferido || r?.encerrado) {
      fim = r;
      break;
    }
  }
  return fim;
}

(async () => {
  const fluxo = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "docs", "fluxo-arka.json"), "utf8")
  );
  fluxo.id = fluxo.id || "fluxo-arka";

  console.log("=== PARTE A -- a decisao do motor (fluxo real da ARKA) ===");

  // ── Teste 1: cliente conclui a automacao -> prazo passa -> NADA ────────────
  console.log("\n[1] cliente conclui a automacao e a conversa segue Pendente");
  {
    const a = ambiente(fluxo);
    const fim = await rodarAteConcluir(a);
    check(fim?.transferido === true, "a automacao terminou em handoff (entregue a equipe)");
    check(!!a.est.sessao?.concluidoEm, "a sessao ficou marcada como CONCLUIDA");
    check(a.est.conversa.statusAtendimento === "pendente", "a conversa continua Pendente (fila do tecnico)");
    a.envelhecer(30);
    const v = await a.varrer();
    check(v.agiu === false, `nao encerrou por inatividade (motivo: ${v.fora || "-"})`);
    check(a.inatividadesEnviadas() === 0, "nenhuma mensagem de inatividade enviada");
  }

  // ── Teste 2: bot pergunta, cliente cala, prazo estoura -> ENCERRA ──────────
  console.log("\n[2] bot pergunta e o cliente nao responde");
  {
    const a = ambiente(fluxo);
    await a.cliente("oi"); // recebe o menu de Boas Vindas e para em `opcao`
    check(a.est.sessao?.aguardando === AGUARDANDO.OPCAO, "sessao parada esperando a escolha do menu");
    check(!!a.est.sessao?.aguardandoDesde, "gravou QUANDO o bot perguntou (aguardandoDesde)");
    a.envelhecer(6);
    const v = await a.varrer();
    check(v.agiu === true, "encerrou por inatividade");
    check(a.inatividadesEnviadas() === 1, "enviou a mensagem do bloco de espera, uma vez");
    check(a.est.conversa.statusAtendimento === "fechada", "a conversa foi fechada");
  }

  // ── Teste 3: cliente responde antes do prazo -> NADA ──────────────────────
  console.log("\n[3] cliente responde antes do prazo e o relogio expira depois");
  {
    const a = ambiente(fluxo);
    await a.cliente("oi");
    a.envelhecer(4); // 4 min de espera...
    await a.cliente("1"); // ...e o cliente responde: nova pergunta, prazo do zero
    a.envelhecer(4); // mais 4 min: 8 no total, mas 4 desde a ULTIMA pergunta
    const v = await a.varrer();
    check(v.agiu === false, "nao encerrou: o prazo conta desde a ultima pergunta");
    check(a.inatividadesEnviadas() === 0, "nenhuma mensagem de inatividade enviada");
  }

  // ── Teste 4: RC-1 -- Pendente esperando tecnico depois de concluir ─────────
  console.log("\n[4] concluida, Pendente, TTL humano estourado e o cliente pede status");
  {
    const a = ambiente(fluxo);
    await rodarAteConcluir(a);
    // 5h sem tecnico: passa do CHATBOT_HUMANO_TTL_MIN (240 min).
    a.envelhecer(300);
    const r = await a.cliente("bom dia, alguma novidade do meu chamado?");
    check(r?.motivo === "aguardando_atendente", `o bot ficou calado (motivo: ${r?.motivo})`);
    check(
      a.est.sessao?.aguardando === AGUARDANDO.HUMANO,
      `a conversa continua na fila do atendente (aguardando=${a.est.sessao?.aguardando})`
    );
    check(
      !/Bem-vindo/i.test(a.doBot.join("\n").split("Solicitação registrada")[1] || ""),
      "o bot NAO reenviou o menu de boas vindas"
    );
    a.envelhecer(10);
    const v = await a.varrer();
    check(v.agiu === false, `nao encerrou por inatividade (motivo: ${v.fora || "-"})`);
    check(a.inatividadesEnviadas() === 0, "nenhuma mensagem de inatividade enviada");
    check(a.est.conversa.statusAtendimento === "pendente", "a conversa segue Pendente para o tecnico");
  }

  // ── Teste 5: varias perguntas respondidas em sequencia -> NADA ─────────────
  console.log("\n[5] cliente responde varias etapas em sequencia");
  {
    const a = ambiente(fluxo);
    for (const m of ATE_O_FIM) {
      const r = await a.cliente(m);
      // Entre cada resposta, 4 min: nunca estoura o prazo de 5.
      a.envelhecer(4);
      const v = await a.varrer();
      if (v.agiu) {
        check(false, `encerrou no meio do fluxo depois de "${m}"`);
        break;
      }
      if (r?.transferido || r?.encerrado) break;
    }
    check(a.inatividadesEnviadas() === 0, "nenhuma inatividade em 7 turnos respondidos");
    check(!!a.est.sessao?.concluidoEm, "a automacao terminou marcada como concluida");
  }

  // ── Teste 6: corrida -- resposta gravada logo antes do timeout -> NADA ─────
  console.log("\n[6] corrida: a resposta do cliente chega no mesmo instante do timeout");
  {
    const a = ambiente(fluxo);
    await a.cliente("oi");
    a.envelhecer(6); // prazo estourado
    // A mensagem do cliente e GRAVADA (webhook), mas o fluxo ainda nao rodou --
    // e exatamente a janela em que a varredura decidia com estado vencido.
    await a.est.conversa.mensagens.push({ origem: "cliente", texto: "1", criadoEm: new Date() });
    const v = await a.varrer();
    check(v.agiu === false, "nao encerrou: havia resposta do cliente posterior a pergunta");
    check(a.inatividadesEnviadas() === 0, "nenhuma mensagem de inatividade enviada");
  }

  // ── Teste 7: duas varreduras sobrepostas -> UMA mensagem ──────────────────
  console.log("\n[7] duas varreduras concorrentes na mesma espera");
  {
    const a = ambiente(fluxo);
    await a.cliente("oi");
    a.envelhecer(6);
    // Duas varreduras que leram a MESMA sessao (restart no meio do prazo, duas
    // replicas da API, varredura anterior que passou dos 60s).
    const snapshot = { ...a.est.sessao };
    const [r1, r2] = await Promise.all([
      a.engine.aplicarInatividade(snapshot, {
        conversa: a.est.conversa,
        instanciaId: "i-inat",
        instanceName: "arka",
      }),
      a.engine.aplicarInatividade(snapshot, {
        conversa: a.est.conversa,
        instanciaId: "i-inat",
        instanceName: "arka",
      }),
    ]);
    check(!!r1 !== !!r2, `apenas uma das duas agiu (r1=${!!r1}, r2=${!!r2})`);
    check(a.inatividadesEnviadas() === 1, `a mensagem saiu uma vez so (saiu ${a.inatividadesEnviadas()}x)`);
  }

  // ── Teste 8: passo final SEM SAIDA -- o desenho do relato de 2026-08-28 ────
  //
  // A confirmacao ("Chamado aberto com sucesso") escrita no TEXTO de um no cujas
  // opcoes nao levam a lugar nenhum. O motor estacionava em `aguardando: opcao`
  // -- "esperando resposta do cliente" -- depois de anunciar que o chamado
  // estava aberto, e a inatividade fechava o atendimento minutos depois.
  //
  // O criterio da correcao NAO olha o texto (seria fragil): olha se alguma opcao
  // tem saida. Ver ChatbotEngine.temSaidaAcionavel.
  console.log("\n[8] passo final com opcoes sem destino (confirmacao no texto do no)");
  {
    const FINAL_SEM_SAIDA = {
      id: "f-sem-saida", nome: "final sem saida", gatilho: "*", ativo: true,
      passos: [
        { id: "s0", tipo: "gatilho", titulo: "Inicio", ordem: 0, targetId: "s1", config: null },
        { id: "s1", tipo: "mensagem", titulo: "Motivo", ordem: 1, targetId: null,
          texto: "Descreva sua solicitacao",
          config: { opcoes: [{ id: "x1", ordem: 0, esperaEscolha: false, rotulo: "livre", palavrasChave: [], acao: "ir", targetId: "s2" }] } },
        { id: "s2", tipo: "mensagem", titulo: "Chamado aberto", ordem: 2, targetId: null,
          texto: "✅ *Chamado aberto com sucesso*\n\nUm de nossos tecnicos dara continuidade por aqui.",
          config: { opcoes: [{ id: "x2", ordem: 0, esperaEscolha: false, rotulo: "livre", palavrasChave: [], acao: "ir", targetId: null }] } },
        { id: "s3", tipo: "espera", titulo: "Sem resposta", ordem: 3, targetId: null,
          config: { modo: "sem_resposta", minutos: 2, mensagem: "Não entendemos a sua demanda. Por favor, abra um chamado novamente.", acao: "encerrar" } },
      ],
    };
    const a = ambiente(FINAL_SEM_SAIDA);
    await a.cliente("oi");
    const r = await a.cliente("Liberar novo colaborador");
    check(r?.transferido === true, `o fim do fluxo entregou para a equipe (motivo: ${r?.motivo})`);
    check(a.est.sessao?.aguardando === AGUARDANDO.HUMANO, `sessao em humano, nao em opcao (veio ${a.est.sessao?.aguardando})`);
    check(!!a.est.sessao?.concluidoEm, "a sessao ficou marcada como CONCLUIDA");
    check(
      a.doBot.filter((t) => /Chamado aberto com sucesso/.test(String(t))).length === 1,
      "a confirmacao do passo saiu uma vez, sem mensagem de encaminhamento em duplicata"
    );
    a.envelhecer(10);
    const v = await a.varrer();
    check(v.agiu === false, `nao encerrou por inatividade (motivo: ${v.fora || "-"})`);
    check(a.inatividadesEnviadas() === 0, "nenhuma mensagem de inatividade enviada");
    check(a.est.conversa.statusAtendimento === "pendente", "a conversa segue Pendente para o tecnico");
  }

  // ── Teste 9: curinga que so transfere -- estaciona, mas NAO cobra ─────────
  //
  // A unica opcao e curinga com `acao: "transferir"`: qualquer coisa que o
  // cliente responda termina na mesma fila. O passo CONTINUA estacionado (se o
  // cliente escrever, a transferencia acontece com a mensagem dele, como sempre
  // -- e o que preserva o "AGORA DESCREVA SUA SOLICITACAO" do fluxo antigo), mas
  // a espera nao e cobrada: `aguardandoDesde` fica null e a inatividade nao se
  // aplica. Ver decidirEsperaDoPasso.
  console.log("\n[9] curinga que so transfere: estaciona sem cobrar resposta");
  {
    const SO_TRANSFERE = {
      id: "f-aberta", nome: "curinga que transfere", gatilho: "*", ativo: true,
      passos: [
        { id: "q0", tipo: "gatilho", titulo: "Inicio", ordem: 0, targetId: "q1", config: null },
        { id: "q1", tipo: "mensagem", titulo: "Descreva", ordem: 1, targetId: null,
          texto: "AGORA DESCREVA SUA SOLICITACAO",
          config: { opcoes: [{ id: "y1", ordem: 0, esperaEscolha: false, rotulo: "transferir", palavrasChave: [], acao: "transferir", targetId: null }] } },
        { id: "q2", tipo: "espera", titulo: "Sem resposta", ordem: 2, targetId: null,
          config: { modo: "sem_resposta", minutos: 2, mensagem: "Não entendemos a sua demanda. Por favor, abra um chamado novamente.", acao: "encerrar" } },
      ],
    };
    const a = ambiente(SO_TRANSFERE);
    await a.cliente("oi");
    check(a.est.sessao?.aguardando === AGUARDANDO.OPCAO, `continuou estacionado (veio ${a.est.sessao?.aguardando})`);
    check(!a.est.sessao?.aguardandoDesde, "NAO gravou relogio de cobranca (aguardandoDesde null)");
    a.envelhecer(10);
    const v = await a.varrer();
    check(v.agiu === false, "nao encerrou: nao havia resposta a cobrar");
    check(a.inatividadesEnviadas() === 0, "nenhuma mensagem de inatividade enviada");
    // E a resposta do cliente ainda transfere, como antes da correcao.
    const r = await a.cliente("minha impressora parou");
    check(r?.transferido === true, `a resposta do cliente ainda transfere (motivo: ${r?.motivo})`);
  }

  // ── Teste 10: o fluxo REAL de producao (relato de 2026-08-28, 18:46) ──────
  //
  // Estrutura lida do banco da VM:
  //
  //   [6]  mensagem "IDENTIFICA PROBLEMA"  opcoes: ir/c214a4c7   <- pergunta
  //   [13] mensagem "CHAMADO ABERTO"       opcoes: transferir/NULO <- confirmacao
  //
  // O no 13 mandava "✅ Chamado aberto com sucesso" e ESTACIONAVA em
  // `aguardando: opcao`, porque `transferir` conta como saida acionavel. Como
  // qualquer resposta (ou nenhuma) termina na mesma fila, esperar nao tem funcao
  // -- e dois minutos depois a inatividade fechava a OS.
  console.log("\n[10] fluxo de producao: no de confirmacao com opcao curinga que transfere");
  {
    const PRODUCAO = {
      id: "f-prod", nome: "ARKA producao", gatilho: "*", ativo: true,
      passos: [
        { id: "n0", tipo: "gatilho", titulo: "Início", ordem: 0, targetId: "n6", config: null },
        { id: "n6", tipo: "mensagem", titulo: "IDENTIFICA PROBLEMA", ordem: 6, targetId: "n13",
          texto: "📝 *Descreva sua solicitação*\n\nConte brevemente o que você precisa.",
          config: { opcoes: [{ id: "livre", ordem: 0, esperaEscolha: false, rotulo: "resposta livre", palavrasChave: [], acao: "ir", targetId: "n13" }] } },
        { id: "n13", tipo: "mensagem", titulo: "CHAMADO ABERTO", ordem: 13, targetId: null,
          texto: "✅ *Chamado aberto com sucesso*\n\nSua solicitação foi registrada e encaminhada para a equipe técnica.\n\nUm de nossos técnicos dará continuidade ao atendimento por aqui.",
          config: { opcoes: [{ id: "tr", ordem: 0, esperaEscolha: false, rotulo: "transferir", palavrasChave: [], acao: "transferir", targetId: null, setor: "Técnico" }] } },
        { id: "n11", tipo: "espera", titulo: "Sem resposta", ordem: 11, targetId: null,
          config: { modo: "sem_resposta", minutos: 2, mensagem: "Não entendemos a sua demanda. Por favor, abra um chamado novamente.", acao: "encerrar" } },
      ],
    };
    const a = ambiente(PRODUCAO);
    await a.cliente("oi");
    check(a.est.sessao?.aguardando === AGUARDANDO.OPCAO, "no 6 (a pergunta) estaciona esperando a resposta");
    check(!!a.est.sessao?.aguardandoDesde, "no 6 COBRA a resposta: a pergunta roteia o fluxo");
    await a.cliente("Impressora parou de funcionar");
    check(
      a.doBot.filter((t) => /Chamado aberto com sucesso/.test(String(t))).length === 1,
      "o no 13 mandou a confirmacao"
    );
    check(!a.est.sessao?.aguardandoDesde, "no 13 NAO cobra resposta (aguardandoDesde null)");
    // O relato: tres minutos depois, com prazo de dois.
    a.envelhecer(3);
    const v = await a.varrer();
    check(v.agiu === false, `nao encerrou por inatividade (motivo: ${v.fora || "-"})`);
    check(a.inatividadesEnviadas() === 0, "nenhuma mensagem de inatividade enviada");
    check(a.est.conversa.statusAtendimento === "pendente", "a conversa segue Pendente para o tecnico");
    check(
      a.doBot.filter((t) => /encerrado por inatividade|abra um chamado novamente/i.test(String(t))).length === 0,
      "o cliente nao recebeu nada depois do 'Chamado aberto com sucesso'"
    );
  }

  // ── Teste 11: a pergunta do no 6, sem resposta, CONTINUA encerrando ───────
  console.log("\n[11] a pergunta que rotea o fluxo continua expirando sem resposta");
  {
    const PRODUCAO = {
      id: "f-prod2", nome: "ARKA producao", gatilho: "*", ativo: true,
      passos: [
        { id: "m0", tipo: "gatilho", titulo: "Início", ordem: 0, targetId: "m6", config: null },
        { id: "m6", tipo: "mensagem", titulo: "IDENTIFICA PROBLEMA", ordem: 6, targetId: "m13",
          texto: "📝 *Descreva sua solicitação*",
          config: { opcoes: [{ id: "livre", ordem: 0, esperaEscolha: false, rotulo: "resposta livre", palavrasChave: [], acao: "ir", targetId: "m13" }] } },
        { id: "m13", tipo: "mensagem", titulo: "CHAMADO ABERTO", ordem: 13, targetId: null,
          texto: "✅ *Chamado aberto com sucesso*",
          config: { opcoes: [{ id: "tr", ordem: 0, esperaEscolha: false, rotulo: "transferir", palavrasChave: [], acao: "transferir", targetId: null }] } },
        { id: "m11", tipo: "espera", titulo: "Sem resposta", ordem: 11, targetId: null,
          config: { modo: "sem_resposta", minutos: 2, mensagem: "Não entendemos a sua demanda. Por favor, abra um chamado novamente.", acao: "encerrar" } },
      ],
    };
    const a = ambiente(PRODUCAO);
    await a.cliente("oi"); // recebe "Descreva sua solicitacao" e para
    check(a.est.sessao?.aguardando === AGUARDANDO.OPCAO, "estacionou na pergunta");
    check(!a.est.sessao?.concluidoEm, "NAO marcou como concluida: ha pergunta em aberto");
    a.envelhecer(3);
    const v = await a.varrer();
    check(v.agiu === true, "encerrou por inatividade, como deve");
    check(a.inatividadesEnviadas() === 1, "enviou a mensagem do bloco de espera");
    check(
      a.doBot.filter((t) => /Chamado aberto/.test(String(t))).length === 0,
      "nao mandou a confirmacao de chamado aberto para quem nao respondeu"
    );
  }

  // ── Teste 12: o aviso de ESPERA NA FILA conta desde o handoff ─────────────
  //
  // O relogio era `os.abertoEm` -- a abertura da OS, que acontece na PRIMEIRA
  // mensagem do cliente. Os 10 minutos incluiam a triagem inteira do bot, e quem
  // levava 8 minutos respondendo recebia "seu atendimento esta na fila" 2 minutos
  // depois de ja ter sido avisado de que o chamado foi aberto.
  console.log("\n[12] aviso de espera na fila conta desde a entrada na fila");
  {
    const a = ambiente(fluxo);
    // OS aberta ha 30 min (o cliente demorou na triagem)...
    a.est.conversa.atendimentos[0].abertoEm = new Date(Date.now() - 30 * MIN);
    // ...e o handoff acabou de acontecer.
    a.est.sessao = { id: "s", concluidoEm: new Date(), aguardando: AGUARDANDO.HUMANO, ativo: true };
    a.est.conversa.sessao = a.est.sessao;

    const avisou = await a.engine.aplicarEsperaFila(a.est.conversa, fluxo, { instanceName: "arka" });
    check(avisou === false, "nao avisou: entrou na fila agora, apesar da OS ser de 30 min atras");

    // Agora sim: 15 min NA FILA (o bloco pede 10).
    a.est.sessao.concluidoEm = new Date(Date.now() - 15 * MIN);
    const avisou2 = await a.engine.aplicarEsperaFila(a.est.conversa, fluxo, { instanceName: "arka" });
    check(avisou2 === true, "avisou depois de 15 min de espera real por atendente");

    // Conversa que chegou a fila sem passar por fluxo: vale a abertura da OS.
    const b = ambiente(fluxo);
    b.est.conversa.atendimentos[0].abertoEm = new Date(Date.now() - 30 * MIN);
    b.est.conversa.sessao = null;
    const avisou3 = await b.engine.aplicarEsperaFila(b.est.conversa, fluxo, { instanceName: "arka" });
    check(avisou3 === true, "sem sessao, o relogio continua sendo a abertura da OS");
  }

  // ── Teste 13: envio que falha nao conta como enviado ──────────────────────
  //
  // 2026-08-28 19:19: o aviso de espera na fila saiu com `status: "erro"` (o
  // container reiniciando no meio de um deploy). O `avisoEsperaEm` era estampado
  // de qualquer forma, e com `repetir: false` o aviso daquele atendimento nunca
  // mais era tentado. O cliente nunca recebeu.
  console.log("\n[13] aviso de espera: falha no envio nao marca como enviado");
  {
    const a = ambiente(fluxo);
    a.est.sessao = { id: "s", concluidoEm: new Date(Date.now() - 15 * MIN), aguardando: AGUARDANDO.HUMANO, ativo: true };
    a.est.conversa.sessao = a.est.sessao;

    // Primeira tentativa: o WhatsApp recusa.
    a.est.falharEnvio = true;
    const t1 = await a.engine.aplicarEsperaFila(a.est.conversa, fluxo, { instanceName: "arka" });
    check(t1 === false, "a tentativa que falhou devolveu false");
    check(
      a.est.conversa.atendimentos[0].avisoEsperaEm == null,
      "NAO estampou avisoEsperaEm: o envio nao aconteceu"
    );
    // Nenhuma conversa rodou neste teste, entao toda bolha do bot aqui e o aviso.
    const bolhas = () => a.est.conversa.mensagens.filter((m) => m.origem === "bot");
    check(bolhas().length === 1, `a bolha da falha ficou registrada uma vez (${bolhas().length})`);
    check(bolhas()[0].status === "erro", `com status "erro" (veio ${bolhas()[0].status})`);

    // Segunda varredura, com o WhatsApp de volta: tem de tentar de novo.
    a.est.falharEnvio = false;
    const t2 = await a.engine.aplicarEsperaFila(a.est.conversa, fluxo, { instanceName: "arka" });
    check(t2 === true, "a varredura seguinte reenviou");
    check(!!a.est.conversa.atendimentos[0].avisoEsperaEm, "agora sim estampou avisoEsperaEm");
    check(
      bolhas().length === 1,
      `reaproveitou a bolha em vez de empilhar outra (${bolhas().length} bolha(s))`
    );
    check(bolhas()[0].status === "enviada", `a bolha virou "enviada" (veio ${bolhas()[0].status})`);

    // Terceira varredura: nao repete (repetir: false + avisoEsperaEm).
    const t3 = await a.engine.aplicarEsperaFila(a.est.conversa, fluxo, { instanceName: "arka" });
    check(t3 === false, "nao avisou de novo depois de ter conseguido");
  }

  // ── PARTE B: a varredura real, com Prisma ────────────────────────────────
  console.log("\n=== PARTE B -- a varredura real contra o banco ===");

  // SEM BANCO, A PARTE B NAO CORRE -- e diz isso em voz alta.
  //
  // Ela precisa de `dev.db` com fluxo ativo e instancia. Numa maquina que so tem
  // o repositorio (sem `.env`), o Prisma estourava erro de conexao e derrubava o
  // script INTEIRO -- levando embora as 70 verificacoes da Parte A, que nao
  // dependem de banco nenhum. Um teste que morre por falta de ambiente e
  // indistinguivel de um teste que reprovou.
  //
  // Pular e registrar e a alternativa honesta. `erros` nao e tocado: nada
  // reprovou. Quem roda com banco continua exercitando a varredura real.
  if (!process.env.DATABASE_URL) {
    console.log("  PULADA: DATABASE_URL nao esta definida (a Parte B exige o dev.db).");
    console.log("  Para rodar: defina DATABASE_URL e garanta um fluxo ativo + instancia no banco.");
    console.log(
      "\n" +
        (erros.length
          ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ")
          : "PARTE A: TODAS AS VERIFICACOES PASSARAM (Parte B pulada: sem banco)")
    );
    process.exit(erros.length ? 1 : 0);
  }

  const prisma = new PrismaClient();
  const inatividade = require("./src/modules/chatbot/chatbot.inatividade");
  const criados = [];

  async function semear({ aguardando, aguardandoDesde, concluidoEm, fluxoId, instanciaId }) {
    const conversa = await prisma.conversa.create({
      data: {
        instanciaId,
        cliente: "Teste Inatividade",
        telefone: `5511000${criados.length}${Date.now() % 10000}`,
        statusAtendimento: "pendente",
      },
    });
    // Pelo repositorio real: e ele que sabe numerar a OS (`numeroOS`).
    const conversaRepo = require("./src/infrastructure/repositories/conversa.repository");
    const { atendimento } = await conversaRepo.garantirAtendimentoAberto(conversa.id, { setor: "Geral" });
    // `avisoEsperaEm` preenchido: a espera na fila (o OUTRO relogio, 10 min) nao
    // pode se misturar com o que este teste mede.
    await prisma.atendimento.update({
      where: { id: atendimento.id },
      data: { avisoEsperaEm: new Date(), abertoEm: new Date(Date.now() - 120 * MIN) },
    });
    const sessao = await prisma.sessaoChatbot.create({
      data: {
        instanciaId,
        conversaId: conversa.id,
        telefone: conversa.telefone,
        fluxoAtualId: fluxoId,
        aguardando,
        ativo: true,
        aguardandoDesde,
        concluidoEm,
        contexto: {},
      },
    });
    criados.push(conversa.id);
    return { conversa, sessao };
  }

  const doBot = (conversaId) =>
    prisma.mensagem.count({ where: { conversaId, origem: "bot" } });

  try {
    const fluxoBanco = await prisma.fluxo.findFirst({ where: { ativo: true } });
    const instancia = await prisma.instancia.findFirst();
    if (!fluxoBanco || !instancia) throw new Error("dev.db sem fluxo ativo ou instancia");

    // B1: automacao concluida, conversa Pendente, prazo vencido -> nada.
    const concluida = await semear({
      aguardando: AGUARDANDO.OPCAO,
      aguardandoDesde: new Date(Date.now() - 60 * MIN),
      concluidoEm: new Date(Date.now() - 50 * MIN),
      fluxoId: fluxoBanco.id,
      instanciaId: instancia.id,
    });

    // B2: pergunta em aberto, sem resposta, prazo vencido -> encerra.
    const semResposta = await semear({
      aguardando: AGUARDANDO.OPCAO,
      aguardandoDesde: new Date(Date.now() - 60 * MIN),
      concluidoEm: null,
      fluxoId: fluxoBanco.id,
      instanciaId: instancia.id,
    });

    // B3: pergunta em aberto, mas o cliente respondeu depois dela -> nada.
    const respondeu = await semear({
      aguardando: AGUARDANDO.OPCAO,
      aguardandoDesde: new Date(Date.now() - 60 * MIN),
      concluidoEm: null,
      fluxoId: fluxoBanco.id,
      instanciaId: instancia.id,
    });
    await prisma.mensagem.create({
      data: {
        conversaId: respondeu.conversa.id,
        origem: "cliente",
        texto: "1",
        criadoEm: new Date(Date.now() - 30 * MIN), // depois da pergunta
      },
    });

    const antes = {
      concluida: await doBot(concluida.conversa.id),
      semResposta: await doBot(semResposta.conversa.id),
      respondeu: await doBot(respondeu.conversa.id),
    };

    const r = await inatividade.varrer();
    console.log(`  varrer() -> ${JSON.stringify(r)}`);

    const depois = {
      concluida: await doBot(concluida.conversa.id),
      semResposta: await doBot(semResposta.conversa.id),
      respondeu: await doBot(respondeu.conversa.id),
    };
    const convConcluida = await prisma.conversa.findUnique({ where: { id: concluida.conversa.id } });
    const convSemResposta = await prisma.conversa.findUnique({ where: { id: semResposta.conversa.id } });

    check(depois.concluida === antes.concluida, "automacao concluida: o bot nao mandou nada");
    check(convConcluida.statusAtendimento === "pendente", "automacao concluida: a conversa segue Pendente");
    check(depois.semResposta === antes.semResposta + 1, `pergunta sem resposta: encerrou (mensagens +${depois.semResposta - antes.semResposta})`);
    check(convSemResposta.statusAtendimento === "fechada", "pergunta sem resposta: a conversa foi fechada");
    check(depois.respondeu === antes.respondeu, "cliente respondeu a pergunta: o bot nao mandou nada");

    // B4: idempotencia no banco -- a mesma espera nao encerra duas vezes.
    const reaberta = await semear({
      aguardando: AGUARDANDO.OPCAO,
      aguardandoDesde: new Date(Date.now() - 60 * MIN),
      concluidoEm: null,
      fluxoId: fluxoBanco.id,
      instanciaId: instancia.id,
    });
    const chatbotEngine = require("./src/modules/chatbot/chatbot.engine");
    const conversaRepository = require("./src/infrastructure/repositories/conversa.repository");
    const conv = await conversaRepository.findById(reaberta.conversa.id);
    // Duas chamadas com o MESMO retrato de sessao: e o que duas varreduras
    // sobrepostas fazem. A segunda tem de bater no UPDATE condicional.
    const a1 = await chatbotEngine.aplicarInatividade(reaberta.sessao, {
      conversa: conv,
      instanciaId: instancia.id,
      instanceName: instancia.nome,
    });
    const a2 = await chatbotEngine.aplicarInatividade(reaberta.sessao, {
      conversa: conv,
      instanciaId: instancia.id,
      instanceName: instancia.nome,
    });
    check(!!a1 && !a2, `so a primeira agiu (1a=${!!a1}, 2a=${!!a2})`);
    check(
      (await doBot(reaberta.conversa.id)) === 1,
      `a mensagem saiu uma vez so (saiu ${await doBot(reaberta.conversa.id)}x)`
    );
  } finally {
    for (const id of criados) {
      await prisma.conversa.delete({ where: { id } }).catch(() => {});
    }
    await prisma.$disconnect();
  }

  console.log(
    "\n" + (erros.length ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ") : "TODAS AS VERIFICACOES PASSARAM")
  );
  process.exit(erros.length ? 1 : 0);
})().catch((e) => {
  console.error("ERRO", e);
  process.exit(1);
});
