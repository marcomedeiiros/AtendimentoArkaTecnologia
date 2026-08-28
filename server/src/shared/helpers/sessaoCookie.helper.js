/**
 * COOKIES DE SESSAO -- um lugar so para decidir como a sessao viaja.
 *
 * Antes, acesso e refresh moravam em `localStorage`. Isso significa que
 * QUALQUER script rodando na pagina le a sessao inteira: um XSS nao rouba uma
 * requisicao, rouba a credencial de 30 dias e vai embora com ela. `HttpOnly`
 * fecha essa porta -- o navegador manda o cookie sozinho e o JavaScript nao
 * consegue ler.
 *
 * ── MODO COMPATIVEL ────────────────────────────────────────────────────────
 *
 * O `authMiddleware` aceita cookie E o header `Authorization` que ja existia.
 * Nao e indecisao: e o que permite subir esta mudanca sem deslogar todo mundo
 * no deploy e sem uma janela em que o painel antigo nao fala com a API nova. O
 * front passa a usar cookie e migra a sessao antiga sozinho na primeira carga.
 *
 * ── AS TRES PECAS ──────────────────────────────────────────────────────────
 *
 *   arka_sessao    (HttpOnly) token de acesso, curto. Cookie de SESSAO: morre
 *                  ao fechar o navegador, e a renovacao o recria.
 *   arka_renovacao (HttpOnly) refresh token, `Path=/api/auth`. O caminho
 *                  estreito e de proposito: a credencial de longa duracao nao
 *                  precisa acompanhar CADA requisicao a /api/conversas, entao
 *                  ela nao acompanha. Menos superficie, menos tamanho.
 *   arka_csrf      (LEGIVEL pelo JS, de proposito) valor aleatorio que o front
 *                  copia para o header `X-CSRF-Token`. Ver csrf.middleware.
 *
 * "Lembrar-me" vira a validade do cookie de renovacao: marcado, ele persiste;
 * desmarcado, e cookie de sessao e evapora com o navegador.
 */
const crypto = require("crypto");
const env = require("../../config/env");

const c = env.cookie;

function baseHttpOnly(persistirMs = null) {
  return {
    httpOnly: true,
    secure: c.secure,
    sameSite: c.sameSite,
    domain: c.dominio,
    ...(persistirMs ? { maxAge: persistirMs } : {}),
  };
}

/**
 * Grava a sessao nos cookies.
 * @param {boolean} lembrar cookie de renovacao persistente (true) ou de sessao.
 */
function definirSessao(res, { token, refreshToken }, lembrar = true) {
  if (token) {
    // Sem maxAge: cookie de sessao. O token de acesso e curto e a renovacao o
    // repoe -- dar validade longa a ele so aumentaria a janela de um vazamento.
    res.cookie(c.nomeAcesso, token, { ...baseHttpOnly(), path: "/" });
  }
  if (refreshToken) {
    res.cookie(c.nomeRefresh, refreshToken, {
      ...baseHttpOnly(lembrar ? env.sessao.refreshMs : null),
      path: "/api/auth",
    });
  }
  return definirCsrf(res, lembrar);
}

/**
 * Emite um valor CSRF novo. `httpOnly: false` e obrigatorio aqui -- o front
 * PRECISA ler para devolver no header, e e isso que prova que a requisicao
 * partiu da nossa pagina (um site externo consegue fazer o navegador ENVIAR
 * cookies, mas nao consegue LER os nossos para montar o header).
 */
function definirCsrf(res, lembrar = true) {
  const valor = crypto.randomBytes(32).toString("base64url");
  res.cookie(c.nomeCsrf, valor, {
    httpOnly: false,
    secure: c.secure,
    sameSite: c.sameSite,
    domain: c.dominio,
    path: "/",
    ...(lembrar ? { maxAge: env.sessao.refreshMs } : {}),
  });
  return valor;
}

/**
 * Apaga os tres cookies. Os atributos precisam bater com os da gravacao
 * (path/domain), senao o navegador cria um cookie novo em vez de remover o
 * antigo -- e a sessao "volta" no proximo F5.
 */
function limparSessao(res) {
  const comum = { secure: c.secure, sameSite: c.sameSite, domain: c.dominio };
  res.clearCookie(c.nomeAcesso, { ...comum, httpOnly: true, path: "/" });
  res.clearCookie(c.nomeRefresh, { ...comum, httpOnly: true, path: "/api/auth" });
  res.clearCookie(c.nomeCsrf, { ...comum, httpOnly: false, path: "/" });
}

/** Token de acesso do cookie (ou null). */
function tokenDoCookie(req) {
  return req.cookies?.[c.nomeAcesso] || null;
}

/** Refresh token do cookie (ou null). */
function refreshDoCookie(req) {
  return req.cookies?.[c.nomeRefresh] || null;
}

module.exports = {
  definirSessao,
  definirCsrf,
  limparSessao,
  tokenDoCookie,
  refreshDoCookie,
  nomes: c,
};
