const prisma = require("../database/prisma.client");

class SessaoRefreshRepository {
  // Uma linha por token emitido. `familia` liga todas as rotacoes da MESMA
  // sessao -- e por familia que se revoga no logout e na deteccao de reuso.
  criar({ familia, tokenHash, usuarioId, expiraEm }) {
    return prisma.sessaoRefresh.create({ data: { familia, tokenHash, usuarioId, expiraEm } });
  }

  // A busca e sempre pelo HASH: o token em claro nunca e guardado.
  findByHash(tokenHash) {
    return prisma.sessaoRefresh.findUnique({ where: { tokenHash } });
  }

  // A sessao (familia) ainda existe? E o que o authMiddleware pergunta para o
  // token de acesso revogado no logout parar de valer na hora. Uma familia viva
  // tem sempre pelo menos a linha mais nova sem revogacao.
  async familiaAtiva(familia) {
    if (!familia) return false;
    const total = await prisma.sessaoRefresh.count({ where: { familia, revogadoEm: null } });
    return total > 0;
  }

  marcarUsado(id) {
    return prisma.sessaoRefresh.update({ where: { id }, data: { usadoEm: new Date() } });
  }

  // Revoga a sessao inteira: logout e deteccao de reuso passam por aqui.
  // updateMany (e nao update) porque a familia tem varias linhas e nenhuma
  // delas e chave unica.
  revogarFamilia(familia) {
    return prisma.sessaoRefresh.updateMany({
      where: { familia, revogadoEm: null },
      data: { revogadoEm: new Date() },
    });
  }

  // Todas as sessoes de uma conta (usado quando a conta e desativada/excluida).
  revogarDoUsuario(usuarioId) {
    return prisma.sessaoRefresh.updateMany({
      where: { usuarioId, revogadoEm: null },
      data: { revogadoEm: new Date() },
    });
  }

  // Faxina: linha vencida ou revogada nao serve mais para nada e a tabela
  // cresce um registro por renovacao. Chamado no boot (ver server.js).
  limparVencidas() {
    return prisma.sessaoRefresh.deleteMany({
      where: { OR: [{ expiraEm: { lt: new Date() } }, { revogadoEm: { not: null } }] },
    });
  }
}

module.exports = new SessaoRefreshRepository();
