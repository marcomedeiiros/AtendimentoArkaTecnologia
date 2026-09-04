const router = require("express").Router();
const relatorioService = require("./relatorio.service");
const { authMiddleware } = require("../../shared/middlewares/auth.middleware");
const { exigirModulo } = require("../permissoes/modulo.middleware");
const { success } = require("../../shared/helpers/response.helper");
const AppError = require("../../shared/errors/AppError");

// MESMO GATE DA VISAO GERAL, e nao um modulo novo.
//
// A aba vive dentro do Dashboard: quem enxerga a aba tem "dashboard", e quem
// nao tem nunca chega a ver o botao. Criar um modulo proprio obrigaria a mexer
// na matriz de permissoes de todo mundo para liberar uma aba que ja esta
// visivel -- e o resultado pratico seria o mesmo conjunto de pessoas.
//
// O que NAO se faz aqui: usar so `authMiddleware`, como o Help Desk faz
// (helpdesk.routes.js:5). La as metricas sao agregadas da operacao; aqui sao
// dados NOMINAIS de cliente, saindo num documento que vai para fora.
router.use(authMiddleware, exigirModulo("dashboard"));

// Validacao dos parametros na BORDA. Sao dois, ambos de query, e o `periodo` e
// uma allowlist -- qualquer outro valor cai em 400 antes de tocar o banco.
function lerParametros(req) {
  const periodo = String(req.query.periodo || "mes");
  if (!relatorioService.PERIODOS.includes(periodo)) {
    throw new AppError(
      `Periodo invalido. Use: ${relatorioService.PERIODOS.join(", ")}.`,
      400,
      "PERIODO_INVALIDO"
    );
  }
  // `referencia` existe para gerar o relatorio de um periodo PASSADO (o mes que
  // fechou, por exemplo). Ausente = hoje. Formato ISO simples, checado aqui
  // para nao virar string arbitraria dentro da construcao da data.
  const referencia = req.query.referencia ? String(req.query.referencia) : null;
  if (referencia && !/^\d{4}-\d{2}-\d{2}$/.test(referencia)) {
    throw new AppError("Data de referencia invalida (use AAAA-MM-DD)", 400, "REFERENCIA_INVALIDA");
  }
  return { periodo, referencia };
}

/**
 * @openapi
 * /api/relatorios/clientes:
 *   get:
 *     tags: [Relatorios]
 *     summary: Mapa de todos os clientes (CNPJ) e o volume de chamados no periodo
 *     security: [{ bearerAuth: [] }]
 */
router.get("/clientes", (req, res, next) =>
  Promise.resolve()
    .then(() => relatorioService.mapaClientes(lerParametros(req)))
    .then((dados) => success(res, dados))
    .catch(next)
);

/**
 * @openapi
 * /api/relatorios/clientes/{cnpj}:
 *   get:
 *     tags: [Relatorios]
 *     summary: Relatorio de uma empresa no periodo (alimenta o PDF)
 *     security: [{ bearerAuth: [] }]
 */
router.get("/clientes/:cnpj", (req, res, next) =>
  Promise.resolve()
    .then(() => relatorioService.relatorioEmpresa(req.params.cnpj, lerParametros(req)))
    .then((dados) => success(res, dados))
    .catch(next)
);

module.exports = router;
