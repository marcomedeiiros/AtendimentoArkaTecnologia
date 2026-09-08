// Verificacao do CICLO NOVO SOBRE SESSAO ORFA -- `node verificar-sessao-orfa.js`.
//
// ── O DEFEITO QUE ESTE SCRIPT EXISTE PARA NAO VOLTAR ────────────────────────
//
// O relato era "qualquer mensagem que chega nao roda a automacao". Ele era real,
// mas nao valia para todo mundo -- e foi isso que o fez demorar a ser achado.
//
// `conversa.service:atualizarStatus` -- o fechamento feito por um ATENDENTE pela
// Central -- nunca tocava em `sessaoChatbot`. (O fechamento feito pelo BOT sempre
// desligou: ver chatbot.engine:fecharConversa.) Entao todo atendimento encerrado
// na Central deixava para tras uma sessao `ativo: true` apontando para uma
// conversa `fechada`. Medido em producao: 11 sessoes ativas, TODAS com a conversa
// fechada, 7 delas em `humano`.
//
// Quando aquele cliente voltava a escrever:
//
//   1. o bloco de ciclo reaberto abria uma OS NOVA e devolvia a conversa para
//      `pendente` -- o numero era emitido, a conversa entrava na fila;
//   2. e o portao `if (sessao.ativo && aguardando === "humano")` respondia
//      SILENCIO, porque a sessao morta do ciclo passado ainda dizia "esperando
//      atendente".
//
// O guard equivalente dentro de `sessaoExpirada` (naFilaDoAtendente) sempre
// testou `!cicloReaberto`; este portao nao testava. Resultado para o cliente:
// chamado aberto, nenhuma pergunta, nenhum menu. Para a equipe: uma OS na fila
// sem setor, sem CNPJ e sem descricao, porque a triagem nunca rodou.
//
// ── POR QUE PARECIA INTERMITENTE ────────────────────────────────────────────
//
// O TTL de `humano` e 240 min. Passadas as 4 h a sessao expirava, o guard de
// `naFilaDoAtendente` (que JA testava `!cicloReaberto`) a zerava e o mesmo
// cliente voltava a ser atendido normalmente. Ou seja: quem respondia rapido ao
// fechamento era engolido, quem voltava no dia seguinte era atendido. O caso 4
// abaixo fixa essa fronteira.
//
// ── POR QUE UM SCRIPT PROPRIO ───────────────────────────────────────────────
//
// `verificar-reentrada-horario.js` cobre o outro alcapao de `aguardando: humano`
// (o do expediente) e o seu caso 5 e a REGRESSAO deste: quem espera o tecnico do
// ciclo EM CURSO tem de continuar recebendo silencio. Os dois defeitos moram no
// mesmo portao e se corrigem em direcoes opostas, entao cada um tem o seu script
// -- e os dois precisam passar juntos.
//
// O relogio e o mesmo desenho do script irmao: `deps.agora` move o cenario, mas
// os carimbos da sessao falsa sao estampados com o tempo REAL, porque o TTL corre
// sobre `Date.now()`. O caso 4 e a excecao, e por isso ele estampa `atualizadoEm`
// no passado de proposito.
const { ChatbotEngine } = require("./src/modules/chatbot/chatbot.engine");

// Expediente aberto em todos os casos: o assunto aqui e a sessao, nao o horario.
const HORARIO = { ativo: false };

const FLUXO = {
  id: "f1",
  nome: "Atendimento",
  gatilho: "*",
  ativo: true,
  passos: [
    { id: "p1", tipo: "gatilho", titulo: "Início", texto: null, ordem: 0, targetId: "p2", config: {} },
    {
      id: "p2",
      tipo: "mensagem",
      titulo: "Menu",
      ordem: 1,
      targetId: null,
      texto: "Escolha uma opção:",
      config: {
        opcoes: [
          { id: "o1", rotulo: "Suporte", palavrasChave: ["1", "suporte"], setor: "Técnico", acao: "transferir" },
          { id: "o2", rotulo: "Financeiro", palavrasChave: ["2", "financeiro"], setor: "Financeiro", acao: "transferir" },
        ],
      },
    },
  ],
};

let relogio = new Date("2026-09-07T10:00:00-03:00");
const respostas = [];
// Quantas OS foram abertas: e o outro dano do defeito, e ele nao aparece na
// conversa do cliente. Cada mensagem engolida ainda emitia um numero de OS.
let ciclosAbertos = 0;

const estado = { conversa: null, sessao: null };

function conversaNova() {
  return {
    id: "c1",
    instanciaId: "i1",
    cliente: "Fulano",
    telefone: "5511999999999",
    statusAtendimento: "pendente",
    setor: "Geral",
    atendenteId: null,
    cnpj: null,
    cnpjVerificado: false,
    mensagens: [],
    atendimentos: [],
  };
}

