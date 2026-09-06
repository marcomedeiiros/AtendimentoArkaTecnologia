const parceiroRepository = require("../../infrastructure/repositories/parceiro.repository");
const conversaRepository = require("../../infrastructure/repositories/conversa.repository");
const logger = require("../../config/logger");
const { mapParceiro } = require("../../shared/helpers/mapper.helper");
const bus = require("../../shared/events/event-bus");
const { limparCnpj, documentoValido } = require("../../shared/helpers/cnpj.helper");
const { TIPOS_CONTRATO } = require("./parceiro.dto");
const AppError = require("../../shared/errors/AppError");
const midiaStorage = require("../../infrastructure/storage/midia.storage");
const { tipoDeImagemNoDisco } = require("../../shared/helpers/imagem.helper");

// Teto da logo. O front ja reduz a imagem antes de enviar (256px de lado, ver
// `prepararLogo` em ParceirosPage), entao 1 MB e folgado para o caso normal --
// ele existe para o caso ANORMAL: alguem chamando a API direto, sem passar pela
// tela, com um arquivo de camera de 40 MB.
const MAX_BYTES_LOGO = 1024 * 1024;

const SEM_LOGO = { logoPath: null, logoTipo: null, logoBytes: null, logoEm: null };

// Normaliza a lista de contratos: so chaves conhecidas, sem repetir, na ordem
// canonica, e devolve string separada por virgula para o banco ("ti,backups").
function normalizarContratos(contratos) {
  if (!Array.isArray(contratos)) return "";
  const set = new Set(contratos);
  return TIPOS_CONTRATO.filter((c) => set.has(c)).join(",");
}

class ParceiroService {
  /**
   * Grava (ou apaga) a logo e devolve as colunas a atualizar.
   *
   *   `undefined` -> o campo nem veio no corpo: NAO MEXE na logo atual.
   *   `null`      -> pedido explicito de remover.
   *   data URL    -> imagem nova.
   *
   * A diferenca entre os dois primeiros e o que impede a logo de sumir sozinha:
   * a tela de edicao salva razao social, e-mail, telefones e contratos de uma
   * vez, e sem essa distincao um `PUT` que nao fala de logo apagaria a que
   * estava la.
   *
   * O ARQUIVO ANTIGO SAI DO DISCO nos dois casos (troca e remocao). Limpar so a
   * coluna deixaria a imagem orfa em `dados/midia`, sem nada apontando para ela
   * e sem ninguem sabendo que existe -- ocupando espaco para sempre.
   */
  async _guardarLogo(entrada, atual = null) {
    if (entrada === undefined) return undefined;

    if (entrada === null) {
      if (atual?.logoPath) await midiaStorage.remover(atual.logoPath).catch(() => {});
      return { ...SEM_LOGO };
    }

    if (typeof entrada !== "string" || !entrada.trim()) return undefined;

    const salvo = await midiaStorage.salvarDataUrl(entrada, null, { maxBytes: MAX_BYTES_LOGO });
    if (!salvo) {
      throw new AppError(
        `Não foi possível guardar a logo. O arquivo precisa ter até ${Math.round(MAX_BYTES_LOGO / 1024)} KB.`,
        400,
        "LOGO_INVALIDA"
      );
    }

    // O QUE O ARQUIVO E, e nao como ele se chama: o mimetype da data URL veio
    // do navegador do cliente e nao decide nada aqui.
    const tipo = await tipoDeImagemNoDisco(salvo.arquivo);
    if (!tipo) {
      // Recusado depois de gravado: apaga na hora, senao fica um arquivo em
      // disco sem nenhuma linha no banco apontando para ele.
      await midiaStorage.remover(salvo.arquivo).catch(() => {});
      throw new AppError(
        "A logo precisa ser uma imagem PNG, JPG, WebP ou GIF.",
        400,
        "LOGO_NAO_E_IMAGEM"
      );
    }

    if (atual?.logoPath) await midiaStorage.remover(atual.logoPath).catch(() => {});

    return {
      logoPath: salvo.arquivo,
      logoTipo: tipo,
      logoBytes: salvo.bytes,
      logoEm: new Date(),
    };
  }

  /** Caminho e tipo da logo, para a rota que serve os bytes. */
  async logoDe(cnpj) {
    const parceiro = await parceiroRepository.findByCnpj(limparCnpj(cnpj));
    if (!parceiro?.logoPath) return null;
    return { caminho: parceiro.logoPath, tipo: parceiro.logoTipo, bytes: parceiro.logoBytes };
  }

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

