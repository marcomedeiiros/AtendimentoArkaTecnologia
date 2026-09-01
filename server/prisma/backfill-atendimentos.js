/**
 * Consolida o historico no modelo "uma conversa por cliente, uma OS por ciclo".
 *
 * Ate aqui cada atendimento era uma CONVERSA nova: fechado o atendimento, a
 * proxima mensagem do mesmo numero criava outra linha, com outro numero, e o
 * historico anterior ficava perdido numa conversa separada. Agora a conversa e
 * o fio permanente do contato e cada ciclo e um `Atendimento` (a OS).
 *
 * O que este script faz, em duas etapas:
 *
 *  1. FUNDE as conversas duplicadas de (instancia, telefone) numa so -- a mais
 *     ANTIGA, que e a que carrega o comeco da historia. Cada conversa fundida
 *     vira um Atendimento no fio sobrevivente, com o numero de OS que ela ja
 *     tinha: os numeros ja informados aos clientes continuam validos.
 *  2. CRIA a primeira OS das conversas que ainda nao tem nenhuma.
 *
 * IDEMPOTENTE: rodar de novo nao duplica nada (conversa ja consolidada nao tem
 * mais duplicata; conversa que ja tem OS e pulada). Roda no deploy, entre o
 * `prisma db push` e o seed -- ver docker-entrypoint.sh.
 *
 * NAO APAGA MENSAGEM NENHUMA: as mensagens sao movidas para o fio sobrevivente
 * e carimbadas com a OS a que pertenciam.
 */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

// Contador compartilhado com a criacao de conversas/OS. Reservar o proximo
// numero aqui evita que uma OS criada pelo backfill colida com uma nova.
async function proximoNumeroOS(db = prisma) {
  const r = await db.contador.upsert({
    where: { chave: "ticket" },
    create: { chave: "ticket", valor: 1 },
    update: { valor: { increment: 1 } },
  });
  return r.valor;
}

// numeroOS e unico: se o numero herdado ja estiver em uso (base meio migrada),
// pega o proximo da sequencia em vez de estourar.
async function numeroLivre(preferido, db = prisma) {
  if (preferido != null) {
    const existe = await db.atendimento.findUnique({ where: { numeroOS: preferido } });
    if (!existe) return preferido;
  }
  let n = await proximoNumeroOS(db);
  // Sequencia atras do historico importado: anda ate achar um numero livre.
  while (await db.atendimento.findUnique({ where: { numeroOS: n } })) {
    n = await proximoNumeroOS(db);
  }
  return n;
}

// Cria a OS que representa uma conversa (ou uma conversa antiga que foi fundida).
async function criarAtendimentoDe(conversa, conversaAlvoId, db = prisma) {
  const numeroOS = await numeroLivre(conversa.numeroOS ?? conversa.numeroTicket ?? null, db);
  return db.atendimento.create({
    data: {
      conversaId: conversaAlvoId,
      numeroOS,
      setor: conversa.setor || null,
      status: conversa.statusAtendimento || "pendente",
      atendenteId: conversa.atendenteId || null,
      atendenteNome: conversa.ultimoAtendenteNome || null,
      avaliacao: conversa.avaliacao ?? null,
      feedback: conversa.feedback || null,
      abertoEm: conversa.criadoEm || new Date(),
      atendidoEm: conversa.atendidoEm || null,
      fechadoEm: conversa.fechadoEm || null,
    },
  });
}

