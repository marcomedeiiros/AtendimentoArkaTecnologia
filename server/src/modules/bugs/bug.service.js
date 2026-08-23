const relatoBugRepository = require("../../infrastructure/repositories/relatoBug.repository");
const { mapRelatoBug } = require("../../shared/helpers/mapper.helper");
const { validarImagensBug } = require("./bug.imagens");
const AppError = require("../../shared/errors/AppError");
const logger = require("../../config/logger");

const PRIORIDADES = ["baixa", "media", "alta", "critica"];

class BugService {
  // Cria o relato. O autor NAO vem do corpo: e derivado do token (quem esta
  // logado), para ninguem forjar autoria de outra pessoa. As imagens passam
  // pela validacao de seguranca (whitelist de tipo + magic bytes) antes de
  // serem guardadas -- ver bug.imagens.js.
  async criar({ descricao, pagina, imagens, prioridade }, autor) {
    const imagensValidadas = validarImagensBug(imagens);
    const relato = await relatoBugRepository.create({
      descricao: descricao.trim(),
      pagina: pagina ? pagina.trim() : null,
      imagens: imagensValidadas,
      prioridade: prioridade || "media",
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

  /**
   * Edicao do relato na triagem: corrigir o texto e reajustar a prioridade.
   *
   * A allowlist e reconferida AQUI, e nao apenas no DTO: assim esta rota nunca
   * vira um caminho de escrita livre na tabela, mesmo se um dia alguem chamar o
   * service de outro lugar sem passar pelo zod. Autoria, pagina, prints e data
   * ficam intocados de proposito -- eles registram de onde e de quem veio o
   * problema, e reescrever isso apagaria a rastreabilidade do relato.
   */
  async atualizar(id, dados) {
    const relato = await relatoBugRepository.findById(id);
    if (!relato) throw new AppError("Relato nao encontrado", 404, "NOT_FOUND");

    const data = {};

    if (dados.descricao !== undefined) {
      const descricao = String(dados.descricao).trim();
      if (descricao.length < 5) {
        throw new AppError("Descreva o problema com pelo menos 5 caracteres", 400, "INVALID_DESCRIPTION");
      }
      if (descricao.length > 4000) {
        throw new AppError("Descricao muito longa", 400, "INVALID_DESCRIPTION");
      }
      data.descricao = descricao;
    }

    if (dados.prioridade !== undefined) {
      if (!PRIORIDADES.includes(dados.prioridade)) {
        throw new AppError("Prioridade invalida", 400, "INVALID_PRIORITY");
      }
      data.prioridade = dados.prioridade;
    }

    // Prints: mesma validacao do criar -- whitelist raster, magic bytes apos
    // decodificar, teto por imagem e reserializacao a partir dos bytes
    // conferidos. Nada aqui confia no que o front declarou.
    //
    // A distincao entre AUSENTE e VAZIO e proposital: `undefined` nao mexe nos
    // prints existentes (editar so o texto nao pode apagar anexo), enquanto
    // null/[] remove todos porque foi pedido.
    if (dados.imagens !== undefined) {
      data.imagens = validarImagensBug(dados.imagens);
      logger.info("Prints do relato atualizados", {
        id,
        antes: Array.isArray(relato.imagens) ? relato.imagens.length : 0,
        depois: data.imagens ? data.imagens.length : 0,
      });
    }

    // Nada mudou: devolve o relato como esta em vez de gravar por gravar.
    if (Object.keys(data).length === 0) return mapRelatoBug(relato);

    const atualizado = await relatoBugRepository.update(id, data);
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
