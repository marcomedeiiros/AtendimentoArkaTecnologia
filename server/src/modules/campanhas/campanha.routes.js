const router = require("express").Router();
const controller = require("./campanha.controller");
const validate = require("../../shared/middlewares/validate.middleware");
const { authMiddleware } = require("../../shared/middlewares/auth.middleware");
const { exigirModulo } = require("../permissoes/modulo.middleware");
const { criarCampanhaSchema } = require("./campanha.dto");

// Envio em Massa -> modulo "massa" na matriz de permissoes. Disparar mensagem
// para centenas de numeros e uma acao sensivel: o gate vale para TODAS as rotas
// abaixo, inclusive as de leitura (a lista revela a base de contatos).
router.use(authMiddleware, exigirModulo("massa"));

router.get("/", (req, res, next) => controller.listar(req, res).catch(next));
router.get("/:id", (req, res, next) => controller.obter(req, res).catch(next));

router.post("/", validate(criarCampanhaSchema), (req, res, next) =>
  controller.criar(req, res).catch(next)
);

// Acoes de execucao. Sem body: o alvo e a campanha da URL, e o servidor decide
// se a transicao de status e permitida (nao confia no que a tela acha).
router.post("/:id/iniciar", (req, res, next) => controller.iniciar(req, res).catch(next));
router.post("/:id/pausar", (req, res, next) => controller.pausar(req, res).catch(next));
router.post("/:id/cancelar", (req, res, next) => controller.cancelar(req, res).catch(next));
router.delete("/:id", (req, res, next) => controller.remover(req, res).catch(next));

module.exports = router;
