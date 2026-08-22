const service = require("./campanha.service");
const { success } = require("../../shared/helpers/response.helper");

class CampanhaController {
  listar(req, res) {
    return service.listar().then((data) => success(res, data));
  }

  obter(req, res) {
    return service.obter(req.params.id).then((data) => success(res, data));
  }

  criar(req, res) {
    // req.user vem do token ja validado (auditoria de quem criou).
    return service.criar(req.body, req.user).then((data) => success(res, data, 201));
  }

  iniciar(req, res) {
    return service.iniciar(req.params.id).then((data) => success(res, data));
  }

  pausar(req, res) {
    return service.pausar(req.params.id).then((data) => success(res, data));
  }

  cancelar(req, res) {
    return service.cancelar(req.params.id).then((data) => success(res, data));
  }

  remover(req, res) {
    return service.remover(req.params.id).then((data) => success(res, data));
  }
}

module.exports = new CampanhaController();
