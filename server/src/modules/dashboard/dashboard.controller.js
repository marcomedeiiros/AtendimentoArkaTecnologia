const dashboardService = require("./dashboard.service");
const { success } = require("../../shared/helpers/response.helper");

class DashboardController {
  async obter(req, res) {
    const data = await dashboardService.obterMetricas();
    return success(res, data);
  }
}

module.exports = new DashboardController();
