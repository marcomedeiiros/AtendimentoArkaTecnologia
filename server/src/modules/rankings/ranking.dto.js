/**
 * Validacao na BORDA das rotas de ranking e mapeamento.
 *
 * Defesa em profundidade, como o resto do sistema: o Zod barra formato aqui, e
 * o service reconfere a REGRA (quem pode, o que ja foi aprovado, quem e o dono).
 * Nenhum dos dois confia no outro -- o service e chamado de mais de um caminho e
 * a rota pode ganhar um verbo novo amanha.
 */
const { z } = require("zod");
const { ITENS_MAPEAMENTO } = require("./pontuacao.externa");

// "2026-09". Regex e nao data solta: o mes e a chave do ranking inteiro, e um
// formato livre viraria consulta silenciosamente vazia.
const competencia = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use AAAA-MM");

// Allowlist dos itens do checklist: o que nao esta na lista da pontuacao nao
// entra. Sem isso daria para inflar a completude mandando chave inventada.
const itensSchema = z
  .object(Object.fromEntries(ITENS_MAPEAMENTO.map((i) => [i.chave, z.string().max(2000).optional()])))
  .partial()
  .optional();

// Evidencia: ou uma data URL nova, ou a referencia de uma ja gravada. O teto de
// tamanho de verdade e no storage; aqui so barramos formato.
const evidenciaSchema = z.union([
  z.string().min(16),
  z.object({ arquivo: z.string().min(1), mimetype: z.string().optional().nullable(), nome: z.string().optional().nullable() }),
]);

/**
 * O PDF do relatorio. Tres formas, e cada uma quer dizer uma coisa:
 *
 *   { conteudo, nome }   PDF novo, em data URL;
 *   { arquivo: "..." }   o que ja estava la, devolvido pela edicao (nao regrava);
 *   null                 remover o anexo.
 *
 * Campo AUSENTE e diferente de `null`: ausente significa "nao mexi nisso", e e
 * o que impede salvar o formulario de apagar um relatorio ja enviado.
 *
 * Aqui so se confere formato. Que os bytes sejam mesmo um PDF e conferido no
 * service, depois de gravar -- nome de arquivo nao e prova de nada.
 */
const arquivoSchema = z
  .union([
    z.object({ conteudo: z.string().min(16), nome: z.string().max(180).optional() }),
    z.object({ arquivo: z.string().min(1), nome: z.string().max(180).optional().nullable() }),
  ])
  .nullable();

const criarMapeamentoSchema = z.object({
  empresa: z.string().trim().min(2, "Informe a empresa visitada").max(160),
  cnpj: z.string().optional().nullable(),
  dataVisita: z.string().min(8, "Informe a data da visita"),
  prazoEm: z.string().min(8, "Informe o prazo de entrega"),
  resumo: z.string().max(4000).optional(),
  itens: itensSchema,
  pendencias: z.string().max(4000).optional().nullable(),
  evidencias: z.array(evidenciaSchema).max(12).optional(),
  arquivo: arquivoSchema.optional(),
  entregar: z.boolean().optional(),
});

const atualizarMapeamentoSchema = criarMapeamentoSchema.partial().refine(
  (d) => Object.keys(d).length > 0,
  { message: "Nada para atualizar" }
);

const validarMapeamentoSchema = z.object({
  aprovado: z.boolean(),
  // Devolver SEM dizer o motivo deixa o tecnico sem saber o que corrigir -- e a
  // devolucao desconta ponto dele. Por isso a observacao e obrigatoria aqui, e
  // opcional na aprovacao.
  observacao: z.string().trim().max(2000).optional(),
}).refine((d) => d.aprovado || (d.observacao && d.observacao.length >= 5), {
  message: "Diga o que precisa ser corrigido",
  path: ["observacao"],
});

const premiacaoSchema = z.object({
  ranking: z.enum(["sede", "externo"]),
  competencia,
  posicao: z.number().int().min(1).max(3),
  premio: z.string().trim().max(160).optional().nullable(),
  valor: z.string().trim().max(60).optional().nullable(),
  entregueEm: z.string().optional().nullable(),
  observacao: z.string().trim().max(1000).optional().nullable(),
});

module.exports = {
  criarMapeamentoSchema,
  atualizarMapeamentoSchema,
  validarMapeamentoSchema,
  premiacaoSchema,
};
