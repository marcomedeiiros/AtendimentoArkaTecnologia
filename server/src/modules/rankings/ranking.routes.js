const router = require("express").Router();
const controller = require("./ranking.controller");
const { authMiddleware } = require("../../shared/middlewares/auth.middleware");
const { adminMiddleware } = require("../../shared/middlewares/admin.middleware");
const { exigirModulo } = require("../permissoes/modulo.middleware");
const validate = require("../../shared/middlewares/validate.middleware");
const {
  criarMapeamentoSchema,
  atualizarMapeamentoSchema,
  validarMapeamentoSchema,
  premiacaoSchema,
} = require("./ranking.dto");

// Tudo daqui exige sessao e o modulo "rankings" (matriz de permissoes).
//
// A LEITURA e liberada para quem tem o modulo -- o ranking existe justamente
// para a equipe se ver nele; esconde-lo de quem concorre esvaziaria o proposito.
// O que e restrito e ESCREVER: validar mapeamento (supervisor, checado no
// service) e registrar premio (administrador, abaixo).
router.use(authMiddleware, exigirModulo("rankings"));

/**
 * @openapi
 * /api/rankings/equipes:
 *   get:
 *     tags: [Rankings]
 *     security: [{ bearerAuth: [] }]
 *     summary: Quem concorre em cada ranking e quem supervisiona
 */
router.get("/equipes", (req, res, next) => controller.equipes(req, res).catch(next));

/**
 * @openapi
 * /api/rankings/regras:
 *   get:
 *     tags: [Rankings]
 *     security: [{ bearerAuth: [] }]
 *     summary: Pesos e faixas da pontuacao do atendimento fora da sede
 */
router.get("/regras", (req, res, next) => controller.regras(req, res).catch(next));

// ── MAPEAMENTOS -- antes de /:equipe, senao "mapeamentos" cairia na rota do
// ranking e viraria um "ranking chamado mapeamentos" com erro 400.
router.get("/mapeamentos", (req, res, next) => controller.listarMapeamentos(req, res).catch(next));
router.get("/mapeamentos/:id", (req, res, next) => controller.obterMapeamento(req, res).catch(next));
router.post("/mapeamentos", validate(criarMapeamentoSchema), (req, res, next) =>
  controller.criarMapeamento(req, res).catch(next)
);
router.patch("/mapeamentos/:id", validate(atualizarMapeamentoSchema), (req, res, next) =>
  controller.atualizarMapeamento(req, res).catch(next)
);
// Aprovar/devolver: o guarda de supervisor esta no service, que le o CADASTRO
// (e nao o token) -- assim tirar a marca de supervisor vale na hora, sem
// esperar o token da pessoa expirar.
router.post("/mapeamentos/:id/validar", validate(validarMapeamentoSchema), (req, res, next) =>
  controller.validarMapeamento(req, res).catch(next)
);
router.delete("/mapeamentos/:id", (req, res, next) => controller.removerMapeamento(req, res).catch(next));

// ── PREMIACAO. So administrador: e o registro do que foi pago a quem.
router.get("/premiacoes", (req, res, next) => controller.listarPremiacoes(req, res).catch(next));
router.post("/premiacoes", adminMiddleware, validate(premiacaoSchema), (req, res, next) =>
  controller.registrarPremiacao(req, res).catch(next)
);
router.delete("/premiacoes/:id", adminMiddleware, (req, res, next) =>
  controller.removerPremiacao(req, res).catch(next)
);

// ── RANKINGS. Por ultimo: `:equipe` casaria com qualquer caminho acima.
router.get("/:equipe/historico", (req, res, next) => controller.historico(req, res).catch(next));
router.get("/:equipe", (req, res, next) => controller.obter(req, res).catch(next));

module.exports = router;
