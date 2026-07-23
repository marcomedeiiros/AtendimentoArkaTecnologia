const createApp = require("./app");
const env = require("./config/env");
const logger = require("./config/logger");
const prisma = require("./infrastructure/database/prisma.client");

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
