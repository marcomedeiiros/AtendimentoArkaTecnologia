const { z } = require("zod");

const criarParceiroSchema = z.object({
  cnpj: z.string().min(14),
  razaoSocial: z.string().min(2),
  email: z.string().optional().nullable(),
  telefones: z.string().optional().nullable(),
  cidades: z.string().optional().nullable(),
  status: z.enum(["ativo", "inativo"]).optional(),
});

// O CNPJ nao entra aqui: ele e a chave (vem na URL) e nao se edita -- trocar o
// documento e apagar e criar outro parceiro, nao editar este.
const atualizarParceiroSchema = z.object({
  razaoSocial: z.string().min(2),
  email: z.string().optional().nullable(),
  telefones: z.string().optional().nullable(),
  cidades: z.string().optional().nullable(),
  status: z.enum(["ativo", "inativo"]).optional(),
});

module.exports = { criarParceiroSchema, atualizarParceiroSchema };
