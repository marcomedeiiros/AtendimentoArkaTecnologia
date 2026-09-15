const { z } = require("zod");

const TIPOS = ["reuniao", "ligacao", "tarefa", "followup", "lembrete"];
const PRIORIDADES = ["alta", "media", "baixa"];

/**
 * AS CORES SAO UM CONJUNTO FECHADO, e nao um hex livre.
 *
 * Aceitar "#ff0000" do painel entregaria tres problemas de graca: cor ilegivel
 * (texto escuro sobre fundo escuro), cor que so funciona num dos dois temas, e
 * um campo de texto livre num lugar onde ninguem espera texto livre. Com a
 * lista fechada, a tela escolhe entre cores que ja foram medidas contra os dois
 * fundos -- e o servidor recusa qualquer outra.
 *
 * Guardar o NOME, e nao o hex, e o que deixa a paleta ser retocada depois sem
 * deixar cores velhas presas no banco (ver o comentario no schema).
 */
const CORES = ["azul", "verde", "ambar", "roxo", "vermelho", "rosa", "ciano", "cinza"];
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/; // YYYY-MM-DD
const RE_HORA = /^\d{2}:\d{2}$/; // HH:MM

const base = {
  titulo: z.string().trim().min(1, "Informe um titulo").max(200),
  data: z.string().regex(RE_DATA, "Data invalida (use AAAA-MM-DD)"),
  // Fim INCLUSIVO do compromisso que atravessa dias. Nulo = de um dia só.
  // A regra "fim >= inicio" fica no `.superRefine` abaixo, porque depende dos
  // dois campos juntos -- um validador por campo não enxerga o outro.
  dataFim: z.string().regex(RE_DATA, "Data final invalida (use AAAA-MM-DD)").nullable().optional(),
  hora: z.string().regex(RE_HORA, "Hora invalida (use HH:MM)").optional().default("09:00"),
  tipo: z.enum(TIPOS).optional().default("reuniao"),
  prioridade: z.enum(PRIORIDADES).optional().default("media"),
  descricao: z.string().max(2000).optional().default(""),
  contato: z.string().max(200).optional().default(""),
  concluido: z.boolean().optional().default(false),
  // QUEM TEM DE FAZER. So o id entra pela borda -- o NOME e resolvido no
  // servico, a partir do cadastro da equipe. Aceitar o nome do corpo deixaria o
  // painel escrever qualquer coisa ali ("Diretoria", o nome de outra pessoa), e
  // a tela passaria a exibir um responsavel que o banco de usuarios desmente.
  //
  // `null` e valor legitimo: compromisso sem dono (lembrete do time inteiro).
  responsavelId: z.string().uuid("Responsavel invalido").nullable().optional(),
  // `null` = cor automática (a que o critério do calendário mandar), que é o
  // padrão. Ver CORES acima para por que a lista é fechada.
  cor: z.enum(CORES).nullable().optional(),
};

/**
 * Fim nunca antes do inicio.
 *
 * Datas em YYYY-MM-DD se comparam como texto, entao a checagem e uma linha --
 * e ela precisa existir: um compromisso que "termina" antes de comecar nao
 * desenha barra nenhuma no calendario, e o defeito apareceria como um item que
 * some da tela sem dizer por que.
 */
const exigirFimDepoisDoInicio = (dados, ctx) => {
  if (dados.dataFim && dados.dataFim < dados.data) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["dataFim"],
      message: "A data final nao pode ser antes da inicial",
    });
  }
};

const criarCompromissoSchema = z.object(base).superRefine(exigirFimDepoisDoInicio);
const atualizarCompromissoSchema = z.object(base).superRefine(exigirFimDepoisDoInicio);

const definirConcluidoSchema = z.object({
  concluido: z.boolean(),
});

/**
 * REMARCAR -- so a data (e opcionalmente a hora).
 *
 * Existe separado do `PUT /:id` por causa do arrastar no calendario. O PUT
 * exige o objeto inteiro, e o objeto que a tela teria em maos na hora do
 * arraste e o da LISTA, que pode estar velho: soltar o item num outro dia
 * gravaria de volta um titulo ou uma descricao que outra pessoa acabou de
 * mudar. Uma rota estreita nao tem como sobrescrever o que ela nao recebe.
 */
/** Esticar: so o fim. O inicio fica onde esta -- ver `esticar` no service. */
const esticarSchema = z.object({
  dataFim: z.string().regex(RE_DATA, "Data final invalida (use AAAA-MM-DD)").nullable(),
});

const remarcarSchema = z.object({
  data: z.string().regex(RE_DATA, "Data invalida (use AAAA-MM-DD)"),
  hora: z.string().regex(RE_HORA, "Hora invalida (use HH:MM)").optional(),
});

module.exports = {
  criarCompromissoSchema,
  atualizarCompromissoSchema,
  definirConcluidoSchema,
  remarcarSchema,
  esticarSchema,
  TIPOS,
  PRIORIDADES,
  CORES,
};
