const service = require("./mensagemRapida.service");
const { success } = require("../../shared/helpers/response.helper");

class MensagemRapidaController {
  listar(req, res) {
    return service.listar().then((data) => success(res, data));
  }

  criar(req, res) {
    return service.criar(req.body).then((data) => success(res, data, 201));
  }

  atualizar(req, res) {
    return service.atualizar(req.params.id, req.body).then((data) => success(res, data));
  }

  remover(req, res) {
    return service.remover(req.params.id).then((data) => success(res, data));
  }
}

module.exports = new MensagemRapidaController();
