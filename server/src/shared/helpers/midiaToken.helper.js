/**
 * Token assinado para servir a MIDIA de uma mensagem por URL.
 *
 * Por que existe: a midia era embutida como data URL base64 dentro do JSON da
 * conversa. Com anexos de ate 20MB, cada acao (enviar, apagar, marcar lido)
 * carregava e serializava DEZENAS de MB -- e o SSE ainda transmitia isso para
 * todos os operadores conectados. Resultado: API travando e 502.
 *
 * Agora a mensagem carrega apenas uma URL curta; o navegador busca os bytes uma
 * vez e cacheia. O `<img src>`/`<video src>` nao manda header Authorization,
 * entao a autenticacao vai na propria URL -- mesma solucao do ticket do SSE,
 * porem assinada (HMAC) em vez de guardada em memoria, para sobreviver a
 * restart e nao crescer sem limite.
 *
 * SEGURANCA: o token e um HMAC-SHA256 de "<mensagemId>.<expiracao>" com o
 * segredo do servidor -- nao da para forjar nem para trocar o id sem invalidar.
 * Ele so libera UMA mensagem especifica e expira. Quem recebeu o token ja tinha
 * permissao de ver aquela conversa (a URL so e gerada em payloads que passaram
 * pelo filtro de setor).
 */
const crypto = require("crypto");
const env = require("../../config/env");

// 7 dias: longo o bastante para o cache do navegador valer a pena, curto o
// bastante para um link vazado nao servir para sempre.
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

function assinar(mensagemId, exp) {
  return crypto
    .createHmac("sha256", env.jwt.secret)
    .update(`${mensagemId}.${exp}`)
    .digest("base64url");
}

// Devolve "<exp>.<assinatura>" para usar em ?t=
function gerarTokenMidia(mensagemId, ttlMs = TTL_MS) {
  const exp = Date.now() + ttlMs;
  return `${exp}.${assinar(mensagemId, exp)}`;
}

// Confere validade e vinculo com a mensagem. Comparacao em tempo constante.
function validarTokenMidia(mensagemId, token) {
  if (typeof token !== "string" || !token.includes(".")) return false;
  const [expStr, assinatura] = token.split(".");
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;

  const esperada = assinar(mensagemId, exp);
  const a = Buffer.from(assinatura || "");
  const b = Buffer.from(esperada);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { gerarTokenMidia, validarTokenMidia };
