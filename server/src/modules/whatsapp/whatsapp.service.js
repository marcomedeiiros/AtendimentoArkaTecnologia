const chatbotService = require("../chatbot/chatbot.service");
const evolutionApi = require("../../infrastructure/external/evolution-api.client");
const instanciaRepository = require("../../infrastructure/repositories/instancia.repository");
const logger = require("../../config/logger");
const env = require("../../config/env");
const AppError = require("../../shared/errors/AppError");
const { limparTelefone } = require("../../shared/helpers/cnpj.helper");

class WhatsAppService {
  constructor() {
    // instancia -> timestamp em que a vimos conectar (para "tempo online").
    this._conectadoDesde = {};
  }

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

  // Detecta mídia no payload do webhook (Baileys/Evolution). Retorna o metadata
  // com `tipo` (imagem/video/audio/documento/localizacao/contato) ou null.
  // Os bytes NÃO vêm aqui: a `url` é criptografada; quem baixa é o webhook.
  extrairMidia(payload) {
    const msg = payload?.data?.message || payload?.message;
    if (!msg || typeof msg !== "object") return null;

    const doc = msg.documentMessage || msg.documentWithCaptionMessage?.message?.documentMessage;

    if (msg.imageMessage) {
      return { tipo: "imagem", mimetype: msg.imageMessage.mimetype || "image/jpeg", caption: msg.imageMessage.caption || null };
    }
    if (msg.videoMessage) {
      return { tipo: "video", mimetype: msg.videoMessage.mimetype || "video/mp4", caption: msg.videoMessage.caption || null };
    }
    if (msg.audioMessage) {
      return { tipo: "audio", mimetype: msg.audioMessage.mimetype || "audio/ogg" };
    }
    if (doc) {
      return { tipo: "documento", mimetype: doc.mimetype || "application/octet-stream", caption: doc.caption || null, fileName: doc.fileName || doc.title || "documento" };
    }
    if (msg.locationMessage) {
      return { tipo: "localizacao", latitude: msg.locationMessage.degreesLatitude, longitude: msg.locationMessage.degreesLongitude, name: msg.locationMessage.name || null, address: msg.locationMessage.address || null };
    }
    if (msg.contactMessage || msg.contactsArrayMessage) {
      const c = msg.contactMessage || msg.contactsArrayMessage?.contacts?.[0] || {};
      return { tipo: "contato", displayName: c.displayName || null, vcard: c.vcard || null };
    }
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

    let midia = this.extrairMidia(body);
    // Para tipos com arquivo, tenta obter os bytes (base64 no payload quando o
    // "Webhook Base64" está ligado, senão baixa via getBase64FromMediaMessage).
    if (midia && midia.tipo !== "localizacao" && midia.tipo !== "contato") {
      let base64 = data?.message?.base64 || data?.base64 || body?.base64 || null;
      let mimetype = midia.mimetype;
      if (!base64 && key) {
        const baixado = await evolutionApi.getBase64FromMediaMessage(key, instanceName);
        if (baixado) {
          base64 = baixado.base64;
          mimetype = baixado.mimetype || mimetype;
        }
      }
      if (base64) {
        const url = base64.startsWith("data:") ? base64 : `data:${mimetype};base64,${base64}`;
        midia = { ...midia, url, mimetype };
      }
    }

    if (!telefone || (!texto && !midia)) {
      return { recebido: true, processado: false, motivo: "dados_incompletos" };
    }

    const result = await chatbotService.processar({
      telefone,
      texto,
      nomeCliente,
      instanceName,
      waMessageId: key?.id || null,
      midia,
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

    // Estados da Evolution: open (online) | connecting | close (desconectado).
    // "unavailable" e nosso: a Evolution nao respondeu.
    const state = evolutionState?.instance?.state || evolutionState?.state || "close";
    const conectado = state === "open";

    if (instancia && instancia.conectado !== conectado) {
      await instanciaRepository.updateConectado(instancia.id, conectado);
    }

    // Tempo online: marcamos o instante em que vimos a instancia conectar.
    // Fica em memoria (zera se o back-end reiniciar) -- suficiente para exibir.
    if (conectado && !this._conectadoDesde[nome]) {
      this._conectadoDesde[nome] = Date.now();
    } else if (!conectado) {
      delete this._conectadoDesde[nome];
    }

    return {
      instancia: nome,
      conectado,
      state,
      statusLabel: this._rotuloStatus(state),
      conectadoDesde: this._conectadoDesde[nome] || null,
      ultimaSincronizacao: new Date().toISOString(),
      webhookUrl: `/api/webhook/v1/whatsapp`,
      webhookSecret: env.webhookSecret,
    };
  }

  _rotuloStatus(state) {
    if (state === "open") return "Online";
    if (state === "connecting") return "Conectando";
    if (state === "unavailable") return "Offline";
    return "Desconectado";
  }

  // Painel completo da instancia: junta status + dados do perfil + webhook +
  // versao numa chamada so, para a tela nao precisar orquestrar varias.
  async obterDetalhes(instanceName) {
    const nome = instanceName || env.evolutionApi.instance;
    const status = await this.obterStatus(nome);

    let info = null;
    try {
      info = await evolutionApi.fetchInstances(nome);
    } catch {
      info = null;
    }

    const webhook = await evolutionApi.findWebhook(nome);
    const versao = await evolutionApi.getVersion();

    return {
      ...status,
      perfil: {
        // v2 devolve `ownerJid`; v1 usava `owner`. Mantemos os dois.
        nome: info?.profileName || null,
        numero: (() => {
          const jid = info?.ownerJid || info?.owner || info?.number;
          return jid ? String(jid).split("@")[0] : null;
        })(),
        foto: info?.profilePicUrl || info?.profilePictureUrl || null,
        integracao: info?.integration || null,
      },
      token: info?.token || info?.apikey || null,
      versao,
      webhook: {
        url: webhook?.url || webhook?.webhook?.url || null,
        eventos: webhook?.events || webhook?.webhook?.events || [],
        habilitado: webhook?.enabled ?? webhook?.webhook?.enabled ?? null,
      },
    };
  }

  // Cria a instancia na Evolution e ja registra o webhook apontando pro Arka.
  // `baseUrlPublica` deve ser a URL que a Evolution enxerga (dominio ou tunel).
  async criarInstancia({ instanceName, baseUrlPublica }) {
    const nome = instanceName || env.evolutionApi.instance;
    const base = String(baseUrlPublica || "").replace(/\/$/, "");
    const webhookUrl = base
      ? `${base}/api/webhook/v1/whatsapp?token=${encodeURIComponent(env.webhookSecret)}`
      : null;

    const criada = await evolutionApi.createInstance({ instanceName: nome, webhookUrl });

    // Espelha a instancia no banco para o chatbot/webhook resolverem por nome.
    const existente = await instanciaRepository.findByNome(nome);
    if (!existente) {
      await instanciaRepository.create({ nome, conectado: false, webhookSecret: env.webhookSecret });
    }

    return {
      instancia: nome,
      webhookUrl,
      qrcode: criada?.qrcode?.base64 || criada?.base64 || null,
      aviso: webhookUrl
        ? null
        : "Instancia criada SEM webhook: informe a URL publica do Arka para receber mensagens.",
    };
  }

  async configurarWebhook({ instanceName, baseUrlPublica }) {
    const nome = instanceName || env.evolutionApi.instance;
    const base = String(baseUrlPublica || "").replace(/\/$/, "");
    if (!base) {
      throw new AppError("Informe a URL publica do Arka", 400, "URL_OBRIGATORIA");
    }
    const url = `${base}/api/webhook/v1/whatsapp?token=${encodeURIComponent(env.webhookSecret)}`;
    await evolutionApi.setWebhook({ instance: nome, url });
    return { instancia: nome, webhookUrl: url };
  }

  async reiniciar(instanceName) {
    const nome = instanceName || env.evolutionApi.instance;
    await evolutionApi.restartInstance(nome);
    delete this._conectadoDesde[nome];
    return this.obterStatus(nome);
  }

  async excluir(instanceName) {
    const nome = instanceName || env.evolutionApi.instance;
    await evolutionApi.deleteInstance(nome);
    const instancia = await instanciaRepository.findByNome(nome);
    if (instancia) await instanciaRepository.updateConectado(instancia.id, false);
    delete this._conectadoDesde[nome];
    return { instancia: nome, excluida: true };
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
