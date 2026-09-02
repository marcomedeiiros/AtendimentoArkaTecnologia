const dashboardService = require("./dashboard.service");
const painelService = require("./painel.service");
const { success } = require("../../shared/helpers/response.helper");

class DashboardController {
  async obter(req, res) {
    const data = await dashboardService.obterMetricas();
    return success(res, data);
  }

  // Painel de parede: um GET so devolve tudo que a TV desenha. A tela recarrega
  // sozinha e nao tem interacao -- varias chamadas por atualizacao dariam
  // metades do painel de instantes diferentes.
  async painel(req, res) {
    const data = await painelService.obter(req.user);
    return success(res, data);
  }
}

module.exports = new DashboardController();
