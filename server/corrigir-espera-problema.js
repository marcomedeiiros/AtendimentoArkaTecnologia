// ─────────────────────────────────────────────────────────────────────────────
// SCRIPT OBSOLETO -- DESATIVADO DE PROPÓSITO.
//
// o mesmo, no bloco de Descrição da solicitação.
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
    "Motivo: o mesmo, no bloco de Descrição da solicitação."
);
process.exit(1);

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function corrigirEsperaProblema() {
  try {
    console.log('=== CORRIGINDO ESPERA NO PASSO DE PROBLEMA ===\n');

    const passoIdentificaProblema = await prisma.passoFluxo.findUnique({
      where: { id: '9bbec3f6-9a9a-4f09-a0b9-b0d8fd973dd9' }
    });

    console.log('Passo: IDENTIFICA PROBLEMA');
    console.log('Config atual:', JSON.stringify(passoIdentificaProblema.config, null, 2));
    
    const config = passoIdentificaProblema.config;
    if (config?.opcoes && config.opcoes.length > 0) {
      // Mudar para esperar a resposta antes de transferir
      config.opcoes[0].esperaEscolha = true;
      
      await prisma.passoFluxo.update({
        where: { id: passoIdentificaProblema.id },
        data: { config }
      });
      
      console.log('\n✅ Atualizado: esperaEscolha = true');
      console.log('\nAgora o bot vai:');
      console.log('1. Perguntar nome e setor → AGUARDAR resposta');
      console.log('2. Perguntar sobre a solicitação → AGUARDAR resposta');
      console.log('3. Transferir para o técnico');
    }

  } catch (error) {
    console.error('❌ Erro:', error);
  } finally {
    await prisma.$disconnect();
  }
}

corrigirEsperaProblema();
