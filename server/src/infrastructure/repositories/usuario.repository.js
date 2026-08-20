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
        // Conta nova entra como "Técnico" (papel comum). Precisa ser um dos
        // cargos que a tela de Equipe conhece (Administrador, Financeiro,
        // Técnico, Comercial) -- senao o <select> nao acha a opcao e exibe a
        // primeira ("Administrador"), dando a impressao de admin sem ser.
        cargo: ePrimeiro ? "Administrador" : cargo || "Técnico",
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

  // Edicao do proprio perfil (nome). NAO toca em cargo/ativo -- isso e gestao,
  // exclusiva de Administrador em outro fluxo.
  atualizarNome(id, nome) {
    return prisma.usuario.update({
      where: { id },
      data: { nome },
      select: { id: true, nome: true, email: true, cargo: true, ativo: true },
    });
  }

  // Hash atual, so para conferir a senha antiga antes de trocar. Fica isolado
  // para o hash nunca vazar junto de findById/listagens.
  senhaHashDe(id) {
    return prisma.usuario.findUnique({ where: { id }, select: { senhaHash: true } });
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
