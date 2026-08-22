const router = require("express").Router();
const chatbotController = require("./chatbot.controller");
const validate = require("../../shared/middlewares/validate.middleware");
const { authMiddleware } = require("../../shared/middlewares/auth.middleware");
const { processarSchema, simularSchema, executarFluxoSchema } = require("./chatbot.dto");

router.use(authMiddleware);

/**
 * @openapi
 * /api/chatbot/processar:
 *   post:
 *     tags: [Chatbot]
 *     security: [{ bearerAuth: [] }]
 *     summary: Processa mensagem inbound manualmente
 */
router.post("/processar", validate(processarSchema), (req, res, next) =>
  chatbotController.processar(req, res).catch(next)
);

/**
 * @openapi
 * /api/chatbot/fluxos/{id}/executar:
 *   post:
 *     tags: [Chatbot]
 *     security: [{ bearerAuth: [] }]
 *     summary: Dispara fluxo manualmente em uma conversa
 */
router.post("/fluxos/:id/executar", validate(executarFluxoSchema), (req, res, next) =>
  chatbotController.executarFluxo(req, res).catch(next)
);

/**
 * @openapi
 * /api/chatbot/simular:
 *   post:
 *     tags: [Chatbot]
 *     security: [{ bearerAuth: [] }]
 *     summary: Conversa de teste contra um fluxo (sem WhatsApp, sem gravar nada)
 */
router.post("/simular", validate(simularSchema), (req, res, next) =>
  chatbotController.simular(req, res).catch(next)
);

/**
 * @openapi
 * /api/chatbot/sessoes/{telefone}:
 *   get:
 *     tags: [Chatbot]
 *     security: [{ bearerAuth: [] }]
 *     summary: Contexto da sessao do chatbot
 */
router.get("/sessoes/:telefone", (req, res, next) =>
  chatbotController.obterSessao(req, res).catch(next)
);

module.exports = router;
