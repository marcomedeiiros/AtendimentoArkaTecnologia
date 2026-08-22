const router = require("express").Router();
const bugController = require("./bug.controller");
const validate = require("../../shared/middlewares/validate.middleware");
const { authMiddleware } = require("../../shared/middlewares/auth.middleware");
const { exigirModulo } = require("../permissoes/modulo.middleware");
const { criarBugSchema, atualizarStatusSchema, atualizarBugSchema } = require("./bug.dto");

router.use(authMiddleware);

// Qualquer pessoa logada pode reportar um bug (botao flutuante em toda tela).
router.post("/", validate(criarBugSchema), (req, res, next) => bugController.criar(req, res).catch(next));

// Ver e gerenciar os relatos: controlado pela matriz (modulo "bugs").
router.get("/", exigirModulo("bugs"), (req, res, next) => bugController.listar(req, res).catch(next));
router.patch("/:id/status", exigirModulo("bugs"), validate(atualizarStatusSchema), (req, res, next) => bugController.atualizarStatus(req, res).catch(next));
// Editar o relato: corrigir o texto e reajustar a prioridade na triagem.
router.patch("/:id", exigirModulo("bugs"), validate(atualizarBugSchema), (req, res, next) => bugController.atualizar(req, res).catch(next));
router.delete("/:id", exigirModulo("bugs"), (req, res, next) => bugController.remover(req, res).catch(next));

module.exports = router;
