const conversaService = require("./conversa.service");
const { success } = require("../../shared/helpers/response.helper");

class ConversaController {
  listar(req, res) {
    return conversaService.listar(req.query, req.user?.cargo).then((data) => success(res, data));
  }

  obter(req, res) {
    return conversaService.obter(req.params.id, req.user?.cargo).then((data) => success(res, data));
  }

  atender(req, res) {
    return conversaService.atender(req.params.id, req.user?.sub).then((data) => success(res, data));
  }

  enviarMensagem(req, res) {
    return conversaService
      .enviarMensagem(req.params.id, req.body.texto, "equipe", req.body.respondendoAId)
      .then((data) => success(res, data));
  }

  encaminharMensagem(req, res) {
    return conversaService
      .encaminharMensagem(req.body.mensagemId, req.body.conversaDestinoId)
      .then((data) => success(res, data));
  }

  editarMensagem(req, res) {
    return conversaService
      .editarMensagem(req.params.mensagemId, req.body.texto)
      .then((data) => success(res, data));
  }

  enviarMidia(req, res) {
    return conversaService.enviarMidia(req.params.id, req.body).then((data) => success(res, data));
  }

  solicitarCnpj(req, res) {
    return conversaService.solicitarCnpj(req.params.id).then((data) => success(res, data));
  }

  validarCnpj(req, res) {
    return conversaService.validarCnpjManual(req.params.id, req.body.cnpj).then((data) => success(res, data));
  }

  atualizarStatus(req, res) {
    return conversaService.atualizarStatus(req.params.id, req.body.status).then((data) => success(res, data));
  }

  atualizarSetor(req, res) {
    return conversaService.atualizarSetor(req.params.id, req.body.setor).then((data) => success(res, data));
  }

  avaliarAtendimento(req, res) {
    return conversaService.avaliarAtendimento(req.params.id, req.body).then((data) => success(res, data));
  }

  atualizarFlags(req, res) {
    return conversaService.atualizarFlags(req.params.id, req.body).then((data) => success(res, data));
  }

  marcarLido(req, res) {
    return conversaService.marcarLido(req.params.id).then((data) => success(res, data));
  }

  remover(req, res) {
    return conversaService.remover(req.params.id).then((data) => success(res, data));
  }
}

module.exports = new ConversaController();
