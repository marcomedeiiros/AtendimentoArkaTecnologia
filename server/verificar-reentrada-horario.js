// Verificacao da REENTRADA NO FLUXO DEPOIS DO FORA DO HORARIO --
// `node verificar-reentrada-horario.js`.
//
// ── O DEFEITO QUE ESTE SCRIPT EXISTE PARA NAO VOLTAR ────────────────────────
//
// O relato era "o fluxo nao funciona, so as automacoes funcionam": o cliente
// recebia o aviso 🌙 de fora do horario e, depois, "Ei! Estamos com uma demanda
// alta..." -- e nada mais. Menu, CPF/CNPJ e triagem por setor nunca aconteciam.
//
// A causa nao estava no fluxo. `aguardando: "humano"` era um ALCAPAO DE MAO
// UNICA: o bloco de fora do horario entrega a conversa a fila, e dali em diante
// os dois `return aguardando_atendente` do motor devolvem SILENCIO a toda
// mensagem seguinte -- `executarFluxo` nunca mais era alcancado.
//
// A unica saida era a conversa ser FECHADA (`cicloReaberto` libera o fluxo).
// Mas `varrerForaDoHorario` -- que cumpre o "encerrado em 5 minutos" do aviso --
// se recusa a fechar DENTRO do expediente, e com razao: nao se fecha na cara de
// quem madrugou na fila. Consequencia: quem escreve nos minutos finais antes de
// abrir (07:57, ou 16:58 numa sexta que fecha as 17:00) atravessa para o
// expediente sem ser encerrado e fica preso -- pendente, sem triagem e sem bot.
//
// ── POR QUE UM SCRIPT, E NAO UM CASO EM verificar-horario.js ────────────────
//
// `verificar-horario.js` prova o MODULO PURO de expediente (dias, fuso,
// feriado). O defeito daqui nao esta na regra de horario, e sim na maquina de
// estados do motor -- ele exige conversa, sessao e DUAS passagens pelo
// recebimento em instantes diferentes. E o que este script monta.
//
// ── O RELOGIO, E POR QUE SAO DOIS ───────────────────────────────────────────
//
// `deps.agora` e o instante que o motor usa para decidir o EXPEDIENTE, e o
// cenario o move (07:57 -> 08:05). O TTL da sessao, em producao, corre sobre
// `Date.now()` real -- entao os carimbos da sessao falsa sao estampados com o
// tempo real. Estampa-los com o relogio do cenario faria o teste medir um dia
// inteiro de inatividade e expirar a sessao antes de o caso ser exercitado --
// provando outra coisa, e nao a reentrada.
const { ChatbotEngine } = require("./src/modules/chatbot/chatbot.engine");

// O expediente da ARKA, na forma nova (um objeto por dia): segunda a quinta ate
// as 18h, sexta ate as 17h, fim de semana fechado.
const HORARIO = {
  ativo: true,
  timezone: "America/Sao_Paulo",
  dias: {
    0: { ativo: false, periodos: [] },
    1: { ativo: true, periodos: [{ inicio: "08:00", fim: "18:00" }] },
    2: { ativo: true, periodos: [{ inicio: "08:00", fim: "18:00" }] },
    3: { ativo: true, periodos: [{ inicio: "08:00", fim: "18:00" }] },
    4: { ativo: true, periodos: [{ inicio: "08:00", fim: "18:00" }] },
    5: { ativo: true, periodos: [{ inicio: "08:00", fim: "17:00" }] },
    6: { ativo: false, periodos: [] },
  },
  excecoes: [],
};

// Fluxo minimo com o gatilho curinga: o que interessa aqui e SE o fluxo roda,
// nao o desenho dele (a matriz do fluxo real e verificar-fluxo-arka.js).
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

// Instantes COM O FUSO EXPLICITO (-03:00), pela mesma razao de
// verificar-horario.js: sem isso o resultado dependeria do fuso da maquina e o
// teste passaria aqui e falharia no container em UTC.
let relogio = new Date("2026-09-07T07:57:00-03:00");

