const prisma = require("../database/prisma.client");

class MensagemRapidaRepository {
  findAll() {
    return prisma.mensagemRapida.findMany({ orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }] });
  }

  findById(id) {
    return prisma.mensagemRapida.findUnique({ where: { id } });
  }

  create(data) {
    return prisma.mensagemRapida.create({ data });
  }

  update(id, data) {
    return prisma.mensagemRapida.update({ where: { id }, data });
  }

  delete(id) {
    return prisma.mensagemRapida.delete({ where: { id } });
  }

  count() {
    return prisma.mensagemRapida.count();
  }

  createMany(itens) {
    return prisma.mensagemRapida.createMany({ data: itens });
  }
}

module.exports = new MensagemRapidaRepository();
