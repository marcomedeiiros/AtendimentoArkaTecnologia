const contatoRepository = require("../../infrastructure/repositories/contato.repository");
const evolutionApi = require("../../infrastructure/external/evolution-api.client");
const { mapContato } = require("../../shared/helpers/mapper.helper");
const { limparTelefone } = require("../../shared/helpers/cnpj.helper");
const logger = require("../../config/logger");
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

  /**
   * Importa a agenda real do WhatsApp (via Evolution) para a tabela de contatos.
   *
   * Contatos ja existentes NAO sao sobrescritos: quem foi editado a mao aqui
   * (empresa, tag, observacoes) continua intacto. Apenas preenchemos o nome
   * quando ele ainda e o proprio numero -- o placeholder de quem chegou pelo
   * WhatsApp antes de ter nome na agenda.
   */
  async sincronizarDoWhatsApp(instanceName) {
    let brutos = [];
    try {
      brutos = await evolutionApi.findContacts(instanceName);
    } catch (error) {
      throw new AppError(
        `Nao foi possivel ler a agenda do WhatsApp: ${error.message}`,
        502,
        "SYNC_CONTATOS_FALHOU"
      );
    }

    let criados = 0;
    let atualizados = 0;
    let ignorados = 0;

    for (const bruto of brutos) {
      const jid = bruto?.remoteJid || bruto?.id || "";
      // Grupos (@g.us) e transmissoes nao sao contatos.
      if (!jid.includes("@s.whatsapp.net")) { ignorados += 1; continue; }

      const telefone = limparTelefone(jid.split("@")[0]);
      if (telefone.length < 10) { ignorados += 1; continue; }

      const nome = String(bruto?.pushName || bruto?.name || "").trim() || telefone;
      const existente = await contatoRepository.findByTelefone(telefone);

      if (!existente) {
        await contatoRepository.create({ nome, telefone, tag: "cliente" });
        criados += 1;
      } else if (existente.nome === existente.telefone && nome !== telefone) {
        // So completa o nome de quem ainda estava sem: nao mexe no que foi editado.
        await contatoRepository.update(existente.id, { nome });
        atualizados += 1;
      }
    }

    logger.info("Contatos sincronizados do WhatsApp", { criados, atualizados, ignorados });
    return { total: brutos.length, criados, atualizados, ignorados };
  }
}

module.exports = new ContatoService();
