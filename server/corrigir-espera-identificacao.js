// ─────────────────────────────────────────────────────────────────────────────
// SCRIPT OBSOLETO -- DESATIVADO DE PROPÓSITO.
//
// gravava esperaEscolha:true na opção curinga do bloco de Identificação -- era exatamente o botão "resposta livre" debaixo da pergunta.
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
    "Motivo: gravava esperaEscolha:true na opção curinga do bloco de Identificação -- era exatamente o botão "resposta livre" debaixo da pergunta."
);
process.exit(1);

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function corrigirEspera() {
  try {
    console.log('=== CORRIGINDO ESPERA DE RESPOSTA ===\n');

    // Passo 1: IDENTIFICA CONTRATO (deve esperar resposta)
    const passoIdentificaContrato = await prisma.passoFluxo.findUnique({
      where: { id: 'f083aed3-0296-499e-af69-9dfcde346d4a' }
    });

    if (passoIdentificaContrato) {
      console.log('Passo 1: IDENTIFICA CONTRATO');
      console.log('Config atual:', JSON.stringify(passoIdentificaContrato.config, null, 2));
      
      const config = passoIdentificaContrato.config;
      if (config?.opcoes && config.opcoes.length > 0) {
        config.opcoes[0].esperaEscolha = true;
        
        await prisma.passoFluxo.update({
          where: { id: passoIdentificaContrato.id },
          data: { config }
        });
        
        console.log('✅ Atualizado: esperaEscolha = true');
      }
    }

    // Passo 2: IDENTIFICA PROBLEMA (já pode ficar sem esperar, pois é o último)
    const passoIdentificaProblema = await prisma.passoFluxo.findUnique({
      where: { id: '9bbec3f6-9a9a-4f09-a0b9-b0d8fd973dd9' }
    });

    console.log('\nPasso 2: IDENTIFICA PROBLEMA');
    console.log('Config atual:', JSON.stringify(passoIdentificaProblema.config, null, 2));
    console.log('Este passo não precisa esperar resposta (é o último antes de criar o chamado)');

    console.log('\n✅ Correção concluída!');
    console.log('\nAgora o fluxo vai:');
    console.log('1. Perguntar nome e setor');
    console.log('2. AGUARDAR a resposta do cliente');
    console.log('3. Só depois perguntar sobre a solicitação');

  } catch (error) {
    console.error('❌ Erro:', error);
  } finally {
    await prisma.$disconnect();
  }
}

corrigirEspera();
