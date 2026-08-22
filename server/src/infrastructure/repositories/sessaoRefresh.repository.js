const prisma = require("../database/prisma.client");

class SessaoRefreshRepository {
  // Uma linha por token emitido. `familia` liga todas as rotacoes da MESMA
  // sessao -- e por familia que se revoga no logout e na deteccao de reuso.
  criar({ familia, familiaCriadaEm, tokenHash, usuarioId, expiraEm }) {
    return prisma.sessaoRefresh.create({
      data: { familia, familiaCriadaEm, tokenHash, usuarioId, expiraEm },
    });
  }

  // A busca e sempre pelo HASH: o token em claro nunca e guardado.
  findByHash(tokenHash) {
    return prisma.sessaoRefresh.findUnique({ where: { tokenHash } });
  }

  // A sessao (familia) ainda existe? E o que o authMiddleware pergunta para o
  // token de acesso revogado no logout parar de valer na hora. Exige linha
  // VIVA: nao revogada e dentro do prazo -- familia so com linha vencida esta
  // morta, e o token de acesso dela nao deve mais passar.
  async familiaAtiva(familia) {
    if (!familia) return false;
    const total = await prisma.sessaoRefresh.count({
      where: { familia, revogadoEm: null, expiraEm: { gt: new Date() } },
    });
    return total > 0;
  }

  // Quantas linhas da familia nasceram DEPOIS desta. E o que separa o duplicado
  // honesto do replay: a linha apresentada tem de ser a penultima (exatamente
  // uma sucessora). Um token de rotacoes atras tem duas ou mais, e ai nao e
  // "outra aba mandando junto" -- e copia antiga voltando.
  contarPosteriores(familia, criadoEm) {
    return prisma.sessaoRefresh.count({ where: { familia, criadoEm: { gt: criadoEm } } });
  }

  // Familias vivas de uma conta, da mais antiga para a mais nova. Sustenta o
  // teto de sessoes simultaneas.
  async familiasVivasDoUsuario(usuarioId) {
    const linhas = await prisma.sessaoRefresh.findMany({
      where: { usuarioId, revogadoEm: null, expiraEm: { gt: new Date() } },
      orderBy: { criadoEm: "asc" },
      select: { familia: true },
    });
    return [...new Set(linhas.map((l) => l.familia))];
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

  // Todas as sessoes de uma conta -- usado quando a conta e desativada,
  // excluida, tem a senha redefinida por um admin ou trocada pela propria
  // pessoa. `exceto` preserva UMA familia (a de quem esta fazendo a acao),
  // para trocar a propria senha nao derrubar a si mesmo.
  revogarDoUsuario(usuarioId, exceto = null) {
    return prisma.sessaoRefresh.updateMany({
      where: {
        usuarioId,
        revogadoEm: null,
        ...(exceto ? { familia: { not: exceto } } : {}),
      },
      data: { revogadoEm: new Date() },
    });
  }

  // Faxina: linha vencida, revogada ou JA GASTA nao serve mais para nada, e a
  // tabela cresce um registro por renovacao. A gasta so sai depois da janela de
  // tolerancia -- antes dela, ela ainda precisa existir para o duplicado
  // honesto de duas abas ser reconhecido (e nao virar "token desconhecido").
  limparVencidas(toleranciaMs = 60_000) {
    const agora = new Date();
    return prisma.sessaoRefresh.deleteMany({
      where: {
        OR: [
          { expiraEm: { lt: agora } },
          { revogadoEm: { not: null } },
          { usadoEm: { lt: new Date(agora.getTime() - toleranciaMs) } },
        ],
      },
    });
  }
}

module.exports = new SessaoRefreshRepository();
