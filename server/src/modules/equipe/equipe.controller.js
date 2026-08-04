const equipeService = require("./equipe.service");
const { success } = require("../../shared/helpers/response.helper");

class EquipeController {
  listar(req, res) {
    return equipeService.listar().then((data) => success(res, data));
  }
}

module.exports = new EquipeController();
