const conversaRepository = require("../../infrastructure/repositories/conversa.repository");
const instanciaRepository = require("../../infrastructure/repositories/instancia.repository");
const evolutionApi = require("../../infrastructure/external/evolution-api.client");
const transcricaoClient = require("../../infrastructure/external/transcricao.client");
const { mapConversa } = require("../../shared/helpers/mapper.helper");
const { limparCnpj, cnpjValido, mascararCnpj, normalizarTelefoneBr } = require("../../shared/helpers/cnpj.helper");
const { normalizarSetor, podeAcessarSetor } = require("../../shared/helpers/setor.helper");
const parceiroRepository = require("../../infrastructure/repositories/parceiro.repository");
const bus = require("../../shared/events/event-bus");
const AppError = require("../../shared/errors/AppError");
const env = require("../../config/env");

// Guard de autorizacao por setor para operacoes por id/mensagem.
//
// A leitura (listar/obter) ja filtrava por setor, mas TODA acao de escrita
// (atender, responder, apagar, mudar status/setor, remover...) recebia so o id
// vindo do front e agia sem conferir -- um IDOR classico: um Tecnico que nao
// PODE LER uma conversa do Financeiro ainda conseguia apaga-la ou responder ao
// cliente sabendo o id. Este guard fecha isso no servidor.
//
// `userCargo` vem do token ja validado (req.user.cargo). Quando null (chamadas
// internas do bot/n8n, que tem acesso total) o guard e um no-op de proposito.
function exigirAcessoSetor(userCargo, setorConversa) {
  if (userCargo && !podeAcessarSetor(userCargo, setorConversa)) {
    throw new AppError("Sem permissao para acessar este setor", 403, "FORBIDDEN_SECTOR");
  }
}

class ConversaService {
  async listar(filtros = {}, userCargo = null) {
    const conversas = await conversaRepository.findAll(filtros);
    const dto = conversas.map(mapConversa);
    if (!userCargo || userCargo === "Administrador") return dto;
    return dto.filter((c) => podeAcessarSetor(userCargo, c.setor));
  }

  async obter(id, userCargo = null) {
    const conversa = await conversaRepository.findById(id);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");
    const dto = mapConversa(conversa);
    exigirAcessoSetor(userCargo, dto.setor);
    return dto;
  }

  async atender(id, atendenteId = null, userCargo = null) {
    const conversa = await conversaRepository.findById(id);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");
    exigirAcessoSetor(userCargo, conversa.setor);

    // Auto-recuperacao da foto: se a Evolution estava fora (ou sem foto) quando
    // a conversa nasceu, tentamos de novo ao assumir o atendimento.
    if (!conversa.fotoUrl) {
      const foto = await evolutionApi
        .fetchProfilePictureUrl(conversa.telefone, env.evolutionApi.instance)
        .catch(() => null);
      if (foto) await conversaRepository.update(id, { fotoUrl: foto });
    }

    const atualizada = await conversaRepository.update(id, {
      statusAtendimento: "aberta",
      lido: true,
      naoLidas: 0,
      atendenteId,
      // So marca o inicio do atendimento na primeira vez (nao sobrescreve em reabertura).
      atendidoEm: conversa.atendidoEm || new Date(),
    });

    return this._emitir(atualizada);
  }

