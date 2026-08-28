/**
 * CLOUDFLARE TURNSTILE -- validacao no SERVIDOR.
 *
 * A regra que da sentido a tudo: o token que o navegador produz nao prova nada
 * sozinho. Ele so vale depois que NOS perguntamos a Cloudflare se aquele token
 * e autentico. Um `turnstileValidated: true` mandado pelo front e apenas um
 * campo JSON que qualquer um digita no curl.
 *
 * A SECRET vive so aqui. Ela nunca sai numa resposta, nunca vai para o log e
 * nao existe no bundle -- a site key (publica, vai no HTML) e servida por uma
 * rota propria justamente para o front nao precisar de nenhuma variavel de
 * build para funcionar.
 *
 * Uso unico: a Cloudflare ja garante isso do lado dela -- um token so pode ser
 * trocado por uma resposta bem-sucedida uma vez. Reapresentar o mesmo token
 * devolve `timeout-or-duplicate`, que tratamos como falha. Nao ha o que guardar
 * do nosso lado.
 */
const env = require("../../config/env");
const logger = require("../../config/logger");

const URL_VERIFICACAO = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TIMEOUT_MS = 5_000;

/**
 * @returns {Promise<{ok: boolean, motivo?: string}>}
 *
 * `ok:true` com `motivo:"desligado"` quando nao ha chaves configuradas -- ver a
 * decisao de fail-open em config/env.js. Configurada a secret, qualquer duvida
 * responde `ok:false`: falha FECHADO.
 */
async function verificar(token, ip = null) {
  if (!env.turnstile.ativo) return { ok: true, motivo: "desligado" };

  if (!token || typeof token !== "string") {
    return { ok: false, motivo: "token-ausente" };
  }

  const corpo = new URLSearchParams();
  corpo.set("secret", env.turnstile.secretKey);
  corpo.set("response", token);
  // O IP ajuda a Cloudflare a pontuar o desafio. Opcional -- e nao mandamos
  // quando nao temos um IP confiavel (ver trust proxy).
  if (ip && ip !== "desconhecido") corpo.set("remoteip", ip);

  let resposta;
  try {
    const controlador = new AbortController();
    const t = setTimeout(() => controlador.abort(), TIMEOUT_MS);
    const r = await fetch(URL_VERIFICACAO, {
      method: "POST",
      body: corpo,
      signal: controlador.signal,
    });
    clearTimeout(t);
    resposta = await r.json();
  } catch (e) {
    // Cloudflare fora do ar ou rede lenta. FECHA.
    //
    // A tentacao aqui e "deixa passar para nao derrubar o login". So que essa
    // e exatamente a condicao que um atacante consegue provocar (basta manter a
    // rede ocupada) -- e ai a protecao existe so quando ninguem esta atacando.
    // Se a Cloudflare cair de verdade, o caminho e desligar o Turnstile pelo
    // .env, conscientemente, e nao um bypass silencioso no codigo.
    logger.warn("Turnstile: falha ao validar", { message: e.message });
    return { ok: false, motivo: "indisponivel" };
  }

  if (!resposta?.success) {
    // `error-codes` da Cloudflare: timeout-or-duplicate (replay), invalid-input-response
    // (forjado), expired (velho demais)... Todos sao falha; o codigo vai para o
    // log para dar para distinguir ataque de configuracao errada.
    return { ok: false, motivo: (resposta?.["error-codes"] || ["invalido"]).join(",") };
  }

  // Conferencia de hostname: garante que o desafio foi resolvido NO NOSSO site,
  // e nao num site do atacante usando a nossa site key. So confere quando
  // configurado -- em ambiente de teste o hostname varia.
  if (env.turnstile.hostname && resposta.hostname !== env.turnstile.hostname) {
    return { ok: false, motivo: "hostname-divergente" };
  }

  return { ok: true, acao: resposta.action, hostname: resposta.hostname };
}

module.exports = { verificar };
