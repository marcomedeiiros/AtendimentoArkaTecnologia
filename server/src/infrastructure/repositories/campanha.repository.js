const prisma = require("../database/prisma.client");

class CampanhaRepository {
  criar(dados, destinatarios) {
    return prisma.campanha.create({
      data: {
        ...dados,
        total: destinatarios.length,
        destinatarios: {
          create: destinatarios.map((d, i) => ({
            nome: d.nome || null,
            telefone: d.telefone,
            ordem: i,
          })),
        },
      },
      include: { destinatarios: { orderBy: { ordem: "asc" } } },
    });
  }

  findById(id) {
    return prisma.campanha.findUnique({
      where: { id },
      include: { destinatarios: { orderBy: { ordem: "asc" } } },
    });
  }

  // Cabecalho da campanha, sem a lista de destinatarios (a tela lista muitas).
  findByIdBasico(id) {
    return prisma.campanha.findUnique({ where: { id } });
  }

  listar(limite = 20) {
    return prisma.campanha.findMany({
      orderBy: { criadoEm: "desc" },
      take: limite,
    });
  }

  atualizar(id, dados) {
    return prisma.campanha.update({ where: { id }, data: dados });
  }

  remover(id) {
    return prisma.campanha.delete({ where: { id } });
  }

  // Proximo destinatario pendente, na ordem original.
  proximoPendente(campanhaId) {
    return prisma.campanhaDestinatario.findFirst({
      where: { campanhaId, status: "pendente" },
      orderBy: { ordem: "asc" },
    });
  }

  marcarDestinatario(id, status, erro = null) {
    return prisma.campanhaDestinatario.update({
      where: { id },
      data: { status, erro, enviadoEm: new Date() },
    });
  }

  // Existe alguma campanha em andamento? Impede duas rajadas simultaneas.
  emAndamento() {
    return prisma.campanha.findFirst({ where: { status: "enviando" } });
  }

  // Ao subir o servidor, campanhas que ficaram "enviando" (queda/restart) sao
  // pausadas: retomar e uma decisao humana, nao um disparo surpresa.
  pausarOrfas() {
    return prisma.campanha.updateMany({
      where: { status: "enviando" },
      data: { status: "pausada" },
    });
  }
}

module.exports = new CampanhaRepository();
