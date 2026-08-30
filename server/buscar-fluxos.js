const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function buscarFluxos() {
  try {
    const fluxos = await prisma.fluxo.findMany({
      include: {
        passos: {
          orderBy: { ordem: 'asc' },
          take: 5
        }
      }
    });

    console.log('=== FLUXOS DISPONÍVEIS ===\n');
    
    fluxos.forEach(fluxo => {
      console.log(`\nFluxo: ${fluxo.nome} (ID: ${fluxo.id})`);
      console.log(`Total de passos: ${fluxo.passos.length}`);
      
      if (fluxo.passos.length > 0) {
        console.log('Primeiros passos:');
        fluxo.passos.forEach((passo, i) => {
          const textoPreview = passo.texto ? passo.texto.substring(0, 60).replace(/\n/g, ' ') : '';
          console.log(`  ${i + 1}. [${passo.tipo}] ${passo.titulo} - ${textoPreview}...`);
        });
      }
    });

    // Buscar especificamente passos com "Identificação" no título
    console.log('\n\n=== PASSOS COM "IDENTIFICAÇÃO" ===\n');
    const passosIdentificacao = await prisma.passoFluxo.findMany({
      where: {
        OR: [
          { titulo: { contains: 'Identificação' } },
          { titulo: { contains: 'IDENTIFICA' } },
          { texto: { contains: 'Para encaminharmos' } }
        ]
      },
      include: {
        fluxo: true
      }
    });

    passosIdentificacao.forEach(passo => {
      console.log(`\nPasso: ${passo.titulo}`);
      console.log(`Fluxo: ${passo.fluxo.nome}`);
      console.log(`ID: ${passo.id}`);
      console.log(`Tipo: ${passo.tipo}`);
      console.log(`Target ID: ${passo.targetId}`);
      console.log(`Texto: ${passo.texto?.substring(0, 150)}`);
      if (passo.config?.opcoes) {
        console.log(`Espera escolha? ${passo.config.opcoes[0]?.esperaEscolha}`);
      }
    });

  } catch (error) {
    console.error('❌ Erro:', error);
  } finally {
    await prisma.$disconnect();
  }
}

buscarFluxos();
