const rateLimit = require("express-rate-limit");

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
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
  skip: (req) => req.path.startsWith("/api/conversas/stream"),
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

module.exports = { webhookLimiter, apiLimiter, authLimiter };
