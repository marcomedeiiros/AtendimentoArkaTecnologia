const router = require("express").Router();
const configuracaoService = require("./configuracao.service");
const evolutionApi = require("../../infrastructure/external/evolution-api.client");
const n8nClient = require("../../infrastructure/external/n8n.client");
const prisma = require("../../infrastructure/database/prisma.client");
const { success } = require("../../shared/helpers/response.helper");
const { authMiddleware } = require("../../shared/middlewares/auth.middleware");
const { exigirModulo } = require("../permissoes/modulo.middleware");
const validate = require("../../shared/middlewares/validate.middleware");
const { salvarConfiguracoesSchema } = require("./configuracao.dto");
const env = require("../../config/env");

// Configuracoes (integracoes/segredos): controlado pela matriz (modulo
// "configuracoes").
router.use(authMiddleware, exigirModulo("configuracoes"));

const rota = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

/**
 * @openapi
 * /api/configuracoes:
 *   get:
 *     tags: [Configuracoes]
 *     security: [{ bearerAuth: [] }]
 *     summary: Configuracoes atuais (segredos mascarados) + status do sistema
 */
router.get(
  "/",
  rota(async (req, res) => {
    const valores = await configuracaoService.listarParaUi();

    // Status do banco: um SELECT trivial confirma a conexao.
    let banco = { conectado: false, tipo: "SQLite" };
    try {
      await prisma.$queryRaw`SELECT 1`;
      banco = {
        conectado: true,
        tipo: String(env.databaseUrl || "").startsWith("postgres") ? "PostgreSQL" : "SQLite",
      };
    } catch (e) {
      banco.erro = e.message;
    }

    return success(res, {
      valores,
      sistema: {
        banco,
        servidor: {
          ambiente: env.nodeEnv,
          porta: env.port,
          node: process.version,
          uptimeSegundos: Math.round(process.uptime()),
        },
        versaoApp: require("../../../package.json").version || "1.0.0",
      },
    });
  })
);

// Gravar configuracao mexe em segredos e URLs de integracao (Evolution, n8n,
// transcricao). Ja restrito ao Grupo A pelo router.use acima.
router.put(
  "/",
  validate(salvarConfiguracoesSchema),
  rota(async (req, res) => success(res, await configuracaoService.salvar(req.body || {})))
);

/**
 * @openapi
 * /api/configuracoes/testar/{servico}:
 *   post:
 *     tags: [Configuracoes]
 *     summary: Testa a conexao com evolution ou n8n
 */
router.post(
  "/testar/:servico",
  rota(async (req, res) => {
    const servico = req.params.servico;

    if (servico === "n8n") {
      try {
        const r = await n8nClient.testarConexao();
        return success(res, { servico, conectado: true, ...r });
      } catch (e) {
        return success(res, { servico, conectado: false, erro: e.message });
      }
    }

    if (servico === "evolution") {
      try {
        const instancia = await evolutionApi.instanciaPadrao();
        const estado = await evolutionApi.getConnectionState(instancia);
        const versao = await evolutionApi.getVersion();
        const state = estado?.instance?.state || estado?.state || "close";
        return success(res, {
          servico,
          conectado: true,
          instancia,
          state,
          versao,
        });
      } catch (e) {
        return success(res, { servico, conectado: false, erro: e.message });
      }
    }

    return res.status(400).json({
      success: false,
      error: { code: "SERVICO_INVALIDO", message: "Use 'evolution' ou 'n8n'" },
    });
  })
);

module.exports = router;
