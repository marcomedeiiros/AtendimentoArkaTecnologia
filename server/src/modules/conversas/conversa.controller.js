const conversaService = require("./conversa.service");
const { success } = require("../../shared/helpers/response.helper");
const { validarTokenMidia } = require("../../shared/helpers/midiaToken.helper");

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
      .enviarMensagem(req.params.id, req.body.texto, "equipe", req.body.respondendoAId, req.user?.cargo)
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
    return conversaService.enviarMidia(req.params.id, req.body, "equipe", req.user?.cargo).then((data) => success(res, data));
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
    res.setHeader("Content-Type", midia.mimetype);
    res.setHeader("Content-Length", midia.buffer.length);
    // O conteudo de uma mensagem nunca muda: cache longo (o token ja limita o
    // acesso). `private` para nao ficar em cache compartilhado de proxy.
    res.setHeader("Cache-Control", "private, max-age=604800, immutable");
    // Evita que um arquivo seja interpretado como outra coisa pelo navegador.
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.end(midia.buffer);
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
