const authService = require("./auth.service");
const { success } = require("../../shared/helpers/response.helper");

class AuthController {
  async login(req, res) {
    const data = await authService.login(req.body);
    return success(res, data);
  }

  async renovar(req, res) {
    const data = await authService.renovar(req.body.refreshToken);
    return success(res, data);
  }

  async sair(req, res) {
    const data = await authService.sair(req.body.refreshToken);
    return success(res, data);
  }

  async cadastrar(req, res) {
    const data = await authService.cadastrar(req.body);
    return success(res, data, 201);
  }

  registroInfo(req, res) {
    return success(res, authService.registroInfo());
  }

  async me(req, res) {
    const data = await authService.me(req.user.sub);
    return success(res, data);
  }

  // Perfil proprio: o alvo e SEMPRE req.user.sub (do token), nunca um id do body.
  async atualizarPerfil(req, res) {
    const data = await authService.atualizarPerfil(req.user.sub, req.body);
    return success(res, data);
  }

  async trocarSenha(req, res) {
    // `sid` (a sessao de quem esta trocando) sobrevive; as outras caem.
    const data = await authService.trocarSenha(req.user.sub, req.body.senhaAtual, req.body.novaSenha, req.user.sid);
    return success(res, data);
  }
}

module.exports = new AuthController();
