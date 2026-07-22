const env = require("../../config/env");
const logger = require("../../config/logger");
const AppError = require("../../shared/errors/AppError");

class EvolutionApiClient {
  constructor() {
    this.baseUrl = env.evolutionApi.url.replace(/\/$/, "");
    this.apiKey = env.evolutionApi.key;
    this.defaultInstance = env.evolutionApi.instance;
  }

  headers() {
    return {
      "Content-Type": "application/json",
      apikey: this.apiKey,
    };
  }

  async request(method, path, body) {
    const url = `${this.baseUrl}${path}`;

    try {
      const response = await fetch(url, {
        method,
        headers: this.headers(),
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

  async sendText(number, text, instance = this.defaultInstance) {
    return this.request("POST", `/message/sendText/${instance}`, {
      number,
      text,
    });
  }
}

module.exports = new EvolutionApiClient();
