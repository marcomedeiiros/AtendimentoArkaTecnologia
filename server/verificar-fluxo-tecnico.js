const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function verificarFluxo() {
  try {
    // ── O FLUXO ATIVO, E NAO UM UUID CONGELADO ────────────────────────────
    //
    // Este script procurava o fluxo pelo id 'de723e94-...', anotado no dia em
    // que foi escrito. Esse id nao existe em nenhuma instalacao alem daquela:
    // reimportar o fluxo gera ids novos, e uma maquina de desenvolvimento nunca
    // teve esse. Resultado: `findFirst` devolvia null, a linha seguinte
    // estourava `Cannot read properties of null (reading 'nome')`, o catch
    // imprimia o erro -- e o processo saia com codigo 0, dizendo "passou".
    const fluxoTecnico = await prisma.fluxo.findFirst({
      where: { ativo: true },
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
    // SAIR COM 1. Sem isto o script imprimia o erro e devolvia sucesso ao
    // shell -- um relatorio que mente sobre a propria execucao.
    console.error('❌ Erro:', error.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

verificarFluxo();
