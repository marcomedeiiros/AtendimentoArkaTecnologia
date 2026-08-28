const prisma = require("../database/prisma.client");

class SessaoRepository {
  findByTelefone(instanciaId, telefone) {
    return prisma.sessaoChatbot.findUnique({
      where: { instanciaId_telefone: { instanciaId, telefone } },
    });
  }

  findByConversa(conversaId) {
    return prisma.sessaoChatbot.findUnique({ where: { conversaId } });
  }

  upsert(instanciaId, conversaId, telefone, data = {}) {
    return prisma.sessaoChatbot.upsert({
      where: { instanciaId_telefone: { instanciaId, telefone } },
      update: data,
      create: {
        instanciaId,
        conversaId,
        telefone,
        contexto: data.contexto ?? {},
        ...data,
      },
    });
  }

  update(id, data) {
    return prisma.sessaoChatbot.update({ where: { id }, data });
  }

  /**
   * REIVINDICA O ENCERRAMENTO POR INATIVIDADE -- uma vez, e so uma.
   *
   * `updateMany` com o estado esperado no WHERE, e nao `update` por id: e o UPDATE
   * que decide, nao um `if` em memoria. Duas varreduras sobrepostas (restart no
   * meio do prazo, duas replicas da API, varredura anterior que demorou mais que
   * o intervalo de 60s) chegam aqui com a mesma sessao; a primeira leva
   * `count: 1` e envia, a segunda leva `count: 0` e sai calada.
   *
   * `aguardandoDesde` entra no WHERE porque a reivindicacao vale para AQUELA
   * pergunta: se o bot perguntou de novo nesse meio-tempo, o carimbo mudou e esta
   * reivindicacao nao se aplica mais.
   *
   * @returns {Promise<{count:number}>} `count: 1` = ganhou o direito de encerrar.
   */
  reivindicarInatividade(id, aguardandoDesde) {
    return prisma.sessaoChatbot.updateMany({
      where: { id, ativo: true, inatividadeEm: null, concluidoEm: null, aguardandoDesde },
      data: { inatividadeEm: new Date() },
    });
  }
}

module.exports = new SessaoRepository();
