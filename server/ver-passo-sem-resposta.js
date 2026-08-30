const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function verPassoSemResposta() {
  try {
    const passo = await prisma.passoFluxo.findFirst({
      where: { 
        fluxoId: '8b620944-b1ce-4ac0-beed-5f3cb2bd8e8d',
        titulo: 'Sem resposta'
      }
    });

    console.log('=== PASSO "SEM RESPOSTA" ===\n');
    console.log('ID:', passo.id);
    console.log('Título:', passo.titulo);
    console.log('Tipo:', passo.tipo);
    console.log('Ordem:', passo.ordem);
    console.log('\nTexto:');
    console.log(passo.texto);
    console.log('\nConfig:');
    console.log(JSON.stringify(passo.config, null, 2));

  } catch (error) {
    console.error('❌ Erro:', error);
  } finally {
    await prisma.$disconnect();
  }
}

verPassoSemResposta();
