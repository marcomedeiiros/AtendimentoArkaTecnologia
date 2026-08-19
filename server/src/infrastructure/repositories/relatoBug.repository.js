const prisma = require("../database/prisma.client");

class RelatoBugRepository {
  findAll(status) {
    const where = status ? { status } : {};
    return prisma.relatoBug.findMany({ where, orderBy: { criadoEm: "desc" } });
  }

  findById(id) {
    return prisma.relatoBug.findUnique({ where: { id } });
  }

  create(data) {
    return prisma.relatoBug.create({ data });
  }

  updateStatus(id, status) {
    return prisma.relatoBug.update({ where: { id }, data: { status } });
  }

  delete(id) {
    return prisma.relatoBug.delete({ where: { id } });
  }

  contarAbertos() {
    return prisma.relatoBug.count({ where: { status: "aberto" } });
  }
}

module.exports = new RelatoBugRepository();
