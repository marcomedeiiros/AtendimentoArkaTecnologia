const prisma = require("../database/prisma.client");

class ConversaRepository {
  findAll(filtros = {}) {
    const where = {};
    if (filtros.status) where.statusAtendimento = filtros.status;
    if (filtros.instanciaId) where.instanciaId = filtros.instanciaId;
    // Arquivadas/ocultas continuam no banco; so somem da listagem quando o
    // filtro correspondente estiver desligado.
    if (filtros.arquivada !== undefined) where.arquivada = filtros.arquivada;
    if (filtros.oculta !== undefined) where.oculta = filtros.oculta;
    if (filtros.favorita !== undefined) where.favorita = filtros.favorita;
    if (filtros.busca) {
      where.OR = [
        { cliente: { contains: filtros.busca } },
        { telefone: { contains: filtros.busca } },
        { cnpj: { contains: filtros.busca } },
      ];
    }

    return prisma.conversa.findMany({
      where,
      include: {
        mensagens: { orderBy: { criadoEm: "asc" } },
      },
      orderBy: { atualizadoEm: "desc" },
    });
  }

  findById(id) {
    return prisma.conversa.findUnique({
      where: { id },
      include: {
        mensagens: { orderBy: { criadoEm: "asc" } },
        sessao: true,
      },
    });
  }

  findByTelefone(instanciaId, telefone) {
    return prisma.conversa.findFirst({
      where: {
        instanciaId,
        telefone,
        statusAtendimento: { in: ["pendente", "aberta"] },
      },
      include: { mensagens: { orderBy: { criadoEm: "asc" } }, sessao: true },
      orderBy: { atualizadoEm: "desc" },
    });
  }

  create(data) {
    return prisma.conversa.create({
      data,
      include: { mensagens: true },
    });
  }

  update(id, data) {
    return prisma.conversa.update({
      where: { id },
      data,
      include: { mensagens: { orderBy: { criadoEm: "asc" } } },
    });
  }

  delete(id) {
    return prisma.conversa.delete({ where: { id } });
  }

  // Cria a mensagem E "toca" a conversa na mesma transacao. Sem o update, o
  // @updatedAt nao muda ao chegar mensagem nova e a conversa nao sobe na lista
  // (ordenada por atualizadoEm). Mensagem do cliente ainda incrementa o
  // contador de nao-lidas usado pelo badge numerico.
  async addMensagem(conversaId, origem, texto, metadata = null, waMessageId = null, extras = {}) {
    const [mensagem] = await prisma.$transaction([
      prisma.mensagem.create({
        data: { conversaId, origem, texto, metadata, waMessageId, ...extras },
      }),
      prisma.conversa.update({
        where: { id: conversaId },
        data:
          origem === "cliente"
            ? { atualizadoEm: new Date(), naoLidas: { increment: 1 }, lido: false }
            : { atualizadoEm: new Date() },
      }),
    ]);
    return mensagem;
  }

  // Vincula o id da Evolution a mensagem recem-criada, para o ACK
  // (messages.update) conseguir encontra-la depois.
  vincularWaMessageId(id, waMessageId, status = "enviada") {
    return prisma.mensagem.update({
      where: { id },
      data: { waMessageId, status },
    });
  }

  // Nao rebaixa o status: um "entregue" atrasado nao pode apagar um "lida".
  async atualizarStatusPorWaId(waMessageId, status) {
    const ordem = { enviando: 0, enviada: 1, entregue: 2, lida: 3 };
    const msg = await prisma.mensagem.findUnique({ where: { waMessageId } });
    if (!msg) return null;
    if (status !== "erro" && (ordem[status] ?? 0) <= (ordem[msg.status] ?? -1)) {
      return msg;
    }
    return prisma.mensagem.update({ where: { id: msg.id }, data: { status } });
  }

  findMensagem(id) {
    return prisma.mensagem.findUnique({ where: { id } });
  }

  atualizarMetadata(id, metadata) {
    return prisma.mensagem.update({ where: { id }, data: { metadata } });
  }

  editarMensagem(id, texto) {
    return prisma.mensagem.update({
      where: { id },
      data: { texto, editadaEm: new Date() },
    });
  }

  removerMensagem(id) {
    return prisma.mensagem.delete({ where: { id } });
  }

  // "Apagar para todos" NAO remove a linha do banco: o Registro (Visao Geral)
  // precisa do log completo de tudo que foi enviado e recebido. Em vez disso,
  // marca a mensagem como deletada dentro do metadata (campo Json que ja existe,
  // sem migracao). O mapper expoe a flag `deletada` e o chat ao vivo mostra
  // "Mensagem apagada" no lugar do conteudo, enquanto o texto original continua
  // gravado para a transcricao/CSV.
  async marcarMensagemApagada(id) {
    const msg = await prisma.mensagem.findUnique({ where: { id } });
    const metadata = {
      ...(msg?.metadata || {}),
      deletada: true,
      deletadaEm: new Date().toISOString(),
    };
    return prisma.mensagem.update({ where: { id }, data: { metadata } });
  }

  zerarNaoLidas(id) {
    return prisma.conversa.update({
      where: { id },
      data: { naoLidas: 0, lido: true },
      include: { mensagens: { orderBy: { criadoEm: "asc" } } },
    });
  }

  // Usado para descartar webhooks reentregues pela Evolution API.
  existeMensagemWa(waMessageId) {
    if (!waMessageId) return Promise.resolve(null);
    return prisma.mensagem.findUnique({
      where: { waMessageId },
      select: { id: true },
    });
  }

  countByStatus() {
    return prisma.conversa.groupBy({
      by: ["statusAtendimento"],
      _count: { id: true },
    });
  }
}

module.exports = new ConversaRepository();
