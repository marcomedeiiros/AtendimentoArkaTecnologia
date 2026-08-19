const AppError = require("../../shared/errors/AppError");
const permissaoService = require("./permissao.service");

// Autoriza o acesso a um MODULO consultando a matriz de permissoes no banco.
// Precisa vir DEPOIS do authMiddleware: usa req.user.cargo (preenchido a partir
// do banco). Administrador sempre passa. Esconder o menu no front nao basta --
// esta e a camada que a URL digitada na mao nao contorna.
function exigirModulo(modulo) {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return next(new AppError("Token de autenticacao nao informado", 401, "UNAUTHORIZED"));
      }
      const ok = await permissaoService.moduloPermitido(req.user.cargo, modulo);
      if (!ok) {
        return next(new AppError("Acesso restrito ao seu perfil", 403, "FORBIDDEN_MODULE"));
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { exigirModulo };
