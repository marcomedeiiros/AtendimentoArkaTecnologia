const equipeService = require("./equipe.service");
const { success } = require("../../shared/helpers/response.helper");

class EquipeController {
  listar(req, res) {
    return equipeService.listar().then((data) => success(res, data));
  }

  criar(req, res) {
    return equipeService.criar(req.body).then((data) => success(res, data, 201));
  }

  atualizar(req, res) {
    return equipeService.atualizar(req.params.id, req.body).then((data) => success(res, data));
  }

  remover(req, res) {
    return equipeService.remover(req.params.id).then((data) => success(res, data));
  }
}

module.exports = new EquipeController();
