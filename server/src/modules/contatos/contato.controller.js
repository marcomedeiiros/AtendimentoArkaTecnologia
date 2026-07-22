const contatoService = require("./contato.service");
const { success } = require("../../shared/helpers/response.helper");

class ContatoController {
  listar(req, res) {
    return contatoService.listar(req.query).then((data) => success(res, data));
  }

  criar(req, res) {
    return contatoService.criar(req.body).then((data) => success(res, data, 201));
  }

  atualizar(req, res) {
    return contatoService.atualizar(req.params.id, req.body).then((data) => success(res, data));
  }

  remover(req, res) {
    return contatoService.remover(req.params.id).then((data) => success(res, data));
  }
}

module.exports = new ContatoController();
