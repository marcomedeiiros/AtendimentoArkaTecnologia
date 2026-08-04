const router = require("express").Router();
const authController = require("./auth.controller");
const validate = require("../../shared/middlewares/validate.middleware");
const { authMiddleware } = require("../../shared/middlewares/auth.middleware");
const { loginSchema, cadastroSchema } = require("./auth.dto");

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
router.post("/login", validate(loginSchema), (req, res, next) =>
  authController.login(req, res).catch(next)
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
router.post("/cadastrar", validate(cadastroSchema), (req, res, next) =>
  authController.cadastrar(req, res).catch(next)
);

/**
 * @openapi
 * /api/auth/registro-info:
 *   get:
 *     tags: [Auth]
 *     summary: Diz se o cadastro exige codigo de convite
 */
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

module.exports = router;
