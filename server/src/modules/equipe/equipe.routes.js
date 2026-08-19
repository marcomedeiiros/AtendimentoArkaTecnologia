const router = require("express").Router();
const equipeController = require("./equipe.controller");
const { authMiddleware } = require("../../shared/middlewares/auth.middleware");
const { adminMiddleware } = require("../../shared/middlewares/admin.middleware");
const { exigirModulo } = require("../permissoes/modulo.middleware");

router.use(authMiddleware);

/**
 * @openapi
 * /api/equipe:
 *   get:
 *     tags: [Equipe]
 *     security: [{ bearerAuth: [] }]
 *     summary: Quem tem conta no painel, com presenca online
 */
// Ver a equipe: controlado pela matriz (modulo "equipe").
router.get("/", exigirModulo("equipe"), (req, res, next) => equipeController.listar(req, res).catch(next));

// Acoes privilegiadas seguem SO com Administrador -- de proposito, mesmo que o
// Comercial veja a tela. Deixar o Comercial mudar cargos abriria um caminho de
// auto-promocao a Administrador (escalonamento de privilegio). Defesa em
// profundidade: adminMiddleware barra pelo cargo do token e cada metodo do
// service reconfere o cargo no BANCO.
router.patch("/:id/status", adminMiddleware, (req, res, next) => equipeController.alterarStatus(req, res).catch(next));
router.patch("/:id/cargo", adminMiddleware, (req, res, next) => equipeController.alterarCargo(req, res).catch(next));
router.patch("/:id/senha", adminMiddleware, (req, res, next) => equipeController.redefinirSenha(req, res).catch(next));
router.delete("/:id", adminMiddleware, (req, res, next) => equipeController.remover(req, res).catch(next));

module.exports = router;
