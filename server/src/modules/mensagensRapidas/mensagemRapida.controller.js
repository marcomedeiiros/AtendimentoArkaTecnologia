const service = require("./mensagemRapida.service");
const { success } = require("../../shared/helpers/response.helper");
const { validarTokenMidia } = require("../../shared/helpers/midiaToken.helper");

class MensagemRapidaController {
  listar(req, res) {
    return service.listar().then((data) => success(res, data));
  }

  // GET /mensagens-rapidas/:id/anexo?t=<token>
  // Serve os bytes do anexo. Autenticada pelo token assinado na URL (o <img> do
  // navegador nao manda Authorization) -- mesmo modelo da midia das conversas.
  async servirAnexo(req, res) {
    const { id } = req.params;
    if (!validarTokenMidia(id, req.query.t)) {
      return res.status(403).json({
        success: false,
        error: { code: "TOKEN_MIDIA_INVALIDO", message: "Link de anexo inválido ou expirado" },
      });
    }
    const anexo = await service.obterAnexoBruto(id);
    if (!anexo) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Anexo não encontrado" },
      });
    }
    res.setHeader("Content-Type", anexo.mimetype);
    res.setHeader("Content-Length", anexo.tamanho ?? anexo.buffer.length);
    res.setHeader("Cache-Control", "private, max-age=604800, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (anexo.stream) {
      anexo.stream.on("error", () => res.destroy());
      return anexo.stream.pipe(res);
    }
    return res.end(anexo.buffer);
  }

  criar(req, res) {
    return service.criar(req.body).then((data) => success(res, data, 201));
  }

  atualizar(req, res) {
    return service.atualizar(req.params.id, req.body).then((data) => success(res, data));
  }

  remover(req, res) {
    return service.remover(req.params.id).then((data) => success(res, data));
  }
}

module.exports = new MensagemRapidaController();
