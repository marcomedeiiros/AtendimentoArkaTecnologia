const router = require("express").Router();
const contatoController = require("./contato.controller");
const validate = require("../../shared/middlewares/validate.middleware");
const { authMiddleware } = require("../../shared/middlewares/auth.middleware");
const { exigirModulo } = require("../permissoes/modulo.middleware");
const { criarContatoSchema, atualizarContatoSchema, sincronizarContatosSchema } = require("./contato.dto");

router.use(authMiddleware, exigirModulo("contatos"));

router.get("/", (req, res, next) => contatoController.listar(req, res).catch(next));
router.post("/", validate(criarContatoSchema), (req, res, next) => contatoController.criar(req, res).catch(next));
/**
 * @openapi
 * /api/contatos/sincronizar:
 *   post:
 *     tags: [Contatos]
 *     security: [{ bearerAuth: [] }]
 *     summary: Importa a agenda real do WhatsApp (Evolution) para os contatos
 */
router.post("/sincronizar", validate(sincronizarContatosSchema), (req, res, next) => contatoController.sincronizar(req, res).catch(next));
router.put("/:id", validate(atualizarContatoSchema), (req, res, next) => contatoController.atualizar(req, res).catch(next));
router.delete("/:id", (req, res, next) => contatoController.remover(req, res).catch(next));

module.exports = router;
