// ─────────────────────────────────────────────────────────────────────────────
// SCRIPT OBSOLETO -- DESATIVADO DE PROPÓSITO.
//
// o mesmo, por outro caminho.
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
    "Motivo: o mesmo, por outro caminho."
);
process.exit(1);

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
