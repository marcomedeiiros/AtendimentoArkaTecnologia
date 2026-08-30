const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function listarFluxos() {
  try {
    console.log('=== TODOS OS FLUXOS DO SISTEMA ===\n');

    const fluxos = await prisma.fluxo.findMany({
      include: {
        passos: {
          orderBy: { ordem: 'asc' }
        }
      }
    });

    fluxos.forEach((fluxo, i) => {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`FLUXO ${i + 1}: ${fluxo.nome}`);
      console.log(`ID: ${fluxo.id}`);
      console.log(`Gatilho: ${fluxo.gatilho}`);
      console.log(`Ativo: ${fluxo.ativo ? 'SIM' : 'NÃO'}`);
      console.log(`Total de passos: ${fluxo.passos.length}`);
      console.log(`${'='.repeat(80)}`);

      // Listar todos os passos
      fluxo.passos.forEach((passo, j) => {
        console.log(`\n  PASSO ${j + 1}:`);
        console.log(`  - ID: ${passo.id}`);
        console.log(`  - Tipo: ${passo.tipo}`);
        console.log(`  - Título: ${passo.titulo}`);
        console.log(`  - Ordem: ${passo.ordem}`);
        console.log(`  - Target: ${passo.targetId || 'null'}`);
        
        if (passo.texto) {
          const textoPreview = passo.texto.substring(0, 80).replace(/\n/g, ' ');
          console.log(`  - Texto: ${textoPreview}...`);
        }

        // Verificar configurações importantes
        if (passo.config) {
          if (passo.config.opcoes) {
            console.log(`  - Opções: ${passo.config.opcoes.length}`);
            passo.config.opcoes.forEach((op, k) => {
              console.log(`    ${k + 1}. ${op.rotulo || op.id} (esperaEscolha: ${op.esperaEscolha})`);
              if (op.botao) {
                console.log(`       Botão: ${op.botao}`);
              }
            });
          }
          
          if (passo.config.variavel) {
            console.log(`  - Variável: ${passo.config.variavel}`);
          }
        }
      });
    });

    console.log(`\n\n${'='.repeat(80)}`);
    console.log(`TOTAL: ${fluxos.length} fluxo(s) encontrado(s)`);
    console.log(`${'='.repeat(80)}\n`);

  } catch (error) {
    console.error('❌ Erro:', error);
  } finally {
    await prisma.$disconnect();
  }
}

listarFluxos();
