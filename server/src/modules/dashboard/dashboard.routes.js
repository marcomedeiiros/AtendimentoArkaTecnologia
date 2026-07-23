const router = require("express").Router();
const dashboardController = require("./dashboard.controller");

/**
 * @openapi
 * /api/dashboard:
 *   get:
 *     tags: [Dashboard]
 *     summary: Metricas gerais do painel
 *     responses:
 *       200:
 *         description: Metricas
 */
router.get("/", (req, res, next) =>
  dashboardController.obter(req, res).catch(next)
);

module.exports = router;
