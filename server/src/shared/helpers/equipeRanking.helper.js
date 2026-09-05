/**
 * A QUAL RANKING CADA PESSOA PERTENCE -- uma leitura so, para os dois lados.
 *
 * `Usuario.equipeRanking` guarda uma LISTA em texto ("sede", "externo" ou
 * "sede,externo"): ha quem atenda no chat e tambem visite cliente, e as duas
 * coisas sao medidas por reguas diferentes que nunca se somam.
 *
 * Isto vive num helper, e nao dentro de um dos servicos, porque QUEM PERGUNTA
 * SAO DOIS: o modulo de rankings (as duas abas da Visao Geral) e o painel de
 * parede. Enquanto a regra morava so no ranking, o painel de parede nao tinha
 * como aplica-la -- e foi assim que a TV passou a coroar como lider do mes
 * gente que nem concorre.
 */
const EQUIPES = ["sede", "externo"];

/**
 * "sede,externo" -> ["sede", "externo"].
 *
 * Filtra pelo que EXISTE: um valor antigo, ou digitado errado direto no banco,
 * nao pode inventar uma terceira equipe.
 */
function equipesDe(valor) {
  return String(valor || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => EQUIPES.includes(s));
}

/**
 * Os NOMES de quem concorre numa equipe.
 *
 * Nome, e nao id, porque e por nome que o atendimento guarda o atendente
 * (`atendenteNome`) -- e e por nome que o ranking da sede ja cruzava as duas
 * coisas. Trocar isso por id aqui criaria dois criterios de igualdade para a
 * mesma pergunta.
 *
 * O recorte e feito em MEMORIA de proposito: com a lista em texto, um `where`
 * por valor exato deixaria de fora justamente quem esta nas duas equipes. A
 * tabela de usuarios tem dezenas de linhas.
 *
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {"sede"|"externo"} equipe
 * @returns {Promise<Set<string>>} vazio quando ninguem foi marcado ainda
 */
async function nomesDaEquipe(prisma, equipe) {
  const usuarios = await prisma.usuario.findMany({
    where: { NOT: [{ equipeRanking: null }, { equipeRanking: "" }] },
    select: { nome: true, equipeRanking: true },
  });
  return new Set(
    usuarios.filter((u) => equipesDe(u.equipeRanking).includes(equipe)).map((u) => u.nome)
  );
}

module.exports = { EQUIPES, equipesDe, nomesDaEquipe };
