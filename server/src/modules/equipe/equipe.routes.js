const router = require("express").Router();
const equipeController = require("./equipe.controller");
const { authMiddleware } = require("../../shared/middlewares/auth.middleware");

router.use(authMiddleware);

/**
 * @openapi
 * /api/equipe:
 *   get:
 *     tags: [Equipe]
 *     security: [{ bearerAuth: [] }]
 *     summary: Quem tem conta no painel, com presenca online
 */
router.get("/", (req, res, next) => equipeController.listar(req, res).catch(next));

// Nao ha POST/PUT/DELETE aqui.
//
// A equipe deixou de ser uma lista editavel: entrar nela e criar conta em
// /cadastrar, e o status vem da presenca observada, nao de um botao. Manter as
// rotas de escrita significaria manter duas fontes de verdade para a mesma
// pergunta -- "quem trabalha aqui?".

module.exports = router;
