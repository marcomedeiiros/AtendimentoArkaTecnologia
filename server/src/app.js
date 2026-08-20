require("dotenv").config();

const express = require("express");
const cors = require("cors");
const swaggerUi = require("swagger-ui-express");

const env = require("./config/env");
const logger = require("./config/logger");
const swaggerSpec = require("./config/swagger");
const errorMiddleware = require("./shared/middlewares/error.middleware");
const { apiLimiter } = require("./shared/middlewares/rateLimit.middleware");

const authRoutes = require("./modules/auth/auth.routes");
const equipeRoutes = require("./modules/equipe/equipe.routes");
const parceiroRoutes = require("./modules/parceiros/parceiro.routes");
const contatoRoutes = require("./modules/contatos/contato.routes");
const fluxoRoutes = require("./modules/fluxos/fluxo.routes");
const conversaRoutes = require("./modules/conversas/conversa.routes");
const dashboardRoutes = require("./modules/dashboard/dashboard.routes");
const helpdeskRoutes = require("./modules/helpdesk/helpdesk.routes");
const chatbotRoutes = require("./modules/chatbot/chatbot.routes");
const n8nRoutes = require("./modules/n8n/n8n.routes");
const configuracaoRoutes = require("./modules/configuracoes/configuracao.routes");
const permissaoRoutes = require("./modules/permissoes/permissao.routes");
const preferenciaRoutes = require("./modules/preferencias/preferencia.routes");
const bugRoutes = require("./modules/bugs/bug.routes");
const {
  webhookRouter,
  adminRouter,
  webhookLimiter,
} = require("./modules/whatsapp/whatsapp.routes");
const webhookAuth = require("./shared/middlewares/webhook.middleware");

function createApp() {
  const app = express();

  // Precisa vir antes do rate limit: e o que faz o req.ip valer o IP real do
  // atendente quando existe um proxy (nginx) na frente, em vez do IP do proxy.
  app.set("trust proxy", env.trustProxy);

  app.use(cors({ origin: env.corsOrigin }));
  app.use(express.json({ limit: "30mb" })); // mídia enviada em base64 passa de 2mb
  app.use(apiLimiter);

  app.get("/health", (req, res) => {
    res.json({ success: true, data: { status: "ok", env: env.nodeEnv } });
  });

  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.get("/api-docs.json", (req, res) => res.json(swaggerSpec));

  app.use("/api/auth", authRoutes);
  app.use("/api/equipe", equipeRoutes);
  app.use("/api/parceiros", parceiroRoutes);
  app.use("/api/contatos", contatoRoutes);
  app.use("/api/fluxos", fluxoRoutes);
  app.use("/api/conversas", conversaRoutes);
  app.use("/api/dashboard", dashboardRoutes);
  app.use("/api/helpdesk", helpdeskRoutes);
  app.use("/api/chatbot", chatbotRoutes);
  app.use("/api/n8n", n8nRoutes);
  app.use("/api/configuracoes", configuracaoRoutes);
  app.use("/api/permissoes", permissaoRoutes);
  app.use("/api/preferencias", preferenciaRoutes);
  app.use("/api/bugs", bugRoutes);
  app.use("/api/whatsapp", adminRouter);

  const mountWebhook = (path) => {
    app.use(path, webhookLimiter, webhookAuth, webhookRouter);
  };

  mountWebhook("/api/webhook/v1/whatsapp");
  mountWebhook("/webhook/v1/whatsapp");

  app.use((req, res) => {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "Rota nao encontrada" },
    });
  });

  app.use(errorMiddleware);

  return app;
}

module.exports = createApp;
