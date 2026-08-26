const router = require("express").Router();
const fluxoController = require("./fluxo.controller");
const validate = require("../../shared/middlewares/validate.middleware");
const { authMiddleware } = require("../../shared/middlewares/auth.middleware");
const { exigirModulo } = require("../permissoes/modulo.middleware");
const { fluxoSchema, atualizarFluxoSchema } = require("./fluxo.dto");

// Fluxo de Automacoes: controlado pela matriz (modulo "fluxos").
router.use(authMiddleware, exigirModulo("fluxos"));

router.get("/", (req, res, next) => fluxoController.listar(req, res).catch(next));
// Retrato de TODAS as automacoes do bot, fluxo a fluxo -- a lista que responde
// "o que o bot vai fazer?" sem ninguem precisar ler codigo. Antes de "/:id".
router.get("/automacoes/resumo", (req, res, next) =>
  fluxoController.automacoes(req, res).catch(next)
);
router.get("/:id", (req, res, next) => fluxoController.obter(req, res).catch(next));
router.post("/", validate(fluxoSchema), (req, res, next) => fluxoController.criar(req, res).catch(next));
router.put("/:id", validate(atualizarFluxoSchema), (req, res, next) => fluxoController.atualizar(req, res).catch(next));
router.delete("/", (req, res, next) => fluxoController.removerTodos(req, res).catch(next));
router.delete("/:id", (req, res, next) => fluxoController.remover(req, res).catch(next));

module.exports = router;