async function fundirDuplicatas() {
  const todas = await prisma.conversa.findMany({ orderBy: { criadoEm: "asc" } });
  const grupos = new Map();
  for (const c of todas) {
    const chave = `${c.instanciaId}::${c.telefone}`;
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(c);
  }

  let fios = 0;
  let fundidas = 0;
  for (const [, lista] of grupos) {
    if (lista.length < 2) continue;
    fios++;
    // A mais antiga fica: e onde a historia comeca.
    const [alvo, ...outras] = lista;

    // ── TUDO OU NADA, POR FIO ────────────────────────────────────────────
    //
    // Antes daqui cada passo era uma escrita solta: criar a OS, mover as
    // mensagens, mover os atendimentos, apagar a sessao, apagar a conversa.
    // Entre um passo e outro o processo pode morrer -- e o entrypoint roda
    // isto em TODA subida de container, logo depois de um `db push`.
    //
    // Em 31/08/2026 o banco de producao amanheceu com 30 linhas orfas: 26
    // mensagens, 2 atendimentos (OS 146 e 149) e 2 sessoes apontando para
    // conversas que nao existiam mais. Duas conversas de clientes reais
    // sumiram da Central levando o historico junto, e nenhuma delas foi
    // apagada pela tela (o log do nginx nao registra um unico DELETE).
    //
    // Uma transacao por fio fecha essa janela: ou a fusao inteira vale, ou
    // nada dela vale e a duplicata continua la, visivel, para ser fundida na
    // proxima subida.
    await prisma.$transaction(async (tx) => {
      // A OS do proprio fio sobrevivente, quando ainda nao existe.
      if (!alvo.atendimentoAtualId) {
        const a = await criarAtendimentoDe(alvo, alvo.id, tx);
        await tx.mensagem.updateMany({
          where: { conversaId: alvo.id, atendimentoId: null },
          data: { atendimentoId: a.id },
        });
        alvo.atendimentoAtualId = a.id;
      }

      // Ordem cronologica: a OS "atual" do fio precisa ser a do ciclo mais novo.
      let ultimaOS = { id: alvo.atendimentoAtualId, em: new Date(alvo.criadoEm).getTime() };

      for (const dup of outras) {
        const os = await criarAtendimentoDe(dup, alvo.id, tx);
        // Mensagens migram para o fio, carimbadas com a OS de origem.
        await tx.mensagem.updateMany({
          where: { conversaId: dup.id },
          data: { conversaId: alvo.id, atendimentoId: os.id },
        });
        // Atendimentos que ja estivessem pendurados na duplicata (rerun parcial).
        await tx.atendimento.updateMany({
          where: { conversaId: dup.id },
          data: { conversaId: alvo.id },
        });
        // A sessao do chatbot e unica por conversa: a da duplicata some (a do fio
        // sobrevivente e a que vale, e o proximo contato reabre o fluxo).
        await tx.sessaoChatbot.deleteMany({ where: { conversaId: dup.id } });

        // ULTIMA CONFERENCIA ANTES DE APAGAR. As tres consultas acima deveriam
        // ter esvaziado a duplicata; se sobrou alguma coisa, apagar a conversa
        // agora e o que cria orfao. Melhor abortar o fio e deixar a duplicata
        // de pe do que perder historico de cliente em silencio.
        const restantes =
          (await tx.mensagem.count({ where: { conversaId: dup.id } })) +
          (await tx.atendimento.count({ where: { conversaId: dup.id } })) +
          (await tx.sessaoChatbot.count({ where: { conversaId: dup.id } }));
        if (restantes > 0) {
          throw new Error(
            `fusao abortada: a conversa ${dup.id} ainda tem ${restantes} registro(s) presos. ` +
              `Nada foi apagado -- a duplicata continua no banco.`
          );
        }

        await tx.conversa.delete({ where: { id: dup.id } });
        fundidas++;

        const em = new Date(dup.criadoEm).getTime();
        if (em >= ultimaOS.em) ultimaOS = { id: os.id, em };
      }

      // O fio herda o estado do ciclo mais recente (e o que a Central mostra).
      const maisRecente = await tx.atendimento.findUnique({ where: { id: ultimaOS.id } });
      await tx.conversa.update({
        where: { id: alvo.id },
        data: {
          atendimentoAtualId: ultimaOS.id,
          statusAtendimento: maisRecente?.status || alvo.statusAtendimento,
          setor: maisRecente?.setor || alvo.setor,
          atendenteId: maisRecente?.atendenteId || null,
          ultimoAtendenteNome: maisRecente?.atendenteNome || alvo.ultimoAtendenteNome,
          avaliacao: maisRecente?.avaliacao ?? null,
          feedback: maisRecente?.feedback ?? null,
          atendidoEm: maisRecente?.atendidoEm ?? null,
          fechadoEm: maisRecente?.fechadoEm ?? null,
          versao: { increment: 1 },
        },
      });
    });
  }

  return { fios, fundidas };
}

async function criarAtendimentosFaltantes() {
  const semOS = await prisma.conversa.findMany({ where: { atendimentoAtualId: null } });
  for (const c of semOS) {
    const a = await criarAtendimentoDe(c, c.id);
    await prisma.mensagem.updateMany({
      where: { conversaId: c.id, atendimentoId: null },
      data: { atendimentoId: a.id },
    });
    await prisma.conversa.update({
      where: { id: c.id },
      data: { atendimentoAtualId: a.id },
    });
  }
  return semOS.length;
}

// Razao social das conversas que ja tinham CNPJ identificado antes de existir a
// coluna `empresa` -- sem isso elas apareceriam sem nome na Central.
async function preencherEmpresa() {
  const alvos = await prisma.conversa.findMany({
    where: { cnpjVerificado: true, empresa: null, cnpj: { not: null } },
    select: { id: true, cnpj: true },
  });
  let preenchidas = 0;
  for (const c of alvos) {
    const parceiro = await prisma.parceiro.findUnique({ where: { cnpj: c.cnpj } });
    if (!parceiro) continue;
    await prisma.conversa.update({
      where: { id: c.id },
      data: { empresa: parceiro.razaoSocial },
    });
    preenchidas++;
  }
  return preenchidas;
}

/**
 * NAO EXISTE MAIS `preencherSetor()` -- e ele nao pode voltar.
 *
 * Havia aqui um passo que varria todas as conversas "Geral", ADIVINHAVA o setor
 * pelas palavras do cliente ("boleto" -> Financeiro) e gravava o palpite na
 * conversa e na OS. Dois problemas, um pior que o outro:
 *
 *  1. Contradizia a regra do sistema: setor so se define quando o CLIENTE
 *     escolhe uma opcao do menu (ver setor.helper.resolverSetorDeclarado). O
 *     backfill carimbava "Tecnico" em quem nunca escolheu nada.
 *  2. Rodava no ENTRYPOINT, ou seja, a CADA subida do container. Nao era uma
 *     migracao unica: qualquer conversa que voltasse a "Geral" era reclassificada
 *     no deploy seguinte. Corrigir o setor a mao nao adiantava -- o proximo
 *     `docker compose up` desfazia.
 *
 * O helper que ele importava (`setorDetectado.helper`) foi apagado junto. Este
 * comentario fica no lugar porque um `require` de arquivo inexistente aqui
 * derruba o entrypoint pelo `set -e` -- e um passo de boot que morre e um 502
 * no painel inteiro, nao um aviso.
 */
async function main() {
  const { fios, fundidas } = await fundirDuplicatas();
  const criadas = await criarAtendimentosFaltantes();
  const empresas = await preencherEmpresa();
  console.log(
    `[arka] backfill de atendimentos: ${fios} cliente(s) consolidado(s), ` +
      `${fundidas} conversa(s) duplicada(s) fundida(s), ` +
      `${criadas} OS criada(s), ${empresas} razao(oes) social(is) preenchida(s).`
  );
}

main()
  .catch((e) => {
    console.error("[arka] backfill de atendimentos FALHOU:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
