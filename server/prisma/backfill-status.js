// Backfill unico: migra o modelo antigo de 4 status para os 3 novos.
//   aguardando      -> pendente
//   em_atendimento  -> aberta
//   finalizado      -> fechada
//   resolvido       -> fechada
// Idempotente: rodar de novo nao altera registros ja migrados.
// Uso: node prisma/backfill-status.js
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const MAPA = {
  aguardando: "pendente",
  em_atendimento: "aberta",
  finalizado: "fechada",
  resolvido: "fechada",
};

async function main() {
  let total = 0;
  for (const [antigo, novo] of Object.entries(MAPA)) {
    const { count } = await prisma.conversa.updateMany({
      where: { statusAtendimento: antigo },
      data: { statusAtendimento: novo },
    });
    if (count > 0) console.log(`  ${antigo} -> ${novo}: ${count}`);
    total += count;
  }
  console.log(`Backfill concluido. ${total} conversa(s) migrada(s).`);
}

main()
  .catch((e) => {
    console.error("Falha no backfill:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
