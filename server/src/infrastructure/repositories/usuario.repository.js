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

  async criar({ nome, email, senhaHash, cargo }) {
    const total = await this.contar();
    const ePrimeiro = total === 0;
    return prisma.usuario.create({
      data: {
        nome,
        email,
        senhaHash,
        cargo: ePrimeiro ? "Administrador" : cargo || "Atendente",
        ativo: ePrimeiro ? true : false,
      },
      select: { id: true, nome: true, email: true, cargo: true, ativo: true },
    });
  }

  atualizarStatus(id, ativo) {
    return prisma.usuario.update({
      where: { id },
      data: { ativo: Boolean(ativo) },
      select: { id: true, nome: true, email: true, cargo: true, ativo: true },
    });
  }

  atualizarCargo(id, cargo) {
    return prisma.usuario.update({
      where: { id },
      data: { cargo },
      select: { id: true, nome: true, email: true, cargo: true, ativo: true },
    });
  }

  // So o hash muda. Nao devolve nada sensivel: quem chamou ja sabe de quem e a
  // conta, e o hash nunca deve sair do servidor.
  atualizarSenha(id, senhaHash) {
    return prisma.usuario.update({
      where: { id },
      data: { senhaHash },
      select: { id: true },
    });
  }

  contar() {
    return prisma.usuario.count();
  }

  // Administradores ATIVOS -- usado para nao deixar excluir/rebaixar o ultimo,
  // o que travaria a gestao (ninguem mais aprova, troca cargo ou exclui).
  contarAdminsAtivos() {
    return prisma.usuario.count({ where: { cargo: "Administrador", ativo: true } });
  }

  remover(id) {
    // Conversas atendidas por essa pessoa nao somem: o atendenteId vira null
    // (onDelete: SetNull no schema). So a conta e apagada.
    return prisma.usuario.delete({ where: { id } });
  }
}

module.exports = new UsuarioRepository();
