const authService = require("./auth.service");
const { success } = require("../../shared/helpers/response.helper");
const env = require("../../config/env");
const bloqueio = require("../../shared/middlewares/bloqueioProgressivo.middleware");
const seg = require("../../shared/helpers/seguranca.helper");
const cookies = require("../../shared/helpers/sessaoCookie.helper");

/**
 * A SESSAO VAI NO COOKIE -- e tambem no corpo, por enquanto.
 *
 * O cookie e a via segura: `HttpOnly` significa que nenhum script da pagina
 * consegue ler a sessao. Guardada em `localStorage`, ela e legivel por qualquer
 * script -- um XSS nao rouba uma requisicao, rouba a credencial inteira e vai
 * embora com ela.
 *
 * O corpo continua carregando os tokens durante a TRANSICAO, por dois motivos:
 * o painel antigo (que le do corpo e guarda em localStorage) nao pode quebrar
 * no instante do deploy, e integracoes sem navegador nao tem cookie.
 *
 * O painel novo ignora os tokens do corpo -- ele nao guarda nada e deixa o
 * navegador cuidar dos cookies. Quando nao houver mais cliente antigo em
 * circulacao, a linha abaixo vira `false` e a transicao termina, sem tocar em
 * mais nada.
 */
const incluirTokensNoCorpo = true;

function responderSessao(req, res, data, lembrar = true) {
  // O valor de CSRF volta no corpo TAMBEM porque o painel precisa dele na
  // primeira resposta; nas seguintes ele le do cookie `arka_csrf`, que e
  // legivel de proposito (ver csrf.middleware).
  const csrf = cookies.definirSessao(res, data, lembrar);
  const corpo = { ...data, csrfToken: csrf };
  if (!incluirTokensNoCorpo) {
    delete corpo.token;
    delete corpo.refreshToken;
  }
  return success(res, corpo);
}

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
      // "Lembrar-me" decide so a VALIDADE do cookie de renovacao. Quem manda na
      // sessao continua sendo o servidor (rotacao, revogacao, teto absoluto).
      return responderSessao(req, res, data, req.body?.lembrar !== false);
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

  /**
   * Renovacao. O refresh vem do COOKIE; o corpo so e lido quando o cookie nao
   * existe -- e esse caminho e a MIGRACAO: o painel antigo manda o token que
   * tinha em localStorage, recebe cookies de volta e apaga o que guardava.
   * Sem isso, o deploy deslogaria todo mundo que estivesse com a aba aberta.
   */
  async renovar(req, res) {
    const refresh = cookies.refreshDoCookie(req) || req.body?.refreshToken;
    const data = await authService.renovar(refresh);
    return responderSessao(req, res, data, true);
  }

  async sair(req, res) {
    const refresh = cookies.refreshDoCookie(req) || req.body?.refreshToken;
    const data = await authService.sair(refresh);
    // Limpa SEMPRE, mesmo se o servidor nao reconheceu o token: sair tem de
    // sair. Deixar o cookie para tras faria o painel voltar sozinho no F5.
    cookies.limparSessao(res);
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
    // "Inclusive neste" tambem no navegador: as familias ja foram revogadas no
    // servidor, mas deixar os cookies aqui faria a tela tentar seguir logada e
    // so descobrir no proximo 401.
    cookies.limparSessao(res);
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
