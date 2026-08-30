const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function limparTudo() {
  console.log('=== LIMPEZA COMPLETA DE SESSÕES E CACHE ===\n');

  try {
    // 1. Limpar TODAS as sessões do chatbot
    console.log('1️⃣ Limpando sessões do chatbot...');
    const sessoesDeletadas = await prisma.sessaoChatbot.deleteMany({});
    console.log(`   ✅ ${sessoesDeletadas.count} sessões deletadas`);

    // 2. Verificar o menu está correto
    console.log('\n2️⃣ Verificando configuração do menu...');
    const menu = await prisma.passoFluxo.findUnique({
      where: { id: 'd70e3322-5760-49c6-98e9-c60550093310' }
    });
    
    if (menu) {
      const botaoFinanceiro = menu.config?.opcoes?.find(op => op.id === 'mp_3');
      if (botaoFinanceiro) {
        console.log(`   Menu: ${botaoFinanceiro.botao}`);
        if (botaoFinanceiro.botao === '💰 Financeiro') {
          console.log('   ✅ Botão está correto: "💰 Financeiro"');
        } else {
          console.log(`   ⚠️ Botão ainda mostra: "${botaoFinanceiro.botao}"`);
        }
      }
    }

    // 3. Verificar esperaEscolha dos passos problemáticos
    console.log('\n3️⃣ Verificando passos de identificação...');
    
    const passoIdentifica = await prisma.passoFluxo.findUnique({
      where: { id: 'f083aed3-0296-499e-af69-9dfcde346d4a' }
    });
    
    const passoProblema = await prisma.passoFluxo.findUnique({
      where: { id: '9bbec3f6-9a9a-4f09-a0b9-b0d8fd973dd9' }
    });

    if (passoIdentifica?.config?.opcoes?.[0]?.esperaEscolha === true) {
      console.log('   ✅ IDENTIFICA CONTRATO: esperaEscolha = true');
    } else {
      console.log('   ❌ IDENTIFICA CONTRATO: esperaEscolha = false (PROBLEMA!)');
    }

    if (passoProblema?.config?.opcoes?.[0]?.esperaEscolha === true) {
      console.log('   ✅ IDENTIFICA PROBLEMA: esperaEscolha = true');
    } else {
      console.log('   ❌ IDENTIFICA PROBLEMA: esperaEscolha = false (PROBLEMA!)');
    }

    console.log('\n✅ LIMPEZA CONCLUÍDA!\n');
    console.log('📱 IMPORTANTE: Peça para o cliente:');
    console.log('   1. Fechar completamente o WhatsApp');
    console.log('   2. Reabrir o WhatsApp');
    console.log('   3. Iniciar uma NOVA conversa');
    console.log('\n💡 Isso vai forçar o WhatsApp a buscar os botões atualizados!');

  } catch (error) {
    console.error('❌ Erro:', error);
  } finally {
    await prisma.$disconnect();
  }
}

limparTudo();
