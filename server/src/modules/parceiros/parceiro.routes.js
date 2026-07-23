const router = require("express").Router();
const parceiroController = require("./parceiro.controller");
const validate = require("../../shared/middlewares/validate.middleware");
const { authMiddleware } = require("../../shared/middlewares/auth.middleware");
const { criarParceiroSchema } = require("./parceiro.dto");

router.use(authMiddleware);

router.get("/", (req, res, next) => parceiroController.listar(req, res).catch(next));
router.post("/", validate(criarParceiroSchema), (req, res, next) => parceiroController.criar(req, res).catch(next));
router.get("/:cnpj/validar", (req, res, next) => parceiroController.validar(req, res).catch(next));
router.patch("/:cnpj/status", (req, res, next) => parceiroController.alternarStatus(req, res).catch(next));
router.delete("/:cnpj", (req, res, next) => parceiroController.remover(req, res).catch(next));

module.exports = router;
