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

/**
 * @openapi
 * /api/webhook/v1/whatsapp/responder:
 *   post:
 *     tags: [WhatsApp]
 *     security: [{ webhookToken: [] }]
 *     summary: Envia uma resposta ao cliente (usado pelo n8n)
 *     description: >
 *       Recebe { telefone | conversaId, texto } e envia pelo WhatsApp,
 *       registrando a mensagem na conversa. Autenticado pelo mesmo
 *       webhook secret usado no recebimento, para o n8n chamar sem JWT.
 */
webhookRouter.post("/responder", (req, res, next) =>
  whatsappController.responder(req, res).catch(next)
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

/**
 * @openapi
 * /api/whatsapp/enviar:
 *   post:
 *     tags: [WhatsApp]
 *     security: [{ bearerAuth: [] }]
 *     summary: Envia uma mensagem de texto a um numero (usado pelo Envio em Massa)
 */
adminRouter.post("/enviar", (req, res, next) =>
  whatsappController.enviar(req, res).catch(next)
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

/**
 * @openapi
 * /api/whatsapp/detalhes:
 *   get:
 *     tags: [WhatsApp]
 *     security: [{ bearerAuth: [] }]
 *     summary: Painel completo da instancia (perfil, webhook, versao, token)
 */
adminRouter.get("/detalhes", (req, res, next) =>
  whatsappController.detalhes(req, res).catch(next)
);

adminRouter.post("/instancia", (req, res, next) =>
  whatsappController.criarInstancia(req, res).catch(next)
);

adminRouter.post("/webhook", (req, res, next) =>
  whatsappController.configurarWebhook(req, res).catch(next)
);

adminRouter.post("/reiniciar", (req, res, next) =>
  whatsappController.reiniciar(req, res).catch(next)
);

adminRouter.delete("/instancia", (req, res, next) =>
  whatsappController.excluir(req, res).catch(next)
);

module.exports = { webhookRouter, adminRouter, webhookLimiter };
