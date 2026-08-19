const relatoBugRepository = require("../../infrastructure/repositories/relatoBug.repository");
const { mapRelatoBug } = require("../../shared/helpers/mapper.helper");
const AppError = require("../../shared/errors/AppError");

class BugService {
  // Cria o relato. O autor NAO vem do corpo: e derivado do token (quem esta
  // logado), para ninguem forjar autoria de outra pessoa.
  async criar({ descricao, pagina }, autor) {
    const relato = await relatoBugRepository.create({
      descricao: descricao.trim(),
      pagina: pagina ? pagina.trim() : null,
      usuarioId: autor?.sub || null,
      usuarioNome: autor?.nome || null,
      usuarioEmail: autor?.email || null,
    });
    return mapRelatoBug(relato);
  }

  async listar(status) {
    const itens = await relatoBugRepository.findAll(status);
    return itens.map(mapRelatoBug);
  }

  async atualizarStatus(id, status) {
    const relato = await relatoBugRepository.findById(id);
    if (!relato) throw new AppError("Relato nao encontrado", 404, "NOT_FOUND");
    const atualizado = await relatoBugRepository.updateStatus(id, status);
    return mapRelatoBug(atualizado);
  }

  async remover(id) {
    const relato = await relatoBugRepository.findById(id);
    if (!relato) throw new AppError("Relato nao encontrado", 404, "NOT_FOUND");
    await relatoBugRepository.delete(id);
    return { removido: true };
  }
}

module.exports = new BugService();
