const { z } = require("zod");

const passoSchema = z.object({
  id: z.string().optional(),
  tipo: z.enum(["gatilho", "mensagem", "condicao", "delay", "acao", "comentario", "avaliacao"]),
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

// "*" e o gatilho curinga do motor: o fluxo de boas-vindas abre em qualquer
// mensagem em vez de depender de palavra-chave. Como tem 1 caractere, precisa de
// excecao explicita ao min(2) - senao o unico jeito de um bot de menu funcionar
// seria o cliente adivinhar a palavra que abre o fluxo.
const gatilhoSchema = z.union([z.literal("*"), z.string().min(2)]);

const fluxoSchema = z.object({
  nome: z.string().min(2),
  gatilho: gatilhoSchema,
  ativo: z.boolean().optional(),
  passos: z.array(passoSchema).optional(),
});

const atualizarFluxoSchema = fluxoSchema.partial();

module.exports = { fluxoSchema, atualizarFluxoSchema };
