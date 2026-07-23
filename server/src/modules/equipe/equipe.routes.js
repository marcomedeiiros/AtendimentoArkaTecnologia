const router = require("express").Router();
const equipeController = require("./equipe.controller");
const validate = require("../../shared/middlewares/validate.middleware");
const { authMiddleware } = require("../../shared/middlewares/auth.middleware");
const { criarEquipeSchema, atualizarEquipeSchema } = require("./equipe.dto");

router.use(authMiddleware);

router.get("/", (req, res, next) => equipeController.listar(req, res).catch(next));
router.post("/", validate(criarEquipeSchema), (req, res, next) => equipeController.criar(req, res).catch(next));
router.put("/:id", validate(atualizarEquipeSchema), (req, res, next) => equipeController.atualizar(req, res).catch(next));
router.delete("/:id", (req, res, next) => equipeController.remover(req, res).catch(next));

module.exports = router;
