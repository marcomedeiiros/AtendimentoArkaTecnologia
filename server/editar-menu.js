const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function editarMenu() {
  try {
    // Busca todos os fluxos ativos
    const fluxos = await prisma.fluxo.findMany({
      where: { ativo: true },
      include: { 
        passos: {
          orderBy: { ordem: 'asc' }
        } 
      }
    });

    console.log('Fluxos encontrados:', fluxos.length);
    
    for (const fluxo of fluxos) {
      console.log(`\nFluxo: ${fluxo.nome} (ID: ${fluxo.id})`);
      console.log(`Gatilho: ${fluxo.gatilho}`);
      
      for (const passo of fluxo.passos) {
        const config = passo.config || {};
        const opcoes = config.opcoes || [];
        
        if (opcoes.length > 0) {
          console.log(`\n  Passo: ${passo.titulo} (ID: ${passo.id})`);
          console.log(`  Texto: ${(passo.texto || '').substring(0, 100)}...`);
          console.log(`  Opções (${opcoes.length}):`);
          
          opcoes.forEach((op, i) => {
            console.log(`    ${i + 1}. ${op.rotulo || op.botao || 'sem rótulo'}`);
            if (op.palavrasChave) {
              console.log(`       Palavras: ${op.palavrasChave.join(', ')}`);
            }
          });

          // Verifica se tem "encerrar" nas opções
          const temEncerrar = opcoes.some(op => 
            (op.rotulo && op.rotulo.toLowerCase().includes('encerrar')) ||
            (op.acao === 'encerrar') ||
            (op.palavrasChave && op.palavrasChave.some(p => p.toLowerCase().includes('encerrar')))
          );

          if (temEncerrar) {
            console.log(`\n  ⚠️ Este passo tem opção de ENCERRAR!`);
            
            // Remove a opção de encerrar
            const novasOpcoes = opcoes.filter(op => {
              const ehEncerrar = 
                (op.rotulo && op.rotulo.toLowerCase().includes('encerrar')) ||
                (op.acao === 'encerrar') ||
                (op.palavrasChave && op.palavrasChave.some(p => p.toLowerCase().includes('encerrar')));
              
              if (ehEncerrar) {
                console.log(`    ❌ Removendo: ${op.rotulo || 'Encerrar'}`);
              }
              return !ehEncerrar;
            });

            if (novasOpcoes.length !== opcoes.length) {
              console.log(`  ✅ Atualizando passo ${passo.id}...`);
              
              await prisma.passoFluxo.update({
                where: { id: passo.id },
                data: {
                  config: {
                    ...config,
                    opcoes: novasOpcoes
                  }
                }
              });
              
              console.log(`  ✅ Passo atualizado! Agora tem ${novasOpcoes.length} opções.`);
            }
          }
        }
      }
    }

    console.log('\n✅ Processo concluído!');
  } catch (error) {
    console.error('❌ Erro:', error);
  } finally {
    await prisma.$disconnect();
  }
}

editarMenu();
