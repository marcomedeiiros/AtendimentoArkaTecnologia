const { z } = require("zod");

/**
 * ── POR QUE TUDO AQUI E `.nullish()`, E NAO `.optional()` ──────────────────
 *
 * Este schema valida o que o EDITOR devolve. E o que o editor devolve e, na
 * maior parte, o que ele acabou de receber do proprio servidor.
 *
 * O `mapPasso` (mapper.helper.js) le as colunas do banco e as entrega como
 * estao -- coluna vazia no SQLite chega ao Prisma como `null`, e sai daqui como
 * `null`:
 *
 *     desc: p.descricao,   // null quando nunca foi preenchido
 *     texto: p.texto,      // null numa anotacao, num gatilho, num delay
 *     config: p.config,    // null em todo bloco sem configuracao
 *
 * `z.string().optional()` significa `string | undefined`. `null` NAO passa.
 * Entao o ciclo normal do editor -- abrir um fluxo, mudar uma palavra, salvar --
 * devolvia ao servidor os mesmos nulos que ele tinha emitido, e o servidor
 * respondia 400 antes de qualquer coisa tocar o banco. Bastava UM bloco sem
 * texto para o fluxo INTEIRO parar de salvar, porque `passos` e validado como
 * um array so.
 *
 * Na tela nada disso aparecia: o editor atualizava o estado local de forma
 * otimista e engolia o erro. A alteracao ficava na tela ate o F5, e ai voltava
 * a versao antiga -- que nunca tinha deixado de ser a unica versao gravada.
 *
 * A correcao e do CONTRATO, e nao do cliente: quem emite `null` tem de aceitar
 * `null` de volta. Limpar os nulos no front resolveria esta tela e deixaria a
 * rota podre para o proximo cliente (import, script, integracao).
 *
 * `.nullish()` = `T | null | undefined`. O repositorio ja normaliza os dois com
 * `|| null` / `?? null` antes de gravar, entao nada muda no banco.
 */
const passoSchema = z.object({
  id: z.string().nullish(),
  // "espera": torna VISIVEL no canvas uma regra que vivia escondida no config
  // de uma anotacao (o bot fecha a conversa depois de N minutos calado). Ver
  // fluxo.automacao.blocoEspera.
  tipo: z.enum(["gatilho", "mensagem", "condicao", "delay", "acao", "comentario", "avaliacao", "espera"]),
  // Continua obrigatorio e nao-nulo: a coluna e NOT NULL no banco, entao nao ha
  // passo gravado sem titulo, e um passo sem titulo fica invisivel na Sequencia.
  titulo: z.string().min(1),
  desc: z.string().nullish(),
  descricao: z.string().nullish(),
  texto: z.string().nullish(),
  config: z.record(z.any()).nullish(),
  x: z.number().nullish(),
  y: z.number().nullish(),
  w: z.number().nullish(),
  h: z.number().nullish(),
  targetId: z.string().nullish(),
  ordem: z.number().nullish(),
});

// "*" e o gatilho curinga do motor: o fluxo de boas-vindas abre em qualquer
// mensagem em vez de depender de palavra-chave. Como tem 1 caractere, precisa de
// excecao explicita ao min(2) - senao o unico jeito de um bot de menu funcionar
// seria o cliente adivinhar a palavra que abre o fluxo.
const gatilhoSchema = z.union([z.literal("*"), z.string().min(2)]);

const fluxoSchema = z.object({
  nome: z.string().min(2),
  gatilho: gatilhoSchema,
  ativo: z.boolean().optional(),
  passos: z.array(passoSchema).optional(),
});

const atualizarFluxoSchema = fluxoSchema.partial();

// ── CRUD de BLOCO ─────────────────────────────────────────────────────────
//
// Salvar um bloco nao pode continuar sendo "reenviar o fluxo inteiro": duas
// telas abertas no mesmo fluxo se sobrescrevem, e o custo de uma virgula e
// reescrever todos os passos. Estes schemas atendem as rotas por passo.
//
// Na criacao o `id` e ignorado (quem da id e o banco) e `tipo`/`titulo` sao
// obrigatorios -- e o mesmo passoSchema, portanto.
const criarPassoSchema = passoSchema;

// Na edicao tudo e parcial: o painel manda so o que mudou. `tipo` fica de fora
// de proposito -- trocar o tipo de um bloco ja criado muda o que o motor faz com
// ele sem mudar o resto da configuracao, e o caminho para isso e apagar e criar.
const atualizarPassoSchema = passoSchema.partial().omit({ tipo: true });

// Reordenacao: so a lista de ids, na ordem desejada. Nao carrega dado de bloco
// nenhum, entao nao ha como uma reordenacao sobrescrever uma edicao.
const reordenarPassosSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});

module.exports = {
  fluxoSchema,
  atualizarFluxoSchema,
  criarPassoSchema,
  atualizarPassoSchema,
  reordenarPassosSchema,
};
