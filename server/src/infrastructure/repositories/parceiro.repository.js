const prisma = require("../database/prisma.client");

class ParceiroRepository {
  findAll(busca) {
    const where = busca ? {
      OR: [
        { razaoSocial: { contains: busca } },
        { cnpj: { contains: busca } },
      ],
    } : {};
    return prisma.parceiro.findMany({ where, orderBy: { razaoSocial: "asc" } });
  }

  findByCnpj(cnpj) {
    return prisma.parceiro.findUnique({ where: { cnpj } });
  }

  async findAtivoByCnpj(cnpj) {
    // Otimização: findUnique (usa PK/índice único) é mais rápido que findFirst
    // Valida status em memória depois
    const parceiro = await prisma.parceiro.findUnique({ where: { cnpj } });
    return parceiro?.status === "ativo" ? parceiro : null;
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
