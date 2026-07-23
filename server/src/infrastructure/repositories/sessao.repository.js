const prisma = require("../database/prisma.client");

class SessaoRepository {
  findByTelefone(instanciaId, telefone) {
    return prisma.sessaoChatbot.findUnique({
      where: { instanciaId_telefone: { instanciaId, telefone } },
    });
  }

  findByConversa(conversaId) {
    return prisma.sessaoChatbot.findUnique({ where: { conversaId } });
  }

  upsert(instanciaId, conversaId, telefone, data = {}) {
    return prisma.sessaoChatbot.upsert({
      where: { instanciaId_telefone: { instanciaId, telefone } },
      update: data,
      create: {
        instanciaId,
        conversaId,
        telefone,
        ...data,
      },
    });
  }

  update(id, data) {
    return prisma.sessaoChatbot.update({ where: { id }, data });
  }
}

module.exports = new SessaoRepository();
