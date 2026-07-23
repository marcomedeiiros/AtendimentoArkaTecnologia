const env = require("../../config/env");
const AppError = require("../errors/AppError");

function webhookAuth(req, res, next) {
  const token = req.headers["x-webhook-token"] || req.query.token;
  const instance = req.headers["x-instance"] || req.body?.instance || env.evolutionApi.instance;

  if (token && token !== env.webhookSecret) {
    return next(new AppError("Webhook nao autorizado", 401, "WEBHOOK_UNAUTHORIZED"));
  }

  req.instanceName = instance;
  return next();
}

module.exports = webhookAuth;
