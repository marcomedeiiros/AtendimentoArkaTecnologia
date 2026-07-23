const router = require("express").Router();
const whatsappController = require("./whatsapp.controller");
const webhookAuth = require("../../shared/middlewares/webhook.middleware");
const { webhookLimiter } = require("../../shared/middlewares/rateLimit.middleware");
const { authMiddleware } = require("../../shared/middlewares/auth.middleware");

const webhookRouter = require("express").Router();

/**
 * @openapi
 * /api/webhook/v1/whatsapp:
 *   post:
 *     tags: [WhatsApp]
 *     security: [{ webhookToken: [] }]
 *     summary: Recebe eventos do provedor WhatsApp
 */
webhookRouter.post("/", (req, res, next) =>
  whatsappController.webhook(req, res).catch(next)
);

/**
 * @openapi
 * /api/webhook/v1/whatsapp:
 *   get:
 *     tags: [WhatsApp]
 *     summary: Verificacao de webhook (Meta/Evolution)
 */
webhookRouter.get("/", (req, res, next) =>
  whatsappController.verificar(req, res).catch(next)
);

const adminRouter = require("express").Router();
adminRouter.use(authMiddleware);

/**
 * @openapi
 * /api/whatsapp/status:
 *   get:
 *     tags: [WhatsApp]
 *     security: [{ bearerAuth: [] }]
 *     summary: Status da instancia WhatsApp
 */
adminRouter.get("/status", (req, res, next) =>
  whatsappController.status(req, res).catch(next)
);

adminRouter.post("/conectar", (req, res, next) =>
  whatsappController.conectar(req, res).catch(next)
);

adminRouter.post("/desconectar", (req, res, next) =>
  whatsappController.desconectar(req, res).catch(next)
);

adminRouter.get("/qrcode", (req, res, next) =>
  whatsappController.qrcode(req, res).catch(next)
);

module.exports = { webhookRouter, adminRouter, webhookLimiter };