const deps = {
  fluxoRepository: {
    findAtivos: async () => [FLUXO],
    findById: async (id) => (id === FLUXO.id ? FLUXO : null),
    findByGatilho: async () => null,
    createLog: async () => {},
  },
  conversaRepository: {
    findById: async () => estado.conversa,
    findByIdParaEvento: async () => estado.conversa,
    findByTelefone: async () => estado.conversa,
    findByTelefoneParaMotor: async () => estado.conversa,
    create: async () => estado.conversa,
    existeMensagemWa: async () => false,
    findMensagemPorWaId: async () => null,
    addMensagem: async (_id, origem, texto) => {
      estado.conversa.mensagens.push({ origem, texto, criadoEm: new Date(relogio) });
      if (origem === "bot") respostas.push(texto);
      return { id: `m${estado.conversa.mensagens.length}` };
    },
    respondeuDepoisDe: async () => false,
    vincularWaMessageId: async () => {},
    update: async (_id, dados) => Object.assign(estado.conversa, dados),
    garantirAtendimento: async () => null,
    // O CONTADOR DE OS: e por aqui que o ciclo novo nasce.
    garantirAtendimentoAberto: async () => {
      ciclosAbertos += 1;
      return { atendimento: { numeroOS: 1000 + ciclosAbertos }, nova: true };
    },
    atualizarAtendimentoAtual: async () => null,
    atualizarAtendimento: async () => null,
    definirMotivoAtualSeVazio: async () => null,
    ultimoCnpjDoTelefone: async () => null,
  },
  sessaoRepository: {
    findByTelefone: async () => estado.sessao,
    findByConversa: async () => estado.sessao,
    upsert: async (instanciaId, conversaId, telefone, dados) => {
      estado.sessao = {
        id: "s1",
        instanciaId,
        conversaId,
        telefone,
        criadoEm: new Date(),
        ...(estado.sessao || {}),
        ...dados,
        atualizadoEm: new Date(),
      };
      return estado.sessao;
    },
    update: async (_id, dados) => {
      estado.sessao = { ...estado.sessao, ...dados, atualizadoEm: new Date() };
      return estado.sessao;
    },
    reivindicarInatividade: async () => ({ count: 0 }),
  },
  parceiroRepository: { findAtivoByCnpj: async () => null, findAtivoByTelefone: async () => null },
  evolutionApi: {
    sendText: async () => ({ key: { id: "sim" } }),
    sendButtons: async () => ({ key: { id: "sim" } }),
    sendList: async () => ({ key: { id: "sim" } }),
    fetchProfilePictureUrl: async () => null,
  },
  n8nClient: { encaminharMensagem: async () => ({ encaminhado: false }) },
  configuracaoService: {
    modoAtendimento: async () => "local",
    horarioAtendimento: async () => HORARIO,
    filasParaSetor: async () => ({}),
    pesquisaSatisfacao: async () => ({ ativo: false }),
  },
  bus: { emitConversa: () => {} },
  agora: () => new Date(relogio),
};

const engine = new ChatbotEngine(deps);

const erros = [];
const check = (cond, msg) => {
  if (!cond) erros.push(msg);
  console.log(`  ${cond ? "OK   " : "FALHA"} ${msg}`);
};

async function turno(quando, texto) {
  relogio = new Date(quando);
  respostas.length = 0;
  const resultado = await engine.processarMensagemEntrada({
    instanciaId: "i1",
    instanceName: "verificacao",
    telefone: estado.conversa.telefone,
    texto,
    nomeCliente: "Fulano",
  });
  return { resultado, respostas: [...respostas] };
}

// O que o fechamento pela CENTRAL fazia antes do conserto: fecha a conversa e
// NAO toca na sessao. E o estado exato encontrado em producao, e reproduzi-lo a
// mao e o unico jeito de provar que o motor aguenta encontra-lo -- as sessoes
// orfas ja gravadas continuam no banco depois do deploy.
function fecharPelaCentralDeixandoSessaoOrfa() {
  estado.conversa.statusAtendimento = "fechada";
  estado.conversa.fechadoEm = new Date(relogio);
}

