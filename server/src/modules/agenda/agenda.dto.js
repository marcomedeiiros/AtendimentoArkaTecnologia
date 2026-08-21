const { z } = require("zod");

const TIPOS = ["reuniao", "ligacao", "tarefa", "followup", "lembrete"];
const PRIORIDADES = ["alta", "media", "baixa"];
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/; // YYYY-MM-DD
const RE_HORA = /^\d{2}:\d{2}$/; // HH:MM

const base = {
  titulo: z.string().trim().min(1, "Informe um titulo").max(200),
  data: z.string().regex(RE_DATA, "Data invalida (use AAAA-MM-DD)"),
  hora: z.string().regex(RE_HORA, "Hora invalida (use HH:MM)").optional().default("09:00"),
  tipo: z.enum(TIPOS).optional().default("reuniao"),
  prioridade: z.enum(PRIORIDADES).optional().default("media"),
  descricao: z.string().max(2000).optional().default(""),
  contato: z.string().max(200).optional().default(""),
  concluido: z.boolean().optional().default(false),
};

const criarCompromissoSchema = z.object(base);
const atualizarCompromissoSchema = z.object(base);

const definirConcluidoSchema = z.object({
  concluido: z.boolean(),
});

module.exports = {
  criarCompromissoSchema,
  atualizarCompromissoSchema,
  definirConcluidoSchema,
  TIPOS,
  PRIORIDADES,
};
