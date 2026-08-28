/**
 * Exige um desafio Turnstile valido antes de liberar a rota.
 *
 * Fica na BORDA, junto do rate limit e do bloqueio progressivo, e nao dentro do
 * service: assim a requisicao reprovada nem chega ao bcrypt nem ao banco.
 *
 * O token chega em `req.body.turnstileToken` (o DTO precisa declarar o campo --
 * o `validate` troca `req.body` pelo resultado do Zod e descarta chave
 * desconhecida). Aceitamos tambem o header `cf-turnstile-response`, que e o
 * nome que o widget usa, para um cliente que prefira mandar fora do corpo.
 */
const turnstile = require("../../infrastructure/external/turnstile.client");
const AppError = require("../errors/AppError");
const seg = require("../helpers/seguranca.helper");

function exigirTurnstile(req, res, next) {
  const token = req.body?.turnstileToken || req.headers["cf-turnstile-response"] || null;

  turnstile
    .verificar(token, seg.ipDe(req))
    .then((r) => {
      if (r.ok) return next();
      seg.registrar(seg.EVENTOS.TURNSTILE_FALHOU, req, { motivo: r.motivo });
      // Mensagem generica: o motivo exato (forjado? repetido? expirado?) fica
      // no log. Devolver o detalhe ao cliente so ajuda quem esta testando o
      // limite da protecao.
      return next(
        new AppError(
          "Nao foi possivel confirmar que voce nao e um robo. Recarregue a pagina e tente de novo.",
          403,
          "TURNSTILE_INVALIDO"
        )
      );
    })
    .catch(next);
}

module.exports = { exigirTurnstile };
