const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function verMenu() {
  try {
    const passo = await prisma.passoFluxo.findFirst({
      where: { id: 'd70e3322-5760-49c6-98e9-c60550093310' }
    });

    console.log('=== MENU PRINCIPAL - BOAS VINDAS ===\n');
    console.log('Texto completo:');
    console.log(passo.texto);
    console.log('\n\nConfig:');
    console.log(JSON.stringify(passo.config, null, 2));
    
    // Atualizar o texto para remover o 4️⃣ se existir
    const textoAtual = passo.texto || '';
    if (textoAtual.includes('4️⃣') || textoAtual.toLowerCase().includes('encerrar')) {
      console.log('\n⚠️ TEXTO CONTÉM REFERÊNCIA A 4ª OPÇÃO OU ENCERRAR!');
      console.log('Vou atualizar o texto...\n');
      
      const novoTexto = `👋 Olá, {{cliente.nome}}!

Bem-vindo(a) à ARKA Tecnologia.

Como podemos ajudar você hoje?

1️⃣ Técnico
2️⃣ Comercial
3️⃣ Administrativo / Financeiro`;

      await prisma.passoFluxo.update({
        where: { id: passo.id },
        data: { texto: novoTexto }
      });
      
      console.log('✅ Texto atualizado com sucesso!');
      console.log('\nNovo texto:');
      console.log(novoTexto);
    } else {
      console.log('\n✅ O texto está correto (3 opções apenas)');
    }

  } catch (error) {
    console.error('❌ Erro:', error);
  } finally {
    await prisma.$disconnect();
  }
}

verMenu();
