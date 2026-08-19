const AppError = require("../errors/AppError");

// Barra quem nao e Administrador. Precisa vir DEPOIS do authMiddleware na
// cadeia, pois le o cargo de req.user (preenchido a partir do token). Esconder
// a tela no front nao basta: sem isto qualquer conta autenticada chamaria a
// rota direto.
function adminMiddleware(req, res, next) {
  if (req.user?.cargo !== "Administrador") {
    return next(new AppError("Acesso restrito a administradores", 403, "FORBIDDEN"));
  }
  return next();
}

module.exports = { adminMiddleware };