  /**
   * Inicia uma conversa a partir de um numero digitado pelo operador.
   *
   * Existia um buraco aqui: `POST /whatsapp/enviar` (usado pelo Envio em Massa)
   * dispara a mensagem, mas so registra a bolha se a conversa JA existir. Para
   * um numero novo, a mensagem saia no celular do cliente e nada aparecia na
   * Central -- a conversa so nascia quando ele respondesse, pelo webhook. Ou
   * seja: o atendente mandava e ficava sem trilha do que mandou.
   *
   * Aqui a conversa e criada JA ABERTA e atribuida a quem enviou. Aberta por
   * dois motivos: quem inicia esta assumindo o atendimento (nao faz sentido
   * entrar na fila de pendentes um contato que nos mesmos procuramos), e
   * `enviarMensagem` recusa mensagem da equipe fora de conversa aberta.
   *
   * O envio em si e delegado a `enviarMensagem`, para herdar de graca o
   * waMessageId, o status de entrega e a emissao no SSE.
   */
  async iniciarConversa({ telefone, nome, setor, texto, atendenteId = null, userCargo = null }) {
    const conteudo = String(texto || "").trim();
    if (!conteudo) {
      throw new AppError("Escreva a mensagem que abre a conversa", 400, "TEXTO_OBRIGATORIO");
    }

    const numero = normalizarTelefoneBr(telefone);
    if (!numero) {
      throw new AppError(
        "Numero invalido. Use DDD + numero, por exemplo 27 99999-0000.",
        400,
        "TELEFONE_INVALIDO"
      );
    }

    const setorFinal = normalizarSetor(setor);
    // Nao deixa abrir conversa num setor que a pessoa nem poderia ler depois.
    exigirAcessoSetor(userCargo, setorFinal);
    const nomeInstancia = env.evolutionApi.instance;
    const instancia = await instanciaRepository.findByNome(nomeInstancia);
    if (!instancia) {
      throw new AppError(
        "Nenhuma instancia do WhatsApp registrada. Conecte em Integracao WhatsApp antes de iniciar conversas.",
        400,
        "INSTANCIA_AUSENTE"
      );
    }

    // Reaproveita conversa em andamento com o mesmo numero: criar outra deixaria
    // o mesmo cliente em duas linhas da lista, cada uma com metade do historico.
    // (`findByTelefone` so considera pendente/aberta, entao um atendimento ja
    // encerrado nao e reaberto por um contato novo -- ele vira conversa nova.)
    const existente = await conversaRepository.findByTelefone(instancia.id, numero);

    let conversaId;
    if (existente) {
      conversaId = existente.id;
      await conversaRepository.update(existente.id, {
        statusAtendimento: "aberta",
        setor: setorFinal,
        lido: true,
        naoLidas: 0,
        // Nao rouba a conversa de quem ja estava nela.
        atendenteId: existente.atendenteId || atendenteId,
        atendidoEm: existente.atendidoEm || new Date(),
      });
    } else {
      const criada = await conversaRepository.create({
        instanciaId: instancia.id,
        // Sem nome informado, o proprio numero e o rotulo. O webhook atualiza
        // para o nome do perfil quando o cliente responder.
        cliente: String(nome || "").trim() || numero,
        telefone: numero,
        statusAtendimento: "aberta",
        setor: setorFinal,
        lido: true,
        naoLidas: 0,
        atendenteId,
        atendidoEm: new Date(),
      });
      conversaId = criada.id;

      // Foto de perfil e best-effort: se a Evolution estiver fora, a conversa
      // nasce sem foto e o avatar cai nas iniciais.
      const fotoUrl = await evolutionApi
        .fetchProfilePictureUrl(numero, nomeInstancia)
        .catch(() => null);
      if (fotoUrl) await conversaRepository.update(conversaId, { fotoUrl });
    }

    const dto = await this.enviarMensagem(conversaId, conteudo, "equipe");
    return { ...dto, criada: !existente };
  }

  // So a conversa ABERTA aceita mensagem do operador.
  //
  // Em "pendente" ninguem assumiu o atendimento ainda: responder dali passaria
  // por cima da fila e deixaria a conversa sem dono, alem de permitir que dois
  // atendentes respondessem o mesmo cliente sem saber um do outro. Em "fechada"
  // o atendimento ja foi encerrado.
  //
  // A checagem olha a origem porque o bot e o n8n tambem passam por aqui, com
  // origem "bot" -- e esses precisam continuar respondendo na fila.
  _exigirAberta(conversa, origem) {
    if (origem !== "equipe") return;
    if (conversa.statusAtendimento === "aberta") return;

    const motivo =
      conversa.statusAtendimento === "pendente"
        ? "Assuma a conversa em Atender antes de responder."
        : "Conversa fechada. Reabra antes de responder.";
    throw new AppError(motivo, 409, "CONVERSA_NAO_ABERTA");
  }

