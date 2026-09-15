const { z } = require("zod");

const TIPOS = ["reuniao", "ligacao", "tarefa", "followup", "lembrete"];
const PRIORIDADES = ["alta", "media", "baixa"];
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/; // YYYY-MM-DD
const RE_HORA = /^\d{2}:\d{2}$/; // HH:MM

const base = {
  titulo: z.string().trim().min(1, "Informe um titulo").max(200),
  data: z.string().regex(RE_DATA, "Data invalida (use AAAA-MM-DD)"),
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
};

const criarCompromissoSchema = z.object(base);
const atualizarCompromissoSchema = z.object(base);

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
const remarcarSchema = z.object({
  data: z.string().regex(RE_DATA, "Data invalida (use AAAA-MM-DD)"),
  hora: z.string().regex(RE_HORA, "Hora invalida (use HH:MM)").optional(),
});

module.exports = {
  criarCompromissoSchema,
  atualizarCompromissoSchema,
  definirConcluidoSchema,
  remarcarSchema,
  TIPOS,
  PRIORIDADES,
};
