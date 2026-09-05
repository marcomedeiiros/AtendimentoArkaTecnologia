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
 *
 * A SEGUNDA ARMADILHA, e a que produziu o "[object Object]" na tela: essa lista
 * nem sempre e de strings. Quando a Evolution valida o corpo com class-validator
 * ela devolve `message: [{property, constraints:{...}}]`, e o `join` de antes
 * transformava cada objeto em "[object Object]" -- literalmente. Objeto simples
 * (sem `message`/`error`) era pior ainda: caia no `return ""` e a frase da
 * Evolution sumia inteira.
 *
 * Agora a extracao DESCE na estrutura e, quando nao reconhece a forma, entrega
 * o JSON em vez de descartar. Regra: e melhor um JSON feio na tela do que um
 * erro sem conteudo -- o feio se investiga, o vazio nao.
 */
function textoDeErro(bruto, profundidade = 0) {
  if (bruto == null || profundidade > 5) return "";
  if (typeof bruto === "string") return bruto.trim();
  if (typeof bruto === "number" || typeof bruto === "boolean") return String(bruto);

  if (Array.isArray(bruto)) {
    return bruto
      .map((item) => textoDeErro(item, profundidade + 1))
      .filter(Boolean)
      .join("; ");
  }

  if (typeof bruto === "object") {
    // Os campos que a Evolution (e o Nest por baixo dela) usam para o texto.
    for (const campo of ["message", "error", "description", "detail", "reason"]) {
      const achado = textoDeErro(bruto[campo], profundidade + 1);
      if (achado) return achado;
    }
    // `constraints` do class-validator: { isString: "name must be a string" }.
    if (bruto.constraints && typeof bruto.constraints === "object") {
      const regras = Object.values(bruto.constraints)
        .map((v) => textoDeErro(v, profundidade + 1))
        .filter(Boolean)
        .join("; ");
      if (regras) return regras;
    }
    try {
      const json = JSON.stringify(bruto);
      if (json && json !== "{}") {
        return json.length > 400 ? `${json.slice(0, 400)}...` : json;
      }
    } catch {
      /* referencia circular -- devolve vazio, quem chama tem texto de reserva */
    }
  }
  return "";
}

function mensagemDaEvolution(data) {
  return (
    textoDeErro(data?.response?.message) ||
    textoDeErro(data?.message) ||
    textoDeErro(data?.error) ||
    textoDeErro(data)
  );
}

