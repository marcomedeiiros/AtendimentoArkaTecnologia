const { z } = require("zod");

const processarSchema = z.object({
  telefone: z.string().min(10),
  texto: z.string().min(1),
  nomeCliente: z.string().optional(),
  instanceName: z.string().optional(),
});

module.exports = { processarSchema };
