const whatsappService = require("./whatsapp.service");
const { success } = require("../../shared/helpers/response.helper");

class WhatsAppController {
  webhook(req, res) {
    return whatsappService
      .processarWebhook(req.body, req.instanceName)
      .then((data) => success(res, data));
  }

  verificar(req, res) {
    const challenge = req.query["hub.challenge"] || req.query.challenge || "ok";
    return res.status(200).send(challenge);
  }

  status(req, res) {
    return whatsappService
      .obterStatus(req.query.instance)
      .then((data) => success(res, data));
  }

  conectar(req, res) {
    return whatsappService
      .conectar(req.body?.instance || req.query.instance)
      .then((data) => success(res, data));
  }

  desconectar(req, res) {
    return whatsappService
      .desconectar(req.body?.instance || req.query.instance)
      .then((data) => success(res, data));
  }

  qrcode(req, res) {
    return whatsappService
      .obterQrcode(req.query.instance)
      .then((data) => success(res, data));
  }
}

module.exports = new WhatsAppController();
