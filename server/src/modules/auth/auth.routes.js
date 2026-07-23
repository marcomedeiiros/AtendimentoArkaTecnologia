const router = require("express").Router();
const authController = require("./auth.controller");
const validate = require("../../shared/middlewares/validate.middleware");
const { authMiddleware } = require("../../shared/middlewares/auth.middleware");
const { loginSchema } = require("./auth.dto");

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
