/**
 * BLOQUEIO PROGRESSIVO da autenticacao.
 *
 * O rate limit fixo (`authLimiter`) responde "quantas requisicoes por janela".
 * Isto responde outra pergunta: "quantas FALHAS seguidas", que e o sinal de
 * forca bruta. Um atacante com senha certa no primeiro palpite nao e barrado;
 * um que erra vinte vezes, sim -- e cada sequencia dobra o castigo.
 *
 * Escada: atraso pequeno -> atraso maior -> bloqueio curto -> bloqueio dobrado
 * a cada reincidencia, ate um teto. Tudo TEMPORARIO.
 *
 * ── O CUIDADO QUE DEFINE O DESENHO ─────────────────────────────────────────
 *
 * Bloquear a CONTA por e-mail e o caminho obvio -- e e uma porta de negacao de
 * servico: qualquer pessoa que saiba o e-mail de um operador erra a senha dez
 * vezes e tranca o acesso dele. O ataque custa nada e a vitima e sempre a
 * empresa.
 *
 * Entao os dois eixos existem, com pesos MUITO diferentes:
 *
 *   - POR IP: e o eixo que bloqueia de verdade. Quem esta errando e quem paga,
 *     e trocar de IP custa alguma coisa para o atacante.
 *   - POR CONTA: NUNCA bloqueia. So atrasa a resposta (com teto baixo) e
 *     registra o evento. Assim uma senha nao vira arma contra o dono dela.
 *
 * O atraso tambem tem teto: prender a requisicao por muito tempo transformaria
 * a defesa em DoS contra nos mesmos -- cada tentativa segura um socket aberto.
 *
 * Estado em memoria, por processo. Isto e proposital: e um freio operacional,
 * nao auditoria. Um restart libera quem estava de castigo -- aceitavel, e muito
 * melhor do que uma escrita no banco por tentativa de login. A trilha durvel
 * dos eventos fica no log de seguranca.
 */
const env = require("../../config/env");
const AppError = require("../errors/AppError");
const seg = require("../helpers/seguranca.helper");

const cfg = env.seguranca;

// chave -> { falhas, ate, castigos, visto }
const registros = new Map();
const LIMITE_ENTRADAS = 20_000; // teto de memoria contra flood de chaves

function agora() {
  return Date.now();
}

function limpar() {
  const t = agora();
  for (const [k, r] of registros) {
    // Some quando o bloqueio acabou E a janela de contagem passou.
    if ((!r.ate || r.ate <= t) && t - r.visto > cfg.janelaMs) registros.delete(k);
  }
}

function ler(chave) {
  const r = registros.get(chave);
  if (!r) return null;
  if (agora() - r.visto > cfg.janelaMs && (!r.ate || r.ate <= agora())) {
    // Janela expirou sem falha nova: o contador zera, mas o historico de
    // castigos permanece -- reincidente volta direto para um bloqueio maior.
    r.falhas = 0;
  }
  return r;
}

function dormir(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Atraso que cresce com as falhas, com teto. */
function atrasoPara(falhas) {
  if (falhas < cfg.falhasAteAtraso) return 0;
  const passos = falhas - cfg.falhasAteAtraso + 1;
  return Math.min(cfg.atrasoMaxMs, 150 * 2 ** Math.min(passos, 10));
}

/**
 * Middleware para as rotas de autenticacao.
 *
 * Roda ANTES do handler: se o IP esta de castigo, a requisicao nem chega ao
 * bcrypt. O registro da falha e feito depois, pelo service, chamando
 * `registrarFalha` -- so ele sabe se a credencial estava errada.
 */
function bloqueioProgressivo(req, res, next) {
  limpar();
  const ip = seg.ipDe(req);
  const rIp = ler(`ip:${ip}`);

  if (rIp?.ate && rIp.ate > agora()) {
    const faltamS = Math.ceil((rIp.ate - agora()) / 1000);
    seg.registrar(seg.EVENTOS.BLOQUEIO_APLICADO, req, { eixo: "ip", faltamS });
    return next(
      new AppError(
        `Muitas tentativas malsucedidas. Tente de novo em ${faltamS}s.`,
        429,
        "BLOQUEIO_TEMPORARIO"
      )
    );
  }

  // Atraso progressivo por IP e pela conta tentada (o maior dos dois).
  const identificador = String(req.body?.email || "").trim().toLowerCase();
  const rConta = identificador ? ler(`conta:${seg.marcaDe(identificador)}`) : null;
  const espera = Math.max(atrasoPara(rIp?.falhas || 0), atrasoPara(rConta?.falhas || 0));

  if (espera > 0) return dormir(espera).then(next).catch(next);
  return next();
}

/**
 * Registra UMA falha de autenticacao. Chamado pelo service quando a credencial
 * nao confere -- nunca no middleware, que nao sabe o desfecho.
 */
function registrarFalha(req, identificador) {
  limpar();
  if (registros.size > LIMITE_ENTRADAS) registros.clear();

  const t = agora();
  const eixos = [
    // Bloqueia de verdade.
    { chave: `ip:${seg.ipDe(req)}`, bloqueia: true },
    // Nunca bloqueia -- so atrasa (ver o cabecalho deste arquivo).
    ...(identificador ? [{ chave: `conta:${seg.marcaDe(identificador)}`, bloqueia: false }] : []),
  ];

  for (const { chave, bloqueia } of eixos) {
    const r = registros.get(chave) || { falhas: 0, ate: 0, castigos: 0, visto: t };
    if (t - r.visto > cfg.janelaMs) r.falhas = 0;
    r.falhas += 1;
    r.visto = t;

    if (bloqueia && r.falhas >= cfg.falhasAteBloqueio) {
      r.castigos += 1;
      const duracao = Math.min(cfg.bloqueioMaxMs, cfg.bloqueioBaseMs * 2 ** (r.castigos - 1));
      r.ate = t + duracao;
      r.falhas = 0; // proxima sequencia recomeca a contagem, nao o castigo
      seg.registrar(seg.EVENTOS.BLOQUEIO_APLICADO, req, {
        eixo: "ip",
        castigo: r.castigos,
        duracaoS: Math.round(duracao / 1000),
      });
    }
    registros.set(chave, r);
  }
}

/** Autenticacao bem-sucedida limpa a contagem daquele IP e daquela conta. */
function registrarSucesso(req, identificador) {
  registros.delete(`ip:${seg.ipDe(req)}`);
  if (identificador) registros.delete(`conta:${seg.marcaDe(identificador)}`);
}

// Para os testes.
function _estado(chave) {
  return registros.get(chave) || null;
}
function _zerar() {
  registros.clear();
}

module.exports = {
  bloqueioProgressivo,
  registrarFalha,
  registrarSucesso,
  _estado,
  _zerar,
};
