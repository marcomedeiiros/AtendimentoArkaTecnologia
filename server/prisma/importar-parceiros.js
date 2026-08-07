// Importacao pontual da carteira de clientes (CNPJ) para a aba Parceiros.
//
// Roda SOB DEMANDA (npm run db:import-parceiros), nunca junto do seed: o seed e
// estrutural e nao deve ressuscitar dados que voce apagou na tela. Este script e
// idempotente -- usa upsert por CNPJ, entao rodar duas vezes nao duplica, apenas
// atualiza os campos a partir do JSON.
//
// A fonte e prisma/data/parceiros-arka.json, gerado a partir da lista enviada,
// ja filtrada para conter SOMENTE CNPJ valido (CPFs e registros sem documento
// foram deixados de fora, conforme combinado).
const { PrismaClient } = require("@prisma/client");
const dados = require("./data/parceiros-arka.json");

const prisma = new PrismaClient();

async function main() {
  let criados = 0;
  let atualizados = 0;
  const falhas = [];

  for (const p of dados) {
    try {
      const existente = await prisma.parceiro.findUnique({ where: { cnpj: p.cnpj } });
      await prisma.parceiro.upsert({
        where: { cnpj: p.cnpj },
        update: {
          razaoSocial: p.razaoSocial,
          email: p.email,
          telefones: p.telefones,
          cidades: p.cidades,
          // Nao mexe no status de quem ja existe: preserva quem voce inativou.
          ...(existente ? {} : { status: p.status || "ativo" }),
        },
        create: {
          cnpj: p.cnpj,
          razaoSocial: p.razaoSocial,
          email: p.email,
          telefones: p.telefones,
          cidades: p.cidades,
          status: p.status || "ativo",
        },
      });
      if (existente) atualizados++;
      else criados++;
    } catch (e) {
      falhas.push({ cnpj: p.cnpj, razaoSocial: p.razaoSocial, erro: e.message });
    }
  }

  console.log(`Parceiros importados: ${criados} criados, ${atualizados} atualizados.`);
  if (falhas.length) {
    console.log(`Falhas: ${falhas.length}`);
    console.log(JSON.stringify(falhas, null, 2));
  }
  const total = await prisma.parceiro.count();
  console.log(`Total de parceiros no banco agora: ${total}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
