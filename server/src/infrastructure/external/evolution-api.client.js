const env = require("../../config/env");
const logger = require("../../config/logger");
const AppError = require("../../shared/errors/AppError");

class EvolutionApiClient {
  constructor() {
    // Valores do .env sao apenas o fallback: a config efetiva vem do banco
    // (tela de Configuracoes) e e resolvida a cada chamada.
    this.baseUrl = env.evolutionApi.url.replace(/\/$/, "");
    this.apiKey = env.evolutionApi.key;
    this.defaultInstance = env.evolutionApi.instance;
  }

  headers(apiKey = this.apiKey) {
    return {
      "Content-Type": "application/json",
      apikey: apiKey,
    };
  }

  // Le a configuracao atual (banco > env). Import tardio evita ciclo.
  async _config() {
    try {
      const cfg = require("../../modules/configuracoes/configuracao.service");
      const evo = await cfg.evolution();
      return {
        url: evo.url || this.baseUrl,
        apiKey: evo.apiKey || this.apiKey,
        instance: evo.instance || this.defaultInstance,
      };
    } catch {
      return { url: this.baseUrl, apiKey: this.apiKey, instance: this.defaultInstance };
    }
  }

  async instanciaPadrao() {
    return (await this._config()).instance;
  }

  async request(method, path, body) {
    const cfg = await this._config();
    const url = `${cfg.url}${path}`;

    try {
      const response = await fetch(url, {
        method,
        headers: this.headers(cfg.apiKey),
        body: body ? JSON.stringify(body) : undefined,
      });

      const text = await response.text();
      const data = text ? JSON.parse(text) : null;

      if (!response.ok) {
        logger.warn("Evolution API erro", { status: response.status, data });
        throw new AppError(
          data?.message || "Falha na comunicacao com Evolution API",
          502,
          "EVOLUTION_API_ERROR"
        );
      }

      return data;
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error("Evolution API indisponivel", { message: error.message });
      throw new AppError(
        "Evolution API indisponivel. Verifique EVOLUTION_API_URL.",
        503,
        "EVOLUTION_API_UNAVAILABLE"
      );
    }
  }

  async getConnectionState(instance = this.defaultInstance) {
    return this.request("GET", `/instance/connectionState/${instance}`);
  }

  async connect(instance = this.defaultInstance) {
    return this.request("GET", `/instance/connect/${instance}`);
  }

  async logout(instance = this.defaultInstance) {
    return this.request("DELETE", `/instance/logout/${instance}`);
  }

  // Dados da instancia (nome do perfil, numero, foto, token, integracao).
  // A Evolution devolve um array; filtramos pelo nome quando informado.
  async fetchInstances(instance = this.defaultInstance) {
    const data = await this.request(
      "GET",
      `/instance/fetchInstances${instance ? `?instanceName=${encodeURIComponent(instance)}` : ""}`
    );
    const lista = Array.isArray(data) ? data : data ? [data] : [];
    // v1 aninha em { instance: {...} }, v2 devolve o objeto direto.
    const achatada = lista.map((i) => i?.instance || i);
    if (!instance) return achatada;
    return (
      achatada.find(
        (i) => i?.instanceName === instance || i?.name === instance
      ) || achatada[0] || null
    );
  }

  // Cria a instancia ja apontando o webhook para o nosso back-end. `webhookUrl`
  // precisa ser alcancavel PELA Evolution (em nuvem, use dominio publico/tunel).
  async createInstance({ instanceName, webhookUrl, eventos }) {
    const body = {
      instanceName,
      qrcode: true,
      integration: "WHATSAPP-BAILEYS",
      // Sem isto o WhatsApp nao envia a agenda/conversas ao parear e a Evolution
      // fica com 0 contatos e 0 chats.
      syncFullHistory: true,
    };
    if (webhookUrl) {
      body.webhook = {
        url: webhookUrl,
        byEvents: false,
        base64: true, // envia a midia em base64 junto do evento
        // MESSAGES_UPDATE traz os ACKs de entrega/leitura (os risquinhos).
        events: eventos || ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE"],
      };
    }
    return this.request("POST", "/instance/create", body);
  }

