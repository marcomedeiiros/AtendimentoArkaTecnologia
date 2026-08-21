const router = require("express").Router();
const conversaController = require("./conversa.controller");
const conversaStream = require("./conversa.stream");
const validate = require("../../shared/middlewares/validate.middleware");
const { authMiddleware } = require("../../shared/middlewares/auth.middleware");
const { exigirModulo } = require("../permissoes/modulo.middleware");
const {
  enviarMensagemSchema,
  iniciarConversaSchema,
  atualizarStatusSchema,
  validarCnpjSchema,
  enviarMidiaSchema,
  atualizarFlagsSchema,
} = require("./conversa.dto");

// SSE: autenticado pelo ticket na query (o EventSource nao manda header).
// Precisa vir ANTES do authMiddleware global e antes de "/:id".
router.get("/stream", (req, res) => conversaStream.stream(req, res));

router.use(authMiddleware);
// Central de Atendimento -> modulo "atendimento" na matriz de permissoes.
router.use(exigirModulo("atendimento"));

router.post("/stream-ticket", (req, res) => conversaStream.criarTicket(req, res));
router.get("/", (req, res, next) => conversaController.listar(req, res).catch(next));
// ANTES de "/:id": em Express a primeira rota que casa vence, e "/iniciar"
// casaria com "/:id" se viesse depois.
router.post("/iniciar", validate(iniciarConversaSchema), (req, res, next) =>
  conversaController.iniciarConversa(req, res).catch(next)
);
router.get("/:id", (req, res, next) => conversaController.obter(req, res).catch(next));
router.post("/:id/atender", (req, res, next) => conversaController.atender(req, res).catch(next));
router.post("/:id/mensagens", validate(enviarMensagemSchema), (req, res, next) =>
  conversaController.enviarMensagem(req, res).catch(next)
);
router.post("/:id/midia", validate(enviarMidiaSchema), (req, res, next) =>
  conversaController.enviarMidia(req, res).catch(next)
);
router.post("/mensagens/encaminhar", (req, res, next) =>
  conversaController.encaminharMensagem(req, res).catch(next)
);
router.patch("/mensagens/:mensagemId", (req, res, next) =>
  conversaController.editarMensagem(req, res).catch(next)
);
router.post("/mensagens/:mensagemId/transcrever", (req, res, next) =>
  conversaController.transcreverAudio(req, res).catch(next)
);
router.delete("/mensagens/:mensagemId", (req, res, next) =>
  conversaController.apagarMensagem(req, res).catch(next)
);
router.post("/:id/solicitar-cnpj", (req, res, next) =>
  conversaController.solicitarCnpj(req, res).catch(next)
);
router.post("/:id/validar-cnpj", validate(validarCnpjSchema), (req, res, next) =>
  conversaController.validarCnpj(req, res).catch(next)
);
router.patch("/:id/status", validate(atualizarStatusSchema), (req, res, next) =>
  conversaController.atualizarStatus(req, res).catch(next)
);
router.patch("/:id/setor", (req, res, next) =>
  conversaController.atualizarSetor(req, res).catch(next)
);
router.patch("/:id/atendente", (req, res, next) =>
  conversaController.definirAtendente(req, res).catch(next)
);
router.post("/:id/avaliacao", (req, res, next) =>
  conversaController.avaliarAtendimento(req, res).catch(next)
);
router.patch("/:id/flags", validate(atualizarFlagsSchema), (req, res, next) =>
  conversaController.atualizarFlags(req, res).catch(next)
);
router.patch("/:id/lido", (req, res, next) => conversaController.marcarLido(req, res).catch(next));
router.delete("/:id", (req, res, next) => conversaController.remover(req, res).catch(next));

module.exports = router;