(async () => {
  console.log("\nCICLO NOVO SOBRE SESSAO ORFA (sessao viva de atendimento ja fechado)\n");

  console.log("1) O ciclo normal: cliente chega, e triado e entregue a equipe");
  estado.conversa = conversaNova();
  estado.sessao = null;
  ciclosAbertos = 0;
  await turno("2026-09-07T10:00:00-03:00", "bom dia");
  await turno("2026-09-07T10:01:00-03:00", "1");
  check(estado.sessao.aguardando === "humano", "a sessao fica em `humano` apos o handoff");
  check(estado.conversa.setor === "Técnico", "o chamado foi triado");

  console.log("\n2) O atendente fecha pela Central -- e a sessao fica orfa");
  fecharPelaCentralDeixandoSessaoOrfa();
  check(estado.conversa.statusAtendimento === "fechada", "a conversa esta fechada");
  check(
    estado.sessao.ativo === true && estado.sessao.aguardando === "humano",
    "a sessao continua viva em `humano` (o estado achado em producao)"
  );

  console.log("\n3) O cliente volta 30 min depois -- DENTRO do TTL humano de 240 min");
  const antes = ciclosAbertos;
  let t = await turno("2026-09-07T10:31:00-03:00", "voltei, o problema continua");
  check(ciclosAbertos === antes + 1, "um ciclo novo (OS nova) e aberto");
  check(estado.conversa.statusAtendimento === "pendente", "a conversa volta para a fila");
  // O CORACAO DO TESTE. Antes do conserto: respostas.length === 0.
  check(t.respostas.length > 0, "o bot RESPONDE (o defeito era silencio absoluto)");
  check(
    t.respostas.some((m) => m.includes("Escolha uma opção")),
    "a triagem roda: o menu do fluxo e enviado"
  );
  check(
    t.resultado.motivo !== "aguardando_atendente",
    "o motivo NAO e `aguardando_atendente` -- este chamado e novo"
  );
  check(estado.sessao.aguardando === "opcao", "a sessao passa a esperar a escolha do menu");

  console.log("\n4) E a triagem do chamado NOVO chega completa na fila");
  estado.conversa.setor = "Geral";
  t = await turno("2026-09-07T10:32:00-03:00", "2");
  check(estado.conversa.setor === "Financeiro", "o setor do ciclo novo vem da escolha do cliente");
  check(t.resultado.transferido === true, "entregue a equipe, agora triado");

  console.log("\n5) O contexto do ciclo anterior NAO vaza para o novo");
  estado.conversa = conversaNova();
  estado.conversa.statusAtendimento = "fechada";
  estado.sessao = {
    id: "s1",
    instanciaId: "i1",
    conversaId: "c1",
    telefone: estado.conversa.telefone,
    ativo: true,
    aguardando: "humano",
    fluxoAtualId: FLUXO.id,
    passoAtualId: "p2",
    // Sujeira do ciclo passado: se vazar, o cliente do chamado NOVO herda as
    // tentativas de menu e o CNPJ em confirmacao de um atendimento encerrado.
    contexto: { tentativasMenu: 3, cnpjPendente: "12345678000199" },
    criadoEm: new Date(),
    atualizadoEm: new Date(),
  };
  t = await turno("2026-09-07T11:00:00-03:00", "oi");
  check(
    t.respostas.some((m) => m.includes("Escolha uma opção")),
    "o fluxo roda desde o inicio"
  );
  check(
    !estado.sessao.contexto?.cnpjPendente && !estado.sessao.contexto?.tentativasMenu,
    "o contexto do ciclo anterior foi descartado"
  );

  // ── AS DUAS REGRESSOES QUE A CORRECAO NAO PODE DERRUBAR ───────────────────
  console.log("\n6) Regressao: quem espera o tecnico do ciclo EM CURSO segue calado");
  estado.conversa = conversaNova();
  estado.sessao = null;
  await turno("2026-09-07T12:00:00-03:00", "bom dia");
  await turno("2026-09-07T12:01:00-03:00", "1");
  check(estado.sessao.aguardando === "humano", "a sessao esta em `humano`");
  check(estado.conversa.statusAtendimento === "pendente", "e a conversa NAO esta fechada");
  t = await turno("2026-09-07T12:30:00-03:00", "alguma novidade?");
  check(t.respostas.length === 0, "o bot nao reinicia o fluxo de quem ja esta na fila");
  check(
    t.resultado.motivo === "aguardando_atendente",
    "o motivo segue `aguardando_atendente` (o ciclo nao reabriu)"
  );

  console.log("\n7) Regressao: atendente ASSUMIU (conversa aberta) -- o bot nao interfere");
  estado.conversa.statusAtendimento = "aberta";
  estado.conversa.atendenteId = "u1";
  t = await turno("2026-09-07T12:31:00-03:00", "obrigado!");
  check(t.respostas.length === 0, "o bot fica calado durante o atendimento humano");
  check(t.resultado.motivo === "atendimento_humano", "o motivo e `atendimento_humano`");

  if (erros.length) {
    console.log(`\n${erros.length} FALHA(S):`);
    for (const e of erros) console.log(`  - ${e}`);
    process.exit(1);
  }
  console.log("\nTODOS OS CASOS OK\n");
  process.exit(0);
})();
