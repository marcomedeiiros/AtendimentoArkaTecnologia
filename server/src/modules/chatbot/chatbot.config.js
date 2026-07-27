// Configuracao do motor do chatbot: limites de seguranca, palavras-chave de
// controle e mensagens padrao. Centralizado aqui para que ajustar o
// comportamento do bot nao exija mexer na logica do engine.

const minutos = (n) => n * 60 * 1000;

const config = {
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

  mensagens: {
    menuCabecalho:
      "Ola! Sou o assistente virtual da Arka Tecnologia.\nComo posso ajudar? Responda com o numero da opcao:",
    menuRodape:
      'Se preferir, digite *atendente* para falar com uma pessoa do nosso time.',
    naoEntendi: "Nao entendi. Escolha uma das opcoes abaixo:",
    semFluxos:
      "Ola! Recebemos sua mensagem e um de nossos atendentes vai responder em instantes.",
    transferindo:
      "Certo! Ja estou chamando um atendente. Aguarde um instante que em breve alguem assume por aqui.",
    encerrado:
      "Atendimento encerrado. Quando precisar, e so mandar uma mensagem que eu comeco de novo.",
    cnpjInvalido:
      "Esse CNPJ nao parece valido. Envie os 14 digitos, por exemplo: 11.222.333/0001-81",
    cnpjSolicitar: "Para continuar, informe o CNPJ da sua empresa (14 digitos).",
    erroInterno:
      "Tive um problema para continuar seu atendimento. Ja estou chamando um atendente para te ajudar.",
  },
};

module.exports = config;
