const prisma = require("../database/prisma.client");

class InstanciaRepository {
  findByNome(nome) {
    return prisma.instancia.findUnique({ where: { nome } });
  }

  findById(id) {
    return prisma.instancia.findUnique({ where: { id } });
  }

  updateConectado(id, conectado) {
    return prisma.instancia.update({ where: { id }, data: { conectado } });
  }
}

module.exports = new InstanciaRepository();
