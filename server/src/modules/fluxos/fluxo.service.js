const fluxoRepository = require("../../infrastructure/repositories/fluxo.repository");
const { mapFluxo } = require("../../shared/helpers/mapper.helper");
const { resumoAutomacoes } = require("./fluxo.automacao");
const AppError = require("../../shared/errors/AppError");

class FluxoService {
  /**
   * TODAS as automacoes do bot, fluxo a fluxo.
   *
   * Existe para responder de um lugar so a pergunta "o que o bot faz?". Antes,
   * a resposta estava espalhada entre variaveis de ambiente, a configuracao
   * global e textos embutidos no motor -- descobrir uma regra exigia ler
   * codigo. Agora cada regra sai do proprio fluxo (fluxo.automacao) e aparece
   * aqui com o valor que esta REALMENTE valendo.
   *
   * O estado ativo/pausado vem junto de proposito: fluxo pausado nao executa
   * nada, e essa e a primeira coisa que alguem precisa ver ao investigar "o bot
   * nao respondeu".
   */
  async resumoAutomacoes() {
    const fluxos = await fluxoRepository.findAll();
    return fluxos.map((f) => resumoAutomacoes(mapFluxo(f)));
  }

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

  async removerTodos() {
    await fluxoRepository.deleteAll();
    return { removidos: true };
  }
}

module.exports = new FluxoService();
