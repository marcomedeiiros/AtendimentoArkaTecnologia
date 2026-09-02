const conversaService = require("./conversa.service");
const configuracaoService = require("../configuracoes/configuracao.service");
const historicoService = require("../whatsapp/historico.service");
const { success } = require("../../shared/helpers/response.helper");
const { validarTokenMidia } = require("../../shared/helpers/midiaToken.helper");
const { prepararRespostaMidia, interpretarRange } = require("../../shared/helpers/midiaResposta.helper");

class ConversaController {
  listar(req, res) {
    return conversaService.listar(req.query, req.user).then((data) => success(res, data));
  }

  // Retrato barato para a Central reconciliar as abas com frequencia, sem
  // arrastar o historico inteiro. Ver conversaService.listarEstados.
  listarEstados(req, res) {
    return conversaService.listarEstados(req.user).then((data) => success(res, data));
  }

  obter(req, res) {
    return conversaService.obter(req.params.id, req.user).then((data) => success(res, data));
  }

  atender(req, res) {
    return conversaService.atender(req.params.id, req.user?.sub, req.user).then((data) => success(res, data));
  }

  // Historico de OS (atendimentos) do cliente.
  atendimentos(req, res) {
    return conversaService
      .listarAtendimentos(req.params.id, req.user)
      .then((data) => success(res, data));
  }

  enviarMensagem(req, res) {
    return conversaService
      // `req.user` vai junto para o service poder registrar QUEM respondeu como
      // atendente quando a conversa ainda nao tem responsavel.
      .enviarMensagem(req.params.id, req.body.texto, "equipe", req.body.respondendoAId, req.user, req.user)
      .then((data) => success(res, data));
  }

  // Motivos de encerramento disponiveis, para o modal de fechamento montar a
  // lista. Leitura pura da configuracao.
  listarMotivos(req, res) {
    return configuracaoService.motivosEncerramento().then((data) => success(res, data));
  }

  // Nota interna: nao sai para o cliente. `req.user` vai junto para a autoria
  // ficar gravada no metadata da mensagem.
  adicionarNota(req, res) {
    return conversaService
      .adicionarNota(req.params.id, req.body.texto, req.user, req.user)
      .then((data) => success(res, data, 201));
  }

  // Conversa nova a partir de um numero digitado. Quem envia fica como
  // atendente: iniciar contato e assumir o atendimento.
  iniciarConversa(req, res) {
    return conversaService
      .iniciarConversa({
        telefone: req.body.telefone,
        nome: req.body.nome,
        setor: req.body.setor,
        texto: req.body.texto,
        atendenteId: req.user?.sub || null,
        acesso: req.user,
      })
      .then((data) => success(res, data, 201));
  }

  encaminharMensagem(req, res) {
    return conversaService
      .encaminharMensagem(req.body.mensagemId, req.body.conversaDestinoId, req.user)
      .then((data) => success(res, data));
  }

  editarMensagem(req, res) {
    return conversaService
      .editarMensagem(req.params.mensagemId, req.body.texto, req.user)
      .then((data) => success(res, data));
  }

  enviarMidia(req, res) {
    return conversaService.enviarMidia(req.params.id, req.body, "equipe", req.user, req.user).then((data) => success(res, data));
  }

  transcreverAudio(req, res) {
    return conversaService
      .transcreverAudio(req.params.mensagemId, req.user)
      .then((data) => success(res, data));
  }

  // O que a Evolution guardou do historico deste numero. Leitura pura: serve
  // para a tela dizer "ha 340 mensagens antigas" (ou que nao ha nenhuma) ANTES
  // de o administrador confirmar a importacao.
  historicoWhatsApp(req, res) {
    return historicoService.previa(req.params.id).then((data) => success(res, data));
  }

  /**
   * Importa o historico e devolve o resultado JUNTO com a conversa atualizada.
   *
   * A conversa vai na mesma resposta porque o front aplica retrato de conversa
   * por um caminho unico (`aplicarConversa` -> mesclarConversa, que descarta
   * versao antiga). Devolver so os numeros obrigaria a tela a fazer um segundo
   * GET para ver o que acabou de importar -- e, entre os dois, um evento SSE
   * poderia chegar com versao maior e o merge descartaria o retrato certo.
   *
   * Sem importacao nenhuma nao ha conversa nova para mandar: `null` evita
   * carregar o fio inteiro (que pode ter milhares de mensagens) so para dizer
   * "nada mudou".
   */
  importarHistorico(req, res) {
    return historicoService
      .importar(req.params.id, {
        limite: req.body?.limite,
        baixarMidia: req.body?.baixarMidia,
      })
      .then(async (resultado) => {
        const conversa =
          resultado.importadas > 0
            ? await conversaService.obter(req.params.id, req.user)
            : null;
        return success(res, { ...resultado, conversa });
      });
  }

  corrigirTexto(req, res) {
    return conversaService.corrigirTexto(req.body.texto).then((data) => success(res, data));
  }

