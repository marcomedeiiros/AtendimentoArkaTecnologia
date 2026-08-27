const router = require("express").Router();
const parceiroController = require("./parceiro.controller");
const validate = require("../../shared/middlewares/validate.middleware");
const { authMiddleware } = require("../../shared/middlewares/auth.middleware");
const { exigirModulo } = require("../permissoes/modulo.middleware");
const { criarParceiroSchema, atualizarParceiroSchema } = require("./parceiro.dto");

router.use(authMiddleware, exigirModulo("parceiros"));

router.get("/", (req, res, next) => parceiroController.listar(req, res).catch(next));
router.post("/", validate(criarParceiroSchema), (req, res, next) => parceiroController.criar(req, res).catch(next));
router.put("/:cnpj", validate(atualizarParceiroSchema), (req, res, next) => parceiroController.atualizar(req, res).catch(next));
router.get("/:cnpj/validar", (req, res, next) => parceiroController.validar(req, res).catch(next));
router.patch("/:cnpj/status", (req, res, next) => parceiroController.alternarStatus(req, res).catch(next));
// REMOCAO MANUAL DE VINCULO NAO EXISTE MAIS.
//
// Havia aqui DELETE /:cnpj/contatos/:telefone -- o endpoint do "X" na tela
// Clientes (CNPJ). Desassociar um CNPJ passou a ser decisao do CLIENTE, tomada
// dentro da etapa do fluxo que pergunta "o CNPJ continua sendo este?": quem
// responde NAO desassocia a propria conversa, e so ela (ver
// chatbot.engine._desassociarCnpj).
//
// A rota foi REMOVIDA, e nao apenas escondida no front. Um endpoint que limpa o
// CNPJ de TODAS as conversas de um telefone continuaria chamavel por qualquer
// sessao autenticada com o modulo "parceiros" -- com botao ou sem botao.
router.delete("/:cnpj", (req, res, next) => parceiroController.remover(req, res).catch(next));

module.exports = router;
