const prisma = require("../database/prisma.client");

class ParceiroRepository {
  findAll() {
    return prisma.parceiro.findMany({ orderBy: { razaoSocial: "asc" } });
  }

  findByCnpj(cnpj) {
    return prisma.parceiro.findUnique({ where: { cnpj } });
  }

  findAtivoByCnpj(cnpj) {
    return prisma.parceiro.findFirst({ where: { cnpj, status: "ativo" } });
  }

  upsert(cnpj, data) {
    return prisma.parceiro.upsert({
      where: { cnpj },
      update: data,
      create: { cnpj, ...data },
    });
  }

  delete(cnpj) {
    return prisma.parceiro.delete({ where: { cnpj } });
  }
}

module.exports = new ParceiroRepository();
