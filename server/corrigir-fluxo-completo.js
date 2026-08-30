const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function corrigirFluxo() {
  console.log('=== CORRIGINDO FLUXO COMPLETO ===\n');

  try {
    // 1. CORRIGIR PASSO "FINANCEIRO" - Texto e esperaEscolha
    console.log('1️⃣ Corrigindo passo FINANCEIRO...');
    const passoFinanceiro = await prisma.passoFluxo.findUnique({
      where: { id: '4f5f1646-5441-4afd-974d-dd4fa639f958' }
    });

    if (passoFinanceiro) {
      const config = passoFinanceiro.config;
      
      // Corrigir esperaEscolha
      if (config?.opcoes && config.opcoes.length > 0) {
        config.opcoes[0].esperaEscolha = true;
      }

      // Corrigir texto
      const novoTexto = `🤖 Você selecionou o Setor Financeiro.

Por favor, descreva sua solicitação e um atendente entrará em contato em breve.`;

      await prisma.passoFluxo.update({
        where: { id: passoFinanceiro.id },
        data: {
          texto: novoTexto,
          config: config
        }
      });

      console.log('   ✅ Texto atualizado: "Setor Financeiro" (removido "Administrativo")');
      console.log('   ✅ esperaEscolha = true');
    }

    // 2. CORRIGIR PASSO "VENDEDOR" - esperaEscolha
    console.log('\n2️⃣ Corrigindo passo VENDEDOR...');
    const passoVendedor = await prisma.passoFluxo.findUnique({
      where: { id: '98273bfb-4099-4020-a61c-ebba61ea1f44' }
    });

    if (passoVendedor) {
      const config = passoVendedor.config;
      
      if (config?.opcoes && config.opcoes.length > 0) {
        config.opcoes[0].esperaEscolha = true;
      }

      await prisma.passoFluxo.update({
        where: { id: passoVendedor.id },
        data: { config: config }
      });

      console.log('   ✅ esperaEscolha = true');
    }

    // 3. VERIFICAR TODOS OS PASSOS DE IDENTIFICAÇÃO
    console.log('\n3️⃣ Verificando passos de identificação...');
    
    const passos = [
      { id: 'f083aed3-0296-499e-af69-9dfcde346d4a', nome: 'IDENTIFICA CONTRATO' },
      { id: '9bbec3f6-9a9a-4f09-a0b9-b0d8fd973dd9', nome: 'IDENTIFICA PROBLEMA' }
    ];

    for (const p of passos) {
      const passo = await prisma.passoFluxo.findUnique({ where: { id: p.id } });
      const espera = passo?.config?.opcoes?.[0]?.esperaEscolha;
      
      if (espera === true) {
        console.log(`   ✅ ${p.nome}: esperaEscolha = true`);
      } else {
        console.log(`   ⚠️ ${p.nome}: esperaEscolha = ${espera} (CORRIGINDO...)`);
        const config = passo.config;
        if (config?.opcoes) {
          config.opcoes[0].esperaEscolha = true;
          await prisma.passoFluxo.update({
            where: { id: p.id },
            data: { config }
          });
          console.log(`   ✅ ${p.nome}: CORRIGIDO!`);
        }
      }
    }

    // 4. LIMPAR TODAS AS SESSÕES
    console.log('\n4️⃣ Limpando sessões antigas...');
    const deleted = await prisma.sessaoChatbot.deleteMany({});
    console.log(`   ✅ ${deleted.count} sessões deletadas`);

    console.log('\n✅ CORREÇÃO COMPLETA!\n');
    console.log('📱 AGORA FAÇA O SEGUINTE:');
    console.log('   1. No WhatsApp, DELETE a conversa com o bot');
    console.log('   2. Envie uma NOVA mensagem');
    console.log('   3. Agora vai funcionar corretamente!');

  } catch (error) {
    console.error('❌ Erro:', error);
  } finally {
    await prisma.$disconnect();
  }
}

corrigirFluxo();
