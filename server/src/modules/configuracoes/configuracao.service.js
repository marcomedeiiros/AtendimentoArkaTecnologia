const prisma = require("../../infrastructure/database/prisma.client");
const env = require("../../config/env");
const logger = require("../../config/logger");

// Chaves suportadas e de onde vem o valor padrao (.env) quando o banco esta vazio.
const DEFINICOES = {
  "evolution.url":      { padrao: () => env.evolutionApi.url,      segredo: false },
  "evolution.apiKey":   { padrao: () => env.evolutionApi.key,      segredo: true  },
  "evolution.instance": { padrao: () => env.evolutionApi.instance, segredo: false },
  "n8n.url":            { padrao: () => process.env.N8N_URL || "http://localhost:5678", segredo: false },
  "n8n.apiKey":         { padrao: () => process.env.N8N_API_KEY || "", segredo: true },
  // URL do webhook do n8n que recebe cada mensagem entrante.
  "n8n.webhookFluxo":   { padrao: () => process.env.N8N_WEBHOOK_FLUXO || "", segredo: false },
  // Quem responde o cliente:
  //   n8n   -> encaminha ao n8n; o bot local NUNCA envia nada por conta propria
  //   local -> motor de fluxos do proprio Arka responde (comportamento antigo)
  //   humano-> so registra a conversa; ninguem responde automaticamente
  "atendimento.modo":   { padrao: () => process.env.ATENDIMENTO_MODO || "n8n", segredo: false },
};

// Mascara em ASCII puro: caracteres como "•" se corrompem dependendo da
// codificacao do cliente e deixavam de casar com a regra de "nao sobrescrever",
// apagando o segredo real ao salvar a tela sem redigitar.
const MASCARA = "********";
const PARECE_MASCARA = /^[*•·�\s]+$/;

// Cache em memoria: estas chaves sao lidas a cada chamada a Evolution/n8n.
let cache = null;

class ConfiguracaoService {
  async _carregar() {
    if (cache) return cache;
    const linhas = await prisma.configuracao.findMany();
    const doBanco = Object.fromEntries(linhas.map((l) => [l.chave, l.valor]));
    cache = {};
    for (const [chave, def] of Object.entries(DEFINICOES)) {
      const valor = doBanco[chave];
      cache[chave] = valor !== undefined && valor !== "" ? valor : def.padrao();
    }
    return cache;
  }

  invalidarCache() {
    cache = null;
  }

  async obter(chave) {
    const cfg = await this._carregar();
    return cfg[chave];
  }

  // Config da Evolution efetiva (banco > env).
  async evolution() {
    const c = await this._carregar();
    return {
      url: String(c["evolution.url"] || "").replace(/\/$/, ""),
      apiKey: c["evolution.apiKey"],
      instance: c["evolution.instance"],
    };
  }

  async n8n() {
    const c = await this._carregar();
    return {
      url: String(c["n8n.url"] || "").replace(/\/$/, ""),
      apiKey: c["n8n.apiKey"],
      webhookFluxo: String(c["n8n.webhookFluxo"] || "").trim(),
    };
  }

  // "n8n" | "local" | "humano" -- ver DEFINICOES.
  async modoAtendimento() {
    const c = await this._carregar();
    const modo = String(c["atendimento.modo"] || "n8n").toLowerCase();
    return ["n8n", "local", "humano"].includes(modo) ? modo : "n8n";
  }

  // Listagem para a tela: mascara segredos, mas informa se ja existe valor.
  async listarParaUi() {
    const cfg = await this._carregar();
    const out = {};
    for (const [chave, def] of Object.entries(DEFINICOES)) {
      const valor = cfg[chave];
      out[chave] = def.segredo
        ? { definido: !!valor, valor: valor ? MASCARA : "" }
        : { definido: !!valor, valor: valor || "" };
    }
    return out;
  }

  async salvar(valores = {}) {
    const gravadas = [];
    for (const [chave, valor] of Object.entries(valores)) {
      if (!(chave in DEFINICOES)) continue;
      // Segredo reenviado mascarado (ou vazio): mantem o valor ja gravado.
      if (DEFINICOES[chave].segredo) {
        const v = String(valor ?? "");
        if (v === "" || PARECE_MASCARA.test(v)) continue;
      }
      await prisma.configuracao.upsert({
        where: { chave },
        update: { valor: String(valor) },
        create: { chave, valor: String(valor) },
      });
      gravadas.push(chave);
    }
    this.invalidarCache();
    logger.info("Configuracoes atualizadas", { chaves: gravadas });
    return this.listarParaUi();
  }
}

module.exports = new ConfiguracaoService();
