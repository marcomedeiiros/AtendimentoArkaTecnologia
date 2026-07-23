const jwt = require("jsonwebtoken");
const env = require("../../config/env");
const AppError = require("../errors/AppError");

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return next(new AppError("Token de autenticacao nao informado", 401, "UNAUTHORIZED"));
  }

  const token = header.slice(7);

  try {
    const payload = jwt.verify(token, env.jwt.secret);
    req.user = payload;
    return next();
  } catch {
    return next(new AppError("Token invalido ou expirado", 401, "INVALID_TOKEN"));
  }
}

function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return next();

  try {
    req.user = jwt.verify(header.slice(7), env.jwt.secret);
  } catch {
    // ignora token invalido em rotas opcionais
  }
  return next();
}

module.exports = { authMiddleware, optionalAuth };
