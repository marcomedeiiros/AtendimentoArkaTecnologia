const conversaRepository = require("../../infrastructure/repositories/conversa.repository");
const instanciaRepository = require("../../infrastructure/repositories/instancia.repository");
const evolutionApi = require("../../infrastructure/external/evolution-api.client");
const { mapConversa } = require("../../shared/helpers/mapper.helper");
const { limparCnpj, cnpjValido, mascararCnpj } = require("../../shared/helpers/cnpj.helper");
const parceiroRepository = require("../../infrastructure/repositories/parceiro.repository");
const AppError = require("../../shared/errors/AppError");
const env = require("../../config/env");

class ConversaService {
  async listar(filtros = {}) {
    const conversas = await conversaRepository.findAll(filtros);
    return conversas.map(mapConversa);
  }

  async obter(id) {
    const conversa = await conversaRepository.findById(id);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");
    return mapConversa(conversa);
  }

  async atender(id, atendenteId = null) {
    const conversa = await conversaRepository.findById(id);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");

    const atualizada = await conversaRepository.update(id, {
      statusAtendimento: "em_atendimento",
      lido: true,
      atendenteId,
    });

    return mapConversa(atualizada);
  }

  async enviarMensagem(id, texto, origem = "equipe") {
    const conversa = await conversaRepository.findById(id);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");

    const cnpjNumeros = limparCnpj(texto);
    let mensagensExtras = [];

    if (cnpjNumeros.length === 14 && !conversa.cnpjVerificado && cnpjValido(cnpjNumeros)) {
      const parceiro = await parceiroRepository.findAtivoByCnpj(cnpjNumeros);
      await conversaRepository.update(id, {
        cnpj: cnpjNumeros,
        cnpjVerificado: true,
      });

      const msgConf = parceiro
        ? `CNPJ ${mascararCnpj(cnpjNumeros)} validado! Razao Social: ${parceiro.razaoSocial} Parceiro com Contrato Ativo.`
        : `CNPJ ${mascararCnpj(cnpjNumeros)} consultado. Nao possui contrato de parceiro ativo.`;

      mensagensExtras.push(
        await conversaRepository.addMensagem(id, "bot", `[Validacao Automatica Arka]: ${msgConf}`)
      );
    }

    await conversaRepository.addMensagem(id, origem === "equipe" ? "equipe" : "bot", texto.trim());

    for (const msg of mensagensExtras) {
      await this._enviarWhatsApp(conversa.telefone, msg.texto);
    }

    await this._enviarWhatsApp(conversa.telefone, texto.trim());

    const atualizada = await conversaRepository.findById(id);
    return mapConversa(atualizada);
  }

  async solicitarCnpj(id) {
    const msg = "[Arka Tecnologia]: Para prosseguirmos e verificar beneficios de parceiro, informe o CNPJ da sua empresa:";
    return this.enviarMensagem(id, msg, "bot");
  }

  async validarCnpjManual(id, cnpj) {
    const cnpjLimpo = limparCnpj(cnpj);
    if (!cnpjValido(cnpjLimpo)) {
      throw new AppError("CNPJ invalido", 400, "INVALID_CNPJ");
    }

    const parceiro = await parceiroRepository.findAtivoByCnpj(cnpjLimpo);
    const msgBot = parceiro
      ? `CNPJ ${mascararCnpj(cnpjLimpo)} identificado! Razao Social: ${parceiro.razaoSocial} (Parceiro Cadastrado).`
      : `CNPJ ${mascararCnpj(cnpjLimpo)} nao consta como parceiro cadastrado.`;

    await conversaRepository.update(id, { cnpj: cnpjLimpo, cnpjVerificado: true });
    await conversaRepository.addMensagem(id, "bot", `[Validacao de CNPJ]: ${msgBot}`);
    await this._enviarWhatsApp(
      (await conversaRepository.findById(id)).telefone,
      `[Validacao de CNPJ]: ${msgBot}`
    );

    return this.obter(id);
  }

  async atualizarStatus(id, status) {
    const conversa = await conversaRepository.findById(id);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");

    const atualizada = await conversaRepository.update(id, {
      statusAtendimento: status,
      lido: status === "resolvido" ? true : conversa.lido,
    });

    return mapConversa(atualizada);
  }

  async marcarLido(id) {
    const conversa = await conversaRepository.findById(id);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");
    const atualizada = await conversaRepository.update(id, { lido: true });
    return mapConversa(atualizada);
  }

  async remover(id) {
    const conversa = await conversaRepository.findById(id);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");
    await conversaRepository.delete(id);
    return { removido: true };
  }

  async _enviarWhatsApp(telefone, texto) {
    try {
      await evolutionApi.sendText(telefone, texto, env.evolutionApi.instance);
    } catch {
      // nao bloqueia operacao administrativa se Evolution estiver offline
    }
  }
}

module.exports = new ConversaService();
