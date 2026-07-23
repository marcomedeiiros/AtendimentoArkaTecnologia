const { z } = require("zod");

const passoSchema = z.object({
  id: z.string().optional(),
  tipo: z.enum(["gatilho", "mensagem", "condicao", "delay", "acao", "comentario"]),
  titulo: z.string().min(1),
  desc: z.string().optional(),
  descricao: z.string().optional(),
  texto: z.string().optional(),
  config: z.record(z.any()).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  w: z.number().optional(),
  h: z.number().optional(),
  targetId: z.string().nullable().optional(),
  ordem: z.number().optional(),
});

const fluxoSchema = z.object({
  nome: z.string().min(2),
  gatilho: z.string().min(2),
  ativo: z.boolean().optional(),
  passos: z.array(passoSchema).optional(),
});

const atualizarFluxoSchema = fluxoSchema.partial();

module.exports = { fluxoSchema, atualizarFluxoSchema };
