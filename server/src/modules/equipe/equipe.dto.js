const { z } = require("zod");

const criarEquipeSchema = z.object({
  nome: z.string().min(2),
  cargo: z.string().optional().default("Atendimento"),
  status: z.enum(["online", "offline"]).optional(),
});

const atualizarEquipeSchema = criarEquipeSchema.partial();

module.exports = { criarEquipeSchema, atualizarEquipeSchema };
