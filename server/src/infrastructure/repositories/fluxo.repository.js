const prisma = require("../database/prisma.client");

class FluxoRepository {
  findAll() {
    return prisma.fluxo.findMany({
      include: { passos: { orderBy: { ordem: "asc" } } },
      orderBy: { nome: "asc" },
    });
  }

  findById(id) {
    return prisma.fluxo.findUnique({
      where: { id },
      include: { passos: { orderBy: { ordem: "asc" } } },
    });
  }

  findAtivos() {
    return prisma.fluxo.findMany({
      where: { ativo: true },
      include: { passos: { orderBy: { ordem: "asc" } } },
    });
  }

  findByGatilho(gatilho) {
    return prisma.fluxo.findFirst({
      where: { ativo: true, gatilho: { equals: gatilho, mode: "insensitive" } },
      include: { passos: { orderBy: { ordem: "asc" } } },
    });
  }

  create(data, passos = []) {
    return prisma.$transaction(async (tx) => {
      const fluxo = await tx.fluxo.create({ data });
      if (passos.length) {
        await tx.passoFluxo.createMany({
          data: passos.map((p, index) => ({
            fluxoId: fluxo.id,
            tipo: p.tipo,
            titulo: p.titulo,
            descricao: p.descricao || p.desc || null,
            texto: p.texto || null,
            config: p.config || null,
            posX: p.x ?? p.posX ?? null,
            posY: p.y ?? p.posY ?? null,
            largura: p.w ?? p.largura ?? null,
            altura: p.h ?? p.altura ?? null,
            targetId: p.targetId || null,
            ordem: p.ordem ?? index,
          })),
        });
      }
      return tx.fluxo.findUnique({
        where: { id: fluxo.id },
        include: { passos: { orderBy: { ordem: "asc" } } },
      });
    });
  }

  update(id, data, passos) {
    return prisma.$transaction(async (tx) => {
      await tx.fluxo.update({ where: { id }, data });

      if (passos) {
        await tx.passoFluxo.deleteMany({ where: { fluxoId: id } });
        if (passos.length) {
          await tx.passoFluxo.createMany({
            data: passos.map((p, index) => ({
              fluxoId: id,
              tipo: p.tipo,
              titulo: p.titulo,
              descricao: p.descricao || p.desc || null,
              texto: p.texto || null,
              config: p.config || null,
              posX: p.x ?? p.posX ?? null,
              posY: p.y ?? p.posY ?? null,
              largura: p.w ?? p.largura ?? null,
              altura: p.h ?? p.altura ?? null,
              targetId: p.targetId || null,
              ordem: p.ordem ?? index,
            })),
          });
        }
      }

      return tx.fluxo.findUnique({
        where: { id },
        include: { passos: { orderBy: { ordem: "asc" } } },
      });
    });
  }

  delete(id) {
    return prisma.fluxo.delete({ where: { id } });
  }

  createLog(data) {
    return prisma.logExecucaoFluxo.create({ data });
  }
}

module.exports = new FluxoRepository();
