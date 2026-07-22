const chatbotService = require("./chatbot.service");
const { success } = require("../../shared/helpers/response.helper");

class ChatbotController {
  processar(req, res) {
    return chatbotService.processar(req.body).then((data) => success(res, data));
  }

  executarFluxo(req, res) {
    return chatbotService
      .executarFluxoManual(req.params.id, req.body.conversaId)
      .then((data) => success(res, data));
  }

  obterSessao(req, res) {
    return chatbotService
      .obterSessao(req.params.telefone, req.query.instance)
      .then((data) => success(res, data));
  }
}

module.exports = new ChatbotController();
