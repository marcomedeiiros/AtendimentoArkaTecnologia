const router = require("express").Router();
const equipeController = require("./equipe.controller");
const { authMiddleware } = require("../../shared/middlewares/auth.middleware");
const { adminMiddleware } = require("../../shared/middlewares/admin.middleware");

router.use(authMiddleware);

/**
 * @openapi
 * /api/equipe:
 *   get:
 *     tags: [Equipe]
 *     security: [{ bearerAuth: [] }]
 *     summary: Quem tem conta no painel, com presenca online
 */
router.get("/", (req, res, next) => equipeController.listar(req, res).catch(next));

// Gestao da equipe e restrita a Administrador. Defesa em profundidade:
// adminMiddleware barra pelo cargo do token (rapido, 1a camada) e cada metodo
// do service reconfere o cargo no BANCO (autoritativo, pega token defasado
// apos um rebaixamento). Sem isto, qualquer conta logada se auto-promovia a
// Administrador com um PATCH /:id/cargo.
router.patch("/:id/status", adminMiddleware, (req, res, next) => equipeController.alterarStatus(req, res).catch(next));
router.patch("/:id/cargo", adminMiddleware, (req, res, next) => equipeController.alterarCargo(req, res).catch(next));
router.patch("/:id/senha", adminMiddleware, (req, res, next) => equipeController.redefinirSenha(req, res).catch(next));
router.delete("/:id", adminMiddleware, (req, res, next) => equipeController.remover(req, res).catch(next));

module.exports = router;
