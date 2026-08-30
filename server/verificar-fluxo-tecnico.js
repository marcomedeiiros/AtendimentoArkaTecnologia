const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function verificarFluxo() {
  try {
    // O ID do fluxo técnico vem do targetId da opção mp_1
    const fluxoTecnico = await prisma.fluxo.findFirst({
      where: { id: 'de723e94-ac45-4ed4-b9c8-4d9e71a6c84f' },
      include: {
        passos: {
          orderBy: { ordem: 'asc' }
        }
      }
    });

    console.log('=== FLUXO TÉCNICO ===\n');
    console.log('Nome:', fluxoTecnico.nome);
    console.log('\nPassos:\n');
    
    fluxoTecnico.passos.forEach((passo, index) => {
      console.log(`\n--- PASSO ${index + 1} ---`);
      console.log('ID:', passo.id);
      console.log('Tipo:', passo.tipo);
      console.log('Título:', passo.titulo);
      console.log('Ordem:', passo.ordem);
      console.log('Target ID:', passo.targetId);
      
      if (passo.texto) {
        console.log('Texto:', passo.texto.substring(0, 100) + (passo.texto.length > 100 ? '...' : ''));
      }
      
      if (passo.config?.opcoes) {
        console.log('Opções:');
        passo.config.opcoes.forEach(op => {
          console.log(`  - ${op.rotulo} (esperaEscolha: ${op.esperaEscolha})`);
        });
      }
    });

  } catch (error) {
    console.error('❌ Erro:', error);
  } finally {
    await prisma.$disconnect();
  }
}

verificarFluxo();