  // GET /conversas/mensagens/:mensagemId/midia?t=<token>
  //
  // Autenticada pelo token assinado na URL (o <img>/<video> do navegador nao
  // manda header Authorization) -- mesma ideia do ticket do SSE. O token e HMAC,
  // vale so para ESTA mensagem e expira.
  async servirMidia(req, res) {
    const { mensagemId } = req.params;
    if (!validarTokenMidia(mensagemId, req.query.t)) {
      return res.status(403).json({
        success: false,
        error: { code: "TOKEN_MIDIA_INVALIDO", message: "Link de mídia inválido ou expirado" },
      });
    }
    // Duas passadas quando ha Range: a primeira so para saber o tamanho total
    // (o sufixo "bytes=-500" nao da para resolver sem ele), a segunda ja com a
    // faixa presa ao arquivo. Sem Range, uma passada so.
    let midia = await conversaService.obterMidiaBruta(mensagemId);
    if (midia && req.headers.range) {
      const faixa = interpretarRange(req.headers.range, midia.total ?? midia.tamanho);
      if (faixa) {
        if (midia.stream) midia.stream.destroy(); // descarta o stream inteiro
        midia = await conversaService.obterMidiaBruta(mensagemId, faixa);
      }
    }
    if (!midia) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Mídia não encontrada" },
      });
    }
    // Cabecalhos seguros (allowlist de Content-Type, inline so para
    // imagem/video/audio, nosniff, CSP sandbox, no-referrer) -- ver
    // midiaResposta.helper.
    prepararRespostaMidia(res, {
      mimetype: midia.mimetype,
      fileName: midia.fileName,
      tamanho: midia.tamanho ?? midia.buffer?.length,
    });
    // Resposta parcial: 206 + Content-Range. E este par que faz o player
    // descobrir a duracao de um audio do WhatsApp (opus/ogg, que chega sem
    // duracao no cabecalho) e conseguir arrastar a barra.
    if (midia.parcial && Number.isFinite(midia.total)) {
      res.status(206);
      res.setHeader("Content-Range", `bytes ${midia.inicio}-${midia.fim}/${midia.total}`);
    }
    // Arquivo em disco vai por STREAM (nao carrega o video inteiro na memoria).
    if (midia.stream) {
      midia.stream.on("error", () => res.destroy());
      // Cliente desistiu no meio (trocou de conversa, arrastou a barra do video,
      // fechou a aba): sem destruir a leitura, cada seek deixava um descritor de
      // arquivo aberto para tras -- e um player arrastado algumas vezes abre
      // dezenas de requisicoes parciais.
      res.on("close", () => midia.stream.destroy());
      return midia.stream.pipe(res);
    }
    return res.end(midia.buffer);
  }

  // NAO existe mais `desvincularCnpj` (DELETE /conversas/:id/cnpj): o "X" saiu
  // da conversa. Ver a nota em conversa.service.js.

  apagarMensagem(req, res) {
    return conversaService
      .apagarMensagem(req.params.mensagemId, req.user)
      .then((data) => success(res, data));
  }

  solicitarCnpj(req, res) {
    return conversaService.solicitarCnpj(req.params.id, req.user).then((data) => success(res, data));
  }

  validarCnpj(req, res) {
    return conversaService.validarCnpjManual(req.params.id, req.body.cnpj, req.user).then((data) => success(res, data));
  }

  atualizarStatus(req, res) {
    return conversaService
      .atualizarStatus(req.params.id, req.body.status, req.user, req.user, req.body.motivo)
      .then((data) => success(res, data));
  }

  atualizarSetor(req, res) {
    return conversaService.atualizarSetor(req.params.id, req.body.setor, req.user).then((data) => success(res, data));
  }

  // Para quem da para transferir. `conversaId` e opcional: com ele, cada
  // operador vem marcado com `podeVerConversa`, para a tela avisar antes de
  // mandar a conversa para alguem de outro setor.
  listarAtendentes(req, res) {
    return conversaService
      .listarAtendentes(req.query.conversaId || null, req.user)
      .then((data) => success(res, data));
  }

  // `req.user.sub` -- de quem esta PEDINDO -- nao vinha, e sem ele o service nao
  // tinha como conferir se quem transfere e mesmo o responsavel pela conversa.
  // Vem do token, nunca do corpo: id de atendente mandado pelo cliente e so um
  // campo JSON que qualquer um digita no curl.
  definirAtendente(req, res) {
    return conversaService
      .definirAtendente(req.params.id, req.body.atendenteId ?? null, req.user, req.user?.sub)
      .then((data) => success(res, data));
  }

  avaliarAtendimento(req, res) {
    return conversaService.avaliarAtendimento(req.params.id, req.body, req.user).then((data) => success(res, data));
  }

  atualizarFlags(req, res) {
    return conversaService.atualizarFlags(req.params.id, req.body, req.user).then((data) => success(res, data));
  }

  marcarLido(req, res) {
    return conversaService.marcarLido(req.params.id, req.user).then((data) => success(res, data));
  }

  remover(req, res) {
    return conversaService.remover(req.params.id, req.user).then((data) => success(res, data));
  }
}

module.exports = new ConversaController();
