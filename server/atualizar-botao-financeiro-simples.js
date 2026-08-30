const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function atualizarBotao() {
  try {
    const passo = await prisma.passoFluxo.findFirst({
      where: { id: 'd70e3322-5760-49c6-98e9-c60550093310' }
    });

    console.log('=== ATUALIZANDO MENU PRINCIPAL ===\n');
    
    // Atualizar o texto
    const novoTexto = `👋 Olá, {{cliente.nome}}!

Bem-vindo(a) à ARKA Tecnologia.

Como podemos ajudar você hoje?

1️⃣ Técnico
2️⃣ Comercial
3️⃣ Financeiro`;

    // Atualizar a config para mudar o botão
    const config = passo.config;
    
    // Encontrar e atualizar a opção mp_3 (Financeiro)
    const opcaoFinanceiro = config.opcoes.find(op => op.id === 'mp_3');
    if (opcaoFinanceiro) {
      opcaoFinanceiro.botao = '💰 Financeiro';
      console.log('✅ Botão atualizado: 💰 Financeiro');
    }

    // Salvar no banco
    await prisma.passoFluxo.update({
      where: { id: passo.id },
      data: { 
        texto: novoTexto,
        config: config
      }
    });

    console.log('✅ Texto atualizado');
    console.log('\nNovo menu:');
    console.log(novoTexto);
    console.log('\n✅ Atualização concluída com sucesso!');

  } catch (error) {
    console.error('❌ Erro:', error);
  } finally {
    await prisma.$disconnect();
  }
}

atualizarBotao();
