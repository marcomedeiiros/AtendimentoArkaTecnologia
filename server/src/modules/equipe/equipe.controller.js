const equipeService = require("./equipe.service");
const { success } = require("../../shared/helpers/response.helper");

class EquipeController {
  listar(req, res) {
    return equipeService.listar().then((data) => success(res, data));
  }

  alterarStatus(req, res) {
    const { id } = req.params;
    const { ativo } = req.body;
    // req.user.sub identifica quem pede; o service confere no banco se e Admin.
    return equipeService.alterarStatus(id, ativo, req.user.sub).then((data) => success(res, data));
  }

  alterarCargo(req, res) {
    const { id } = req.params;
    const { cargo } = req.body;
    return equipeService.alterarCargo(id, cargo, req.user.sub).then((data) => success(res, data));
  }

  redefinirSenha(req, res) {
    const { id } = req.params;
    const { senha } = req.body;
    // req.user.sub identifica quem esta pedindo; o service confere se e Admin.
    return equipeService
      .redefinirSenha(id, senha, req.user.sub)
      .then((data) => success(res, data));
  }

  remover(req, res) {
    return equipeService
      .remover(req.params.id, req.user.sub)
      .then((data) => success(res, data));
  }
}

module.exports = new EquipeController();
