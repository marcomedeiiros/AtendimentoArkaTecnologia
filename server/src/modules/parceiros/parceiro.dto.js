const { z } = require("zod");

// Tipos de contrato oferecidos. Chave canonica no banco; o rotulo fica no front.
const TIPOS_CONTRATO = ["ti", "backups", "locacao", "hospedagem"];

// Aceita a lista de contratos como array de chaves conhecidas (o front manda
// array). Chave desconhecida e recusada -- o service ainda deduplica/normaliza.
const contratosSchema = z
  .array(z.enum(TIPOS_CONTRATO))
  .max(TIPOS_CONTRATO.length)
  .optional()
  .nullable();

const criarParceiroSchema = z.object({
  // 11 = CPF sem pontuacao, que e o documento mais curto que o cadastro
  // aceita. Este `min` e so uma peneira grossa contra campo vazio; QUEM VALIDA
  // e o servico, com a conta dos digitos verificadores (`documentoValido`).
  // Estava em 14 e por isso um CPF em digitos crus era recusado aqui, ANTES de
  // chegar na validacao de verdade -- com uma mensagem de schema, e nao a
  // mensagem que explica o que esta errado.
  cnpj: z.string().min(11),
  razaoSocial: z.string().min(2),
  email: z.string().optional().nullable(),
  telefones: z.string().optional().nullable(),
  cidades: z.string().optional().nullable(),
  contratos: contratosSchema,
  status: z.enum(["ativo", "inativo"]).optional(),
});

// O CNPJ nao entra aqui: ele e a chave (vem na URL) e nao se edita -- trocar o
// documento e apagar e criar outro parceiro, nao editar este.
const atualizarParceiroSchema = z.object({
  razaoSocial: z.string().min(2),
  email: z.string().optional().nullable(),
  telefones: z.string().optional().nullable(),
  cidades: z.string().optional().nullable(),
  contratos: contratosSchema,
  status: z.enum(["ativo", "inativo"]).optional(),
});

module.exports = { criarParceiroSchema, atualizarParceiroSchema, TIPOS_CONTRATO };
