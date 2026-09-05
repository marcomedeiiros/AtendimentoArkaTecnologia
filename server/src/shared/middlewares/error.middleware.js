const { ZodError } = require("zod");
const AppError = require("../errors/AppError");
const logger = require("../../config/logger");

function errorMiddleware(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Dados invalidos",
        details: err.errors.map((e) => ({
          field: e.path.join("."),
          message: e.message,
        })),
      },
    });
  }

  if (err instanceof AppError) {
    // DIAGNOSTICO NO LOG, SEMPRE -- inclusive quando a resposta HTTP e curta.
    // Uma falha de integracao que so aparece como frase na tela nao deixa
    // rastro nenhum no servidor, e depois nao ha o que investigar.
    if (err.diagnostico) {
      logger.error("Falha de integracao", {
        code: err.code,
        statusCode: err.statusCode,
        message: err.message,
        path: req.path,
        method: req.method,
        ...err.diagnostico,
      });
    }

    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        // `diagnostico` e separado de `details` de proposito: `details` e a
        // lista campo-a-campo que os formularios usam para destacar o input
        // errado, e misturar as duas coisas quebraria essa leitura.
        ...(err.diagnostico ? { diagnostico: err.diagnostico } : {}),
      },
    });
  }

  logger.error("Erro nao tratado", {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  return res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "Erro interno do servidor",
    },
  });
}

module.exports = errorMiddleware;
