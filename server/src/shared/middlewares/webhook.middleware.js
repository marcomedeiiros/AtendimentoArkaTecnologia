const crypto = require("crypto");
const env = require("../../config/env");
const logger = require("../../config/logger");
const AppError = require("../errors/AppError");

// Comparacao em tempo constante: evita vazar o segredo por diferenca de tempo
// de resposta. `timingSafeEqual` exige buffers do MESMO tamanho, entao a
// diferenca de comprimento e tratada antes (e ja e, por si so, "nao bate").
function tokensBatem(recebido, esperado) {
  if (!recebido || !esperado) return false;
  const a = Buffer.from(String(recebido));
  const b = Buffer.from(String(esperado));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * RECUSA BARULHENTA -- e a parte que faltava.
 *
 * ── O QUE CUSTOU DESCOBRIR ISSO ────────────────────────────────────────────
 *
 * A recusa era um `AppError` 401 sem `diagnostico`, e o tratador de erros so
 * registra `AppError` QUE TEM diagnostico. Resultado: cada mensagem recusada
 * saia com 401 e nao deixava uma linha sequer no log.
 *
 * Em 07/09/2026 isso custou horas de bot mudo. Da parte de fora tudo parecia
 * saudavel -- contêiner no ar, WhatsApp CONNECTED, webhook `enabled: true` --,
 * e mesmo assim nenhuma mensagem entrava. Nao havia como distinguir "a Evolution
 * nao esta chamando" de "esta chamando e sendo recusada", porque os dois casos
 * produziam exatamente o mesmo silencio.
 *
 * ── POR QUE ELA E TAO FACIL DE ACONTECER ───────────────────────────────────
 *
 * O segredo entra nos dois lados por caminhos diferentes: a API le
 * `WEBHOOK_SECRET` quando SOBE, e a Evolution recebe o mesmo valor embutido na
 * `WEBHOOK_GLOBAL_URL` quando O CONTÊINER DELA nasce. Um deploy que recria so a
 * API -- o caso comum, ja que a Evolution nao tem `build:` -- deixa os dois
 * lados com valores diferentes se o `.env` mudou no meio. Nada quebra de forma
 * visivel: as mensagens simplesmente param.
 *
 * Por isso o log distingue TOKEN AUSENTE de TOKEN DIFERENTE: o primeiro aponta
 * para webhook mal configurado, o segundo para exatamente esta divergencia.
 *
 * ── SEM DESPEJAR O SEGREDO, E SEM INUNDAR O LOG ────────────────────────────
 *
 * O token nao e registrado, nem em pedaco: log costuma ir para lugares que o
 * `.env` nao vai. O que se registra e o tamanho, que ja separa "veio vazio" de
 * "veio outro" sem revelar nada.
 *
 * E a linha e limitada a uma por minuto, com a contagem do que foi omitido:
 * numa rajada, a Evolution repete o webhook e a mesma falha viraria centenas de
 * linhas iguais empurrando o resto do log para fora.
 */
const JANELA_LOG_MS = 60_000;
let ultimoAviso = 0;
let recusadasNaJanela = 0;

function avisarRecusa(req, motivo, tamanhoRecebido) {
  recusadasNaJanela += 1;
  const agora = Date.now();
  if (agora - ultimoAviso < JANELA_LOG_MS) return;

  const omitidas = recusadasNaJanela - 1;
  ultimoAviso = agora;
  recusadasNaJanela = 0;

  logger.warn("Webhook RECUSADO -- nenhuma mensagem esta entrando", {
    motivo,
    // Tamanho, nunca o valor. Ja distingue ausente de divergente.
    tamanhoDoTokenRecebido: tamanhoRecebido,
    tamanhoDoTokenEsperado: String(env.webhookSecret || "").length,
    instancia: req.headers["x-instance"] || req.body?.instance || null,
    de: req.ip,
    ...(omitidas > 0 ? { outrasRecusadasNoUltimoMinuto: omitidas } : {}),
    dica:
      motivo === "token ausente"
        ? "A Evolution esta chamando sem token: confira a WEBHOOK_GLOBAL_URL (ou o webhook da instancia)."
        : "Os segredos divergiram. A API le WEBHOOK_SECRET ao subir; a Evolution recebe o mesmo valor quando O CONTÊINER DELA nasce -- um deploy que recria so a API deixa os dois diferentes.",
  });
}

// Autentica o webhook do WhatsApp (Evolution/n8n). ANTES bastava NAO enviar
// token para passar: a checagem so barrava um token ERRADO, nunca a ausencia
// dele -- ou seja, o endpoint que dispara mensagens ao cliente ficava aberto a
// internet. Agora o token e obrigatorio e comparado por igualdade real.
function webhookAuth(req, res, next) {
  const token = req.headers["x-webhook-token"] || req.query.token;
  const instance = req.headers["x-instance"] || req.body?.instance || env.evolutionApi.instance;

  if (!tokensBatem(token, env.webhookSecret)) {
    avisarRecusa(req, token ? "token diferente" : "token ausente", String(token || "").length);
    return next(new AppError("Webhook nao autorizado", 401, "WEBHOOK_UNAUTHORIZED"));
  }

  req.instanceName = instance;
  return next();
}

module.exports = webhookAuth;
