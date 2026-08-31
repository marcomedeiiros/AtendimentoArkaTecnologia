// ─────────────────────────────────────────────────────────────────────────────
// SCRIPT OBSOLETO -- DESATIVADO DE PROPÓSITO.
//
// reescreve as opções do MENU PRINCIPAL (bloco d70e3322).
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
    "Motivo: reescreve as opções do MENU PRINCIPAL (bloco d70e3322)."
);
process.exit(1);

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
