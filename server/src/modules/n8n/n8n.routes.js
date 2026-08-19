const router = require("express").Router();
const n8nService = require("./n8n.service");
const { success } = require("../../shared/helpers/response.helper");
const { authMiddleware } = require("../../shared/middlewares/auth.middleware");
const { exigirModulo } = require("../permissoes/modulo.middleware");

// n8n faz parte de "Fluxo de Automacoes" -> modulo "fluxos". O gate no router
// inteiro cobre leitura E escrita/execucao.
router.use(authMiddleware, exigirModulo("fluxos"));

const rota = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

/**
 * @openapi
 * /api/n8n/status:
 *   get:
 *     tags: [n8n]
 *     security: [{ bearerAuth: [] }]
 *     summary: Testa a conexao com o n8n
 */
router.get(
  "/status",
  rota(async (req, res) => {
    try {
      const dados = await n8nService.testarConexao();
      return success(res, { ...dados, conectado: true });
    } catch (e) {
      // Status e um "ping": responder 200 com conectado=false facilita a UI.
      return success(res, {
        conectado: false,
        erro: e.message,
        codigo: e.code || "N8N_ERROR",
      });
    }
  })
);

router.get("/workflows", rota(async (req, res) => success(res, await n8nService.listarWorkflows())));

router.post(
  "/workflows",
  rota(async (req, res) => success(res, await n8nService.criar(req.body?.nome || "Novo fluxo"), 201))
);

router.put(
  "/workflows/:id",
  rota(async (req, res) => success(res, await n8nService.renomear(req.params.id, req.body?.nome)))
);

router.patch(
  "/workflows/:id/ativo",
  rota(async (req, res) => success(res, await n8nService.alternarAtivo(req.params.id, !!req.body?.ativo)))
);

router.post(
  "/workflows/:id/executar",
  rota(async (req, res) => success(res, await n8nService.executar(req.params.id, req.body?.payload || {})))
);

router.delete(
  "/workflows/:id",
  rota(async (req, res) => success(res, await n8nService.excluir(req.params.id)))
);

module.exports = router;
