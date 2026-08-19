const crypto = require("crypto");
const env = require("../../config/env");
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

// Autentica o webhook do WhatsApp (Evolution/n8n). ANTES bastava NAO enviar
// token para passar: a checagem so barrava um token ERRADO, nunca a ausencia
// dele -- ou seja, o endpoint que dispara mensagens ao cliente ficava aberto a
// internet. Agora o token e obrigatorio e comparado por igualdade real.
function webhookAuth(req, res, next) {
  const token = req.headers["x-webhook-token"] || req.query.token;
  const instance = req.headers["x-instance"] || req.body?.instance || env.evolutionApi.instance;

  if (!tokensBatem(token, env.webhookSecret)) {
    return next(new AppError("Webhook nao autorizado", 401, "WEBHOOK_UNAUTHORIZED"));
  }

  req.instanceName = instance;
  return next();
}

module.exports = webhookAuth;
