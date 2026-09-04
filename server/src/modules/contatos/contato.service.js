const contatoRepository = require("../../infrastructure/repositories/contato.repository");
const evolutionApi = require("../../infrastructure/external/evolution-api.client");
const { mapContato } = require("../../shared/helpers/mapper.helper");
const { limparTelefone } = require("../../shared/helpers/cnpj.helper");
const logger = require("../../config/logger");
const AppError = require("../../shared/errors/AppError");
const bus = require("../../shared/events/event-bus");

// Telefone comparavel: so digitos e SEM o DDI 55. A agenda importada grava
// 5527999990000 e a conversa pode ter so 27999990000 (ou o contrario) -- sem
// tirar o DDI dos dois lados, o mesmo numero nao casa consigo mesmo. Mesma
// regra do `telefoneComparavel` da tela (client/src/utils/busca.js).
function comparavel(v) {
  const d = String(v || "").replace(/\D/g, "");
  return d.length > 11 && d.startsWith("55") ? d.slice(2) : d;
}

class ContatoService {
  /**
   * A agenda, com a foto de perfil de cada um.
   *
   * ── DE ONDE VEM A FOTO, E POR QUE DE DOIS LUGARES ──────────────────────────
   *
   * O link de foto do WhatsApp VENCE em poucos dias e passa a devolver 403.
   * Quem cuida disso hoje e `conversa.fotos.js`, que varre as CONVERSAS em
   * segundo plano e renova o link. Entao a foto guardada numa conversa e, por
   * construcao, mais fresca do que a que a sincronizacao da agenda gravou --
   * essa envelhece parada ate alguem sincronizar de novo.
   *
   * Por isso a conversa manda quando existe, e o campo do contato e a reserva
   * para quem NUNCA escreveu para o numero (foi importado da agenda e nao tem
   * conversa nenhuma). O merge e feito aqui, e nao no banco, porque telefone
   * nao e chave estrangeira entre as duas tabelas -- a agenda guarda o numero
   * como texto, e a comparacao precisa ignorar o DDI.
   *
   * Custo: UMA consulta a mais, de dois campos, sem `include` nem `join`.
   */
  async listar(filtros) {
    const itens = await contatoRepository.findAll(filtros);
    const fotos = await contatoRepository.fotosDasConversas();
    return itens.map((c) =>
      mapContato({ ...c, fotoUrl: fotos.get(comparavel(c.telefone)) || c.fotoUrl || null })
    );
  }

  async criar(data) {
    const telefone = limparTelefone(data.telefone);
    if (telefone.length < 10) {
      throw new AppError("Telefone invalido", 400, "INVALID_PHONE");
    }

    const contato = await contatoRepository.create({ ...data, telefone });
    // A agenda e compartilhada: quem esta com a tela aberta rele pelo SSE, em
    // vez de so descobrir o contato novo no proximo F5.
    bus.emitRecurso("contatos");
    return mapContato(contato);
  }

  async atualizar(id, data) {
    const existente = await contatoRepository.findById(id);
    if (!existente) throw new AppError("Contato nao encontrado", 404, "NOT_FOUND");

    const payload = { ...data };
    if (data.telefone) payload.telefone = limparTelefone(data.telefone);

    const contato = await contatoRepository.update(id, payload);
    bus.emitRecurso("contatos");
    return mapContato(contato);
  }

  async remover(id) {
    const existente = await contatoRepository.findById(id);
    if (!existente) throw new AppError("Contato nao encontrado", 404, "NOT_FOUND");
    await contatoRepository.delete(id);
    bus.emitRecurso("contatos");
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
      // A Evolution nomeia este campo de um jeito diferente conforme a versao;
      // lemos os tres em vez de apostar num. Sem foto, fica `null` e a tela
      // desenha o boneco cinza -- que e a resposta honesta.
      const foto =
        bruto?.profilePicUrl || bruto?.profilePictureUrl || bruto?.picture || null;
      const existente = await contatoRepository.findByTelefone(telefone);

      if (!existente) {
        await contatoRepository.create({ nome, telefone, tag: "cliente", fotoUrl: foto });
        criados += 1;
      } else {
        const mudancas = {};
        // So completa o nome de quem ainda estava sem: nao mexe no que foi editado.
        if (existente.nome === existente.telefone && nome !== telefone) mudancas.nome = nome;
        // A FOTO, ao contrario do nome, e sempre atualizada: ela nao e um campo
        // que alguem edita aqui -- e um retrato do WhatsApp, e o link antigo
        // vence. Preservar o velho seria preservar um 403.
        if (foto && foto !== existente.fotoUrl) mudancas.fotoUrl = foto;
        if (Object.keys(mudancas).length > 0) {
          await contatoRepository.update(existente.id, mudancas);
          atualizados += 1;
        }
      }
    }

    if (criados || atualizados) bus.emitRecurso("contatos");
    logger.info("Contatos sincronizados do WhatsApp", { criados, atualizados, ignorados });
    return { total: brutos.length, criados, atualizados, ignorados };
  }
}

module.exports = new ContatoService();
