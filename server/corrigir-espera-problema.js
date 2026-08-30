const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function corrigirEsperaProblema() {
  try {
    console.log('=== CORRIGINDO ESPERA NO PASSO DE PROBLEMA ===\n');

    const passoIdentificaProblema = await prisma.passoFluxo.findUnique({
      where: { id: '9bbec3f6-9a9a-4f09-a0b9-b0d8fd973dd9' }
    });

    console.log('Passo: IDENTIFICA PROBLEMA');
    console.log('Config atual:', JSON.stringify(passoIdentificaProblema.config, null, 2));
    
    const config = passoIdentificaProblema.config;
    if (config?.opcoes && config.opcoes.length > 0) {
      // Mudar para esperar a resposta antes de transferir
      config.opcoes[0].esperaEscolha = true;
      
      await prisma.passoFluxo.update({
        where: { id: passoIdentificaProblema.id },
        data: { config }
      });
      
      console.log('\n✅ Atualizado: esperaEscolha = true');
      console.log('\nAgora o bot vai:');
      console.log('1. Perguntar nome e setor → AGUARDAR resposta');
      console.log('2. Perguntar sobre a solicitação → AGUARDAR resposta');
      console.log('3. Transferir para o técnico');
    }

  } catch (error) {
    console.error('❌ Erro:', error);
  } finally {
    await prisma.$disconnect();
  }
}

corrigirEsperaProblema();
