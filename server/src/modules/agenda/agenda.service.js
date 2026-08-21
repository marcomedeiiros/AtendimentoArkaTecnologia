const repo = require("../../infrastructure/repositories/compromisso.repository");
const { mapCompromisso } = require("../../shared/helpers/mapper.helper");
const AppError = require("../../shared/errors/AppError");

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

class AgendaService {
  async listar() {
    const itens = await repo.findAll();
    return itens.map(mapCompromisso);
  }

  // O autor vem do token (nao do corpo), so para saber quem criou.
  async criar(dados, autor) {
    const criado = await repo.create({
      ...dados,
      usuarioId: autor?.sub || null,
      usuarioNome: autor?.nome || null,
    });
    return mapCompromisso(criado);
  }

  async atualizar(id, dados) {
    const existente = await repo.findById(id);
    if (!existente) throw new AppError("Compromisso nao encontrado", 404, "NOT_FOUND");
    // Nao mexe em usuarioId/usuarioNome: continua sendo de quem criou.
    const atualizado = await repo.update(id, dados);
    return mapCompromisso(atualizado);
  }

  async definirConcluido(id, concluido) {
    const existente = await repo.findById(id);
    if (!existente) throw new AppError("Compromisso nao encontrado", 404, "NOT_FOUND");
    const atualizado = await repo.update(id, { concluido });
    return mapCompromisso(atualizado);
  }

  async remover(id) {
    const existente = await repo.findById(id);
    if (!existente) throw new AppError("Compromisso nao encontrado", 404, "NOT_FOUND");
    await repo.delete(id);
    return { removido: true };
  }

  async limparConcluidosAntigos() {
    const r = await repo.deleteConcluidosAntigos(hojeISO());
    return { removidos: r.count };
  }
}

module.exports = new AgendaService();
