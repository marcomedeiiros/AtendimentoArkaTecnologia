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

/**
 * @openapi
 * /api/dashboard/painel:
 *   get:
 *     tags: [Dashboard]
 *     security: [{ bearerAuth: [] }]
 *     summary: Painel de parede -- KPIs da equipe e fila de espera
 *     responses:
 *       200:
 *         description: Ranking do mes, CSAT, tempos, meta do dia, equipe online e fila
 */
router.get("/painel", (req, res, next) =>
  dashboardController.painel(req, res).catch(next)
);

/**
 * @openapi
 * /api/dashboard/ranking-equipe:
 *   get:
 *     tags: [Dashboard]
 *     security: [{ bearerAuth: [] }]
 *     summary: Ranking do time (todos), com o ultimo atendimento de cada um
 *     responses:
 *       200:
 *         description: Classificacao do mes por pontos, com ultimo atendimento
 */
router.get("/ranking-equipe", (req, res, next) =>
  dashboardController.rankingEquipe(req, res).catch(next)
);

module.exports = router;