  // Guard de setor para operacoes que chegam por mensagemId: resolve a conversa
  // dona da mensagem e aplica a mesma regra das operacoes por conversa.
  async _exigirAcessoMensagem(mensagem, userCargo) {
    if (!userCargo) return; // chamada interna (bot/n8n): acesso total
    const conversa = await conversaRepository.findById(mensagem.conversaId);
    exigirAcessoSetor(userCargo, conversa?.setor);
  }

  async enviarMensagem(id, texto, origem = "equipe", respondendoAId = null, userCargo = null) {
    const conversa = await conversaRepository.findById(id);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");
    exigirAcessoSetor(userCargo, conversa.setor);
    this._exigirAberta(conversa, origem);

    // "Responder" do WhatsApp: cita a mensagem original na bolha do cliente.
    let quoted = null;
    if (respondendoAId) {
      const citada = await conversaRepository.findMensagem(respondendoAId);
      if (citada?.waMessageId) {
        quoted = {
          key: {
            remoteJid: `${conversa.telefone}@s.whatsapp.net`,
            fromMe: citada.origem !== "cliente",
            id: citada.waMessageId,
          },
          message: { conversation: citada.texto },
        };
      }
    }

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

    const msgLocal = await conversaRepository.addMensagem(
      id,
      origem === "equipe" ? "equipe" : "bot",
      texto.trim(),
      null,
      null,
      { status: "enviando", respondendoAId: respondendoAId || null }
    );

    for (const msg of mensagensExtras) {
      await this._enviarWhatsApp(conversa.telefone, msg.texto);
    }

    const envio = await this._enviarWhatsApp(conversa.telefone, texto.trim(), quoted);
    await conversaRepository.vincularWaMessageId(
      msgLocal.id,
      envio.waMessageId,
      envio.ok ? "enviada" : "erro"
    );

    const atualizada = await conversaRepository.findById(id);
    return this._emitir(atualizada);
  }

  // Envia mídia (imagem/vídeo/documento/áudio/localização) pela Evolution e
  // registra a mensagem. `media` aceita URL pública ou base64 (data URL). Para
  // a bolha do operador renderizar de volta, guardamos a própria mídia em
  // metadata.url.
  async enviarMidia(id, payload, origem = "equipe", userCargo = null) {
    const conversa = await conversaRepository.findById(id);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");
    exigirAcessoSetor(userCargo, conversa.setor);
    this._exigirAberta(conversa, origem);

    const { tipo, media, mimetype, fileName, caption, latitude, longitude, name, address } = payload;
    const rotulos = {
      imagem: "[Imagem]", video: "[Vídeo]", documento: "[Documento]",
      audio: "[Áudio]", localizacao: "[Localização]",
    };

    // O front manda data URL (base64 com prefixo). A Evolution espera base64 cru
    // ou URL http; a bolha do operador renderiza a data URL. Separamos os dois.
    const ehDataUrl = typeof media === "string" && media.startsWith("data:");
    const paraEvolution = ehDataUrl ? media.split(",")[1] : media;
    const urlBolha = ehDataUrl || (typeof media === "string" && media.startsWith("http"))
      ? media
      : `data:${mimetype || "application/octet-stream"};base64,${media}`;

    try {
      if (tipo === "audio") {
        await evolutionApi.sendWhatsAppAudio(conversa.telefone, paraEvolution, env.evolutionApi.instance);
      } else if (tipo === "localizacao") {
        await evolutionApi.sendLocation(conversa.telefone, { latitude, longitude, name, address }, env.evolutionApi.instance);
      } else {
        const mediatype = tipo === "imagem" ? "image" : tipo === "video" ? "video" : "document";
        await evolutionApi.sendMedia(
          conversa.telefone,
          { mediatype, media: paraEvolution, mimetype, fileName, caption },
          env.evolutionApi.instance
        );
      }
    } catch (err) {
      throw new AppError(`Falha ao enviar mídia pela Evolution: ${err.message}`, 502, "EVOLUTION_MEDIA_ERROR");
    }

    const metadata = tipo === "localizacao"
      ? { tipo, latitude, longitude, name, address }
      : { tipo, url: urlBolha, mimetype: mimetype || null, fileName: fileName || null, caption: caption || null };

    await conversaRepository.addMensagem(id, origem, caption || rotulos[tipo] || "[Mídia]", metadata);

    const atualizada = await conversaRepository.findById(id);
    return this._emitir(atualizada);
  }

