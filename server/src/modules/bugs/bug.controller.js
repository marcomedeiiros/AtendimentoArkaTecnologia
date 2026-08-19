const bugService = require("./bug.service");
const { success } = require("../../shared/helpers/response.helper");

class BugController {
  criar(req, res) {
    return bugService.criar(req.body, req.user).then((data) => success(res, data, 201));
  }

  listar(req, res) {
    return bugService.listar(req.query.status).then((data) => success(res, data));
  }

  atualizarStatus(req, res) {
    return bugService.atualizarStatus(req.params.id, req.body.status).then((data) => success(res, data));
  }

  remover(req, res) {
    return bugService.remover(req.params.id).then((data) => success(res, data));
  }
}

module.exports = new BugController();