  // NAO HA `desvincularContato` AQUI, e isso e a regra de negocio.
  //
  // Ele desmarcava um contato da empresa a mao (o "X" da tela Clientes/CNPJ),
  // limpando o CNPJ de todas as conversas daquele telefone. Quem sabe se o CNPJ
  // esta certo e o proprio cliente, e ele ja responde isso no fluxo do bot -- o
  // "NAO" em "o CNPJ continua sendo este?" desassocia a conversa dele, e so a
  // dele (chatbot.engine._desassociarCnpj). Ter as duas portas significava duas
  // regras disputando o mesmo vinculo, uma delas sem contexto nenhum.
  //
  // A listagem acima continua mostrando os contatos: saber QUEM fala pela
  // empresa e informacao util; poder apagar esse vinculo a mao e que nao era.

  async criar({ cnpj, razaoSocial, email, telefones, cidades, contratos, logo, status = "ativo" }) {
    const cnpjLimpo = limparCnpj(cnpj);
    if (!documentoValido(cnpjLimpo)) {
      throw new AppError("CPF ou CNPJ invalido", 400, "INVALID_CNPJ");
    }

    // `upsert`: cadastrar um CNPJ que ja existe SOBRESCREVE o cadastro. Le a
    // logo que estava la para o arquivo antigo sair do disco na troca.
    const existente = await parceiroRepository.findByCnpj(cnpjLimpo);
    const logoSalva = await this._guardarLogo(logo, existente);

    const parceiro = await parceiroRepository.upsert(cnpjLimpo, {
      razaoSocial: razaoSocial.trim(),
      email: email ? email.trim() : null,
      telefones: telefones ? telefones.trim() : null,
      cidades: cidades ? cidades.trim() : null,
      contratos: normalizarContratos(contratos),
      ...(logoSalva || {}),
      status,
    });
    // A lista de clientes mudou: quem esta com o painel aberto rele sozinho.
    bus.emitRecurso("parceiros");
    return mapParceiro(parceiro);
  }

  async validar(cnpj) {
    const cnpjLimpo = limparCnpj(cnpj);
    if (!documentoValido(cnpjLimpo)) {
      throw new AppError("CPF ou CNPJ invalido", 400, "INVALID_CNPJ");
    }

    const parceiro = await parceiroRepository.findAtivoByCnpj(cnpjLimpo);
    return {
      cnpj: cnpjLimpo,
      valido: true,
      parceiroAtivo: !!parceiro,
      parceiro: parceiro ? mapParceiro(parceiro) : null,
    };
  }

  async atualizar(cnpj, { razaoSocial, email, telefones, cidades, contratos, logo, status }) {
    const cnpjLimpo = limparCnpj(cnpj);
    const parceiro = await parceiroRepository.findByCnpj(cnpjLimpo);
    if (!parceiro) throw new AppError("Parceiro nao encontrado", 404, "NOT_FOUND");

    // Antes do upsert: se a imagem for recusada, nada foi gravado ainda e o
    // cadastro fica exatamente como estava.
    const logoSalva = await this._guardarLogo(logo, parceiro);

    const atualizado = await parceiroRepository.upsert(cnpjLimpo, {
      razaoSocial: razaoSocial.trim(),
      email: email ? email.trim() : null,
      telefones: telefones ? telefones.trim() : null,
      cidades: cidades ? cidades.trim() : null,
      // So mexe em contratos quando o campo veio no corpo (evita zerar sem querer).
      ...(contratos !== undefined ? { contratos: normalizarContratos(contratos) } : {}),
      // Mesma regra para a logo: campo ausente NAO e pedido de remocao.
      ...(logoSalva || {}),
      ...(status ? { status } : {}),
    });
    bus.emitRecurso("parceiros");
    return mapParceiro(atualizado);
  }

  async alternarStatus(cnpj) {
    const cnpjLimpo = limparCnpj(cnpj);
    const parceiro = await parceiroRepository.findByCnpj(cnpjLimpo);
    if (!parceiro) throw new AppError("Parceiro nao encontrado", 404, "NOT_FOUND");

    const atualizado = await parceiroRepository.upsert(cnpjLimpo, {
      status: parceiro.status === "ativo" ? "inativo" : "ativo",
    });
    bus.emitRecurso("parceiros");
    return mapParceiro(atualizado);
  }

  async remover(cnpj) {
    const cnpjLimpo = limparCnpj(cnpj);
    const parceiro = await parceiroRepository.findByCnpj(cnpjLimpo);
    if (!parceiro) throw new AppError("Parceiro nao encontrado", 404, "NOT_FOUND");
    // A logo vai junto: apagar so a linha deixaria a imagem no disco para
    // sempre, sem nada apontando para ela.
    if (parceiro.logoPath) await midiaStorage.remover(parceiro.logoPath).catch(() => {});
    await parceiroRepository.delete(cnpjLimpo);
    bus.emitRecurso("parceiros");
    return { removido: true };
  }
}

module.exports = new ParceiroService();
