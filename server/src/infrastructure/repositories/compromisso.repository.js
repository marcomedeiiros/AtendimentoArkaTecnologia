const prisma = require("../database/prisma.client");

class CompromissoRepository {
  findAll() {
    return prisma.compromisso.findMany({ orderBy: [{ data: "asc" }, { hora: "asc" }] });
  }

  findById(id) {
    return prisma.compromisso.findUnique({ where: { id } });
  }

  create(data) {
    return prisma.compromisso.create({ data });
  }

  update(id, data) {
    return prisma.compromisso.update({ where: { id }, data });
  }

  delete(id) {
    return prisma.compromisso.delete({ where: { id } });
  }

  // Remove os concluidos com data anterior a `dataLimite` (YYYY-MM-DD).
  deleteConcluidosAntigos(dataLimite) {
    return prisma.compromisso.deleteMany({
      where: { concluido: true, data: { lt: dataLimite } },
    });
  }
}

module.exports = new CompromissoRepository();
