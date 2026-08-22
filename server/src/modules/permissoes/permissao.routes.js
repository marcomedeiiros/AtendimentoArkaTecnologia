const router = require("express").Router();
const permissaoService = require("./permissao.service");
const { success } = require("../../shared/helpers/response.helper");
const { authMiddleware } = require("../../shared/middlewares/auth.middleware");
const { adminMiddleware } = require("../../shared/middlewares/admin.middleware");
const validate = require("../../shared/middlewares/validate.middleware");
const { salvarPermissoesSchema } = require("./permissao.dto");

// Ver e editar a matriz de permissoes e privilegio EXCLUSIVO do Administrador
// -- mesmo o Comercial, que enxerga a tela de Equipe, nao mexe aqui. Editar
// permissao e o poder mais sensivel do painel (define quem acessa o que), entao
// vale a barreira mais forte. adminMiddleware le o cargo do banco (via
// authMiddleware), nao do token cru.
router.use(authMiddleware, adminMiddleware);

const rota = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// Catalogo de modulos + matriz efetiva (para o editor).
router.get("/", rota(async (req, res) => success(res, await permissaoService.paraEditor())));

// Salva a matriz. O service ignora Administrador e qualquer chave desconhecida.
router.put("/", validate(salvarPermissoesSchema), rota(async (req, res) => success(res, await permissaoService.salvar(req.body || {}))));

module.exports = router;
