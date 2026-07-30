const conversaRepository = require("../../infrastructure/repositories/conversa.repository");
const instanciaRepository = require("../../infrastructure/repositories/instancia.repository");
const evolutionApi = require("../../infrastructure/external/evolution-api.client");
const { mapConversa } = require("../../shared/helpers/mapper.helper");
const { limparCnpj, cnpjValido, mascararCnpj } = require("../../shared/helpers/cnpj.helper");
const parceiroRepository = require("../../infrastructure/repositories/parceiro.repository");
const bus = require("../../shared/events/event-bus");
const AppError = require("../../shared/errors/AppError");
const env = require("../../config/env");

class ConversaService {
  async listar(filtros = {}) {
    const conversas = await conversaRepository.findAll(filtros);
    return conversas.map(mapConversa);
  }

  async obter(id) {
    const conversa = await conversaRepository.findById(id);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");
    return mapConversa(conversa);
  }

  async atender(id, atendenteId = null) {
    const conversa = await conversaRepository.findById(id);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");

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

  async enviarMensagem(id, texto, origem = "equipe") {
    const conversa = await conversaRepository.findById(id);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");

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

    await conversaRepository.addMensagem(id, origem === "equipe" ? "equipe" : "bot", texto.trim());

    for (const msg of mensagensExtras) {
      await this._enviarWhatsApp(conversa.telefone, msg.texto);
    }

    await this._enviarWhatsApp(conversa.telefone, texto.trim());

    const atualizada = await conversaRepository.findById(id);
    return this._emitir(atualizada);
  }

  // Envia mídia (imagem/vídeo/documento/áudio/localização) pela Evolution e
  // registra a mensagem. `media` aceita URL pública ou base64 (data URL). Para
  // a bolha do operador renderizar de volta, guardamos a própria mídia em
  // metadata.url.
  async enviarMidia(id, payload, origem = "equipe") {
    const conversa = await conversaRepository.findById(id);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");

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

  async solicitarCnpj(id) {
    const msg = "[Arka Tecnologia]: Para prosseguirmos e verificar beneficios de parceiro, informe o CNPJ da sua empresa:";
    return this.enviarMensagem(id, msg, "bot");
  }

  async validarCnpjManual(id, cnpj) {
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

  async atualizarStatus(id, status) {
    const conversa = await conversaRepository.findById(id);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");

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
  async atualizarFlags(id, flags) {
    const conversa = await conversaRepository.findById(id);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");

    const data = {};
    for (const campo of ["favorita", "fixada", "arquivada", "oculta"]) {
      if (flags[campo] !== undefined) data[campo] = flags[campo];
    }
    if (Object.keys(data).length === 0) return mapConversa(conversa);

    const atualizada = await conversaRepository.update(id, data);
    return this._emitir(atualizada);
  }

  async marcarLido(id) {
    const conversa = await conversaRepository.findById(id);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");
    const atualizada = await conversaRepository.zerarNaoLidas(id);
    return this._emitir(atualizada);
  }

  async remover(id) {
    const conversa = await conversaRepository.findById(id);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");
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

  async _enviarWhatsApp(telefone, texto) {
    try {
      await evolutionApi.sendText(telefone, texto, env.evolutionApi.instance);
    } catch {
      // nao bloqueia operacao administrativa se Evolution estiver offline
    }
  }
}

module.exports = new ConversaService();
