const chatbotService = require("../chatbot/chatbot.service");
const evolutionApi = require("../../infrastructure/external/evolution-api.client");
const instanciaRepository = require("../../infrastructure/repositories/instancia.repository");
const logger = require("../../config/logger");
const env = require("../../config/env");
const { limparTelefone } = require("../../shared/helpers/cnpj.helper");

class WhatsAppService {
  extrairTelefone(remoteJid) {
    if (!remoteJid) return null;
    const numero = String(remoteJid).split("@")[0];
    return limparTelefone(numero);
  }

  extrairTexto(payload) {
    const msg = payload?.data?.message || payload?.message || payload;
    if (!msg) return null;

    if (typeof msg === "string") return msg.trim();
    if (msg.conversation) return msg.conversation.trim();
    if (msg.extendedTextMessage?.text) return msg.extendedTextMessage.text.trim();
    if (msg.imageMessage?.caption) return msg.imageMessage.caption.trim();
    if (msg.buttonsResponseMessage?.selectedDisplayText) {
      return msg.buttonsResponseMessage.selectedDisplayText.trim();
    }
    if (msg.listResponseMessage?.title) return msg.listResponseMessage.title.trim();

    return null;
  }

  async processarWebhook(body, instanceName) {
    const event = body?.event || body?.type || "";
    const instance = body?.instance || instanceName || env.evolutionApi.instance;

    if (event === "connection.update" || event === "CONNECTION_UPDATE") {
      return this._processarConexao(body, instance);
    }

    if (
      event === "messages.upsert" ||
      event === "MESSAGES_UPSERT" ||
      body?.data?.key ||
      body?.key
    ) {
      return this._processarMensagem(body, instance);
    }

    logger.debug("Webhook ignorado", { event, instance });
    return { recebido: true, processado: false, evento: event || "desconhecido" };
  }

  async _processarConexao(body, instanceName) {
    const state = body?.data?.state || body?.data?.status || body?.state;
    const conectado = state === "open" || state === "connected";

    const instancia = await instanciaRepository.findByNome(instanceName);
    if (instancia) {
      await instanciaRepository.updateConectado(instancia.id, conectado);
    }

    return { recebido: true, evento: "connection.update", conectado, state };
  }

  async _processarMensagem(body, instanceName) {
    const data = body?.data || body;
    const key = data?.key || body?.key;

    if (key?.fromMe) {
      return { recebido: true, processado: false, motivo: "mensagem_propria" };
    }

    const telefone = this.extrairTelefone(key?.remoteJid || data?.remoteJid);
    const texto = this.extrairTexto(body);
    const nomeCliente = data?.pushName || data?.senderName || "Cliente";

    if (!telefone || !texto) {
      return { recebido: true, processado: false, motivo: "dados_incompletos" };
    }

    const result = await chatbotService.processar({
      telefone,
      texto,
      nomeCliente,
      instanceName,
    });

    return { recebido: true, ...result };
  }

  async obterStatus(instanceName) {
    const nome = instanceName || env.evolutionApi.instance;
    const instancia = await instanciaRepository.findByNome(nome);

    let evolutionState = null;
    try {
      evolutionState = await evolutionApi.getConnectionState(nome);
    } catch {
      evolutionState = { state: "unavailable" };
    }

    const state = evolutionState?.instance?.state || evolutionState?.state || "close";
    const conectado = state === "open" || instancia?.conectado;

    if (instancia && instancia.conectado !== conectado) {
      await instanciaRepository.updateConectado(instancia.id, !!conectado);
    }

    return {
      instancia: nome,
      conectado: !!conectado,
      state,
      webhookUrl: `/api/webhook/v1/whatsapp`,
      webhookSecret: env.webhookSecret,
    };
  }

  async conectar(instanceName) {
    const nome = instanceName || env.evolutionApi.instance;
    const data = await evolutionApi.connect(nome);
    return {
      instancia: nome,
      qrcode: data?.base64 || data?.qrcode?.base64 || data?.code || null,
      pairingCode: data?.pairingCode || null,
      raw: data,
    };
  }

  async desconectar(instanceName) {
    const nome = instanceName || env.evolutionApi.instance;
    await evolutionApi.logout(nome);

    const instancia = await instanciaRepository.findByNome(nome);
    if (instancia) {
      await instanciaRepository.updateConectado(instancia.id, false);
    }

    return { instancia: nome, conectado: false };
  }

  async obterQrcode(instanceName) {
    const result = await this.conectar(instanceName);
    return {
      instancia: result.instancia,
      qrcode: result.qrcode,
      pairingCode: result.pairingCode,
    };
  }
}

module.exports = new WhatsAppService();
