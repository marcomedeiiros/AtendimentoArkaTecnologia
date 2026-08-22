const campanhaService = require("./modules/campanhas/campanha.service");
const createApp = require("./app");
const env = require("./config/env");
const logger = require("./config/logger");
const prisma = require("./infrastructure/database/prisma.client");
const inatividade = require("./modules/chatbot/chatbot.inatividade");
const sessaoRefreshRepository = require("./infrastructure/repositories/sessaoRefresh.repository");

const app = createApp();

async function start() {
  try {
    await prisma.$connect();
    logger.info("Banco de dados conectado");
  } catch (error) {
    logger.error("Falha ao conectar no banco", { message: error.message });
    logger.warn("Servidor iniciara mesmo sem banco (algumas rotas falharao)");
  }

  app.listen(env.port, () => {
    logger.info(`Servidor rodando em http://localhost:${env.port}`);
    logger.info(`Swagger em http://localhost:${env.port}/api-docs`);
    // Encerramento por inatividade depende de alguem olhando o relogio: o motor
    // do chatbot so e acionado por mensagem recebida.
    inatividade.iniciar();
    // Campanha que ficou "enviando" num restart vira "pausada": retomar e
    // decisao humana, nao um disparo surpresa ao subir o servidor.
    campanhaService.recuperarAposReinicio();
    // Faxina das sessoes: a tabela ganha uma linha por renovacao, e linha
    // vencida ou revogada nao serve para nada. Best-effort -- se falhar, o
    // servidor sobe igual (a validacao de sessao nao depende desta limpeza).
    sessaoRefreshRepository
      .limparVencidas()
      .then(({ count }) => { if (count) logger.info("Sessoes expiradas removidas", { count }); })
      .catch((e) => logger.warn("Nao foi possivel limpar sessoes expiradas", { message: e.message }));
  });
}

start();

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
