const router = require("express").Router();
const equipeController = require("./equipe.controller");
const { authMiddleware } = require("../../shared/middlewares/auth.middleware");
const { adminMiddleware } = require("../../shared/middlewares/admin.middleware");
const { exigirModulo } = require("../permissoes/modulo.middleware");
const validate = require("../../shared/middlewares/validate.middleware");
const {
  alterarStatusSchema,
  alterarCargoSchema,
  alterarSetoresSchema,
  alterarRankingSchema,
  redefinirSenhaSchema,
} = require("./equipe.dto");

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
router.patch("/:id/status", adminMiddleware, validate(alterarStatusSchema), (req, res, next) => equipeController.alterarStatus(req, res).catch(next));
router.patch("/:id/cargo", adminMiddleware, validate(alterarCargoSchema), (req, res, next) => equipeController.alterarCargo(req, res).catch(next));
router.patch("/:id/setores", adminMiddleware, validate(alterarSetoresSchema), (req, res, next) => equipeController.alterarSetores(req, res).catch(next));
// Ranking de desempenho: em qual equipe concorre e se supervisiona.
router.patch("/:id/ranking", adminMiddleware, validate(alterarRankingSchema), (req, res, next) => equipeController.alterarRanking(req, res).catch(next));
router.patch("/:id/senha", adminMiddleware, validate(redefinirSenhaSchema), (req, res, next) => equipeController.redefinirSenha(req, res).catch(next));
router.delete("/:id", adminMiddleware, (req, res, next) => equipeController.remover(req, res).catch(next));

module.exports = router;
