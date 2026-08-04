const prisma = require("../database/prisma.client");

class UsuarioRepository {
  findByEmail(email) {
    return prisma.usuario.findUnique({ where: { email } });
  }

  findById(id) {
    return prisma.usuario.findUnique({
      where: { id },
      select: { id: true, nome: true, email: true, cargo: true, ativo: true },
    });
  }

  criar({ nome, email, senhaHash, cargo }) {
    return prisma.usuario.create({
      data: { nome, email, senhaHash, cargo: cargo || "Atendente" },
      select: { id: true, nome: true, email: true, cargo: true, ativo: true },
    });
  }

  contar() {
    return prisma.usuario.count();
  }
}

module.exports = new UsuarioRepository();
