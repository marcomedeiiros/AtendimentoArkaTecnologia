const env = require("../../config/env");
const logger = require("../../config/logger");
const AppError = require("../../shared/errors/AppError");

/**
 * O TEXTO DO ERRO DA EVOLUTION, onde quer que ela o tenha posto.
 *
 * A v2 responde `{status, error, response: {message: [...]}}` -- uma LISTA,
 * aninhada. O codigo lia `data.message` e nao achava nada, entao toda falha
 * chegava ao painel como "Falha na comunicacao com Evolution API", escondendo
 * justamente a frase que dizia o que houve ("The X instance does not exist").
 */
function mensagemDaEvolution(data) {
  const bruto = data?.response?.message ?? data?.message ?? data?.error;
  if (Array.isArray(bruto)) return bruto.filter(Boolean).join("; ");
  if (typeof bruto === "string") return bruto;
  return "";
}

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
        const detalhe = mensagemDaEvolution(data);

        // INSTANCIA QUE NAO EXISTE E UM CASO A PARTE, e nao "falha de
        // comunicacao". Sem distingui-lo, o painel recebia 502 com texto
        // generico nas tres rotas que dependem da instancia (qrcode, conectar,
        // reiniciar) e nao tinha como oferecer o unico caminho que resolve:
        // criar a instancia de novo. Foi o que deixou o atendimento 4h30 fora
        // do ar em 01/09/2026 -- alguem excluiu a instancia e o painel virou um
        // beco sem saida, com 26 cliques em "Reconectar" levando 502.
        if (response.status === 404 && /instance/i.test(path)) {
          throw new AppError(
            `A instancia nao existe mais na Evolution${detalhe ? ` (${detalhe})` : ""}.`,
            404,
            "INSTANCIA_INEXISTENTE"
          );
        }

        throw new AppError(
          detalhe || "Falha na comunicacao com Evolution API",
          502,
          "EVOLUTION_API_ERROR"
        );
      }

      // FALHA DISFARCADA DE SUCESSO.
      //
      // Varios controllers da Evolution 2.4 envolvem o corpo inteiro num
      // try/catch que devolve `{error:true, message}` com HTTP **200** -- o
      // `restartInstance` e o `connectToWhatsapp` fazem exatamente isso
      // (instance.controller.ts:346 e :392). Sem checar aqui, o vigia lia 200,
      // anotava "reiniciada" e ia dormir enquanto NADA tinha acontecido: uma
      // reconexao que falha em silencio e pior que uma que estoura.
      if (data && data.error === true) {
        const detalhe = mensagemDaEvolution(data) || data.message || "";
        logger.warn("Evolution API respondeu 200 com erro no corpo", { path, detalhe });
        throw new AppError(
          detalhe || "A Evolution recusou a operacao",
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
      //
      // Tem um custo: a sincronizacao inicial e refeita a CADA reconexao (dezenas
      // de chats, centenas de mensagens), o que estica bastante o tempo em
      // `connecting`. Isso ja foi fatal, quando o watchdog reconectava por cima
      // do handshake; hoje o `whatsapp.reconexao` espera o handshake terminar e
      // a demora voltou a ser so demora. Deixamos ligado por causa da agenda --
      // `EVOLUTION_SYNC_FULL_HISTORY=false` desliga para quem prefere reconexao
      // rapida a importacao de contatos.
      syncFullHistory: env.evolutionApi.syncFullHistory,
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

  // POST, NAO PUT.
  //
  // Ate a 2.3.x a rota aceitava PUT. Na 2.4.0-rc2 o router registra so
  // `.post(this.routerPath('restart'))` (instance.router.ts:27), entao o PUT
  // caia no 404 do Express -- e o nosso proprio tratamento de 404 traduzia isso
  // para "A instancia nao existe mais na Evolution". Resultado: TODA tentativa
  // de reconexao automatica falhava, o vigia queimava as seis tentativas em
  // ~31 min e o painel mandava reescanear o QR com a sessao intacta no banco.
  //
  // Vale lembrar o limite desta rota (instance.controller.ts:361): ela RECUSA
  // instancia em `close` -- e devolve a recusa como HTTP 200 `{error:true}`,
  // nao como erro. Quem esta em `close` se recupera por `/instance/connect`.
  // Ver `whatsapp.reconexao.js`, que escolhe a chamada pelo estado.
  async restartInstance(instance = this.defaultInstance) {
    return this.request("POST", `/instance/restart/${instance}`);
  }

  async deleteInstance(instance = this.defaultInstance) {
    return this.request("DELETE", `/instance/delete/${instance}`);
  }

  /**
   * POR QUE A CONEXAO CAIU -- o numero, nao o palpite.
   *
   * A Evolution grava na propria linha da instancia o `statusCode` do Baileys
   * que fechou o socket (`disconnectionReasonCode`), a hora e o objeto bruto do
   * `lastDisconnect`. Isso ja vinha em `/instance/fetchInstances` e nunca era
   * lido: sem esse numero, "caiu" e "deslogou" sao indistinguiveis e a unica
   * saida e adivinhar -- foi o que fez a tela pedir QR sem motivo.
   *
   * Best-effort de proposito: se a Evolution nao responder, devolvemos tudo
   * nulo e quem chama trata como "desconhecido", nunca como "deslogado".
   */
  async diagnosticoConexao(instance = this.defaultInstance) {
    try {
      const info = await this.fetchInstances(instance);
      if (!info) return { conhecido: false };
      return {
        conhecido: true,
        connectionStatus: info.connectionStatus || null,
        motivoCodigo:
          info.disconnectionReasonCode == null ? null : Number(info.disconnectionReasonCode),
        motivoEm: info.disconnectionAt || null,
        motivoObjeto: info.disconnectionObject || null,
      };
    } catch {
      return { conhecido: false };
    }
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

  // Menu com BOTOES de resposta (max. 3). Formato Evolution v2. Cada botao:
  // { type:"reply", displayText, id }. O `id` volta no webhook como
  // buttonsResponseMessage.selectedButtonId. IMPORTANTE: em instancias Baileys o
  // WhatsApp pode NAO renderizar botoes; por isso quem chama deve ter fallback
  // para texto (ver enviarBotComOpcoes no chatbot.engine).
  async sendButtons(number, { title, description, footer, buttons }, instance = this.defaultInstance) {
    return this.request("POST", `/message/sendButtons/${instance}`, {
      number,
      ...(title ? { title } : {}),
      description: description || "",
      ...(footer ? { footer } : {}),
      buttons,
    });
  }

  // Menu em LISTA (ate 10 itens). Formato Evolution v2. Cada linha:
  // { title, description?, rowId }. O `rowId` volta como
  // listResponseMessage.singleSelectReply.selectedRowId. Mesma ressalva de
  // renderizacao do Baileys se aplica.
  async sendList(number, { title, description, buttonText, footerText, sections }, instance = this.defaultInstance) {
    return this.request("POST", `/message/sendList/${instance}`, {
      number,
      ...(title ? { title } : {}),
      description: description || "",
      buttonText: buttonText || "Ver opções",
      ...(footerText ? { footerText } : {}),
      sections,
    });
  }

  /**
   * ENQUETE -- a unica coisa CLICAVEL que renderiza no transporte atual.
   *
   * Botao e lista dependem do `native_flow`, que a Evolution 2.3.7 nao consegue
   * montar (regressao `this.isZero`). A enquete usa outro caminho do protocolo e
   * renderiza normalmente no Baileys -- e por isso ela existe aqui: e o menu
   * clicavel que da para ter HOJE, sem migrar o numero e sem custo.
   *
   * `selectableCount: 1` = escolha unica (o cliente marca uma opcao). O WhatsApp
   * aceita de 2 a 12 opcoes.
   *
   * A RESSALVA, e ela e grande: o VOTO volta criptografado no Baileys
   * (`pollUpdateMessage.vote.encPayload`) e depende de a Evolution decifrar e
   * expor a opcao escolhida. Quem chama tem de estar pronto para o voto nao
   * chegar legivel -- ver `extrairTexto` (whatsapp.service), que registra o
   * formato bruto quando nao reconhece, para o primeiro voto real dizer
   * exatamente o que esta instalacao manda.
   */
  async sendPoll(number, { name, values, selectableCount = 1 }, instance = this.defaultInstance) {
    return this.request("POST", `/message/sendPoll/${instance}`, {
      number,
      name,
      selectableCount,
      values,
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

  // Apaga a mensagem PARA TODOS (o "apagar para todos" do WhatsApp). Vale apenas
  // para mensagens que a instancia enviou (fromMe: true) -- o WhatsApp nao deixa
  // remover do aparelho do cliente algo que ele mesmo mandou. `key` e a chave da
  // mensagem: { id, remoteJid, fromMe }.
  async apagarMensagem(key, instance = this.defaultInstance) {
    return this.request("DELETE", `/chat/deleteMessageForEveryone/${instance}`, key);
  }

  // Envia imagem/video/documento. `media` aceita URL publica ou base64.
  // mediatype: "image" | "video" | "document". `gifPlayback` faz um video curto
  // tocar em loop como GIF (o WhatsApp nao entrega GIF animado como "image").
  async sendMedia(number, { mediatype, media, mimetype, fileName, caption, gifPlayback }, instance = this.defaultInstance) {
    return this.request("POST", `/message/sendMedia/${instance}`, {
      number,
      mediatype,
      media,
      ...(mimetype ? { mimetype } : {}),
      ...(fileName ? { fileName } : {}),
      ...(caption ? { caption } : {}),
      ...(gifPlayback ? { gifPlayback: true } : {}),
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
      // O campo muda conforme a versao da Evolution: `base64` (v2), `media`,
      // ou aninhado em `data.base64`. Cobrimos todas para o audio nao sumir so
      // porque a instalacao usa um formato diferente.
      const base64 =
        data?.base64 ||
        data?.media ||
        data?.data?.base64 ||
        data?.message?.base64 ||
        data?.buffer ||
        null;
      if (!base64) return null;
      const mimetype = data?.mimetype || data?.mimeType || data?.data?.mimetype || null;
      return { base64, mimetype };
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

  // Agenda do WhatsApp sincronizada pela instancia. Depende de a instancia ter
  // sido criada com syncFullHistory -- sem isso o WhatsApp nao envia a agenda.
  async findContacts(instance = this.defaultInstance) {
    const alvo = instance || (await this.instanciaPadrao());
    const data = await this.request("POST", `/chat/findContacts/${alvo}`, {});
    const lista = Array.isArray(data) ? data : data?.data || [];
    return lista;
  }

  /**
   * MENSAGENS QUE A EVOLUTION GUARDOU de uma conversa -- inclusive as que
   * aconteceram no CELULAR, antes de a Central existir.
   *
   * Isto NAO le o aparelho. Le o banco da propria Evolution, que se enche por
   * dois caminhos:
   *   1. o `syncFullHistory` do pareamento (ver createInstance), quando o
   *      WhatsApp despeja o historico no dispositivo novo;
   *   2. o dia a dia, com `DATABASE_SAVE_DATA_NEW_MESSAGE=true` (ver
   *      docker-compose.evolution.yml).
   * Sem nenhum dos dois, `total` volta 0 e nao existe historico para importar --
   * o problema esta na Evolution, nao aqui.
   *
   * `offset` na API da Evolution NAO e o deslocamento: e o TAMANHO da pagina
   * (`pages: Math.ceil(count / query.offset)` no fetchMessages dela). Mandar so
   * `page` sem `offset` deixa a conta de paginas indefinida, entao os dois vao
   * sempre juntos.
   *
   * @param {string} remoteJid jid completo, ex. "5511999999999@s.whatsapp.net"
   * @returns {{total:number, paginas:number, pagina:number, registros:object[]}}
   */
  async findMessages(remoteJid, { pagina = 1, porPagina = 100 } = {}, instance = this.defaultInstance) {
    const alvo = instance || (await this.instanciaPadrao());
    const data = await this.request("POST", `/chat/findMessages/${alvo}`, {
      where: { key: { remoteJid } },
      page: pagina,
      offset: porPagina,
    });
    const bloco = data?.messages || data || {};
    const registros = Array.isArray(bloco.records)
      ? bloco.records
      : Array.isArray(bloco)
        ? bloco
        : [];
    return {
      total: Number(bloco.total ?? registros.length) || 0,
      paginas: Number(bloco.pages) || (registros.length ? 1 : 0),
      pagina: Number(bloco.currentPage ?? pagina) || pagina,
      registros,
    };
  }

  // Conversas conhecidas pela instancia. Usado para descobrir o jid REAL de um
  // telefone: contato de Android recente chega como "<numero>@lid" em vez de
  // "<numero>@s.whatsapp.net", e filtrar mensagem pelo jid errado devolve zero
  // sem nenhum erro (ver issue 1916 da Evolution).
  async findChats(instance = this.defaultInstance) {
    const alvo = instance || (await this.instanciaPadrao());
    try {
      const data = await this.request("POST", `/chat/findChats/${alvo}`, {});
      const bloco = data?.chats || data;
      if (Array.isArray(bloco)) return bloco;
      return Array.isArray(bloco?.records) ? bloco.records : [];
    } catch {
      return [];
    }
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
