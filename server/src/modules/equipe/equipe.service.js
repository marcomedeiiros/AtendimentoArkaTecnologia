const equipeRepository = require("../../infrastructure/repositories/equipe.repository");
const { mapEquipe } = require("../../shared/helpers/mapper.helper");
const AppError = require("../../shared/errors/AppError");

class EquipeService {
  async listar() {
    const itens = await equipeRepository.findAll();
    return itens.map(mapEquipe);
  }

  async criar(data) {
    const membro = await equipeRepository.create(data);
    return mapEquipe(membro);
  }

  async atualizar(id, data) {
    const existente = await equipeRepository.findById(id);
    if (!existente) throw new AppError("Membro nao encontrado", 404, "NOT_FOUND");
    const membro = await equipeRepository.update(id, data);
    return mapEquipe(membro);
  }

  async remover(id) {
    const existente = await equipeRepository.findById(id);
    if (!existente) throw new AppError("Membro nao encontrado", 404, "NOT_FOUND");
    await equipeRepository.delete(id);
    return { removido: true };
  }
}

module.exports = new EquipeService();
