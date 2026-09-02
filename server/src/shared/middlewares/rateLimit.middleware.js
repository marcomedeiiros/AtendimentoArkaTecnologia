const rateLimit = require("express-rate-limit");

/**
 * A REQUISICAO VEIO DE DENTRO DA REDE DO COMPOSE?
 *
 * A Evolution nao e um cliente da internet: ela e um container ao lado, e fala
 * com a API por `http://api:3000` sem passar pelo nginx. Chega, portanto, com
 * um IP privado do Docker (172.16-31.x, ou 10.x em rede customizada).
 *
 * Isto NAO e autenticacao -- quem autentica o webhook e o token, em
 * `webhook.middleware`. E so a resposta a "vale a pena estrangular este
 * remetente?", e para o nosso proprio container a resposta e nao.
 */
function ehRedeInterna(ip) {
  const limpo = String(ip || "").replace(/^::ffff:/, "");
  return (
    limpo === "127.0.0.1" ||
    limpo === "::1" ||
    /^10\./.test(limpo) ||
    /^192\.168\./.test(limpo) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(limpo)
  );
}

/**
 * ── O LIMITE DO WEBHOOK QUASE CUSTOU AS MENSAGENS DE UM DIA ─────────────────
 *
 * Em 01/09/2026, entre 07:59 e 08:26, a Evolution levou 429 desta rota 4.439
 * vezes -- pico de 1.492 num unico minuto. Ela tenta 10 vezes e desiste: 87
 * eventos chegaram a nona tentativa. Cada evento descartado e uma mensagem de
 * cliente que nunca entrou na Central, e ninguem foi avisado.
 *
 * A rajada nao era ataque, era o funcionamento normal: sincronizacao de
 * historico depois de parear, envio em massa, uma conversa movimentada. Como a
 * Evolution entrega tudo por UM IP so, 120/min e um teto que o uso legitimo
 * atravessa sozinho.
 *
 * Agora o teto so vale para quem vem de fora (o `location /webhook/` do nginx
 * e publico, e ali o limite continua fazendo sentido). De dentro da rede do
 * compose nao ha o que estrangular: e o nosso proprio container, ja autenticado
 * pelo token, e engasgar com ele significa perder dado de cliente.
 */
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => ehRedeInterna(req.ip),
  message: {
    success: false,
    error: { code: "RATE_LIMIT", message: "Muitas requisicoes ao webhook" },
  },
});

// O painel faz polling (status do WhatsApp, reconciliacao de conversas) e cada
// operador aberto consome cota. Com 500/15min um unico navegador ja estourava o
// limite e a tela exibia "back-end offline". 2000/15min (~133/min) continua
// protegendo contra abuso e comporta varios atendentes simultaneos.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  // O stream SSE e uma conexao longa e unica: nao deve consumir cota.
  //
  // O WEBHOOK tambem sai daqui. Ele ja tem o seu proprio limitador (acima) e
  // este limitador global estava contando por cima: uma rajada da Evolution
  // gastava a cota dos dois de uma vez. Dois tetos sobre o mesmo trafego so
  // tornam mais dificil descobrir qual deles disparou o 429.
  //
  // As duas montagens contam: o webhook responde em `/api/webhook/...` e em
  // `/webhook/...` (o nginx tem um `location` para cada).
  skip: (req) =>
    req.path.startsWith("/api/conversas/stream") ||
    req.path.startsWith("/api/webhook/") ||
    req.path.startsWith("/webhook/"),
  message: {
    success: false,
    error: { code: "RATE_LIMIT", message: "Limite de requisicoes excedido" },
  },
});

// Limite estrito para endpoints sensiveis de autenticacao (login, cadastro,
// troca de senha). Defesa em profundidade contra forca-bruta: o bcrypt ja
// torna cada tentativa cara, e isto ainda estrangula a taxa. 40/15min por IP e
// folgado para uso humano (inclusive varios operadores atras do mesmo IP) e
// asfixia qualquer tentativa automatizada.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  // Nao conta tentativas bem-sucedidas: so pressiona quem fica errando.
  skipSuccessfulRequests: true,
  message: {
    success: false,
    error: { code: "RATE_LIMIT", message: "Muitas tentativas. Aguarde alguns minutos e tente de novo." },
  },
});

// Rotas de MIDIA (/midia e /anexo): ficam antes do authMiddleware porque o
// <img>/<video> nao manda header -- quem autentica e o token assinado na URL.
// Sem JWT na frente, um limite proprio evita que alguem com um link valido
// martele o servidor puxando o mesmo video sem parar. Folgado para uso real:
// uma conversa carrega varias midias de uma vez, e o navegador cacheia depois.
const midiaLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: "RATE_LIMIT", message: "Muitas requisicoes de midia" },
  },
});

// CORRETOR DE TEXTO: cada chamada e uma requisicao paga a um provedor externo
// (Groq), disparada por um clique. O limite aqui nao e sobre carga do nosso
// servidor -- e sobre CUSTO e sobre a cota da conta de IA, que o apiLimiter
// global (~133/min) nunca protegeria.
//
// 30/min por IP: um atendente corrige uma frase de cada vez, e mesmo varios
// operadores atras do mesmo IP da empresa nao chegam perto disso digitando. Quem
// chegar esta com o dedo no botao ou com um script.
const correcaoLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: "RATE_LIMIT",
      message: "Muitas correções em sequência. Aguarde um minuto.",
    },
  },
});

module.exports = { webhookLimiter, apiLimiter, authLimiter, midiaLimiter, correcaoLimiter };
