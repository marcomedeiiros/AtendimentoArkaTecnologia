const conversaService = require("./conversa.service");
const { success } = require("../../shared/helpers/response.helper");
const { validarTokenMidia } = require("../../shared/helpers/midiaToken.helper");
const { prepararRespostaMidia } = require("../../shared/helpers/midiaResposta.helper");

class ConversaController {
  listar(req, res) {
    return conversaService.listar(req.query, req.user?.cargo).then((data) => success(res, data));
  }

  obter(req, res) {
    return conversaService.obter(req.params.id, req.user?.cargo).then((data) => success(res, data));
  }

  atender(req, res) {
    return conversaService.atender(req.params.id, req.user?.sub, req.user?.cargo).then((data) => success(res, data));
  }

  enviarMensagem(req, res) {
    return conversaService
      // `req.user` vai junto para o service poder registrar QUEM respondeu como
      // atendente quando a conversa ainda nao tem responsavel.
      .enviarMensagem(req.params.id, req.body.texto, "equipe", req.body.respondendoAId, req.user?.cargo, req.user)
      .then((data) => success(res, data));
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
        userCargo: req.user?.cargo,
      })
      .then((data) => success(res, data, 201));
  }

  encaminharMensagem(req, res) {
    return conversaService
      .encaminharMensagem(req.body.mensagemId, req.body.conversaDestinoId, req.user?.cargo)
      .then((data) => success(res, data));
  }

  editarMensagem(req, res) {
    return conversaService
      .editarMensagem(req.params.mensagemId, req.body.texto, req.user?.cargo)
      .then((data) => success(res, data));
  }

  enviarMidia(req, res) {
    return conversaService.enviarMidia(req.params.id, req.body, "equipe", req.user?.cargo, req.user).then((data) => success(res, data));
  }

  transcreverAudio(req, res) {
    return conversaService
      .transcreverAudio(req.params.mensagemId, req.user?.cargo)
      .then((data) => success(res, data));
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
    const midia = await conversaService.obterMidiaBruta(mensagemId);
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
    // Arquivo em disco vai por STREAM (nao carrega o video inteiro na memoria).
    if (midia.stream) {
      midia.stream.on("error", () => res.destroy());
      return midia.stream.pipe(res);
    }
    return res.end(midia.buffer);
  }

  // DELETE /conversas/:id/cnpj -- desvincula o CNPJ da conversa.
  desvincularCnpj(req, res) {
    return conversaService
      .desvincularCnpj(req.params.id, req.user?.cargo, req.user?.nome)
      .then((data) => success(res, data));
  }

  apagarMensagem(req, res) {
    return conversaService
      .apagarMensagem(req.params.mensagemId, req.user?.cargo)
      .then((data) => success(res, data));
  }

  solicitarCnpj(req, res) {
    return conversaService.solicitarCnpj(req.params.id, req.user?.cargo).then((data) => success(res, data));
  }

  validarCnpj(req, res) {
    return conversaService.validarCnpjManual(req.params.id, req.body.cnpj, req.user?.cargo).then((data) => success(res, data));
  }

  atualizarStatus(req, res) {
    return conversaService.atualizarStatus(req.params.id, req.body.status, req.user?.cargo, req.user).then((data) => success(res, data));
  }

  atualizarSetor(req, res) {
    return conversaService.atualizarSetor(req.params.id, req.body.setor, req.user?.cargo).then((data) => success(res, data));
  }

  definirAtendente(req, res) {
    return conversaService
      .definirAtendente(req.params.id, req.body.atendenteId ?? null, req.user?.cargo)
      .then((data) => success(res, data));
  }

  avaliarAtendimento(req, res) {
    return conversaService.avaliarAtendimento(req.params.id, req.body, req.user?.cargo).then((data) => success(res, data));
  }

  atualizarFlags(req, res) {
    return conversaService.atualizarFlags(req.params.id, req.body, req.user?.cargo).then((data) => success(res, data));
  }

  marcarLido(req, res) {
    return conversaService.marcarLido(req.params.id, req.user?.cargo).then((data) => success(res, data));
  }

  remover(req, res) {
    return conversaService.remover(req.params.id, req.user?.cargo).then((data) => success(res, data));
  }
}

module.exports = new ConversaController();
