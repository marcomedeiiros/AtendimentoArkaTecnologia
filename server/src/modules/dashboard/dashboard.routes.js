const router = require("express").Router();
const dashboardController = require("./dashboard.controller");
const { authMiddleware } = require("../../shared/middlewares/auth.middleware");
const { exigirModulo } = require("../permissoes/modulo.middleware");

// Visao Geral: acesso definido pela matriz de permissoes (modulo "dashboard").
// Antes esta rota nao tinha autenticacao nenhuma: as metricas ficavam publicas.
router.use(authMiddleware, exigirModulo("dashboard"));

/**
 * @openapi
 * /api/dashboard:
 *   get:
 *     tags: [Dashboard]
 *     security: [{ bearerAuth: [] }]
 *     summary: Metricas gerais do painel
 *     responses:
 *       200:
 *         description: Metricas
 */
router.get("/", (req, res, next) =>
  dashboardController.obter(req, res).catch(next)
);

module.exports = router;
