const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function atualizarBotaoFinanceiro() {
  try {
    const passo = await prisma.passoFluxo.findFirst({
      where: { id: 'd70e3322-5760-49c6-98e9-c60550093310' }
    });

    console.log('=== ATUALIZANDO BOTÃO FINANCEIRO ===\n');
    
    const config = passo.config || {};
    const opcoes = config.opcoes || [];
    
    // Encontra a opção financeiro e atualiza o botão
    const novasOpcoes = opcoes.map(op => {
      if (op.id === 'mp_3' || op.setor === 'Financeiro') {
        console.log('Botão atual:', op.botao);
        return {
          ...op,
          botao: '💰 Administrativo / Financeiro'
        };
      }
      return op;
    });

    await prisma.passoFluxo.update({
      where: { id: passo.id },
      data: {
        config: {
          ...config,
          opcoes: novasOpcoes
        }
      }
    });

    console.log('Novo botão: 💰 Administrativo / Financeiro');
    console.log('\n✅ Botão atualizado com sucesso!');

  } catch (error) {
    console.error('❌ Erro:', error);
  } finally {
    await prisma.$disconnect();
  }
}

atualizarBotaoFinanceiro();
