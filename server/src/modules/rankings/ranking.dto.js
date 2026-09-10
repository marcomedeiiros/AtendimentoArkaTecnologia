/**
 * Validacao na BORDA das rotas de ranking e mapeamento.
 *
 * Defesa em profundidade, como o resto do sistema: o Zod barra formato aqui, e
 * o service reconfere a REGRA (quem pode, o que ja foi aprovado, quem e o dono).
 * Nenhum dos dois confia no outro -- o service e chamado de mais de um caminho e
 * a rota pode ganhar um verbo novo amanha.
 */
const { z } = require("zod");
// O teto do pódio vem de quem manda nele, e não repetido aqui: o defeito do
// achado 2 era exatamente este número escrito em quatro lugares.
const { MAXIMO: MAXIMO_PREMIADOS } = require("./premiados");

// "2026-09". Regex e nao data solta: o mes e a chave do ranking inteiro, e um
// formato livre viraria consulta silenciosamente vazia.
const competencia = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use AAAA-MM");

/**
 * O CHECKLIST DEIXOU DE SER FIXO -- e por isso a allowlist saiu daqui.
 *
 * Este schema era um objeto com as oito chaves de fábrica, montado no
 * CARREGAMENTO do módulo. Com o checklist configurável, um item criado pela
 * empresa seria recusado na borda e o campo nunca chegaria a ser salvo -- e o
 * erro apareceria como "campo desconhecido", longe da causa.
 *
 * A allowlist não sumiu, MUDOU DE LUGAR: aqui fica a forma (chave curta, texto
 * com teto, nada de objeto aninhado) e no serviço fica o conjunto de chaves
 * válidas, que só o banco sabe. É a defesa em profundidade de sempre, com a
 * parte que depende de configuração no lado que enxerga a configuração --
 * `saneiaItens` continua descartando chave inventada.
 */
const itensSchema = z
  .record(
    z.string().regex(/^[a-z0-9]{1,40}$/, "Chave de item invalida"),
    z.string().max(2000)
  )
  // Teto de chaves: o checklist tem no maximo 20 itens (relatorio.regras), e
  // sem limite aqui daria para mandar um objeto gigante que so seria
  // descartado depois de percorrido.
  .refine((o) => Object.keys(o).length <= 40, "Itens demais no checklist")
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
  // Opcional: sem ele, o servidor aplica a regra da empresa (prazo por
  // relatorio, e o vencimento mensal quando houver). Era obrigatorio quando o
  // unico caminho era a tela digitar o valor.
  prazoEm: z.string().min(8).optional().nullable(),
  resumo: z.string().max(4000).optional(),
  itens: itensSchema,
  pendencias: z.string().max(4000).optional().nullable(),
  evidencias: z.array(evidenciaSchema).max(12).optional(),
  arquivo: arquivoSchema.optional(),
  entregar: z.boolean().optional(),
});

// So a leitura: um PDF, e nada mais. Sem os campos do mapeamento, porque nao
// ha mapeamento ainda -- e aceitar mais aqui abriria um segundo caminho de
// criacao, com validacao propria, para o mesmo recurso.
const analisarMapeamentoSchema = z.object({
  arquivo: z.object({ conteudo: z.string().min(16), nome: z.string().max(180).optional() }),
});

const atualizarMapeamentoSchema = criarMapeamentoSchema.partial().refine(
  (d) => Object.keys(d).length > 0,
  { message: "Nada para atualizar" }
);

/**
 * A CONFIGURACAO DOS RELATORIOS.
 *
 * Aqui so a FORMA (tipo e faixa grosseira). A regra de verdade -- pesos que
 * somam 100, item de checklist sem palavra nenhuma, dia 30 que nao existe em
 * fevereiro -- fica em `relatorio.regras.validar`, que e chamado tanto ao gravar
 * quanto ao LER. Defesa em profundidade: um valor editado direto no banco
 * tambem passa por la antes de virar pontuacao.
 *
 * Tudo opcional: a tela pode salvar so o campo que mexeu, e o que nao veio
 * mantem o valor atual.
 */
const regrasRelatorioSchema = z.object({
  prazoDias: z.number().int().min(1).max(90).optional(),
  // De 1 a 31: o dia que nao existe no mes cai no ultimo dia dele (a aparagem e
  // em `relatorio.regras`, com o helper de calendario). Aqui so a faixa.
  vencimentoDiaDoMes: z.number().int().min(1).max(31).nullable().optional(),
  exigirPdf: z.boolean().optional(),
  minimoRelatorios: z.number().int().min(1).max(20).optional(),
  custoPorDevolucao: z.number().int().min(0).max(25).optional(),
  pesos: z.record(z.string(), z.number().int().min(0).max(100)).optional(),
  // Lista ou texto separado por virgula -- a tela usa um campo de texto por
  // item, e obrigar o front a partir a string so moveria a mesma regra de lugar.
  palavras: z.record(z.string(), z.union([z.array(z.string()), z.string()])).optional(),
});

/**
 * DEVOLVER para correcao -- a unica validacao que sobrou.
 *
 * Nao ha mais `aprovado`: entregar virou o fim do caminho, e o supervisor so
 * aponta problema quando ha (ver mapeamento.service.devolver).
 *
 * A observacao e OBRIGATORIA, e agora sem excecao. Devolver sem dizer o motivo
 * deixa o tecnico sem saber o que corrigir -- e a devolucao ainda desconta
 * ponto dele. Antes o `refine` a dispensava no caminho da aprovacao; sem
 * aprovacao, ela e sempre exigida.
 */
const devolverMapeamentoSchema = z.object({
  observacao: z.string().trim().min(5, "Diga o que precisa ser corrigido").max(2000),
});

const premiacaoSchema = z.object({
  ranking: z.enum(["sede", "externo"]),
  competencia,
  posicao: z.number().int().min(1).max(MAXIMO_PREMIADOS),
  premio: z.string().trim().max(160).optional().nullable(),
  valor: z.string().trim().max(60).optional().nullable(),
  entregueEm: z.string().optional().nullable(),
  observacao: z.string().trim().max(1000).optional().nullable(),
});

module.exports = {
  criarMapeamentoSchema,
  atualizarMapeamentoSchema,
  analisarMapeamentoSchema,
  regrasRelatorioSchema,
  devolverMapeamentoSchema,
  premiacaoSchema,
};
