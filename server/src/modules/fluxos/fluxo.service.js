const fluxoRepository = require("../../infrastructure/repositories/fluxo.repository");
const { mapFluxo } = require("../../shared/helpers/mapper.helper");
const AppError = require("../../shared/errors/AppError");

class FluxoService {
  async listar() {
    const fluxos = await fluxoRepository.findAll();
    return fluxos.map(mapFluxo);
  }

  async obter(id) {
    const fluxo = await fluxoRepository.findById(id);
    if (!fluxo) throw new AppError("Fluxo nao encontrado", 404, "NOT_FOUND");
    return mapFluxo(fluxo);
  }

  async criar(data) {
    const { passos, ...fluxoData } = data;
    const fluxo = await fluxoRepository.create(fluxoData, passos || []);
    return mapFluxo(fluxo);
  }

  async atualizar(id, data) {
    const existente = await fluxoRepository.findById(id);
    if (!existente) throw new AppError("Fluxo nao encontrado", 404, "NOT_FOUND");

    const { passos, ...fluxoData } = data;
    const fluxo = await fluxoRepository.update(id, fluxoData, passos);
    return mapFluxo(fluxo);
  }

  async remover(id) {
    const existente = await fluxoRepository.findById(id);
    if (!existente) throw new AppError("Fluxo nao encontrado", 404, "NOT_FOUND");
    await fluxoRepository.delete(id);
    return { removido: true };
  }
}

module.exports = new FluxoService();
