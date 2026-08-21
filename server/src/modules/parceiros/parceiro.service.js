const parceiroRepository = require("../../infrastructure/repositories/parceiro.repository");
const { mapParceiro } = require("../../shared/helpers/mapper.helper");
const { limparCnpj, cnpjValido } = require("../../shared/helpers/cnpj.helper");
const { TIPOS_CONTRATO } = require("./parceiro.dto");
const AppError = require("../../shared/errors/AppError");

// Normaliza a lista de contratos: so chaves conhecidas, sem repetir, na ordem
// canonica, e devolve string separada por virgula para o banco ("ti,backups").
function normalizarContratos(contratos) {
  if (!Array.isArray(contratos)) return "";
  const set = new Set(contratos);
  return TIPOS_CONTRATO.filter((c) => set.has(c)).join(",");
}

class ParceiroService {
  async listar(busca) {
    const itens = await parceiroRepository.findAll(busca);
    return itens.map(mapParceiro);
  }

  async criar({ cnpj, razaoSocial, email, telefones, cidades, contratos, status = "ativo" }) {
    const cnpjLimpo = limparCnpj(cnpj);
    if (!cnpjValido(cnpjLimpo)) {
      throw new AppError("CNPJ invalido", 400, "INVALID_CNPJ");
    }

    const parceiro = await parceiroRepository.upsert(cnpjLimpo, {
      razaoSocial: razaoSocial.trim(),
      email: email ? email.trim() : null,
      telefones: telefones ? telefones.trim() : null,
      cidades: cidades ? cidades.trim() : null,
      contratos: normalizarContratos(contratos),
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

  async atualizar(cnpj, { razaoSocial, email, telefones, cidades, contratos, status }) {
    const cnpjLimpo = limparCnpj(cnpj);
    const parceiro = await parceiroRepository.findByCnpj(cnpjLimpo);
    if (!parceiro) throw new AppError("Parceiro nao encontrado", 404, "NOT_FOUND");

    const atualizado = await parceiroRepository.upsert(cnpjLimpo, {
      razaoSocial: razaoSocial.trim(),
      email: email ? email.trim() : null,
      telefones: telefones ? telefones.trim() : null,
      cidades: cidades ? cidades.trim() : null,
      // So mexe em contratos quando o campo veio no corpo (evita zerar sem querer).
      ...(contratos !== undefined ? { contratos: normalizarContratos(contratos) } : {}),
      ...(status ? { status } : {}),
    });
    return mapParceiro(atualizado);
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
