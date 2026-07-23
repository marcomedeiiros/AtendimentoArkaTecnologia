const parceiroRepository = require("../../infrastructure/repositories/parceiro.repository");
const { mapParceiro } = require("../../shared/helpers/mapper.helper");
const { limparCnpj, cnpjValido } = require("../../shared/helpers/cnpj.helper");
const AppError = require("../../shared/errors/AppError");

class ParceiroService {
  async listar() {
    const itens = await parceiroRepository.findAll();
    return itens.map(mapParceiro);
  }

  async criar({ cnpj, razaoSocial, status = "ativo" }) {
    const cnpjLimpo = limparCnpj(cnpj);
    if (!cnpjValido(cnpjLimpo)) {
      throw new AppError("CNPJ invalido", 400, "INVALID_CNPJ");
    }

    const parceiro = await parceiroRepository.upsert(cnpjLimpo, {
      razaoSocial: razaoSocial.trim(),
      status,
    });
    return mapParceiro(parceiro);
  }

  async validar(cnpj) {
    const cnpjLimpo = limparCnpj(cnpj);
    if (!cnpjValido(cnpjLimpo)) {
      throw new AppError("CNPJ invalido", 400, "INVALID_CNPJ");
    }

    const parceiro = await parceiroRepository.findAtivoByCnpj(cnpjLimpo);
    return {
      cnpj: cnpjLimpo,
      valido: true,
      parceiroAtivo: !!parceiro,
      parceiro: parceiro ? mapParceiro(parceiro) : null,
    };
  }

  async alternarStatus(cnpj) {
    const cnpjLimpo = limparCnpj(cnpj);
    const parceiro = await parceiroRepository.findByCnpj(cnpjLimpo);
    if (!parceiro) throw new AppError("Parceiro nao encontrado", 404, "NOT_FOUND");

    const atualizado = await parceiroRepository.upsert(cnpjLimpo, {
      status: parceiro.status === "ativo" ? "inativo" : "ativo",
    });
    return mapParceiro(atualizado);
  }

  async remover(cnpj) {
    const cnpjLimpo = limparCnpj(cnpj);
    const parceiro = await parceiroRepository.findByCnpj(cnpjLimpo);
    if (!parceiro) throw new AppError("Parceiro nao encontrado", 404, "NOT_FOUND");
    await parceiroRepository.delete(cnpjLimpo);
    return { removido: true };
  }
}

module.exports = new ParceiroService();
