const fluxoService = require("./fluxo.service");
const { success } = require("../../shared/helpers/response.helper");

class FluxoController {
  listar(req, res) {
    return fluxoService.listar().then((data) => success(res, data));
  }

  obter(req, res) {
    return fluxoService.obter(req.params.id).then((data) => success(res, data));
  }

  criar(req, res) {
    return fluxoService.criar(req.body).then((data) => success(res, data, 201));
  }

  atualizar(req, res) {
    return fluxoService.atualizar(req.params.id, req.body).then((data) => success(res, data));
  }

  remover(req, res) {
    return fluxoService.remover(req.params.id).then((data) => success(res, data));
  }
}

module.exports = new FluxoController();
