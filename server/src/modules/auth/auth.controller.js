const authService = require("./auth.service");
const { success } = require("../../shared/helpers/response.helper");
const env = require("../../config/env");

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

  /**
   * Encerra a sessao em TODOS os dispositivos, inclusive neste.
   *
   * O alvo e SEMPRE `req.user.sub` -- o id que veio do token ja validado. Nao
   * ha parametro de usuario, e isso e a protecao: sem um id vindo do corpo ou
   * da URL, nao existe como derrubar a sessao de outra pessoa por aqui, nem
   * trocando o que se manda. A rota exige `authMiddleware`, entao so quem tem
   * sessao valida chega ate esta linha.
   */
  async sairDeTodos(req, res) {
    const data = await authService.sairDeTodos(req.user.sub);
    return success(res, data);
  }

  async cadastrar(req, res) {
    const data = await authService.cadastrar(req.body);
    return success(res, data, 201);
  }

  registroInfo(req, res) {
    return success(res, authService.registroInfo());
  }

  /**
   * Configuracao PUBLICA do Turnstile: so a site key, que por definicao aparece
   * no HTML de quem usa o widget. A SECRET nao passa por aqui em hipotese
   * nenhuma -- ela existe so no processo do servidor.
   *
   * Servida por rota (e nao embutida no bundle com VITE_*) para trocar a chave
   * nao exigir rebuild do front, e para nao existir nenhuma variavel de
   * ambiente do Turnstile do lado do cliente.
   */
  turnstileConfig(req, res) {
    return success(res, {
      ativo: env.turnstile.ativo,
      siteKey: env.turnstile.siteKey || null,
    });
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
