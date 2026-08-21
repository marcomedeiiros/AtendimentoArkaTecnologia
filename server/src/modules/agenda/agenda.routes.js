const router = require("express").Router();
const controller = require("./agenda.controller");
const validate = require("../../shared/middlewares/validate.middleware");
const { authMiddleware } = require("../../shared/middlewares/auth.middleware");
const { exigirModulo } = require("../permissoes/modulo.middleware");
const {
  criarCompromissoSchema,
  atualizarCompromissoSchema,
  definirConcluidoSchema,
} = require("./agenda.dto");

router.use(authMiddleware);

// A agenda e compartilhada pela equipe: quem tem o modulo "agenda" ve e edita.
// O servidor e a autoridade -- esconder a tela no front nao basta.
router.use(exigirModulo("agenda"));

router.get("/", (req, res, next) => controller.listar(req, res).catch(next));
router.post("/", validate(criarCompromissoSchema), (req, res, next) => controller.criar(req, res).catch(next));

// Rota especifica ANTES de "/:id" para nao ser capturada como um id.
router.delete("/concluidos-antigos", (req, res, next) => controller.limparConcluidosAntigos(req, res).catch(next));

router.put("/:id", validate(atualizarCompromissoSchema), (req, res, next) => controller.atualizar(req, res).catch(next));
router.patch("/:id/concluido", validate(definirConcluidoSchema), (req, res, next) => controller.definirConcluido(req, res).catch(next));
router.delete("/:id", (req, res, next) => controller.remover(req, res).catch(next));

module.exports = router;
