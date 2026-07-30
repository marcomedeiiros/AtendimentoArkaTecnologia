const router = require("express").Router();
const conversaController = require("./conversa.controller");
const conversaStream = require("./conversa.stream");
const validate = require("../../shared/middlewares/validate.middleware");
const { authMiddleware } = require("../../shared/middlewares/auth.middleware");
const {
  enviarMensagemSchema,
  atualizarStatusSchema,
  validarCnpjSchema,
  enviarMidiaSchema,
  atualizarFlagsSchema,
} = require("./conversa.dto");

// SSE: autenticado pelo ticket na query (o EventSource nao manda header).
// Precisa vir ANTES do authMiddleware global e antes de "/:id".
router.get("/stream", (req, res) => conversaStream.stream(req, res));

router.use(authMiddleware);

router.post("/stream-ticket", (req, res) => conversaStream.criarTicket(req, res));
router.get("/", (req, res, next) => conversaController.listar(req, res).catch(next));
router.get("/:id", (req, res, next) => conversaController.obter(req, res).catch(next));
router.post("/:id/atender", (req, res, next) => conversaController.atender(req, res).catch(next));
router.post("/:id/mensagens", validate(enviarMensagemSchema), (req, res, next) =>
  conversaController.enviarMensagem(req, res).catch(next)
);
router.post("/:id/midia", validate(enviarMidiaSchema), (req, res, next) =>
  conversaController.enviarMidia(req, res).catch(next)
);
router.post("/:id/solicitar-cnpj", (req, res, next) =>
  conversaController.solicitarCnpj(req, res).catch(next)
);
router.post("/:id/validar-cnpj", validate(validarCnpjSchema), (req, res, next) =>
  conversaController.validarCnpj(req, res).catch(next)
);
router.patch("/:id/status", validate(atualizarStatusSchema), (req, res, next) =>
  conversaController.atualizarStatus(req, res).catch(next)
);
router.patch("/:id/flags", validate(atualizarFlagsSchema), (req, res, next) =>
  conversaController.atualizarFlags(req, res).catch(next)
);
router.patch("/:id/lido", (req, res, next) => conversaController.marcarLido(req, res).catch(next));
router.delete("/:id", (req, res, next) => conversaController.remover(req, res).catch(next));

module.exports = router;
