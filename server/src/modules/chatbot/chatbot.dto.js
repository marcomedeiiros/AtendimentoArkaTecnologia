const { z } = require("zod");

const processarSchema = z.object({
  telefone: z.string().min(10),
  texto: z.string().min(1),
  nomeCliente: z.string().optional(),
  instanceName: z.string().optional(),
  waMessageId: z.string().optional(),
});

// Simulacao de conversa: a lista completa de mensagens do cliente, em ordem. O
// endpoint e stateless e reproduz a conversa do zero a cada chamada.
const simularSchema = z.object({
  fluxoId: z.string().min(1),
  mensagens: z.array(z.string()).max(40).default([]),
  nomeCliente: z.string().max(80).optional(),
  respeitarHorario: z.boolean().optional(),
});

// Disparar um fluxo manualmente numa conversa existente.
const executarFluxoSchema = z.object({
  conversaId: z.string().min(1, "Informe a conversa"),
});

module.exports = { processarSchema, simularSchema, executarFluxoSchema };
