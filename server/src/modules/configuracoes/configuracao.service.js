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
  //   local -> motor de fluxos do proprio Arka responde por gatilho (padrao)
  //   n8n   -> encaminha ao n8n; o bot local NUNCA envia nada por conta propria
  //   humano-> so registra a conversa; ninguem responde automaticamente
  //
  // O padrao e "local" de proposito: numa instalacao nova o n8n ainda nao tem
  // webhook configurado, e com "n8n" os fluxos do Arka ficariam mudos sem que o
  // motivo fosse obvio. Troque em Configuracoes quando o workflow estiver pronto.
  "atendimento.modo":   { padrao: () => process.env.ATENDIMENTO_MODO || "local", segredo: false },
  // Transcricao de audio (fala->texto). Provedor padrao: Groq (Whisper), que tem
  // camada gratuita. A chave e OpenAI-compativel, entao trocar para a OpenAI e so
  // mudar a chave/URL. Vem do .env (GROQ_API_KEY) quando o banco esta vazio.
  "transcricao.apiKey": { padrao: () => process.env.GROQ_API_KEY || process.env.TRANSCRICAO_API_KEY || "", segredo: true },
  // Horario de atendimento, usado pelo motor de fluxos para o "fora de horario".
  // JSON: { "ativo": bool, "inicio": "08:00", "fim": "18:00", "dias": [1..5],
  //         "mensagem": "texto enviado fora do horario" }
  // `dias` segue Date#getDay (0=domingo). Vazio/desligado = atende sempre, que e
  // o padrao para nao mudar o comportamento de quem ja usa o sistema.
  "chatbot.horario":    { padrao: () => process.env.CHATBOT_HORARIO || "", segredo: false },
  // Mapa fila -> setor. O `queueId` dos fluxos importados nao existe aqui; este
  // mapa e o que permite a transferencia cair no setor certo do HelpDesk.
  // JSON: { "33": "Suporte", "35": "Comercial" }
  "chatbot.filas":      { padrao: () => process.env.CHATBOT_FILAS || "", segredo: false },
  // Pesquisa de satisfacao (CSAT) que o bot dispara ao encerrar o atendimento:
  // pergunta a nota de 1 a 5 e, em seguida, um comentario livre. As respostas
  // vao para os campos `avaliacao`/`feedback` da conversa e alimentam a aba
  // Avaliacoes da Visao Geral.
  // JSON: { "ativo": bool, "pedirComentario": bool, "mensagemNota": "...",
  //         "mensagemComentario": "...", "mensagemAgradecimento": "...",
  //         "mensagemNotaInvalida": "..." }
  // Ligada por padrao; desligue com {"ativo": false}. So atua no modo "local".
  "chatbot.pesquisaSatisfacao": { padrao: () => process.env.CHATBOT_PESQUISA || "", segredo: false },
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

  // Chave do servico de transcricao (Groq/OpenAI). Vazia = recurso desligado.
  async transcricaoApiKey() {
    const c = await this._carregar();
    return String(c["transcricao.apiKey"] || "").trim();
  }

  // "n8n" | "local" | "humano" -- ver DEFINICOES.
  async modoAtendimento() {
    const c = await this._carregar();
    const modo = String(c["atendimento.modo"] || "n8n").toLowerCase();
    return ["n8n", "local", "humano"].includes(modo) ? modo : "n8n";
  }

  // JSON invalido nao pode derrubar o atendimento: cai no padrao "atende sempre".
  _json(valor, padrao) {
    const bruto = String(valor || "").trim();
    if (!bruto) return padrao;
    try {
      const dados = JSON.parse(bruto);
      return dados && typeof dados === "object" ? dados : padrao;
    } catch {
      logger.warn("Configuracao com JSON invalido, usando o padrao", { valor: bruto.slice(0, 60) });
      return padrao;
    }
  }

  async horarioAtendimento() {
    const c = await this._carregar();
    const h = this._json(c["chatbot.horario"], {});
    return {
      ativo: h.ativo === true,
      inicio: typeof h.inicio === "string" ? h.inicio : "08:00",
      fim: typeof h.fim === "string" ? h.fim : "18:00",
      dias: Array.isArray(h.dias) ? h.dias.map(Number).filter((d) => d >= 0 && d <= 6) : [1, 2, 3, 4, 5],
      mensagem: typeof h.mensagem === "string" ? h.mensagem : "",
    };
  }

  // Pesquisa de satisfacao disparada pelo bot ao encerrar. Ligada por padrao;
  // textos customizaveis pela tela de Configuracoes (chave chatbot.pesquisaSatisfacao).
  async pesquisaSatisfacao() {
    const c = await this._carregar();
    const p = this._json(c["chatbot.pesquisaSatisfacao"], {});
    const txt = (valor, padrao) =>
      typeof valor === "string" && valor.trim() ? valor : padrao;
    return {
      ativo: p.ativo !== false,
      pedirComentario: p.pedirComentario !== false,
      mensagemNota: txt(
        p.mensagemNota,
        "Antes de encerrar: de 1 a 5, que nota voce da para este atendimento? (1 = pessimo, 5 = otimo)"
      ),
      mensagemComentario: txt(
        p.mensagemComentario,
        'Obrigado! Em poucas palavras, o que foi bom ou o que podemos melhorar? (ou responda "pular")'
      ),
      mensagemAgradecimento: txt(
        p.mensagemAgradecimento,
        "Sua avaliacao foi registrada. Obrigado pelo seu feedback!"
      ),
      mensagemNotaInvalida: txt(
        p.mensagemNotaInvalida,
        "Por favor, responda apenas com um numero de 1 a 5."
      ),
    };
  }

  // { "33": "Suporte" } -> setor para onde a fila do fluxo importado aponta.
  async filasParaSetor() {
    const c = await this._carregar();
    const mapa = this._json(c["chatbot.filas"], {});
    const out = {};
    for (const [fila, setor] of Object.entries(mapa)) {
      if (typeof setor === "string" && setor.trim()) out[String(fila)] = setor.trim();
    }
    return out;
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
