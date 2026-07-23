const prisma = require("../database/prisma.client");

class ConversaRepository {
  findAll(filtros = {}) {
    const where = {};
    if (filtros.status) where.statusAtendimento = filtros.status;
    if (filtros.instanciaId) where.instanciaId = filtros.instanciaId;
    if (filtros.busca) {
      where.OR = [
        { cliente: { contains: filtros.busca, mode: "insensitive" } },
        { telefone: { contains: filtros.busca } },
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
        statusAtendimento: { in: ["aguardando", "em_atendimento"] },
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

  addMensagem(conversaId, origem, texto, metadata = null) {
    return prisma.mensagem.create({
      data: { conversaId, origem, texto, metadata },
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
