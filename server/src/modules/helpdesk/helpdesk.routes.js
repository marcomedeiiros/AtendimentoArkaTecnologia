const router = require("express").Router();
const helpdeskController = require("./helpdesk.controller");
const { authMiddleware } = require("../../shared/middlewares/auth.middleware");

router.use(authMiddleware);

router.get("/", (req, res, next) => helpdeskController.metricas(req, res).catch(next));

module.exports = router;
