const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function corrigirEspera() {
  try {
    console.log('=== CORRIGINDO ESPERA DE RESPOSTA ===\n');

    // Passo 1: IDENTIFICA CONTRATO (deve esperar resposta)
    const passoIdentificaContrato = await prisma.passoFluxo.findUnique({
      where: { id: 'f083aed3-0296-499e-af69-9dfcde346d4a' }
    });

    if (passoIdentificaContrato) {
      console.log('Passo 1: IDENTIFICA CONTRATO');
      console.log('Config atual:', JSON.stringify(passoIdentificaContrato.config, null, 2));
      
      const config = passoIdentificaContrato.config;
      if (config?.opcoes && config.opcoes.length > 0) {
        config.opcoes[0].esperaEscolha = true;
        
        await prisma.passoFluxo.update({
          where: { id: passoIdentificaContrato.id },
          data: { config }
        });
        
        console.log('✅ Atualizado: esperaEscolha = true');
      }
    }

    // Passo 2: IDENTIFICA PROBLEMA (já pode ficar sem esperar, pois é o último)
    const passoIdentificaProblema = await prisma.passoFluxo.findUnique({
      where: { id: '9bbec3f6-9a9a-4f09-a0b9-b0d8fd973dd9' }
    });

    console.log('\nPasso 2: IDENTIFICA PROBLEMA');
    console.log('Config atual:', JSON.stringify(passoIdentificaProblema.config, null, 2));
    console.log('Este passo não precisa esperar resposta (é o último antes de criar o chamado)');

    console.log('\n✅ Correção concluída!');
    console.log('\nAgora o fluxo vai:');
    console.log('1. Perguntar nome e setor');
    console.log('2. AGUARDAR a resposta do cliente');
    console.log('3. Só depois perguntar sobre a solicitação');

  } catch (error) {
    console.error('❌ Erro:', error);
  } finally {
    await prisma.$disconnect();
  }
}

corrigirEspera();
