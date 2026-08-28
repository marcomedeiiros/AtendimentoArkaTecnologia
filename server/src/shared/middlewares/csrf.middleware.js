/**
 * CSRF -- so importa depois que a sessao passou a viajar em cookie.
 *
 * O problema: cookie o navegador manda SOZINHO. Um site qualquer pode fazer o
 * navegador da vitima disparar `POST /api/conversas/123/mensagens`, e a
 * requisicao chega autenticada sem o atacante ter visto token nenhum.
 *
 * Nao vale para o header `Authorization`: aquele o atacante teria de montar, e
 * para monta-lo precisaria LER o token -- que ele nao tem. Por isso este guard
 * so morde requisicao autenticada POR COOKIE. Cliente que usa Bearer (scripts,
 * integracoes, o modo compativel) passa direto, sem CSRF que nao lhe diz
 * respeito.
 *
 * ── TRES CAMADAS, DA MAIS BARATA PARA A MAIS FORTE ─────────────────────────
 *
 *  1. SameSite=Lax no cookie (ver sessaoCookie.helper): o navegador ja recusa
 *     mandar o cookie em POST/PATCH/DELETE vindos de outro site. Sozinho ja
 *     resolveria quase tudo -- mas depende do navegador, e navegador antigo (ou
 *     uma versao com bug) nao e base para a unica defesa.
 *
 *  2. ORIGEM: `Origin`/`Referer` precisam bater com a allowlist. Cabecalho que
 *     o site atacante nao consegue falsificar -- o navegador o preenche.
 *
 *  3. DOUBLE SUBMIT: o valor do cookie `arka_csrf` tem de vir tambem no header
 *     `X-CSRF-Token`. O site externo consegue fazer o navegador ENVIAR os
 *     nossos cookies, mas nao consegue LE-LOS (origem diferente), entao nao
 *     tem como montar o header. Comparacao em tempo constante.
 *
 * Metodos seguros (GET/HEAD/OPTIONS) passam: eles nao mudam estado. Se algum
 * GET mudar estado um dia, o problema e o GET, nao este arquivo.
 */
const crypto = require("crypto");
const env = require("../../config/env");
const AppError = require("../errors/AppError");
const seg = require("../helpers/seguranca.helper");
const { nomes } = require("../helpers/sessaoCookie.helper");

const METODOS_SEGUROS = new Set(["GET", "HEAD", "OPTIONS"]);

function iguaisEmTempoConstante(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * A origem da requisicao e uma das nossas?
 *
 * ── COMPARA-SE O HOST, E NAO O ESQUEMA ────────────────────────────────────
 *
 * A primeira versao comparava `esquema://host` e RECUSAVA TODO LOGIN em
 * producao. O motivo e a topologia: quem termina o HTTPS e a Cloudflare, e o
 * nginx repassa `X-Forwarded-Proto $scheme` -- que ali dentro vale `http`,
 * porque o trecho Cloudflare->nginx e HTTP puro. Entao o servidor comparava
 * `http://chat.exemplo.com` com a origem real `https://chat.exemplo.com` e
 * concluia que era um site estranho. Resultado na tela: "Origem nao permitida",
 * e ninguem entrava.
 *
 * O esquema nao e a parte que protege. Quem protege e o HOST: o site de um
 * atacante tem outro nome de dominio, e isso nenhum proxy reescreve. Comparar
 * so o host mantem a defesa e para de depender de um cabecalho que a
 * infraestrutura muda por conta propria.
 */
function hostDe(valor) {
  try {
    return new URL(valor).host.toLowerCase();
  } catch {
    return "";
  }
}

function origemPermitida(req) {
  const bruta = req.headers.origin || req.headers.referer;
  // Sem Origin nem Referer: cliente nao-navegador (curl, integracao). Estes nao
  // sao vitimas de CSRF -- ninguem "engana" um script para mandar cookie que
  // ele nao tem. O double submit abaixo continua valendo e e o que decide.
  if (!bruta) return true;

  const origem = hostDe(bruta);
  if (!origem) return false;

  // Configuradas explicitamente (CORS_ORIGIN).
  if (env.corsOrigins.some((o) => hostDe(o) === origem)) return true;

  // Mesmo host da propria requisicao: e o caso normal em producao, onde o nginx
  // serve o painel e faz o proxy de /api sob o mesmo dominio.
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  return !!host && host === origem;
}

/**
 * PORTAS DE ENTRADA -- nunca podem ser trancadas por CSRF.
 *
 * Achado medindo, e nao lendo: com um cookie de sessao antigo no navegador, o
 * proprio `POST /auth/login` levava 403. O guard via o cookie, nao via o header,
 * e recusava -- deixando a pessoa SEM CONSEGUIR ENTRAR. Basta o cookie de
 * sessao sobreviver ao de CSRF (validades diferentes) para o painel virar uma
 * porta trancada por dentro.
 *
 * E ha o outro lado: aqui nao existe o que proteger. CSRF e sobre agir usando a
 * sessao ALHEIA; estas rotas nao agem sobre sessao nenhuma -- elas CRIAM uma, e
 * so depois de conferir e-mail e senha. Quem chega sem credencial nao passa,
 * com ou sem este guard.
 *
 * O que restaria seria o "login CSRF" (forcar a vitima a entrar na conta do
 * atacante). Contra isso ja atuam o `SameSite=Lax` do cookie e a checagem de
 * ORIGEM abaixo, que continua valendo para estas rotas.
 */
const ENTRADAS = new Set(["/api/auth/login", "/api/auth/cadastrar"]);

function csrfMiddleware(req, res, next) {
  if (METODOS_SEGUROS.has(req.method)) return next();

  // `originalUrl` inclui a query; comparar so o caminho.
  const caminho = (req.originalUrl || req.url || "").split("?")[0].replace(/\/$/, "");
  if (ENTRADAS.has(caminho)) {
    // A origem continua sendo conferida -- so o double submit e dispensado.
    if (!origemPermitida(req)) {
      seg.registrar(seg.EVENTOS.CSRF_REJEITADO, req, { motivo: "origem-na-entrada" });
      return next(new AppError("Origem nao permitida", 403, "CSRF_ORIGEM"));
    }
    return next();
  }

  // Autenticou por header? Entao nao ha vetor de CSRF nesta requisicao.
  const cabecalho = req.headers.authorization;
  const usouBearer = cabecalho && cabecalho.startsWith("Bearer ");
  const cookieSessao = req.cookies?.[nomes.nomeAcesso];
  if (usouBearer || !cookieSessao) return next();

  if (!origemPermitida(req)) {
    seg.registrar(seg.EVENTOS.CSRF_REJEITADO, req, { motivo: "origem" });
    return next(new AppError("Origem nao permitida", 403, "CSRF_ORIGEM"));
  }

  const doCookie = req.cookies?.[nomes.nomeCsrf];
  const doHeader = req.headers["x-csrf-token"];
  if (!iguaisEmTempoConstante(doCookie, doHeader)) {
    seg.registrar(seg.EVENTOS.CSRF_REJEITADO, req, { motivo: "token" });
    return next(
      new AppError("Requisicao sem confirmacao de origem. Recarregue a pagina.", 403, "CSRF_TOKEN")
    );
  }

  return next();
}

module.exports = { csrfMiddleware };