const respostas = [];
const estado = {
  conversa: {
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
  },
  sessao: null,
};

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
    // A OS nao e o assunto aqui; os metodos precisam existir porque o motor
    // real os chama ao transferir e ao encerrar.
    garantirAtendimento: async () => null,
    garantirAtendimentoAberto: async () => ({ atendimento: null, nova: false }),
    atualizarAtendimentoAtual: async () => null,
    atualizarAtendimento: async () => null,
    definirMotivoAtualSeVazio: async () => null,
    ultimoCnpjDoTelefone: async () => null,
  },
  sessaoRepository: {
    findByTelefone: async () => estado.sessao,
    findByConversa: async () => estado.sessao,
    // `atualizadoEm` com o tempo REAL, e nao com o relogio do cenario -- ver o
    // cabecalho ("o relogio, e por que sao dois").
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
  // Nada sai para o WhatsApp.
  evolutionApi: {
    sendText: async () => ({ key: { id: "sim" } }),
    sendButtons: async () => ({ key: { id: "sim" } }),
    sendList: async () => ({ key: { id: "sim" } }),
    fetchProfilePictureUrl: async () => null,
  },
  n8nClient: { encaminharMensagem: async () => ({ encaminhado: false }) },
  configuracaoService: {
    // Modo local forcado: fora dele o motor nao responde nada por conta propria
    // e o teste ficaria refem da configuracao da tela.
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

(async () => {
  console.log("\nREENTRADA NO FLUXO DEPOIS DO FORA DO HORARIO\n");

  console.log("1) Segunda 07:57 -- ainda fora do expediente (abre 08:00)");
  let t = await turno("2026-09-07T07:57:00-03:00", "oi, meu sistema travou");
  check(
    t.respostas.some((m) => m.includes("fora do horário")),
    "o cliente recebe o aviso de fora do horario"
  );
  check(t.resultado.transferido === true, "a conversa vai para a fila de Pendentes");
  check(estado.sessao.aguardando === "humano", "a sessao fica em `humano`");
  check(!!estado.sessao.contexto.foraHorarioEm, "a marca `foraHorarioEm` foi gravada");

  console.log("\n2) Segunda 08:05 -- expediente ABERTO, e o cliente escreve de novo");
  t = await turno("2026-09-07T08:05:00-03:00", "alguem pode me ajudar?");
  check(t.respostas.length > 0, "o bot VOLTA a responder (o defeito era silencio absoluto)");
  check(
    t.respostas.some((m) => m.includes("Escolha uma opção")),
    "o fluxo roda: o menu do fluxo e enviado"
  );
  check(estado.sessao.aguardando === "opcao", "a sessao passa a esperar a escolha do menu");
  check(
    !estado.sessao.contexto.foraHorarioEm,
    "a marca de fora do horario foi limpa (senao o varredor fecharia a conversa a noite)"
  );

  console.log("\n3) A triagem que este cliente nunca tinha conseguido fazer");
  t = await turno("2026-09-07T08:06:00-03:00", "1");
  check(estado.conversa.setor === "Técnico", "o setor e definido pela escolha do cliente");
  check(t.resultado.transferido === true, "entregue a equipe, agora com o chamado triado");

  console.log("\n4) Regressao: dentro do expediente o caminho normal nao foi tocado");
  estado.sessao = null;
  estado.conversa.statusAtendimento = "pendente";
  estado.conversa.setor = "Geral";
  t = await turno("2026-09-07T10:00:00-03:00", "bom dia");
  check(
    t.respostas.some((m) => m.includes("Escolha uma opção")),
    "cliente que chega em horario comercial recebe o menu"
  );

  // ── O GUARD QUE A CORRECAO NAO PODE DERRUBAR ──────────────────────────────
  //
  // Quem foi entregue a fila PELO FLUXO (chamado triado, esperando o tecnico)
  // tem de continuar calado: era daqui que saia o menu de boas-vindas por cima
  // de quem so perguntou "alguma novidade?". A diferenca entre os dois casos e
  // a marca `foraHorarioEm` -- e e so ela que a reentrada aceita.
  console.log("\n5) Regressao: quem espera o tecnico NAO volta para o inicio do bot");
  estado.sessao = null;
  estado.conversa.statusAtendimento = "pendente";
  await turno("2026-09-07T10:01:00-03:00", "bom dia");
  await turno("2026-09-07T10:02:00-03:00", "1");
  check(estado.sessao.aguardando === "humano", "a sessao fica em `humano` apos o handoff do fluxo");
  check(!estado.sessao.contexto.foraHorarioEm, "e sem marca de fora do horario");
  t = await turno("2026-09-07T10:30:00-03:00", "alguma novidade?");
  check(t.respostas.length === 0, "o bot nao reinicia o fluxo de quem espera o tecnico");
  check(t.resultado.motivo === "aguardando_atendente", "o motivo segue `aguardando_atendente`");

  if (erros.length) {
    console.log(`\n${erros.length} FALHA(S):`);
    for (const e of erros) console.log(`  - ${e}`);
    process.exit(1);
  }
  console.log("\nTODOS OS CASOS OK\n");
  process.exit(0);
})();
