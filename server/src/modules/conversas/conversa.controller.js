const conversaService = require("./conversa.service");
const { success } = require("../../shared/helpers/response.helper");

class ConversaController {
  listar(req, res) {
    return conversaService.listar(req.query).then((data) => success(res, data));
  }

  obter(req, res) {
    return conversaService.obter(req.params.id).then((data) => success(res, data));
  }

  atender(req, res) {
    return conversaService.atender(req.params.id, req.user?.sub).then((data) => success(res, data));
  }

  enviarMensagem(req, res) {
    return conversaService.enviarMensagem(req.params.id, req.body.texto).then((data) => success(res, data));
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

  marcarLido(req, res) {
    return conversaService.marcarLido(req.params.id).then((data) => success(res, data));
  }

  remover(req, res) {
    return conversaService.remover(req.params.id).then((data) => success(res, data));
  }
}

module.exports = new ConversaController();