  // Transcreve o audio de uma mensagem (fala -> texto) e guarda o resultado no
  // metadata, para nao pagar/reprocessar de novo no proximo F5. Sob demanda: so
  // roda quando o operador clica em "Transcrever".
  async transcreverAudio(mensagemId, userCargo = null) {
    const mensagem = await conversaRepository.findMensagem(mensagemId);
    if (!mensagem) throw new AppError("Mensagem nao encontrada", 404, "NOT_FOUND");
    await this._exigirAcessoMensagem(mensagem, userCargo);

    const meta = mensagem.metadata || {};
    if (meta.tipo !== "audio") {
      throw new AppError("Esta mensagem nao e um audio.", 400, "NAO_E_AUDIO");
    }
    // Ja transcrito antes: devolve o cache, sem chamar a API de novo.
    if (meta.transcricao) return { transcricao: meta.transcricao, cache: true };

    // A midia recebida/enviada guarda a data URL em `url`. Se por acaso for um
    // link http (raro), baixa os bytes antes de mandar transcrever.
    let media = meta.url;
    if (typeof media === "string" && media.startsWith("http")) {
      const resp = await fetch(media);
      const buf = Buffer.from(await resp.arrayBuffer());
      media = `data:${meta.mimetype || "audio/ogg"};base64,${buf.toString("base64")}`;
    }
    if (!media) throw new AppError("Audio indisponivel para transcrever.", 400, "AUDIO_INDISPONIVEL");

    const texto = await transcricaoClient.transcrever(media, meta.mimetype);
    const transcricao = texto || "(nao foi possivel entender o audio)";

    await conversaRepository.atualizarMetadata(mensagemId, { ...meta, transcricao });

    // Reemite a conversa para o painel refletir a transcricao em tempo real.
    const conversa = await conversaRepository.findById(mensagem.conversaId);
    if (conversa) this._emitir(conversa);

    return { transcricao, cache: false };
  }

  // Encaminha uma mensagem existente para outra conversa (o WhatsApp reenvia o
  // conteudo; nao existe "forward nativo" pela API, entao reenviamos o texto).
  async encaminharMensagem(mensagemId, conversaDestinoId, userCargo = null) {
    const original = await conversaRepository.findMensagem(mensagemId);
    if (!original) throw new AppError("Mensagem nao encontrada", 404, "NOT_FOUND");
    // Precisa poder ler a ORIGEM (senao encaminhar seria uma leitura disfarcada)
    // e escrever no DESTINO.
    await this._exigirAcessoMensagem(original, userCargo);

    const destino = await conversaRepository.findById(conversaDestinoId);
    if (!destino) throw new AppError("Conversa de destino nao encontrada", 404, "NOT_FOUND");
    exigirAcessoSetor(userCargo, destino.setor);

    const meta = original.metadata || null;
    if (meta?.tipo && meta.tipo !== "texto" && meta.url) {
      return this.enviarMidia(conversaDestinoId, {
        tipo: meta.tipo,
        media: meta.url,
        mimetype: meta.mimetype,
        fileName: meta.fileName,
        caption: meta.caption,
      });
    }

    return this.enviarMensagem(conversaDestinoId, original.texto, "equipe");
  }

