const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function verificarTempoInatividade() {
  try {
    // Mesmo defeito do verificar-fluxo-tecnico: o id era de uma instalacao so.
    // Ver o comentario la para o historico completo.
    const fluxo = await prisma.fluxo.findFirst({
      where: { ativo: true }
    });

    console.log('=== CONFIGURAÇÃO DE INATIVIDADE ===\n');
    console.log('Fluxo:', fluxo.nome);
    console.log('\nConfigurações globais:');
    
    if (fluxo.configGlobais) {
      const config = fluxo.configGlobais;
      
      if (config.semResposta) {
        console.log('\n📍 Sem Resposta (Inatividade):');
        console.log('  - Minutos:', config.semResposta.minutos || 'não configurado (padrão: 5)');
        console.log('  - Ação:', config.semResposta.acao || 'não configurado');
        console.log('  - Mensagem:', config.semResposta.mensagem?.substring(0, 60) || 'não configurado');
      } else {
        console.log('\n⚠️ Sem Resposta: não configurado (usando padrão: 5 minutos)');
      }
      
      if (config.filaPendentes) {
        console.log('\n📍 Fila Pendentes (Espera na Fila):');
        console.log('  - Minutos:', config.filaPendentes.minutos || 'não configurado (padrão: 10)');
        console.log('  - Ativo:', config.filaPendentes.ativo !== false ? 'SIM' : 'NÃO');
      }
    } else {
      console.log('⚠️ Nenhuma configuração global definida. Usando padrões:');
      console.log('  - Inatividade: 5 minutos');
      console.log('  - Espera na fila: 10 minutos');
    }

    // Verificar também os passos com configuração de tempo
    const passos = await prisma.passoFluxo.findMany({
      where: { fluxoId: fluxo.id }
    });

    console.log('\n\n=== PASSOS COM CONFIGURAÇÃO DE TEMPO ===\n');
    
    passos.forEach(passo => {
      if (passo.config?.semResposta || passo.config?.modo === 'sem_resposta') {
        console.log(`\nPasso: ${passo.titulo}`);
        console.log(`Tipo: ${passo.tipo}`);
        if (passo.config.semResposta) {
          console.log(`  - Minutos: ${passo.config.semResposta.minutos || 'usa global'}`);
          console.log(`  - Ação: ${passo.config.semResposta.acao || 'usa global'}`);
        }
        if (passo.config.modo === 'sem_resposta') {
          console.log('  - Modo: sem_resposta (bloco específico)');
        }
      }
    });

  } catch (error) {
    process.exitCode = 1;
    console.error('❌ Erro:', error);
  } finally {
    await prisma.$disconnect();
  }
}

verificarTempoInatividade();
