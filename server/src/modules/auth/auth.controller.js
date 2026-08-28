const authService = require("./auth.service");
const { success } = require("../../shared/helpers/response.helper");
const env = require("../../config/env");
const bloqueio = require("../../shared/middlewares/bloqueioProgressivo.middleware");
const seg = require("../../shared/helpers/seguranca.helper");

class AuthController {
  /**
   * O login precisa CONTAR o que aconteceu, e nao so responder.
   *
   * O middleware `bloqueioProgressivo` decide se a tentativa passa, mas quem
   * sabe se ela deu certo e este ponto -- e sem esse retorno o contador nunca
   * anda, e o bloqueio nunca acontece. Sao as duas metades do mesmo freio.
   *
   * Sucesso ZERA o castigo: quem lembrou a senha na quarta tentativa nao fica
   * pagando pelas tres primeiras.
   */
  async login(req, res) {
    const email = req.body?.email;
    try {
      const data = await authService.login(req.body);
      bloqueio.registrarSucesso(req, email);
      seg.registrar(seg.EVENTOS.LOGIN_OK, req, { conta: seg.marcaDe(email) });
      return success(res, data);
    } catch (e) {
      // Só conta como falha o que é ERRO DE CREDENCIAL. Conta desativada,
      // Turnstile recusado ou banco fora do ar nao sao tentativa de adivinhar
      // senha -- somar tudo bloquearia gente por problema que nao e dela.
      //
      // Conta certa com senha errada e conta inexistente contam IGUAL: quem
      // sonda quais e-mails existem nao aprende nada com a diferenca.
      if (e?.statusCode === 401 || e?.code === "INVALID_CREDENTIALS") {
        bloqueio.registrarFalha(req, email);
        seg.observarLoginFalhou(req, email);
      }
      throw e;
    }
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