  // Edicao de mensagem propria, como no WhatsApp. Se a Evolution recusar
  // (versao sem suporte ou janela de 15 min expirada), nada e alterado.
  async editarMensagem(mensagemId, novoTexto, userCargo = null) {
    const msg = await conversaRepository.findMensagem(mensagemId);
    if (!msg) throw new AppError("Mensagem nao encontrada", 404, "NOT_FOUND");
    await this._exigirAcessoMensagem(msg, userCargo);
    if (msg.origem === "cliente") {
      throw new AppError("Só é possível editar mensagens enviadas por você", 400, "EDICAO_NAO_PERMITIDA");
    }

    const texto = String(novoTexto || "").trim();
    if (!texto) throw new AppError("Informe o novo texto", 400, "TEXTO_OBRIGATORIO");

    const conversa = await conversaRepository.findById(msg.conversaId);

    if (msg.waMessageId) {
      try {
        await evolutionApi.editarMensagem(
          {
            number: conversa.telefone,
            key: {
              remoteJid: `${conversa.telefone}@s.whatsapp.net`,
              fromMe: true,
              id: msg.waMessageId,
            },
            texto,
          },
          env.evolutionApi.instance
        );
      } catch (err) {
        throw new AppError(
          `Nao foi possivel editar no WhatsApp: ${err.message}`,
          502,
          "EDICAO_FALHOU"
        );
      }
    }

    await conversaRepository.editarMensagem(mensagemId, texto);
    return this._emitir(await conversaRepository.findById(msg.conversaId));
  }

  // Apaga a mensagem para todos. Nas mensagens que NOS enviamos, dispara o
  // "apagar para todos" do WhatsApp (some tambem no aparelho do cliente). Em
  // mensagem do cliente isso e impossivel pelo WhatsApp -- entao ela some so do
  // painel. Em ambos os casos removemos a linha aqui, entao some da Central.
  async apagarMensagem(mensagemId, userCargo = null) {
    const msg = await conversaRepository.findMensagem(mensagemId);
    if (!msg) throw new AppError("Mensagem nao encontrada", 404, "NOT_FOUND");

    const conversa = await conversaRepository.findById(msg.conversaId);
    exigirAcessoSetor(userCargo, conversa?.setor);
    const nossa = msg.origem !== "cliente";

    if (msg.waMessageId && nossa && conversa) {
      try {
        await evolutionApi.apagarMensagem(
          {
            id: msg.waMessageId,
            remoteJid: `${conversa.telefone}@s.whatsapp.net`,
            fromMe: true,
          },
          env.evolutionApi.instance
        );
      } catch (err) {
        throw new AppError(
          `Nao foi possivel apagar no WhatsApp: ${err.message}`,
          502,
          "APAGAR_FALHOU"
        );
      }
    }

    // Soft-delete: some do WhatsApp do cliente (acima), mas a mensagem continua
    // no banco marcada como apagada, para o Registro/Visao Geral manter o log
    // completo. Sem isto, "Apagar para todos" tambem apagava do historico.
    await conversaRepository.marcarMensagemApagada(mensagemId);
    return this._emitir(await conversaRepository.findById(msg.conversaId));
  }

  async solicitarCnpj(id, userCargo = null) {
    const conversa = await conversaRepository.findById(id);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");
    exigirAcessoSetor(userCargo, conversa.setor);
    const msg = "[Arka Tecnologia]: Para prosseguirmos e verificar beneficios de parceiro, informe o CNPJ da sua empresa:";
    return this.enviarMensagem(id, msg, "bot");
  }

