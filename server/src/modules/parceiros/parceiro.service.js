const parceiroRepository = require("../../infrastructure/repositories/parceiro.repository");
const conversaRepository = require("../../infrastructure/repositories/conversa.repository");
const logger = require("../../config/logger");
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
    // Contatos do WhatsApp que ja informaram cada CNPJ: e o que liga a empresa
    // cadastrada as pessoas que falam por ela. Uma consulta so para a lista
    // inteira (sem N+1); se falhar, a lista sai sem os contatos.
    let porCnpj = new Map();
    try {
      porCnpj = await conversaRepository.contatosPorCnpj();
    } catch (e) {
      logger.warn("Falha ao carregar contatos por CNPJ", { message: e.message });
    }
    return itens.map((p) => ({
      ...mapParceiro(p),
      contatos: [...(porCnpj.get(limparCnpj(p.cnpj))?.values() || [])]
        .sort((a, b) => new Date(b.em) - new Date(a.em))
        .map(({ nome, telefone }) => ({ nome, telefone })),
    }));
  }

  // Desmarca um contato desta empresa: limpa o CNPJ das conversas daquele
  // telefone (o vinculo vem justamente dali). As conversas voltam para "CNPJ
  // pendente" -- util quando a pessoa informou o CNPJ errado.
  async desvincularContato(cnpj, telefone) {
    const cnpjLimpo = limparCnpj(cnpj);
    const tel = String(telefone || "").replace(/\D/g, "");
    if (!cnpjValido(cnpjLimpo)) throw new AppError("CNPJ invalido", 400, "INVALID_CNPJ");
    if (!tel) throw new AppError("Telefone invalido", 400, "TELEFONE_INVALIDO");

    const afetadas = await conversaRepository.limparCnpjDoContato(tel, cnpjLimpo);
    logger.info("Contato desvinculado do CNPJ", { cnpj: cnpjLimpo, telefone: tel, afetadas });
    return { desvinculado: true, conversasAfetadas: afetadas };
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