// O corpo da resposta guardado no diagnostico, com teto. Sem teto, um
// `fetchInstances` que devolve o historico inteiro entupiria o log e a tela.
function recorte(valor, limite = 800) {
  try {
    const texto = typeof valor === "string" ? valor : JSON.stringify(valor);
    if (!texto) return null;
    return texto.length > limite ? `${texto.slice(0, limite)}...` : texto;
  } catch {
    return null;
  }
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
      // CORPO QUE NAO E JSON TAMBEM E INFORMACAO. Um 502 do nginx ou um HTML de
      // erro faziam o `JSON.parse` estourar aqui dentro, o catch la embaixo
      // engolia tudo e o painel dizia "Evolution API indisponivel" -- quando na
      // verdade ela RESPONDEU, e a resposta explicava o problema.
      let data = null;
      let corpoNaoJson = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          corpoNaoJson = text;
        }
      }

      // O contexto que transforma "deu erro" em "deu erro AQUI". Vai junto do
      // AppError ate a tela e ate o log -- ver error.middleware.
      const diagnostico = {
        endpoint: path,
        metodo: method,
        httpStatus: response.status,
        resposta: recorte(data ?? corpoNaoJson),
      };

      if (!response.ok) {
        logger.warn("Evolution API erro", {
          ...diagnostico,
          // O objeto cru no log, alem do recorte: aqui nao ha limite de tela.
          corpo: data ?? corpoNaoJson,
        });
        const detalhe = mensagemDaEvolution(data) || textoDeErro(corpoNaoJson);

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
            "INSTANCIA_INEXISTENTE",
            diagnostico
          );
        }

        throw new AppError(
          detalhe || `A Evolution respondeu HTTP ${response.status} sem descrever o motivo`,
          502,
          "EVOLUTION_API_ERROR",
          diagnostico
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
        const detalhe = mensagemDaEvolution(data);
        logger.warn("Evolution API respondeu 200 com erro no corpo", {
          ...diagnostico,
          detalhe,
          corpo: data,
        });
        throw new AppError(
          detalhe || "A Evolution recusou a operacao",
          502,
          "EVOLUTION_API_ERROR",
          { ...diagnostico, erroNoCorpoCom200: true }
        );
      }

      return data;
    } catch (error) {
      if (error instanceof AppError) throw error;
      // AQUI a Evolution nao respondeu NADA: DNS, recusa de conexao, timeout.
      // E uma falha diferente de "ela respondeu um erro", e a tela precisa
      // saber a diferenca -- uma pede olhar o container, a outra pede olhar a
      // requisicao. Nenhuma das duas significa que o pareamento se perdeu.
      logger.error("Evolution API indisponivel", {
        endpoint: path,
        metodo: method,
        url,
        message: error.message,
        causa: error.cause?.code || error.code || null,
      });
      throw new AppError(
        `Evolution API indisponivel (${error.cause?.code || error.code || error.message}).`,
        503,
        "EVOLUTION_API_UNAVAILABLE",
        {
          endpoint: path,
          metodo: method,
          url,
          causa: error.cause?.code || error.code || null,
          message: error.message,
        }
      );
    }
  }

  async getConnectionState(instance = this.defaultInstance) {
    return this.request("GET", `/instance/connectionState/${instance}`);
  }

  /**
   * PAREAR SEM ESTAR NA FRENTE DO CELULAR.
   *
   * Com `numero`, a Evolution devolve um CODIGO DE PAREAMENTO de 8 caracteres
   * em vez de so o QR. Quem esta com o aparelho digita esse codigo em
   * WhatsApp > Aparelhos conectados > "Conectar com numero de telefone" -- nao
   * precisa apontar a camera para tela nenhuma. Na pratica: quem esta longe le
   * o codigo por telefone para quem esta perto.
   *
   * Como funciona do lado da Evolution: `?number=` entra no DTO
   * (`Object.assign(instance, request.query)` no abstract.router) e chega em
   * `connectToWhatsapp(number)`, que chama `requestPairingCode` do Baileys.
   *
   * A RESSALVA QUE IMPORTA: o `number` so e repassado quando a instancia esta
   * em `close` (instance.controller.ts:337). Em `connecting` a Evolution
   * devolve o QR que ja tem em memoria e IGNORA o numero -- entao pedir codigo
   * no meio de um handshake nao traz codigo nenhum. Quem chama precisa dizer
   * isso ao operador em vez de mostrar um campo vazio.
   *
   * O numero vai so com digitos, com DDI (ex.: 5527210300070).
   */
  async connect(instance = this.defaultInstance, numero = null) {
    const digitos = String(numero || "").replace(/\D/g, "");
    const query = digitos ? `?number=${encodeURIComponent(digitos)}` : "";
    return this.request("GET", `/instance/connect/${instance}${query}`);
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

  /**
   * TEXTO, CUSTE O QUE CUSTAR -- normaliza um campo que DEVERIA ser string.
   *
   * O caso que motivou isto: o "recado" chegou como `{ status, setAt }` e foi
   * parar direto no JSX, derrubando a Central inteira com o React #31
   * ("Objects are not valid as a React child").
   *
   * A culpa nao e de um bug pontual, e da forma do dado: no Baileys,
   * `fetchStatus` devolve `{ status, setAt }`, e a Evolution tenta desaninhar
   * com `status?.status`. Quando a versao do Baileys aninha um nivel a mais, o
   * desaninhamento fica pela metade e o objeto passa adiante. Confiar que o
   * outro lado vai entregar string e o que quebrou.
   *
   * Entao esta funcao desce enquanto encontrar `{ status: ... }` (com teto, por
   * causa de referencia circular) e devolve string ou `null` -- nunca objeto.
   * Vale para TODOS os campos de texto do perfil, nao so o recado: se um deles
   * mudar de forma amanha, ele vira `null` em vez de tela preta.
   */
  static _texto(bruto, profundidade = 0) {
    if (bruto == null || profundidade > 4) return null;
    if (typeof bruto === "string") return bruto.trim() || null;
    if (typeof bruto === "number" || typeof bruto === "boolean") return String(bruto);
    // `{ status, setAt }` e a forma que o Baileys usa para o recado; algumas
    // rotas devolvem `{ value }`. Qualquer outra coisa vira null de proposito.
    if (typeof bruto === "object") {
      return (
        EvolutionApiClient._texto(bruto.status, profundidade + 1) ??
        EvolutionApiClient._texto(bruto.value, profundidade + 1)
      );
    }
    return null;
  }

  /**
   * PERFIL PUBLICO DO CONTATO NO WHATSAPP -- foto, recado e dados de Business.
   *
   * E o que o proprio WhatsApp mostra a qualquer um que abra a conversa: a
   * frase do "recado" (o campo `status`), e, quando a conta e comercial, o
   * e-mail, o site e a descricao que a empresa publicou. Nada aqui e privado
   * nem exige permissao especial -- e a mesma tela que o atendente veria com o
   * celular na mao.
   *
   * Best-effort ate o fim. A Evolution devolve 400 quando o numero nao existe
   * no WhatsApp, e 503 quando ela mesma esta fora do ar; nenhum dos dois pode
   * derrubar a abertura do perfil, porque o resto dos dados (nome, empresa,
   * setor) vem do NOSSO banco e continua valendo. Por isso o retorno tem
   * sempre a mesma forma, com `null` onde nao deu.
   */
  async fetchPerfilContato(number, instance = this.defaultInstance) {
    try {
      const d = await this.request("POST", `/chat/fetchProfile/${instance}`, { number });
      const texto = EvolutionApiClient._texto;
      return {
        // `status` no vocabulario do Baileys e o "recado" da tela do WhatsApp
        // -- nao confundir com status de conexao nem de atendimento. Renomeado
        // aqui para o nome que aparece para o usuario.
        //
        // TODO campo de texto passa pelo `_texto`: e o unico ponto do sistema
        // que toca esse dado, e depois daqui a tela confia que sao strings.
        recado: texto(d?.status),
        foto: texto(d?.picture),
        nomeWhatsApp: texto(d?.name),
        existeNoWhatsApp: d?.numberExists !== false,
        comercial: !!d?.isBusiness,
        email: texto(d?.email),
        site: texto(d?.website),
        descricao: texto(d?.description),
      };
    } catch {
      return null;
    }
  }
}

module.exports = new EvolutionApiClient();
