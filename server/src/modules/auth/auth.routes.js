const router = require("express").Router();
const authController = require("./auth.controller");
const validate = require("../../shared/middlewares/validate.middleware");
const { authMiddleware } = require("../../shared/middlewares/auth.middleware");
const { authLimiter } = require("../../shared/middlewares/rateLimit.middleware");
const { exigirTurnstile } = require("../../shared/middlewares/turnstile.middleware");
const { bloqueioProgressivo } = require("../../shared/middlewares/bloqueioProgressivo.middleware");
const { loginSchema, cadastroSchema, atualizarPerfilSchema, trocarSenhaSchema, refreshSchema, sairSchema } = require("./auth.dto");

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Login de operador
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, senha]
 *             properties:
 *               email: { type: string }
 *               senha: { type: string }
 *     responses:
 *       200:
 *         description: Token JWT
 */
/* ORDEM DOS FREIOS, e ela importa:
     authLimiter        corta VOLUME por IP (barato, primeiro)
     validate           corpo malformado nem conta como tentativa
     bloqueioProgressivo pune SEQUENCIA de falhas -- antes do Turnstile, para
                        um bloqueado nao gastar chamada a Cloudflare
     exigirTurnstile    por ultimo: e a checagem que sai da maquina */
router.post("/login", authLimiter, validate(loginSchema), bloqueioProgressivo, exigirTurnstile, (req, res, next) =>
  authController.login(req, res).catch(next)
);

/**
 * @openapi
 * /api/auth/renovar:
 *   post:
 *     tags: [Auth]
 *     summary: Renova a sessao (troca o refresh token por um par novo)
 *     description: >
 *       Rotacao obrigatoria: o token enviado e queimado e sai um novo no lugar.
 *       Reenviar um token ja usado revoga a sessao inteira (deteccao de roubo).
 *       Nao exige o token de acesso -- e justamente para quando ele venceu.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken: { type: string }
 *     responses:
 *       200: { description: "Novo par: token de acesso + refreshToken" }
 *       401: { description: Sessao invalida, expirada, revogada ou reusada }
 */
router.post("/renovar", authLimiter, validate(refreshSchema), (req, res, next) =>
  authController.renovar(req, res).catch(next)
);

/**
 * @openapi
 * /api/auth/sair:
 *   post:
 *     tags: [Auth]
 *     summary: Encerra a sessao no servidor (revoga a familia do refresh token)
 *     description: Idempotente -- token desconhecido tambem responde 200.
 */
router.post("/sair", authLimiter, validate(sairSchema), (req, res, next) =>
  authController.sair(req, res).catch(next)
);

/**
 * @openapi
 * /api/auth/sair-todos:
 *   post:
 *     tags: [Auth]
 *     summary: Encerra a sessao em TODOS os dispositivos, inclusive neste
 *     description: >
 *       Revoga todas as familias de refresh da conta. Como o authMiddleware
 *       confere a familia (sid) a cada requisicao, os tokens de acesso ja
 *       emitidos param de valer na hora, e nao no fim do prazo deles. O alvo e
 *       sempre o usuario do token -- nao ha como atingir a conta de outro.
 *     responses:
 *       200: { description: "Quantas sessoes foram encerradas" }
 *       401: { description: "Sem sessao valida" }
 */
/* `authMiddleware` e obrigatorio, e nao decorativo: e ele que poe `req.user.sub`
   -- o alvo da revogacao. Sem o middleware, `req.user` seria indefinido e a
   rota derrubaria a sessao de ninguem, ou quebraria. Sem corpo: nao ha nada
   para validar, porque nao se aceita nenhum parametro de quem chama. */
router.post("/sair-todos", authMiddleware, (req, res, next) =>
  authController.sairDeTodos(req, res).catch(next)
);

/**
 * @openapi
 * /api/auth/cadastrar:
 *   post:
 *     tags: [Auth]
 *     summary: Cria uma conta de operador (nao autentica -- e preciso fazer login)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nome, email, senha]
 *             properties:
 *               nome:   { type: string }
 *               email:  { type: string }
 *               senha:  { type: string, minLength: 6 }
 *               cargo:  { type: string }
 *               codigo: { type: string, description: "Exigido apenas quando REGISTRO_CODIGO estiver definido no .env" }
 *     responses:
 *       201: { description: "Conta criada. Devolve apenas os dados do usuario; o token sai do /login" }
 *       409: { description: E-mail ja cadastrado }
 */
router.post("/cadastrar", authLimiter, validate(cadastroSchema), bloqueioProgressivo, exigirTurnstile, (req, res, next) =>
  authController.cadastrar(req, res).catch(next)
);

/**
 * @openapi
 * /api/auth/registro-info:
 *   get:
 *     tags: [Auth]
 *     summary: Diz se o cadastro exige codigo de convite
 */
router.get("/turnstile", (req, res) => authController.turnstileConfig(req, res));

router.get("/registro-info", (req, res) => authController.registroInfo(req, res));

/**
 * @openapi
 * /api/auth/me:
 *   get:
 *     tags: [Auth]
 *     security: [{ bearerAuth: [] }]
 *     summary: Usuario autenticado
 */
router.get("/me", authMiddleware, (req, res, next) =>
  authController.me(req, res).catch(next)
);

/**
 * @openapi
 * /api/auth/perfil:
 *   patch:
 *     tags: [Auth]
 *     security: [{ bearerAuth: [] }]
 *     summary: Edita o proprio perfil (nome). O alvo vem do token, nao do body.
 */
router.patch("/perfil", authMiddleware, validate(atualizarPerfilSchema), (req, res, next) =>
  authController.atualizarPerfil(req, res).catch(next)
);

/**
 * @openapi
 * /api/auth/senha:
 *   patch:
 *     tags: [Auth]
 *     security: [{ bearerAuth: [] }]
 *     summary: Troca a propria senha (exige a senha atual)
 */
router.patch("/senha", authLimiter, authMiddleware, validate(trocarSenhaSchema), (req, res, next) =>
  authController.trocarSenha(req, res).catch(next)
);

module.exports = router;