  async validarCnpjManual(id, cnpj, userCargo = null) {
    const conversa = await conversaRepository.findById(id);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");
    exigirAcessoSetor(userCargo, conversa.setor);

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

    return this._emitir(await conversaRepository.findById(id));
  }

  async atualizarStatus(id, status, userCargo = null) {
    const conversa = await conversaRepository.findById(id);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");
    exigirAcessoSetor(userCargo, conversa.setor);

    const data = { statusAtendimento: status };
    if (status === "fechada") {
      data.fechadoEm = new Date();
      data.lido = true;
      data.naoLidas = 0;
    } else if (status === "aberta") {
      // Reabertura: limpa o fechamento e garante marca de atendimento.
      data.fechadoEm = null;
      data.atendidoEm = conversa.atendidoEm || new Date();
    }

    const atualizada = await conversaRepository.update(id, data);
    return this._emitir(atualizada);
  }

  // Favoritar / fixar / arquivar / ocultar. Nenhuma delas apaga a conversa:
  // arquivada e oculta apenas somem da listagem quando o filtro esta desligado.
  async atualizarFlags(id, flags, userCargo = null) {
    const conversa = await conversaRepository.findById(id);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");
    exigirAcessoSetor(userCargo, conversa.setor);

    const data = {};
    for (const campo of ["favorita", "fixada", "arquivada", "oculta"]) {
      if (flags[campo] !== undefined) data[campo] = flags[campo];
    }
    if (Object.keys(data).length === 0) return mapConversa(conversa);

    const atualizada = await conversaRepository.update(id, data);
    return this._emitir(atualizada);
  }

  async marcarLido(id, userCargo = null) {
    const conversa = await conversaRepository.findById(id);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");
    exigirAcessoSetor(userCargo, conversa.setor);
    const atualizada = await conversaRepository.zerarNaoLidas(id);
    return this._emitir(atualizada);
  }

  async atualizarSetor(id, setor, userCargo = null) {
    const conversa = await conversaRepository.findById(id);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");
    // Precisa poder mexer na conversa de ORIGEM. O destino fica livre de
    // proposito: triar/encaminhar uma conversa "Geral" para o setor certo e
    // justamente o fluxo esperado, e mover nao expoe conteudo nenhum.
    exigirAcessoSetor(userCargo, conversa.setor);
    const atualizada = await conversaRepository.update(id, { setor });
    return this._emitir(atualizada);
  }

  async avaliarAtendimento(id, { avaliacao, feedback }, userCargo = null) {
    const conversa = await conversaRepository.findById(id);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");
    exigirAcessoSetor(userCargo, conversa.setor);
    const atualizada = await conversaRepository.update(id, {
      avaliacao: Number(avaliacao) || null,
      feedback: feedback ? String(feedback).trim() : null,
    });
    return this._emitir(atualizada);
  }

  async remover(id, userCargo = null) {
    const conversa = await conversaRepository.findById(id);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");
    exigirAcessoSetor(userCargo, conversa.setor);
    await conversaRepository.delete(id);
    bus.emitDelete(id);
    return { removido: true };
  }

  // Mapeia, publica no barramento (SSE) e devolve o DTO. Fonte unica de emissao
  // para as operacoes administrativas desta tela.
  _emitir(conversa) {
    const dto = mapConversa(conversa);
    bus.emitConversa(dto);
    return dto;
  }

  // Envia e devolve o id da mensagem na Evolution, necessario para casar os
  // ACKs de entrega/leitura (messages.update) com a mensagem local.
  async _enviarWhatsApp(telefone, texto, quoted = null) {
    try {
      const r = await evolutionApi.sendText(telefone, texto, env.evolutionApi.instance, quoted);
      return { ok: true, waMessageId: r?.key?.id || null };
    } catch {
      // nao bloqueia operacao administrativa se Evolution estiver offline
      return { ok: false, waMessageId: null };
    }
  }
}

module.exports = new ConversaService();
