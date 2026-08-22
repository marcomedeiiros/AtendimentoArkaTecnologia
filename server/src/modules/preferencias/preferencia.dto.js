const { z } = require("zod");

// Preferencia de UI do operador: `valor` e JSON livre (qualquer coisa
// serializavel; guardado por usuario+chave). So garantimos que o corpo e um
// objeto com a chave `valor` -- barra corpo nao-objeto. Corpo ausente vira {}.
const salvarPreferenciaSchema = z.preprocess(
  (v) => (v == null ? {} : v),
  z.object({ valor: z.unknown().optional() }).passthrough()
);

module.exports = { salvarPreferenciaSchema };
