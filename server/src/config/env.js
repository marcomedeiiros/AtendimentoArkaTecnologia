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

const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT) || 3000,
  databaseUrl: process.env.DATABASE_URL,
  jwt: {
    secret: segredo("JWT_SECRET", process.env.JWT_SECRET, "dev-secret-change-me"),
    expiresIn: process.env.JWT_EXPIRES_IN || "8h",
  },
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
  // Quantos proxies existem na frente da API. Em producao o nginx do painel
  // fica na frente (TRUST_PROXY=1), entao o Express precisa ler o
  // X-Forwarded-For para identificar quem chamou -- sem isso o rate limit
  // enxerga um IP unico (o do nginx) e a cota vira compartilhada entre todos
  // os atendentes. Em desenvolvimento nao ha proxy: 0.
  trustProxy: Number(process.env.TRUST_PROXY) || 0,
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
