const parceiroService = require("./parceiro.service");
const { success } = require("../../shared/helpers/response.helper");

class ParceiroController {
  listar(req, res) {
    const busca = req.query.q || req.query.busca || req.query.nome;
    return parceiroService.listar(busca).then((data) => success(res, data));
  }

  criar(req, res) {
    return parceiroService.criar(req.body).then((data) => success(res, data, 201));
  }

  atualizar(req, res) {
    return parceiroService.atualizar(req.params.cnpj, req.body).then((data) => success(res, data));
  }

  validar(req, res) {
    return parceiroService.validar(req.params.cnpj).then((data) => success(res, data));
  }

  alternarStatus(req, res) {
    return parceiroService.alternarStatus(req.params.cnpj).then((data) => success(res, data));
  }

  remover(req, res) {
    return parceiroService.remover(req.params.cnpj).then((data) => success(res, data));
  }
}

module.exports = new ParceiroController();
