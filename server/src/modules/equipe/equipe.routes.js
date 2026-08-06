const router = require("express").Router();
const equipeController = require("./equipe.controller");
const { authMiddleware } = require("../../shared/middlewares/auth.middleware");

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
router.patch("/:id/status", (req, res, next) => equipeController.alterarStatus(req, res).catch(next));
router.patch("/:id/cargo", (req, res, next) => equipeController.alterarCargo(req, res).catch(next));
router.patch("/:id/senha", (req, res, next) => equipeController.redefinirSenha(req, res).catch(next));

module.exports = router;
