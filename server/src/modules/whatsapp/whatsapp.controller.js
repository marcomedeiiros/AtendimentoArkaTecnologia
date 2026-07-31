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

  detalhes(req, res) {
    return whatsappService
      .obterDetalhes(req.query.instance)
      .then((data) => success(res, data));
  }

  responder(req, res) {
    return whatsappService
      .responderCliente({
        conversaId: req.body?.conversaId,
        telefone: req.body?.telefone,
        texto: req.body?.texto,
        instanceName: req.body?.instance || req.instanceName,
      })
      .then((data) => success(res, data));
  }

  criarInstancia(req, res) {
    return whatsappService
      .criarInstancia({
        instanceName: req.body?.instance,
        baseUrlPublica: req.body?.baseUrlPublica,
      })
      .then((data) => success(res, data, 201));
  }

  configurarWebhook(req, res) {
    return whatsappService
      .configurarWebhook({
        instanceName: req.body?.instance,
        baseUrlPublica: req.body?.baseUrlPublica,
      })
      .then((data) => success(res, data));
  }

  reiniciar(req, res) {
    return whatsappService
      .reiniciar(req.body?.instance || req.query.instance)
      .then((data) => success(res, data));
  }

  excluir(req, res) {
    return whatsappService
      .excluir(req.body?.instance || req.query.instance)
      .then((data) => success(res, data));
  }
}

module.exports = new WhatsAppController();