  // Ajusta o webhook de uma instancia que ja existe.
  async setWebhook({ instance, url, eventos }) {
    const alvo = instance || (await this.instanciaPadrao());
    return this.request("POST", `/webhook/set/${alvo}`, {
      webhook: {
        enabled: true,
        url,
        webhookByEvents: false,
        webhookBase64: true,
        // MESSAGES_UPDATE traz os ACKs de entrega/leitura (os risquinhos).
        events: eventos || ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE"],
      },
    });
  }

  async restartInstance(instance = this.defaultInstance) {
    return this.request("PUT", `/instance/restart/${instance}`);
  }

  async deleteInstance(instance = this.defaultInstance) {
    return this.request("DELETE", `/instance/delete/${instance}`);
  }

  // Webhook configurado na instancia (url + eventos).
  async findWebhook(instance = this.defaultInstance) {
    try {
      return await this.request("GET", `/webhook/find/${instance}`);
    } catch {
      return null;
    }
  }

  // Versao da Evolution (raiz da API). Best-effort.
  async getVersion() {
    try {
      const data = await this.request("GET", "/");
      return data?.version || data?.data?.version || null;
    } catch {
      return null;
    }
  }

  // `quoted` reproduz o "responder" do WhatsApp: { key, message } da original.
  async sendText(number, text, instance = this.defaultInstance, quoted = null) {
    return this.request("POST", `/message/sendText/${instance}`, {
      number,
      text,
      ...(quoted ? { quoted } : {}),
    });
  }

  // Edicao de mensagem ja enviada (WhatsApp permite ate ~15 min).
  async editarMensagem({ number, key, texto }, instance = this.defaultInstance) {
    return this.request("POST", `/chat/updateMessage/${instance}`, {
      number,
      key,
      text: texto,
    });
  }

  // Envia imagem/video/documento. `media` aceita URL publica ou base64.
  // mediatype: "image" | "video" | "document".
  async sendMedia(number, { mediatype, media, mimetype, fileName, caption }, instance = this.defaultInstance) {
    return this.request("POST", `/message/sendMedia/${instance}`, {
      number,
      mediatype,
      media,
      ...(mimetype ? { mimetype } : {}),
      ...(fileName ? { fileName } : {}),
      ...(caption ? { caption } : {}),
    });
  }

  // Audio de voz (PTT). `audio` aceita URL publica ou base64.
  async sendWhatsAppAudio(number, audio, instance = this.defaultInstance) {
    return this.request("POST", `/message/sendWhatsAppAudio/${instance}`, {
      number,
      audio,
    });
  }

  // Baixa os bytes de uma mensagem de midia recebida (a `url` do webhook e
  // criptografada e nao serve direto). Retorna { base64, mimetype } ou null.
  // Best-effort: depende da versao da Evolution.
  async getBase64FromMediaMessage(key, instance = this.defaultInstance) {
    try {
      const data = await this.request(
        "POST",
        `/chat/getBase64FromMediaMessage/${instance}`,
        { message: { key }, convertToMp4: false }
      );
      const base64 = data?.base64 || data?.media || null;
      if (!base64) return null;
      return { base64, mimetype: data?.mimetype || null };
    } catch {
      return null;
    }
  }

  async sendLocation(number, { latitude, longitude, name, address }, instance = this.defaultInstance) {
    return this.request("POST", `/message/sendLocation/${instance}`, {
      number,
      latitude,
      longitude,
      ...(name ? { name } : {}),
      ...(address ? { address } : {}),
    });
  }

  // Foto de perfil do contato. Best-effort: a Evolution retorna 404/erro quando
  // o numero nao tem foto publica -- nesses casos devolvemos null e o front cai
  // para o avatar de iniciais.
  async fetchProfilePictureUrl(number, instance = this.defaultInstance) {
    try {
      const data = await this.request(
        "POST",
        `/chat/fetchProfilePictureUrl/${instance}`,
        { number }
      );
      return data?.profilePictureUrl || data?.url || null;
    } catch {
      return null;
    }
  }
}

module.exports = new EvolutionApiClient();
