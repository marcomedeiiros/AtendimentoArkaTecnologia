const crypto = require("crypto");
const prisma = require("../database/prisma.client");

// Monta os passos para gravar remapeando os ids do front para uuids novos,
// preservando as conexoes (targetId aponta para o novo id do bloco destino).
// Sem isso, o delete+recreate gerava ids novos e o targetId apontava para um
// id inexistente -> as ligacoes dos fios sumiam no reload.
function montarPassos(passos, fluxoId) {
  const idMap = new Map();
  passos.forEach((p) => {
    idMap.set(p.id || crypto.randomUUID(), crypto.randomUUID());
  });
  const ids = [...idMap.values()];
  const alvo = (antigo) => (antigo && idMap.get(antigo)) || null;

  return passos.map((p, index) => ({
    id: ids[index],
    fluxoId,
    tipo: p.tipo,
    titulo: p.titulo,
    descricao: p.descricao || p.desc || null,
    texto: p.texto || null,
    config: p.config || null,
    posX: p.x ?? p.posX ?? null,
    posY: p.y ?? p.posY ?? null,
    largura: p.w ?? p.largura ?? null,
    altura: p.h ?? p.altura ?? null,
    targetId: alvo(p.targetId),
    ordem: p.ordem ?? index,
  }));
}

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
      where: { ativo: true, gatilho: { equals: gatilho } },
      include: { passos: { orderBy: { ordem: "asc" } } },
    });
  }

  create(data, passos = []) {
    return prisma.$transaction(async (tx) => {
      const fluxo = await tx.fluxo.create({ data });
      if (passos.length) {
        await tx.passoFluxo.createMany({ data: montarPassos(passos, fluxo.id) });
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
          await tx.passoFluxo.createMany({ data: montarPassos(passos, id) });
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

  deleteAll() {
    return prisma.fluxo.deleteMany({});
  }

  createLog(data) {
    return prisma.logExecucaoFluxo.create({ data });
  }
}

module.exports = new FluxoRepository();
