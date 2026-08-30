const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function analisarPerformance() {
  console.log('=== ANÁLISE DE PERFORMANCE DO SISTEMA ===\n');

  try {
    // 1. Verificar índices do SQLite
    console.log('📊 1. ÍNDICES NO BANCO DE DADOS\n');
    
    const indices = await prisma.$queryRaw`
      SELECT 
        m.name as tabela,
        il.name as indice,
        GROUP_CONCAT(ii.name) as colunas
      FROM sqlite_master AS m
      LEFT JOIN pragma_index_list(m.name) AS il
      LEFT JOIN pragma_index_info(il.name) AS ii
      WHERE m.type = 'table'
      AND il.name IS NOT NULL
      GROUP BY m.name, il.name
      ORDER BY m.name, il.name
    `;
    
    console.table(indices);

    // 2. Estatísticas das tabelas principais
    console.log('\n📈 2. ESTATÍSTICAS DAS TABELAS\n');
    
    const stats = {
      conversas: await prisma.conversa.count(),
      mensagens: await prisma.mensagem.count(),
      parceiros: await prisma.parceiro.count(),
      sessoes: await prisma.sessaoChatbot.count(),
      usuarios: await prisma.usuario.count(),
    };
    
    console.table(stats);

    // 3. Conversas por status
    console.log('\n📋 3. CONVERSAS POR STATUS\n');
    
    const porStatus = await prisma.conversa.groupBy({
      by: ['statusAtendimento'],
      _count: true,
    });
    
    console.table(porStatus);

    // 4. Mensagens por conversa (média)
    console.log('\n💬 4. MENSAGENS POR CONVERSA\n');
    
    const conversasComMensagens = await prisma.conversa.findMany({
      select: {
        id: true,
        _count: {
          select: { mensagens: true }
        }
      },
      take: 10,
      orderBy: { mensagens: { _count: 'desc' } }
    });
    
    const mediaMensagens = await prisma.mensagem.count() / await prisma.conversa.count();
    console.log(`Média de mensagens por conversa: ${mediaMensagens.toFixed(2)}`);
    console.log('\nTop 10 conversas com mais mensagens:');
    conversasComMensagens.forEach((c, i) => {
      console.log(`  ${i + 1}. Conversa ${c.id.substring(0, 8)}...: ${c._count.mensagens} mensagens`);
    });

    // 5. Sessões ativas
    console.log('\n🔄 5. SESSÕES ATIVAS DO CHATBOT\n');
    
    const sessoesAtivas = await prisma.sessaoChatbot.count({
      where: { ativo: true }
    });
    
    console.log(`Sessões ativas: ${sessoesAtivas}`);

    // 6. Índices ausentes ou sugeridos
    console.log('\n💡 6. SUGESTÕES DE OTIMIZAÇÃO\n');
    
    const sugestoes = [];

    // Verificar índice em Parceiro.cnpj (chave primária, já tem)
    // Verificar índice em Conversa.cnpj (NÃO TEM!)
    const conversasCnpj = await prisma.conversa.count({
      where: { cnpj: { not: null } }
    });
    if (conversasCnpj > 100) {
      sugestoes.push({
        tabela: 'Conversa',
        campo: 'cnpj',
        motivo: `${conversasCnpj} conversas com CNPJ - consultas frequentes durante identificação`,
        impacto: 'ALTO'
      });
    }

    // Verificar índice em Mensagem.waMessageId (já tem UNIQUE)
    
    // Verificar conversas com muitas mensagens
    const conversaGrande = await prisma.$queryRaw`
      SELECT COUNT(*) as total 
      FROM conversas c
      WHERE (SELECT COUNT(*) FROM mensagens m WHERE m.conversa_id = c.id) > 1000
    `;
    
    if (conversaGrande[0].total > 0) {
      sugestoes.push({
        tabela: 'Conversa',
        campo: 'N/A',
        motivo: `${conversaGrande[0].total} conversas com +1000 mensagens - considerar paginação`,
        impacto: 'MÉDIO'
      });
    }

    if (sugestoes.length === 0) {
      console.log('✅ Nenhuma otimização crítica necessária!');
    } else {
      console.table(sugestoes);
    }

    // 7. Tempo de resposta de queries comuns
    console.log('\n⏱️  7. BENCHMARK DE QUERIES COMUNS\n');
    
    const benchmarks = [];

    // Query 1: Buscar conversa por telefone
    let t0 = Date.now();
    await prisma.conversa.findFirst({
      where: { telefone: { contains: '5527' } }
    });
    benchmarks.push({ query: 'Buscar conversa por telefone', tempo: `${Date.now() - t0}ms` });

    // Query 2: Buscar parceiro por CNPJ
    t0 = Date.now();
    await prisma.parceiro.findFirst({
      where: { cnpj: '12345678000100', status: 'ativo' }
    });
    benchmarks.push({ query: 'Buscar parceiro por CNPJ', tempo: `${Date.now() - t0}ms` });

    // Query 3: Listar conversas com mensagens
    t0 = Date.now();
    await prisma.conversa.findMany({
      include: {
        mensagens: {
          orderBy: { criadoEm: 'desc' },
          take: 50
        }
      },
      take: 10
    });
    benchmarks.push({ query: 'Listar 10 conversas + 50 msgs cada', tempo: `${Date.now() - t0}ms` });

    // Query 4: Buscar sessão por telefone
    t0 = Date.now();
    await prisma.sessaoChatbot.findFirst({
      where: { telefone: { contains: '5527' } }
    });
    benchmarks.push({ query: 'Buscar sessão por telefone', tempo: `${Date.now() - t0}ms` });

    console.table(benchmarks);

  } catch (error) {
    console.error('❌ Erro na análise:', error);
  } finally {
    await prisma.$disconnect();
  }
}

analisarPerformance();
