const prisma = require("../database/prisma.client");

class EquipeRepository {
  findAll() {
    return prisma.equipe.findMany({ orderBy: { nome: "asc" } });
  }

  create(data) {
    return prisma.equipe.create({ data });
  }

  update(id, data) {
    return prisma.equipe.update({ where: { id }, data });
  }

  delete(id) {
    return prisma.equipe.delete({ where: { id } });
  }

  findById(id) {
    return prisma.equipe.findUnique({ where: { id } });
  }
}

module.exports = new EquipeRepository();
