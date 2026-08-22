const { z } = require("zod");

// Validacao de BORDA do Envio em Massa. O service reconfere e ainda impoe o
// piso do intervalo e o teto de destinatarios (a autoridade e la) -- aqui
// barramos cedo o que e claramente invalido.
const destinatarioSchema = z.object({
  nome: z.string().max(120).optional().nullable(),
  telefone: z.string().min(8, "Telefone invalido").max(20),
});

const criarCampanhaSchema = z.object({
  nome: z.string().max(120).optional(),
  mensagem: z.string().min(1, "Escreva a mensagem").max(4096),
  destinatarios: z.array(destinatarioSchema).min(1, "Informe ao menos um destinatario").max(1000),
  // Segundos entre envios. O piso real (anti-bloqueio) e aplicado no service.
  intervaloDe: z.coerce.number().int().min(1).max(600).optional(),
  intervaloAte: z.coerce.number().int().min(1).max(600).optional(),
});

module.exports = { criarCampanhaSchema };
