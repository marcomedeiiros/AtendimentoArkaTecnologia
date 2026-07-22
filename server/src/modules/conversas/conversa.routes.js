const router = require("express").Router();
const conversaController = require("./conversa.controller");
const validate = require("../../shared/middlewares/validate.middleware");
const { authMiddleware } = require("../../shared/middlewares/auth.middleware");
const {
  enviarMensagemSchema,
  atualizarStatusSchema,
  validarCnpjSchema,
} = require("./conversa.dto");

router.use(authMiddleware);

router.get("/", (req, res, next) => conversaController.listar(req, res).catch(next));
router.get("/:id", (req, res, next) => conversaController.obter(req, res).catch(next));
router.post("/:id/atender", (req, res, next) => conversaController.atender(req, res).catch(next));
router.post("/:id/mensagens", validate(enviarMensagemSchema), (req, res, next) =>
  conversaController.enviarMensagem(req, res).catch(next)
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
router.patch("/:id/lido", (req, res, next) => conversaController.marcarLido(req, res).catch(next));
router.delete("/:id", (req, res, next) => conversaController.remover(req, res).catch(next));

module.exports = router;
