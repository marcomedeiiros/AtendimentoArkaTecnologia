const parceiroService = require("./parceiro.service");
const { success } = require("../../shared/helpers/response.helper");
const midiaStorage = require("../../infrastructure/storage/midia.storage");
const { prepararRespostaMidia } = require("../../shared/helpers/midiaResposta.helper");

class ParceiroController {
  listar(req, res) {
    const busca = req.query.q || req.query.busca || req.query.nome;
    return parceiroService.listar(busca).then((data) => success(res, data));
  }

  criar(req, res) {
    return parceiroService.criar(req.body).then((data) => success(res, data, 201));
  }

  atualizar(req, res) {
    return parceiroService.atualizar(req.params.cnpj, req.body).then((data) => success(res, data));
  }

  validar(req, res) {
    return parceiroService.validar(req.params.cnpj).then((data) => success(res, data));
  }

  alternarStatus(req, res) {
    return parceiroService.alternarStatus(req.params.cnpj).then((data) => success(res, data));
  }

  remover(req, res) {
    return parceiroService.remover(req.params.cnpj).then((data) => success(res, data));
  }

  /**
   * Bytes da logo, para o `<img>` da lista.
   *
   * SEM TOKEN NA URL, ao contrário dos anexos das mensagens rápidas: aqui a
   * rota inteira já está atrás de `authMiddleware` + `exigirModulo("parceiros")`
   * (ver parceiro.routes), e o cookie de sessão é HttpOnly e same-origin -- o
   * navegador o envia sozinho num `<img src>`. Um token a mais na query só
   * espalharia credencial pelo histórico e pelos logs de acesso sem fechar
   * nenhuma porta que já não esteja fechada.
   *
   * Os cabeçalhos saem do mesmo helper da mídia das conversas: `nosniff`, CSP
   * com sandbox e o Content-Type vindo de allowlist. O tipo aqui é o que a
   * ASSINATURA DOS BYTES disse na hora de gravar, não o que o cliente mandou.
   */
  async logo(req, res) {
    const logo = await parceiroService.logoDe(req.params.cnpj);
    if (!logo) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Este cliente não tem logo" },
      });
    }
    const aberto = await midiaStorage.abrirParaLeitura(logo.caminho);
    if (!aberto) {
      // A linha existe mas o arquivo não: volume não montado, disco limpo na
      // mão. 404 e não 500 -- o `onError` do `<img>` cai nas iniciais, que é o
      // mesmo desenho de quem nunca teve logo.
      return res.status(404).json({
        success: false,
        error: { code: "ARQUIVO_AUSENTE", message: "O arquivo da logo não está mais no disco" },
      });
    }
    prepararRespostaMidia(res, {
      mimetype: logo.tipo,
      fileName: `logo.${(logo.tipo || "image/png").split("/")[1] || "png"}`,
      tamanho: aberto.tamanho,
    });
    aberto.stream.on("error", () => res.destroy());
    return aberto.stream.pipe(res);
  }
}

module.exports = new ParceiroController();
