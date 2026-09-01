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
const evolutionApi = require("./infrastructure/external/evolution-api.client");

const app = createApp();

// WATCHDOG DE CONEXAO WHATSAPP
// Verifica a cada 30s se a instancia esta conectada. Se nao estiver,
// chama connect() automaticamente. Funciona como segunda camada alem do
// auto-reconexao por webhook -- garante a volta mesmo se o evento
// CONNECTION_UPDATE nao chegar ao back-end (queda de rede entre containers).
let _watchdogConectadoAntes = false;
let _watchdogReconectando = false;

async function _watchdogWhatsApp() {
  try {
    const instancia = env.evolutionApi.instance;
    if (!instancia) return;

    const estado = await evolutionApi.getConnectionState(instancia);
    const state = estado?.instance?.state || estado?.state || "close";
    const conectado = state === "open";

    if (conectado) {
      _watchdogConectadoAntes = true;
      _watchdogReconectando = false;
      return;
    }

    // So tenta se ja esteve conectado antes (evita loop antes do 1o QR)
    if (!_watchdogConectadoAntes || _watchdogReconectando) return;

    logger.warn("[Watchdog] WhatsApp desconectado -- reconectando automaticamente", {
      instance: instancia, state,
    });
    _watchdogReconectando = true;

    try {
      await evolutionApi.connect(instancia);
      logger.info("[Watchdog] Reconexao solicitada com sucesso", { instance: instancia });
    } catch (err) {
      logger.warn("[Watchdog] Falha ao solicitar reconexao", { message: err.message });
    } finally {
      // Libera para tentar novamente no proximo ciclo se necessario
      setTimeout(() => { _watchdogReconectando = false; }, 15_000);
    }
  } catch {
    // Silencioso: a Evolution pode estar subindo ainda
  }
}

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

    // Watchdog: verifica conexao WhatsApp a cada 30s e reconecta se necessario.
    // Aguarda 20s no boot para dar tempo da Evolution e do Baileys inicializarem.
    setTimeout(() => {
      _watchdogWhatsApp();
      setInterval(_watchdogWhatsApp, 30_000);
    }, 20_000);
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
