const router = require("express").Router();
const dashboardController = require("./dashboard.controller");
const { authMiddleware } = require("../../shared/middlewares/auth.middleware");
const { exigirModulo } = require("../permissoes/modulo.middleware");
const { adminMiddleware } = require("../../shared/middlewares/admin.middleware");
const validate = require("../../shared/middlewares/validate.middleware");
const { regrasSedeSchema } = require("./dashboard.dto");

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

// A SATISFACAO DO CICLO. Nao e restrita a administrador: e o mesmo agregado
// que o painel de parede mostra para a sala, e os cartoes de cima desta tela
// sempre contaram a empresa inteira. O que ela substitui e uma conta que a tela
// fazia sobre a lista da Central -- recortada por setor, e sem janela de tempo.
router.get("/satisfacao", (req, res, next) => dashboardController.satisfacao(req, res).catch(next));

// CONFIGURACAO DA PONTUACAO DA SEDE. So ADMINISTRADOR, nos dois verbos --
// inclusive na leitura: a tela expoe a regua exata, e quem e avaliado saber
// dela antes de a empresa anunciar e outra coisa.
router.get("/regras", adminMiddleware, (req, res, next) => dashboardController.obterRegras(req, res).catch(next));
// COM VALIDACAO NA BORDA, como a rota irma dos relatorios: o Zod barra a
// forma aqui e os tres gravadores reconferem a regra (ver `dashboard.dto`).
// Era a unica escrita de ranking sem esta primeira camada.
router.put("/regras", adminMiddleware, validate(regrasSedeSchema), (req, res, next) =>
  dashboardController.salvarRegras(req, res).catch(next)
);

/**
 * @openapi
 * /api/dashboard/ranking/{ranking}/recomecar:
 *   post:
 *     tags: [Dashboard]
 *     security: [{ bearerAuth: [] }]
 *     summary: Recomeca a contagem da competencia corrente (nao apaga atendimentos)
 *     responses:
 *       200:
 *         description: Competencia e instante a partir do qual ela conta
 */
// SO ADMINISTRADOR. Muda o placar que a equipe INTEIRA ve -- no ranking, na
// parede e na Visao Geral --, inclusive o de quem clicou. Esconder o botao no
// front nao basta: sem este guarda, qualquer conta autenticada chamaria a rota
// no curl.
//
// NAO HA rota de desfazer, a pedido ("sem botao de voltar essa pontuacao"). O
// caminho existe no servidor: `node recomecar-contagem.js --ranking=X
// --desfazer`. Ver o bloco no controller.
router.post("/ranking/:ranking/recomecar", adminMiddleware, (req, res, next) =>
  dashboardController.recomecarContagem(req, res).catch(next)
);

// AS ROTAS DE LIMPAR/RESTAURAR O PAINEL SAIRAM (11/09/2026).
//
// O recurso inteiro foi removido -- ver o topo de `painel.service`. Rota viva
// com botao removido e pior que o botao: a mesma chamada sai no curl e continua
// cortando a contagem de todos, agora sem nada na tela explicando.

module.exports = router;
