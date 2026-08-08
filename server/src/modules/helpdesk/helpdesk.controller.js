const helpdeskService = require("./helpdesk.service");
const { success } = require("../../shared/helpers/response.helper");

class HelpDeskController {
  metricas(req, res) {
    return helpdeskService.obterMetricas().then((data) => success(res, data));
  }
}

module.exports = new HelpDeskController();
