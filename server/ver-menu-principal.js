// ─────────────────────────────────────────────────────────────────────────────
// SCRIPT OBSOLETO -- DESATIVADO DE PROPÓSITO.
//
// apesar do nome "ver", ele faz update no bloco do menu.
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
    "Motivo: apesar do nome "ver", ele faz update no bloco do menu."
);
process.exit(1);

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
3️⃣ Financeiro`;

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
