const contatoRepository = require("../../infrastructure/repositories/contato.repository");
const { mapContato } = require("../../shared/helpers/mapper.helper");
const { limparTelefone } = require("../../shared/helpers/cnpj.helper");
const AppError = require("../../shared/errors/AppError");

class ContatoService {
  async listar(filtros) {
    const itens = await contatoRepository.findAll(filtros);
    return itens.map(mapContato);
  }

  async criar(data) {
    const telefone = limparTelefone(data.telefone);
    if (telefone.length < 10) {
      throw new AppError("Telefone invalido", 400, "INVALID_PHONE");
    }

    const contato = await contatoRepository.create({ ...data, telefone });
    return mapContato(contato);
  }

  async atualizar(id, data) {
    const existente = await contatoRepository.findById(id);
    if (!existente) throw new AppError("Contato nao encontrado", 404, "NOT_FOUND");

    const payload = { ...data };
    if (data.telefone) payload.telefone = limparTelefone(data.telefone);

    const contato = await contatoRepository.update(id, payload);
    return mapContato(contato);
  }

  async remover(id) {
    const existente = await contatoRepository.findById(id);
    if (!existente) throw new AppError("Contato nao encontrado", 404, "NOT_FOUND");
    await contatoRepository.delete(id);
    return { removido: true };
  }
}

module.exports = new ContatoService();
