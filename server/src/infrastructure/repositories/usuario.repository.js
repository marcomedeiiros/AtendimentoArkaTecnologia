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

  // Todo mundo que tem conta, na ordem em que entrou. Sem senhaHash: esta lista
  // vai para a tela de Gestao da Equipe.
  listarTodos() {
    return prisma.usuario.findMany({
      orderBy: { criadoEm: "asc" },
      select: {
        id: true, nome: true, email: true, cargo: true,
        ativo: true, ultimoAcessoEm: true, criadoEm: true,
      },
    });
  }

  marcarAcesso(id) {
    return prisma.usuario.update({
      where: { id },
      data: { ultimoAcessoEm: new Date() },
      select: { id: true },
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
