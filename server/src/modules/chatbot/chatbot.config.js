// Configuracao do motor do chatbot: limites de seguranca, palavras-chave de
// controle e mensagens padrao. Centralizado aqui para que ajustar o
// comportamento do bot nao exija mexer na logica do engine.

const minutos = (n) => n * 60 * 1000;

const config = {
  // O bot so envia o que estiver escrito nos PASSOS DO FLUXO. As mensagens
  // embutidas abaixo (menu, "nao entendi", "chamando um atendente", etc.) sao
  // iniciativa do motor, nao do fluxo -- por isso ficam DESLIGADAS por padrao.
  // Sem gatilho reconhecido a conversa simplesmente vai para a fila, em vez de
  // o bot despejar um menu que ninguem configurou.
  // Ligue com CHATBOT_RESPOSTAS_AUTOMATICAS=true no .env se quiser o antigo.
  respostasAutomaticas: process.env.CHATBOT_RESPOSTAS_AUTOMATICAS === "true",

  sessao: {
    // Depois desse tempo sem mensagem, a sessao expira e o cliente recomeca
    // do zero em vez de cair no meio de um fluxo antigo.
    ttlMs: minutos(Number(process.env.CHATBOT_SESSAO_TTL_MIN) || 30),
    // Conversa transferida para humano fica mais tempo sem o bot intervir.
    ttlHumanoMs: minutos(Number(process.env.CHATBOT_HUMANO_TTL_MIN) || 240),
  },

  limites: {
    // Corta fluxos com ciclo (targetId apontando para tras) antes que o
    // while do engine trave o event loop.
    maxPassosPorExecucao: Number(process.env.CHATBOT_MAX_PASSOS) || 50,
    // Tentativas de CNPJ invalido antes de transferir para um atendente.
    maxTentativasCnpj: Number(process.env.CHATBOT_MAX_TENTATIVAS_CNPJ) || 3,
    // Respostas que nao casam com nenhuma opcao do menu do fluxo antes de
    // transferir. Equivale ao `maxRetryBotMessage` do editor de origem.
    maxTentativasOpcao: Number(process.env.CHATBOT_MAX_TENTATIVAS_OPCAO) || 3,
    // Mensagens sem gatilho reconhecido antes de transferir.
    maxTentativasMenu: Number(process.env.CHATBOT_MAX_TENTATIVAS_MENU) || 3,
    // Teto do passo "delay": ele roda dentro do request do webhook.
    maxDelayMs: Number(process.env.CHATBOT_MAX_DELAY_MS) || 5000,
  },

  // Comparadas contra o texto normalizado (minusculo, sem acento).
  palavrasChave: {
    atendente: [
      "atendente",
      "humano",
      "pessoa",
      "falar com alguem",
      "falar com uma pessoa",
      "suporte humano",
    ],
    menu: ["menu", "opcoes", "inicio", "voltar", "recomecar"],
    sair: ["sair", "cancelar", "encerrar", "parar", "tchau"],
  },

  // NAO existe mais um bloco `mensagens` aqui.
  //
  // O motor tinha textos proprios (menu numerado, "nao entendi", "chamando um
  // atendente", "atendimento encerrado", pedido de CNPJ, erro interno) que iam
  // para o cliente sem estarem em nenhum fluxo. Quem decide o que o cliente le
  // e voce, pelos passos do fluxo na tela -- entao esses textos foram removidos
  // do codigo, e nao apenas desligados.
  //
  // Sem gatilho reconhecido, o bot fica calado e a conversa vai para a fila.
};

module.exports = config;
