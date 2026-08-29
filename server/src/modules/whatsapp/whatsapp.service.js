const chatbotService = require("../chatbot/chatbot.service");
const evolutionApi = require("../../infrastructure/external/evolution-api.client");
const instanciaRepository = require("../../infrastructure/repositories/instancia.repository");
const conversaRepository = require("../../infrastructure/repositories/conversa.repository");
const contatoService = require("../contatos/contato.service");
const midiaStorage = require("../../infrastructure/storage/midia.storage");
const { mapConversa } = require("../../shared/helpers/mapper.helper");
const bus = require("../../shared/events/event-bus");
const logger = require("../../config/logger");
const env = require("../../config/env");
const AppError = require("../../shared/errors/AppError");
const { limparTelefone } = require("../../shared/helpers/cnpj.helper");

// Teto da midia RECEBIDA do WhatsApp. O remetente e externo, entao este limite e
// o que impede alguem de encher o disco mandando arquivos enormes. O proprio
// WhatsApp ja limita perto disso.
const MAX_MIDIA_RECEBIDA = 20 * 1024 * 1024;

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

    // Resposta de BOTAO: o `id` (que enviamos = numero da opcao) casa direto com
    // as palavras-chave no motor; por isso vem ANTES do texto do botao, que pode
    // estar truncado pelo WhatsApp.
    if (msg.buttonsResponseMessage?.selectedButtonId) {
      return String(msg.buttonsResponseMessage.selectedButtonId).trim();
    }
    if (msg.buttonsResponseMessage?.selectedDisplayText) {
      return msg.buttonsResponseMessage.selectedDisplayText.trim();
    }
    // Resposta de LISTA: idem, o rowId primeiro; senao o titulo da linha.
    if (msg.listResponseMessage?.singleSelectReply?.selectedRowId) {
      return String(msg.listResponseMessage.singleSelectReply.selectedRowId).trim();
    }
    if (msg.listResponseMessage?.title) return msg.listResponseMessage.title.trim();
    // Formato "interactive" (algumas versoes): id da opcao escolhida.
    if (msg.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson) {
      try {
        const p = JSON.parse(msg.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson);
        const id = p?.id || p?.selectedId || p?.selectedRowId;
        if (id) return String(id).trim();
      } catch { /* ignora json invalido */ }
    }

    // ── VOTO DE ENQUETE ──────────────────────────────────────────────────────
    //
    // A enquete e o menu clicavel que funciona no transporte atual (botao e
    // lista dependem do `native_flow`, que a 2.3.7 nao monta). Mas o voto e a
    // parte fragil: no Baileys ele vem CRIPTOGRAFADO
    // (`pollUpdateMessage.vote.encPayload`), e so chega legivel aqui se a
    // Evolution decifrar e expor o nome da opcao -- comportamento que varia
    // entre versoes.
    //
    // Por isso duas coisas:
    //
    //   1. varios formatos plausiveis sao tentados, porque nao ha um contrato
    //      estavel para isso;
    //   2. quando NENHUM casa, o formato bruto vai para o log. E deliberado: um
    //      voto que nao vira texto e indistinguivel de "cliente nao respondeu",
    //      e sem o retrato do payload a proxima investigacao comeca do zero. O
    //      primeiro voto real diz exatamente o que esta instalacao manda.
    //
    // O que volta e o NOME da opcao (nao um id), e o motor casa por rotulo --
    // ver `casarOpcao` no chatbot.engine.
    const voto =
      msg.pollUpdateMessage?.vote?.selectedOptions?.[0]?.name ||
      msg.pollUpdateMessage?.vote?.selectedOptions?.[0] ||
      msg.pollUpdateMessage?.selectedName ||
      msg.pollUpdateMessage?.name ||
      payload?.data?.pollUpdates?.[0]?.vote?.name ||
      payload?.data?.selectedOptions?.[0]?.name ||
      null;
    if (typeof voto === "string" && voto.trim()) return voto.trim();

    if (msg.pollUpdateMessage || payload?.data?.pollUpdates) {
      logger.warn("Voto de enquete recebido em formato NAO reconhecido", {
        // Recorte pequeno de proposito: e para identificar o formato, nao para
        // guardar conteudo de conversa no log.
        payload: JSON.stringify(msg.pollUpdateMessage || payload?.data?.pollUpdates).slice(0, 600),
      });
    }

    return null;
  }

  /**
   * A mensagem foi ENCAMINHADA? Informação real do WhatsApp, não palpite.
   *
   * O Baileys entrega isso no `contextInfo` de cada tipo de mensagem:
   *   - `isForwarded`: booleano;
   *   - `forwardingScore`: quantas vezes já foi repassada (>0 = encaminhada;
   *     >=5 é o "encaminhada muitas vezes" do aplicativo).
   *
   * O `contextInfo` fica DENTRO do nó do tipo (extendedTextMessage,
   * imageMessage, ...), e não na raiz -- por isso varremos os nós conhecidos.
   * Sem nenhum dos dois campos, a resposta é "não": marcar por aparência criaria
   * um selo falso.
   */
  extrairEncaminhada(payload) {
    const msg = payload?.data?.message || payload?.message;
    if (!msg || typeof msg !== "object") return null;

    const nos = [
      msg.extendedTextMessage, msg.imageMessage, msg.videoMessage, msg.audioMessage,
      msg.documentMessage, msg.documentWithCaptionMessage?.message?.documentMessage,
      msg.stickerMessage, msg.locationMessage, msg.contactMessage, msg.contextInfo && msg,
    ].filter(Boolean);

    for (const no of nos) {
      const ctx = no.contextInfo;
      if (!ctx) continue;
      const vezes = Number(ctx.forwardingScore) || 0;
      if (ctx.isForwarded === true || vezes > 0) {
        return { encaminhada: true, encaminhadaVezes: vezes || 1 };
      }
    }
    return null;
  }

  // Detecta mídia no payload do webhook (Baileys/Evolution). Retorna o metadata
  // com `tipo` (imagem/video/audio/documento/localizacao/contato) ou null.
  // Os bytes NÃO vêm aqui: a `url` é criptografada; quem baixa é o webhook.
  extrairMidia(payload) {
    const msg = payload?.data?.message || payload?.message;
    if (!msg || typeof msg !== "object") return null;

    const doc = msg.documentMessage || msg.documentWithCaptionMessage?.message?.documentMessage;

    // FIGURINHA (sticker). Precisa vir ANTES de imageMessage: algumas versoes da
    // Evolution mandam os dois campos no mesmo payload, e casar por imagem
    // primeiro transformaria a figurinha numa imagem estatica.
    //
    // Esta era a causa raiz de "figurinha nao aparece": nao havia ramo nenhum
    // para `stickerMessage` aqui. `extrairMidia` devolvia null, `texto` tambem
    // era null, e o webhook respondia "dados_incompletos" -- a figurinha nao
    // chegava a entrar no sistema. Nao era problema de renderizacao: nao havia
    // o que renderizar.
    //
    // Figurinha do WhatsApp e sempre WebP (animada ou nao) e nunca tem legenda.
    if (msg.stickerMessage) {
      return {
        tipo: "figurinha",
        mimetype: msg.stickerMessage.mimetype || "image/webp",
        animada: !!msg.stickerMessage.isAnimated,
        fileName: "figurinha.webp",
      };
    }
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

    if (event === "messages.update" || event === "MESSAGES_UPDATE") {
      return this._processarAck(body);
    }

    if (
      event === "messages.upsert" ||
      event === "MESSAGES_UPSERT" ||
      body?.data?.key ||
      body?.key
    ) {
      // QUANTO DEMOROU, DE VERDADE.
      //
      // "a mensagem demora para chegar" pode ser o webhook, o download da
      // midia, o fluxo do bot, o envio da resposta ou a rede da Evolution --
      // camadas diferentes, correcoes diferentes. Sem numero, a conversa vira
      // troca de palpites.
      //
      // `atrasoWhatsApp` e o tempo entre o WhatsApp carimbar a mensagem e ela
      // chegar aqui: se ELE for grande, o gargalo esta antes do nosso codigo
      // (fila da Evolution, rede) e nada que eu otimize aqui dentro resolve.
      const t0 = Date.now();
      const carimbo = Number(body?.data?.messageTimestamp || body?.messageTimestamp) || null;
      const r = await this._processarMensagem(body, instance);
      const ms = Date.now() - t0;
      // So registra o que interessa: processamento lento, ou atraso de chegada.
      const atrasoWhatsApp = carimbo ? Date.now() - carimbo * 1000 : null;
      if (ms > 500 || (atrasoWhatsApp != null && atrasoWhatsApp > 5000)) {
        logger.warn("Recebimento lento", {
          processamentoMs: ms,
          atrasoWhatsAppMs: atrasoWhatsApp,
          motivo: r?.motivo || null,
          conversaId: r?.conversaId || null,
        });
      } else {
        logger.debug("Recebimento", { processamentoMs: ms, atrasoWhatsAppMs: atrasoWhatsApp });
      }
      return r;
    }

    logger.debug("Webhook ignorado", { event, instance });
    return { recebido: true, processado: false, evento: event || "desconhecido" };
  }

  async _processarConexao(body, instanceName) {
    const state = body?.data?.state || body?.data?.status || body?.state;
    const conectado = state === "open" || state === "connected";

    const instancia = await instanciaRepository.findByNome(instanceName);
    const eraConectado = instancia?.conectado;
    if (instancia) {
      await instanciaRepository.updateConectado(instancia.id, conectado);
    }

    // Acabou de parear: o WhatsApp envia a agenda logo apos a conexao, entao
    // importamos os contatos reais. Roda em segundo plano e com um atraso para
    // dar tempo da Evolution receber a sincronizacao do aparelho.
    if (conectado && !eraConectado) {
      setTimeout(() => {
        contatoService
          .sincronizarDoWhatsApp(instanceName)
          .then((r) => logger.info("Agenda do WhatsApp importada", r))
          .catch((e) => logger.warn("Falha ao importar agenda", { message: e.message }));
      }, 15000);
    }

    return { recebido: true, evento: "connection.update", conectado, state };
  }

  // ACK de entrega/leitura das mensagens que NOS enviamos. A Evolution manda o
  // status em maiusculas (Baileys); traduzimos para o vocabulario da UI.
  async _processarAck(body) {
    const data = body?.data || body;
    const waMessageId = data?.key?.id || data?.keyId || null;
    const bruto = String(data?.status || data?.update?.status || "").toUpperCase();

    const MAPA = {
      PENDING: "enviando",
      SERVER_ACK: "enviada",
      DELIVERY_ACK: "entregue",
      READ: "lida",
      PLAYED: "lida",
      ERROR: "erro",
    };
    const status = MAPA[bruto];

    if (!waMessageId || !status) {
      return { recebido: true, processado: false, motivo: "ack_sem_dados", bruto };
    }

    const r = await conversaRepository.atualizarStatusPorWaId(waMessageId, status);
    if (!r) {
      // Mensagem que nao saiu daqui (ex.: enviada pelo celular do atendente).
      return { recebido: true, processado: false, motivo: "mensagem_desconhecida" };
    }
    // ACK repetido ou atrasado: nada mudou, nada a emitir.
    if (!r.conversa) {
      return { recebido: true, processado: false, motivo: "ack_sem_mudanca", status };
    }

    // PATCH, e nao a conversa inteira.
    //
    // Aqui havia um `findById` completo + `mapConversa` a cada ACK. Como o
    // WhatsApp manda ate quatro por mensagem (PENDING, SERVER_ACK,
    // DELIVERY_ACK, READ), UMA mensagem enviada custava quatro leituras e
    // quatro serializacoes do historico inteiro -- medido: 261ms de CPU e
    // 1,08MB de SSE num fio de 800 mensagens, so para mudar o risquinho.
    bus.emitStatusMensagem({
      conversaId: r.conversa.id,
      mensagemId: r.mensagem.id,
      status,
      versao: r.conversa.versao,
      setor: r.conversa.setor,
    });

    return { recebido: true, processado: true, status, waMessageId };
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

    // Encaminhamento vale para QUALQUER tipo -- inclusive texto puro, que não
    // passa por `extrairMidia`. Por isso é lido em separado e juntado depois.
    const encaminhada = this.extrairEncaminhada(body);
    let midia = this.extrairMidia(body);
    // Para tipos com arquivo, tenta obter os bytes (base64 no payload quando o
    // "Webhook Base64" está ligado, senão baixa via getBase64FromMediaMessage).
    if (midia && midia.tipo !== "localizacao" && midia.tipo !== "contato") {
      // A Evolution acomoda o base64 em lugares diferentes conforme a versao e o
      // "Webhook Base64": no proprio audioMessage, na raiz da mensagem, ou solto.
      const msg = data?.message || {};
      // `stickerMessage` entra na lista: sem ele o base64 embutido da
      // figurinha nunca era encontrado e a midia chegava vazia.
      const doMidia =
        msg.audioMessage || msg.imageMessage || msg.videoMessage || msg.documentMessage ||
        msg.stickerMessage || {};
      let base64 =
        doMidia.base64 ||
        msg.base64 ||
        data?.base64 ||
        body?.base64 ||
        null;
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
        // Grava os bytes em disco e guarda so o caminho (o base64 no banco era o
        // que inchava tudo). Se falhar, mantem inline para nao perder a midia.
        let salvo = null;
        try {
          // Teto explicito para midia RECEBIDA: o remetente e externo (qualquer
          // um que tenha o numero), entao um arquivo enorme nao pode encher o
          // disco. Acima disso a mensagem entra sem os bytes.
          salvo = await midiaStorage.salvarDataUrl(url, mimetype, { maxBytes: MAX_MIDIA_RECEBIDA });
        } catch (e) {
          logger.warn("Falha ao gravar midia recebida em disco; mantendo inline", {
            message: e.message,
          });
        }
        if (salvo) {
          midia = { ...midia, arquivo: salvo.arquivo, mimetype };
        } else {
          // Nao gravou (grande demais ou falha): NAO guardamos o base64 no banco
          // -- era justamente isso que inchava tudo. A mensagem entra sem os
          // bytes e a Central mostra "[Midia indisponivel]".
          logger.warn("Midia recebida nao armazenada (tamanho ou falha de escrita)", {
            tipo: midia.tipo,
            mimetype,
            waMessageId: key?.id || null,
          });
          midia = { ...midia, mimetype };
        }
      } else {
        // Sem bytes o audio vira "[Mídia indisponível]" na Central. Deixamos o
        // rastro no log para diagnosticar: quase sempre e o "Webhook Base64"
        // desligado na Evolution ou o getBase64 indisponivel naquela versao.
        logger.warn("Mídia recebida sem bytes (base64 ausente)", {
          tipo: midia.tipo,
          instance: instanceName,
          waMessageId: key?.id || null,
        });
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
      encaminhada,
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
      // NAO expor o webhookSecret aqui: /status e aberto a qualquer conta
      // logada. O segredo so sai em /detalhes, que e restrito a Administrador.
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
      // Restrito a Administrador na rota; a tela de Integracao mostra o segredo
      // para configurar o webhook na Evolution.
      webhookSecret: env.webhookSecret,
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

  // Usado pelo n8n para responder o cliente. Envia pelo WhatsApp e registra a
  // mensagem na conversa (para aparecer na Central e no historico).
  async responderCliente({ conversaId, telefone, texto, instanceName }) {
    const conteudo = String(texto || "").trim();
    if (!conteudo) {
      throw new AppError("Informe o texto da resposta", 400, "TEXTO_OBRIGATORIO");
    }

    let conversa = null;
    if (conversaId) {
      conversa = await conversaRepository.findById(conversaId);
      if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");
    } else if (telefone) {
      const nome = instanceName || env.evolutionApi.instance;
      const instancia = await instanciaRepository.findByNome(nome);
      if (instancia) {
        conversa = await conversaRepository.findByTelefone(
          instancia.id,
          limparTelefone(String(telefone))
        );
      }
    }

    if (!conversa && !telefone) {
      throw new AppError("Informe conversaId ou telefone", 400, "DESTINO_OBRIGATORIO");
    }

    const destino = conversa?.telefone || limparTelefone(String(telefone));
    await evolutionApi.sendText(destino, conteudo, instanceName || env.evolutionApi.instance);

    // Origem "bot": a bolha aparece como automacao, nao como um atendente.
    if (conversa) {
      await conversaRepository.addMensagem(conversa.id, "bot", conteudo);
      const atualizada = await conversaRepository.findById(conversa.id);
      if (atualizada) bus.emitConversa(mapConversa(atualizada));
    }

    return { enviado: true, telefone: destino, conversaId: conversa?.id || null };
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
