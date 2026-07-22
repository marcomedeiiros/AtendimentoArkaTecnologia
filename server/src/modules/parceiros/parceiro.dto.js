const { z } = require("zod");

const criarParceiroSchema = z.object({
  cnpj: z.string().min(14),
  razaoSocial: z.string().min(2),
  status: z.enum(["ativo", "inativo"]).optional(),
});

module.exports = { criarParceiroSchema };
