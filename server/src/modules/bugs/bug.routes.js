const router = require("express").Router();
const bugController = require("./bug.controller");
const validate = require("../../shared/middlewares/validate.middleware");
const { authMiddleware } = require("../../shared/middlewares/auth.middleware");
const { adminMiddleware } = require("../../shared/middlewares/admin.middleware");
const { criarBugSchema, atualizarStatusSchema } = require("./bug.dto");

router.use(authMiddleware);

// Qualquer pessoa logada pode reportar um bug (botao flutuante em toda tela).
router.post("/", validate(criarBugSchema), (req, res, next) => bugController.criar(req, res).catch(next));

// Ver e gerenciar os relatos e so para Administradores.
router.get("/", adminMiddleware, (req, res, next) => bugController.listar(req, res).catch(next));
router.patch("/:id/status", adminMiddleware, validate(atualizarStatusSchema), (req, res, next) => bugController.atualizarStatus(req, res).catch(next));
router.delete("/:id", adminMiddleware, (req, res, next) => bugController.remover(req, res).catch(next));

module.exports = router;
