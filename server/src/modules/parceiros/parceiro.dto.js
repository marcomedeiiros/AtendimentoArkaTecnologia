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

/**
 * LOGO: data URL de imagem, `null` para remover, ou ausente para não mexer.
 *
 * A distinção entre AUSENTE e `null` é a regra: a tela de edição salva todos os
 * campos de uma vez, e sem ela um `PUT` que não fala de logo apagaria a que já
 * estava lá. Por isso `.optional()` (pode faltar) e `.nullable()` (pode ser
 * null de propósito) são coisas diferentes aqui, e não redundância.
 *
 * A peneira é grossa de propósito -- só confere que é uma data URL de imagem e
 * o tamanho. QUEM DECIDE se é imagem mesmo é o serviço, lendo a ASSINATURA DOS
 * BYTES gravados (ver imagem.helper); o rótulo `image/...` na data URL é
 * escrito pelo cliente e não prova nada.
 *
 * O teto de 1,4 milhão de CARACTERES corresponde a ~1 MB de bytes depois do
 * base64 (que cresce 4/3). Ele barra o corpo gigante ANTES de decodificar.
 */
const logoSchema = z
  .string()
  .regex(/^data:image\//, "A logo precisa ser uma imagem.")
  .max(1_400_000, "A logo está grande demais.")
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
  logo: logoSchema,
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
  logo: logoSchema,
  status: z.enum(["ativo", "inativo"]).optional(),
});

module.exports = { criarParceiroSchema, atualizarParceiroSchema, TIPOS_CONTRATO };
