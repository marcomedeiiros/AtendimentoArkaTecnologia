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
}

module.exports = new UsuarioRepository();
