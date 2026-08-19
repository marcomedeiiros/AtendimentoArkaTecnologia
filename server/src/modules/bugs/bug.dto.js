const { z } = require("zod");

const criarBugSchema = z.object({
  descricao: z.string().min(5, "Descreva o problema com pelo menos 5 caracteres").max(4000),
  pagina: z.string().max(300).optional().nullable(),
});

const atualizarStatusSchema = z.object({
  status: z.enum(["aberto", "resolvido"]),
});

module.exports = { criarBugSchema, atualizarStatusSchema };
