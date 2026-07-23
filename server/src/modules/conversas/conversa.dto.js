const { z } = require("zod");

const enviarMensagemSchema = z.object({
  texto: z.string().min(1),
});

const atualizarStatusSchema = z.object({
  status: z.enum(["aguardando", "em_atendimento", "finalizado", "resolvido"]),
});

const validarCnpjSchema = z.object({
  cnpj: z.string().min(14),
});

module.exports = { enviarMensagemSchema, atualizarStatusSchema, validarCnpjSchema };
