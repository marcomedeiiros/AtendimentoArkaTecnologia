/**
 * EVENTOS DE SEGURANCA e deteccao de comportamento anormal.
 *
 * Duas responsabilidades, de proposito juntas: quem registra o evento e quem
 * conta o evento precisam concordar sobre o que aconteceu. Separar viraria duas
 * listas de nomes que divergem com o tempo.
 *
 * O QUE NUNCA ENTRA AQUI -- e a razao de existir uma funcao em vez de espalhar
 * `logger.warn` pelo codigo: senha, hash de senha, cookie, token de acesso,
 * refresh token, secret do Turnstile, chave de API. O registro guarda o QUE
 * aconteceu e um identificador para correlacionar, nunca a credencial. Um log
 * de seguranca que copia a credencial dentro dele transforma o arquivo de log
 * num segundo banco de senhas.
 *
 * Deteccao: contadores em memoria, por processo. Isto e um sinal operacional --
 * "esta acontecendo algo estranho AGORA" -- e nao auditoria historica. Perder
 * os contadores num restart e aceitavel; o que nao pode e a deteccao custar uma
 * escrita no banco por requisicao. A autoridade de BLOQUEIO nao mora aqui (ver
 * bloqueioProgressivo.middleware): aqui so se observa e se avisa.
 */
const crypto = require("crypto");
const logger = require("../../config/logger");

// Vocabulario fechado. Evento fora desta lista e erro de programacao, nao um
// nome novo inventado na hora -- e o que mantem os alertas pesquisaveis.
const EVENTOS = {
  LOGIN_FALHOU: "login_failed",
  LOGIN_OK: "login_success",
  SESSAO_CRIADA: "session_created",
  SESSAO_REVOGADA: "session_revoked",
  SESSAO_REUSO: "session_reuse_detected",
  RATE_LIMIT: "rate_limit_triggered",
  BLOQUEIO_APLICADO: "auth_locked",
  TURNSTILE_FALHOU: "turnstile_failed",
  AUTORIZACAO_NEGADA: "authorization_denied",
  CSRF_REJEITADO: "csrf_rejected",
  ANOMALIA: "anomaly_detected",
};

/**
 * Identificador correlacionavel SEM guardar o dado original.
 *
 * Um e-mail em texto puro espalhado por milhares de linhas de log e um vazamento
 * de base de usuarios esperando acontecer -- e logs costumam ir para servicos
 * de terceiros. O hash truncado permite responder "foram 300 tentativas contra
 * a MESMA conta?" sem que o log diga QUAL conta. Quem investiga de verdade tem
 * o banco.
 *
 * Nao e segredo nem precisa resistir a forca bruta: e um rotulo estavel.
 */
function marcaDe(valor) {
  if (!valor) return "anon";
  return crypto.createHash("sha256").update(String(valor).toLowerCase()).digest("hex").slice(0, 12);
}

/**
 * IP real do cliente.
 *
 * `req.ip` ja respeita o `trust proxy` configurado em app.js -- por isso NAO
 * lemos `x-forwarded-for` na mao aqui: fazer isso ignoraria a contagem de hops
 * e aceitaria o header que o proprio cliente mandou.
 */
function ipDe(req) {
  return req?.ip || req?.socket?.remoteAddress || "desconhecido";
}

function registrar(evento, req, dados = {}) {
  const base = {
    evento,
    ip: ipDe(req),
    rota: req?.originalUrl ? String(req.originalUrl).split("?")[0] : undefined,
    metodo: req?.method,
  };
  // User-agent truncado: ajuda a distinguir script de navegador sem virar um
  // campo gigante em toda linha do log.
  const ua = req?.headers?.["user-agent"];
  if (ua) base.ua = String(ua).slice(0, 120);
  logger.warn(`[seguranca] ${evento}`, { ...base, ...dados });
}

// ── DETECCAO DE COMPORTAMENTO ANORMAL ───────────────────────────────────────
//
// Indicadores objetivos, sem modelo nenhum: contagem por chave dentro de uma
// janela deslizante. Cada sinal tem um limiar; passar do limiar registra UMA
// anomalia (e nao uma por requisicao -- alerta que se repete mil vezes vira
// ruido e para de ser lido).
const JANELA_MS = 5 * 60_000;
const LIMIARES = {
  // Muitos IDs diferentes tentados pela mesma sessao: varredura de IDOR.
  idsDistintos: 40,
  // Muitas negativas de autorizacao: alguem batendo em setor/modulo alheio.
  autorizacaoNegada: 10,
  // Falhas de login concentradas.
  loginFalhou: 15,
};

const contadores = new Map(); // chave -> { inicio, total, distintos:Set, avisado }

function limpar() {
  const agora = Date.now();
  for (const [k, v] of contadores) if (agora - v.inicio > JANELA_MS) contadores.delete(k);
}

function contar(tipo, chave, valorDistinto = null) {
  limpar();
  const k = `${tipo}:${chave}`;
  const agora = Date.now();
  let c = contadores.get(k);
  if (!c || agora - c.inicio > JANELA_MS) {
    c = { inicio: agora, total: 0, distintos: new Set(), avisado: false };
    contadores.set(k, c);
  }
  c.total += 1;
  if (valorDistinto != null) c.distintos.add(String(valorDistinto));
  return c;
}

/** Sessao varrendo IDs (tentativa de IDOR/BOLA por forca bruta de identificador). */
function observarAcessoARecurso(req, recursoId) {
  if (!req?.user?.sub || !recursoId) return;
  const c = contar("ids", req.user.sub, recursoId);
  if (c.distintos.size >= LIMIARES.idsDistintos && !c.avisado) {
    c.avisado = true;
    registrar(EVENTOS.ANOMALIA, req, {
      sinal: "muitos_ids_distintos",
      usuario: marcaDe(req.user.sub),
      distintos: c.distintos.size,
      janelaMin: JANELA_MS / 60000,
    });
  }
}

/** Negativas de autorizacao repetidas (setor/modulo de outra pessoa). */
function observarAutorizacaoNegada(req, motivo) {
  const chave = req?.user?.sub || ipDe(req);
  const c = contar("negado", chave);
  registrar(EVENTOS.AUTORIZACAO_NEGADA, req, {
    motivo,
    usuario: req?.user?.sub ? marcaDe(req.user.sub) : undefined,
    cargo: req?.user?.cargo,
  });
  if (c.total >= LIMIARES.autorizacaoNegada && !c.avisado) {
    c.avisado = true;
    registrar(EVENTOS.ANOMALIA, req, {
      sinal: "autorizacao_negada_repetida",
      usuario: req?.user?.sub ? marcaDe(req.user.sub) : undefined,
      total: c.total,
    });
  }
}

/** Falhas de login concentradas por IP. */
function observarLoginFalhou(req, email) {
  const c = contar("login", ipDe(req));
  registrar(EVENTOS.LOGIN_FALHOU, req, { conta: marcaDe(email), falhasNaJanela: c.total });
  if (c.total >= LIMIARES.loginFalhou && !c.avisado) {
    c.avisado = true;
    registrar(EVENTOS.ANOMALIA, req, { sinal: "muitas_falhas_de_login", total: c.total });
  }
}

// Exposto para os testes conseguirem partir de um estado limpo.
function _zerar() {
  contadores.clear();
}

module.exports = {
  EVENTOS,
  registrar,
  marcaDe,
  ipDe,
  observarAcessoARecurso,
  observarAutorizacaoNegada,
  observarLoginFalhou,
  _zerar,
};
