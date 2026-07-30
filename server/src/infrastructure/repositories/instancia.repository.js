const prisma = require("../database/prisma.client");

class InstanciaRepository {
  findByNome(nome) {
    return prisma.instancia.findUnique({ where: { nome } });
  }

  findById(id) {
    return prisma.instancia.findUnique({ where: { id } });
  }

  updateConectado(id, conectado) {
    return prisma.instancia.update({ where: { id }, data: { conectado } });
  }

  // Usado ao criar a instancia pela tela: espelha o nome no banco para o
  // webhook/chatbot conseguirem resolver a instancia depois.
  create({ nome, conectado = false, webhookSecret }) {
    return prisma.instancia.create({ data: { nome, conectado, webhookSecret } });
  }
}

module.exports = new InstanciaRepository();
