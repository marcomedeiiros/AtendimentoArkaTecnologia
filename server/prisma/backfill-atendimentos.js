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
async function proximoNumeroOS() {
  const r = await prisma.contador.upsert({
    where: { chave: "ticket" },
    create: { chave: "ticket", valor: 1 },
    update: { valor: { increment: 1 } },
  });
  return r.valor;
}

// numeroOS e unico: se o numero herdado ja estiver em uso (base meio migrada),
// pega o proximo da sequencia em vez de estourar.
async function numeroLivre(preferido) {
  if (preferido != null) {
    const existe = await prisma.atendimento.findUnique({ where: { numeroOS: preferido } });
    if (!existe) return preferido;
  }
  let n = await proximoNumeroOS();
  // Sequencia atras do historico importado: anda ate achar um numero livre.
  while (await prisma.atendimento.findUnique({ where: { numeroOS: n } })) {
    n = await proximoNumeroOS();
  }
  return n;
}

// Cria a OS que representa uma conversa (ou uma conversa antiga que foi fundida).
async function criarAtendimentoDe(conversa, conversaAlvoId) {
  const numeroOS = await numeroLivre(conversa.numeroOS ?? conversa.numeroTicket ?? null);
  return prisma.atendimento.create({
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

    // A OS do proprio fio sobrevivente, quando ainda nao existe.
    if (!alvo.atendimentoAtualId) {
      const a = await criarAtendimentoDe(alvo, alvo.id);
      await prisma.mensagem.updateMany({
        where: { conversaId: alvo.id, atendimentoId: null },
        data: { atendimentoId: a.id },
      });
      alvo.atendimentoAtualId = a.id;
    }

    // Ordem cronologica: a OS "atual" do fio precisa ser a do ciclo mais novo.
    let ultimaOS = { id: alvo.atendimentoAtualId, em: new Date(alvo.criadoEm).getTime() };

    for (const dup of outras) {
      const os = await criarAtendimentoDe(dup, alvo.id);
      // Mensagens migram para o fio, carimbadas com a OS de origem.
      await prisma.mensagem.updateMany({
        where: { conversaId: dup.id },
        data: { conversaId: alvo.id, atendimentoId: os.id },
      });
      // Atendimentos que ja estivessem pendurados na duplicata (rerun parcial).
      await prisma.atendimento.updateMany({
        where: { conversaId: dup.id },
        data: { conversaId: alvo.id },
      });
      // A sessao do chatbot e unica por conversa: a da duplicata some (a do fio
      // sobrevivente e a que vale, e o proximo contato reabre o fluxo).
      await prisma.sessaoChatbot.deleteMany({ where: { conversaId: dup.id } });
      await prisma.conversa.delete({ where: { id: dup.id } });
      fundidas++;

      const em = new Date(dup.criadoEm).getTime();
      if (em >= ultimaOS.em) ultimaOS = { id: os.id, em };
    }

    // O fio herda o estado do ciclo mais recente (e o que a Central mostra).
    const maisRecente = await prisma.atendimento.findUnique({ where: { id: ultimaOS.id } });
    await prisma.conversa.update({
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
 * SETOR das conversas/OS que ficaram como "Geral" sem terem sido triadas.
 *
 * O fluxo transferia para uma FILA numerica e, sem o mapa fila->setor
 * preenchido, o setor nunca era gravado: tudo virava "Geral" e a aba de
 * Feedbacks classificava todo atendimento como "Atendimento Geral". A deducao
 * agora acontece na hora da transferencia (setorDetectado.helper); aqui ela e
 * aplicada UMA VEZ ao historico que ficou para tras.
 *
 * Conservador de proposito: so mexe em quem esta "Geral". Uma conversa que
 * alguem triou a mao para Tecnico/Financeiro/Comercial nao e tocada.
 */
async function preencherSetor() {
  const { detectarSetor } = require("../src/shared/helpers/setorDetectado.helper");

  const alvos = await prisma.conversa.findMany({
    where: { OR: [{ setor: null }, { setor: "Geral" }] },
    include: { mensagens: { orderBy: { criadoEm: "asc" } } },
  });

  let ajustadas = 0;
  for (const c of alvos) {
    const setor = detectarSetor(c);
    if (!setor || setor === "Geral") continue;
    await prisma.conversa.update({
      where: { id: c.id },
      data: { setor, versao: { increment: 1 } },
    });
    // As OS herdam o mesmo setor -- e delas que o Feedback tira a categoria.
    await prisma.atendimento.updateMany({
      where: { conversaId: c.id, OR: [{ setor: null }, { setor: "Geral" }] },
      data: { setor },
    });
    ajustadas++;
  }
  return ajustadas;
}

async function main() {
  const { fios, fundidas } = await fundirDuplicatas();
  const criadas = await criarAtendimentosFaltantes();
  const empresas = await preencherEmpresa();
  const setores = await preencherSetor();
  console.log(
    `[arka] backfill de atendimentos: ${fios} cliente(s) consolidado(s), ` +
      `${fundidas} conversa(s) duplicada(s) fundida(s), ` +
      `${criadas} OS criada(s), ${empresas} razao(oes) social(is) preenchida(s), ` +
      `${setores} setor(es) classificado(s).`
  );
}

main()
  .catch((e) => {
    console.error("[arka] backfill de atendimentos FALHOU:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
