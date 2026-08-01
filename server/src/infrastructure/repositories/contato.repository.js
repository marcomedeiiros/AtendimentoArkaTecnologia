const prisma = require("../database/prisma.client");

class ContatoRepository {
  findAll(filtros = {}) {
    const where = {};
    if (filtros.tag) where.tag = filtros.tag;
    if (filtros.busca) {
      where.OR = [
        { nome: { contains: filtros.busca } },
        { telefone: { contains: filtros.busca } },
        { empresa: { contains: filtros.busca } },
      ];
    }

    return prisma.contato.findMany({ where, orderBy: { nome: "asc" } });
  }

  findById(id) {
    return prisma.contato.findUnique({ where: { id } });
  }

  // Usado pela sincronizacao da agenda do WhatsApp (telefone nao e unico no
  // schema, entao findFirst).
  findByTelefone(telefone) {
    return prisma.contato.findFirst({ where: { telefone } });
  }

  create(data) {
    return prisma.contato.create({ data });
  }

  update(id, data) {
    return prisma.contato.update({ where: { id }, data });
  }

  delete(id) {
    return prisma.contato.delete({ where: { id } });
  }
}

module.exports = new ContatoRepository();
