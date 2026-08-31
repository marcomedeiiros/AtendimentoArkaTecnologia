// ─────────────────────────────────────────────────────────────────────────────
// SCRIPT OBSOLETO -- DESATIVADO DE PROPÓSITO.
//
// varre os fluxos ativos e reescreve opções de menu.
//
// Ele mexia em bloco do fluxo por UUID chumbado, um campo por vez. Os ids que
// ele usa CONTINUAM existindo (o fluxo novo os preserva para não orfanar sessões
// e logs de execução), então rodá-lo hoje não daria erro: daria o defeito de
// volta, em silêncio.
//
// O caminho atual é publicar o fluxo INTEIRO, validado e com confirmação:
//
//     node publicar-fluxo-arka.js --dry     confere sem gravar
//     node publicar-fluxo-arka.js           mostra o plano e pede confirmação
//
// Ele valida o teto de 3 botões, que bloco de texto livre não tem opção, e que
// todo destino existe -- as invariantes que este script violava.
//
// O arquivo fica aqui em vez de ser apagado porque o histórico dele explica de
// onde vieram os defeitos. Se você precisa MESMO do que ele fazia, o git tem a
// versão anterior.
// ─────────────────────────────────────────────────────────────────────────────
console.error(
  "Este script está obsoleto e desativado. Use: node publicar-fluxo-arka.js\n" +
    "Motivo: varre os fluxos ativos e reescreve opções de menu."
);
process.exit(1);

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
