require("dotenv").config();

const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT) || 3000,
  databaseUrl: process.env.DATABASE_URL,
  jwt: {
    secret: process.env.JWT_SECRET || "dev-secret-change-me",
    expiresIn: process.env.JWT_EXPIRES_IN || "8h",
  },
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
  evolutionApi: {
    url: process.env.EVOLUTION_API_URL || "http://localhost:8080",
    key: process.env.EVOLUTION_API_KEY || "",
    instance: process.env.WHATSAPP_INSTANCE || "arka-wapi-oficial",
  },
  webhookSecret: process.env.WEBHOOK_SECRET || "arka-webhook-secret",
  admin: {
    email: process.env.ADMIN_EMAIL || "admin@arkatecnologia.com.br",
    password: process.env.ADMIN_PASSWORD || "Admin@123",
  },
};

module.exports = env;
