const fluxoService = require("./fluxo.service");
const { success } = require("../../shared/helpers/response.helper");

class FluxoController {
  listar(req, res) {
    return fluxoService.listar().then((data) => success(res, data));
  }

  // GET /fluxos/automacoes/resumo
  automacoes(req, res) {
    return fluxoService.resumoAutomacoes().then((data) => success(res, data));
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

  // ── Blocos (passos) ──────────────────────────────────────────────────────
  // As mutacoes devolvem o FLUXO inteiro: o editor precisa reconciliar ligacoes
  // e ordem, e uma resposta parcial o obrigaria a adivinhar o resto.

  obterPasso(req, res) {
    return fluxoService
      .obterPasso(req.params.id, req.params.passoId)
      .then((data) => success(res, data));
  }

  criarPasso(req, res) {
    return fluxoService.criarPasso(req.params.id, req.body).then((data) => success(res, data, 201));
  }

  atualizarPasso(req, res) {
    return fluxoService
      .atualizarPasso(req.params.id, req.params.passoId, req.body)
      .then((data) => success(res, data));
  }

  removerPasso(req, res) {
    return fluxoService
      .removerPasso(req.params.id, req.params.passoId)
      .then((data) => success(res, data));
  }

  reordenarPassos(req, res) {
    return fluxoService
      .reordenarPassos(req.params.id, req.body.ids)
      .then((data) => success(res, data));
  }
}

module.exports = new FluxoController();
