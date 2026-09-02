// FUSO DO PROCESSO, antes de qualquer require: o container roda em UTC, e tudo
// que usa a hora local do processo (getHours, getDay, toLocaleString sem
// timeZone, timestamp de log) sai 3 horas adiantado. Definir aqui alinha o
// projeto INTEIRO de uma vez, inclusive codigo futuro que esqueca de fixar o
// fuso. `TZ` no ambiente continua tendo prioridade -- isto e o padrao, nao uma
// imposicao.
//
// Nao substitui os helpers explicitos (dataBrasilia/partesBrasilia): eles
// continuam corretos mesmo se o processo subir com outro TZ. Duas camadas.
process.env.TZ = process.env.TZ || "America/Sao_Paulo";

const campanhaService = require("./modules/campanhas/campanha.service");
const createApp = require("./app");
const env = require("./config/env");
const logger = require("./config/logger");
const prisma = require("./infrastructure/database/prisma.client");
const inatividade = require("./modules/chatbot/chatbot.inatividade");
const sessaoRefreshRepository = require("./infrastructure/repositories/sessaoRefresh.repository");
const reconexaoWhatsApp = require("./modules/whatsapp/whatsapp.reconexao");

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

    // Vigia da conexao com o WhatsApp: reinicia a instancia quando ela cai de
    // verdade e, se o pareamento tiver se perdido, para de tentar e avisa o
    // painel. A regra toda vive no modulo -- ele e a UNICA via de reconexao.
    reconexaoWhatsApp.iniciar();
  });
}

start();


// ── REDE DE SEGURANCA DO PROCESSO ───────────────────────────────────────────
//
// No Node 20 uma promessa rejeitada sem `catch` DERRUBA o processo. Nao e
// hipotese distante: ha trabalho disparado sem `await` de proposito neste
// sistema -- a sincronizacao de contatos logo depois do pareamento, os
// temporizadores de inatividade, o watchdog do WhatsApp. Uma unica rejeicao
// solta ali dentro mata a API inteira, e o `restart: unless-stopped` a reergue
// sem que nada explique o que houve.
//
// Registrar os dois handlers troca "o container reiniciou sozinho e ninguem
// sabe por que" por uma linha de log com a pilha. O processo CONTINUA no ar: um
// defeito num temporizador nao e motivo para tirar o atendimento do ar.
//
// `uncaughtException` e o caso mais grave -- o estado do processo pode estar
// inconsistente depois dele. Ainda assim, seguir servindo com um erro
// registrado e melhor do que a queda seca, e o watchdog e o healthcheck do
// compose continuam observando o processo por fora.
process.on("unhandledRejection", (motivo) => {
  logger.error("Promessa rejeitada sem tratamento", {
    erro: motivo instanceof Error ? motivo.message : String(motivo),
    stack: motivo instanceof Error ? motivo.stack : undefined,
  });
});

process.on("uncaughtException", (erro) => {
  logger.error("Excecao nao capturada -- a API segue no ar, mas investigue", {
    erro: erro?.message,
    stack: erro?.stack,
  });
});

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
