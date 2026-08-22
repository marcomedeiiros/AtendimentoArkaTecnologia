const router = require("express").Router();
const prisma = require("../../infrastructure/database/prisma.client");
const { success } = require("../../shared/helpers/response.helper");
const { authMiddleware } = require("../../shared/middlewares/auth.middleware");
const validate = require("../../shared/middlewares/validate.middleware");
const { salvarPreferenciaSchema } = require("./preferencia.dto");

router.use(authMiddleware);

const rota = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// O JWT carrega o id do operador em `sub`.
const usuarioDe = (req) => req.user?.sub;

/**
 * @openapi
 * /api/preferencias/{chave}:
 *   get:
 *     tags: [Preferencias]
 *     security: [{ bearerAuth: [] }]
 *     summary: Le uma preferencia de interface do operador logado
 */
router.get(
  "/:chave",
  rota(async (req, res) => {
    const usuarioId = usuarioDe(req);
    if (!usuarioId) return success(res, { chave: req.params.chave, valor: null });

    const pref = await prisma.preferencia.findUnique({
      where: { usuarioId_chave: { usuarioId, chave: req.params.chave } },
    });

    let valor = null;
    if (pref?.valor) {
      // Guardamos JSON serializado; se algo corromper, devolve null em vez de 500.
      try { valor = JSON.parse(pref.valor); } catch { valor = null; }
    }
    return success(res, { chave: req.params.chave, valor });
  })
);

router.put(
  "/:chave",
  validate(salvarPreferenciaSchema),
  rota(async (req, res) => {
    const usuarioId = usuarioDe(req);
    if (!usuarioId) {
      return res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Operador nao identificado" },
      });
    }

    const chave = req.params.chave;
    const valor = JSON.stringify(req.body?.valor ?? null);

    await prisma.preferencia.upsert({
      where: { usuarioId_chave: { usuarioId, chave } },
      update: { valor },
      create: { usuarioId, chave, valor },
    });

    return success(res, { chave, valor: req.body?.valor ?? null });
  })
);

module.exports = router;
