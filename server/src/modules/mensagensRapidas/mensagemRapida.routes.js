const router = require("express").Router();
const controller = require("./mensagemRapida.controller");
const validate = require("../../shared/middlewares/validate.middleware");
const { authMiddleware } = require("../../shared/middlewares/auth.middleware");
const { exigirModulo } = require("../permissoes/modulo.middleware");
const {
  criarMensagemRapidaSchema,
  atualizarMensagemRapidaSchema,
} = require("./mensagemRapida.dto");

router.use(authMiddleware);

// LER: qualquer pessoa logada precisa das mensagens rapidas no atendimento.
router.get("/", (req, res, next) => controller.listar(req, res).catch(next));

// GERENCIAR: criar/editar/excluir afeta a equipe toda -> controlado pela matriz
// (modulo "mensagens"). O servidor e a autoridade; esconder no front nao basta.
router.post("/", exigirModulo("mensagens"), validate(criarMensagemRapidaSchema), (req, res, next) =>
  controller.criar(req, res).catch(next)
);
router.put("/:id", exigirModulo("mensagens"), validate(atualizarMensagemRapidaSchema), (req, res, next) =>
  controller.atualizar(req, res).catch(next)
);
router.delete("/:id", exigirModulo("mensagens"), (req, res, next) =>
  controller.remover(req, res).catch(next)
);

module.exports = router;
