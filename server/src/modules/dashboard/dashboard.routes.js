const router = require("express").Router();
const dashboardController = require("./dashboard.controller");
const { authMiddleware } = require("../../shared/middlewares/auth.middleware");
const { exigirModulo } = require("../permissoes/modulo.middleware");
const { adminMiddleware } = require("../../shared/middlewares/admin.middleware");

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

/**
 * @openapi
 * /api/dashboard/painel/limpar:
 *   post:
 *     tags: [Dashboard]
 *     security: [{ bearerAuth: [] }]
 *     summary: Zera o painel da equipe a partir de agora (nao apaga atendimentos)
 *     responses:
 *       200:
 *         description: Instante do zeramento
 */
// SO ADMINISTRADOR. Muda o que a equipe INTEIRA ve na parede -- inclusive a
// propria classificacao de quem clicou. Esconder o botao no front nao basta:
// sem este guarda, qualquer conta autenticada chamaria a rota no curl.
// CONFIGURACAO DA PONTUACAO DA SEDE. So ADMINISTRADOR, nos dois verbos --
// inclusive na leitura: a tela expoe a regua exata, e quem e avaliado saber
// dela antes de a empresa anunciar e outra coisa.
router.get("/regras", adminMiddleware, (req, res, next) => dashboardController.obterRegras(req, res).catch(next));
router.put("/regras", adminMiddleware, (req, res, next) => dashboardController.salvarRegras(req, res).catch(next));

router.post("/painel/limpar", adminMiddleware, (req, res, next) =>
  dashboardController.limparPainel(req, res).catch(next)
);

/**
 * @openapi
 * /api/dashboard/painel/restaurar:
 *   post:
 *     tags: [Dashboard]
 *     security: [{ bearerAuth: [] }]
 *     summary: Desfaz a limpeza e volta a contar o mes inteiro
 *     responses:
 *       200:
 *         description: Zeramento removido
 */
router.post("/painel/restaurar", adminMiddleware, (req, res, next) =>
  dashboardController.restaurarPainel(req, res).catch(next)
);

module.exports = router;
