// Backfill unico: o relato da visita muda de campo.
//
// O formulario passou a ter dois campos -- `resumo` (o assunto, uma linha) e
// `descricao` (o relato) -- e quem conta na completude e a DESCRICAO. Nos
// relatorios de antes o relato foi escrito no unico campo que existia, o
// `resumo`: sem mover esse texto, todos eles perderiam essa parcela de uma vez,
// e a completude e recalculada a cada consulta -- a nota de meses ja fechados
// cairia por causa de um campo que nao existia quando foram escritos.
//
// MOVE, nao copia: o texto e um so, e duplica-lo faria o PDF antigo sair com o
// mesmo paragrafo em duas secoes. Quem quiser separar assunto e relato depois
// edita o relatorio -- que e o que a tela nova pede de qualquer jeito.
//
// So mexe em quem TEM resumo e NAO TEM descricao. Idempotente: rodar de novo
// nao acha mais ninguem.
//
// Uso: node prisma/backfill-descricao-mapeamento.js
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const alvos = await prisma.mapeamentoTecnico.findMany({
    where: {
      OR: [{ descricao: null }, { descricao: "" }],
      NOT: { resumo: "" },
    },
    select: { id: true, empresa: true, resumo: true },
  });

  if (!alvos.length) {
    console.log("Nada a migrar: nenhum relatorio com resumo e sem descricao.");
    return;
  }

  for (const m of alvos) {
    await prisma.mapeamentoTecnico.update({
      where: { id: m.id },
      data: { descricao: m.resumo, resumo: "" },
    });
    console.log(`  ${m.empresa}: ${m.resumo.slice(0, 50)}${m.resumo.length > 50 ? "..." : ""}`);
  }
  console.log(`Backfill concluido. ${alvos.length} relatorio(s) migrado(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
