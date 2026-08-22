require("dotenv").config();

const ehProducao = (process.env.NODE_ENV || "development") === "production";

// Segredos com fallback conhecido sao uma bomba-relogio: se a variavel faltar
// em producao, o app sobe com um JWT_SECRET/WEBHOOK_SECRET que esta no codigo
// publico -- qualquer um forja token de admin ou chama o webhook. Entao os
// fallbacks so valem em desenvolvimento; em producao a ausencia derruba o boot.
function segredo(nome, valor, fallbackDev) {
  if (valor) return valor;
  if (ehProducao) {
    throw new Error(
      `Config ausente: defina ${nome} no ambiente. ` +
        `Gere com: node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`
    );
  }
  return fallbackDev;
}

// "30d", "12h", "90m", "45s" -> milissegundos. Numero puro e lido como
// milissegundos. Valor invalido cai no padrao recebido, para uma variavel
// digitada errada no .env nao virar sessao de NaN (que expiraria sempre).
function duracaoMs(valor, padraoMs) {
  const bruto = String(valor ?? "").trim();
  if (!bruto) return padraoMs;
  const m = /^(\d+)\s*(s|m|h|d)?$/i.exec(bruto);
  if (!m) return padraoMs;
  const n = Number(m[1]);
  const unidade = (m[2] || "").toLowerCase();
  const fator = unidade === "s" ? 1_000 : unidade === "m" ? 60_000 : unidade === "h" ? 3_600_000 : unidade === "d" ? 86_400_000 : 1;
  return n * fator;
}

const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT) || 3000,
  databaseUrl: process.env.DATABASE_URL,
  jwt: {
    secret: segredo("JWT_SECRET", process.env.JWT_SECRET, "dev-secret-change-me"),
    expiresIn: process.env.JWT_EXPIRES_IN || "8h",
  },
  // Sessao renovavel. O token de acesso (JWT acima) continua curto e sem
  // estado; quem sustenta a sessao longa e o refresh token da tabela
  // SessaoRefresh. NAO aumente JWT_EXPIRES_IN para "resolver" queda de sessao:
  // token longo e token que nao da para revogar. A correcao e renovar.
  sessao: {
    // Prazo de cada refresh token, renovado a cada rotacao (deslizante).
    // E o que faz a sessao sobreviver a fechar e reabrir o navegador.
    refreshMs: duracaoMs(process.env.REFRESH_EXPIRES_IN, 30 * 86_400_000), // 30d
    // Janela de INATIVIDADE do operador. Quem passa deste tempo sem interagir
    // volta para o login, mesmo com refresh token valido -- e o que impede que
    // uma aba esquecida aberta por dias siga renovando sozinha. Vai para o
    // cliente na resposta do login/renovacao: so o navegador sabe se ha alguem
    // ali. A AUTORIDADE da sessao continua aqui (rotacao, revogacao, reuso).
    inatividadeMs: duracaoMs(process.env.SESSAO_INATIVIDADE, 12 * 3_600_000), // 12h
  },
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
  evolutionApi: {
    url: process.env.EVOLUTION_API_URL || "http://localhost:8080",
    key: process.env.EVOLUTION_API_KEY || "",
    instance: process.env.WHATSAPP_INSTANCE || "arka-wapi-oficial",
  },
  webhookSecret: segredo("WEBHOOK_SECRET", process.env.WEBHOOK_SECRET, "arka-webhook-secret"),
  admin: {
    email: process.env.ADMIN_EMAIL || "admin@arkatecnologia.com.br",
    password: process.env.ADMIN_PASSWORD || "Admin@123",
  },
  // Codigo de convite para /api/auth/cadastrar. Vazio (padrao) = cadastro
  // aberto: qualquer pessoa que alcance a URL cria conta e passa a ler as
  // conversas dos clientes. Preencha REGISTRO_CODIGO no .env para exigir o
  // codigo no cadastro -- o formulario mostra o campo sozinho quando isso
  // estiver ativo.
  registroCodigo: process.env.REGISTRO_CODIGO || "",
};

module.exports = env;
