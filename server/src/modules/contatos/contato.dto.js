const { z } = require("zod");

const criarContatoSchema = z.object({
  nome: z.string().min(2),
  telefone: z.string().min(10),
  email: z.string().email().optional().or(z.literal("")),
  empresa: z.string().optional(),
  tag: z.enum(["cliente", "parceiro", "suporte", "vip", "inativo"]).optional(),
  favorito: z.boolean().optional(),
  observacoes: z.string().optional(),
});

const atualizarContatoSchema = criarContatoSchema.partial();

// Sincronizar a agenda do WhatsApp: instancia opcional (cai para a query/padrao).
const sincronizarContatosSchema = z.object({
  instance: z.string().min(1).max(120).optional(),
});

module.exports = { criarContatoSchema, atualizarContatoSchema, sincronizarContatosSchema };
