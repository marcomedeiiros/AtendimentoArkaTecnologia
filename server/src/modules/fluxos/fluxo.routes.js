const router = require("express").Router();
const fluxoController = require("./fluxo.controller");
const validate = require("../../shared/middlewares/validate.middleware");
const { authMiddleware } = require("../../shared/middlewares/auth.middleware");
const { fluxoSchema, atualizarFluxoSchema } = require("./fluxo.dto");

router.use(authMiddleware);

router.get("/", (req, res, next) => fluxoController.listar(req, res).catch(next));
router.get("/:id", (req, res, next) => fluxoController.obter(req, res).catch(next));
router.post("/", validate(fluxoSchema), (req, res, next) => fluxoController.criar(req, res).catch(next));
router.put("/:id", validate(atualizarFluxoSchema), (req, res, next) => fluxoController.atualizar(req, res).catch(next));
router.delete("/:id", (req, res, next) => fluxoController.remover(req, res).catch(next));

module.exports = router;
