/**
 * Validacao dos prints anexados a um relato de bug.
 *
 * A checagem pesada (whitelist de tipo raster + magic bytes + tamanho) vive no
 * helper compartilhado imagemSegura.helper.js. Aqui so aplicamos as regras
 * especificas do relato: no maximo 3 imagens, ate 3 MB cada.
 */
const { validarImagemDataUrl } = require("../../shared/helpers/imagemSegura.helper");
const AppError = require("../../shared/errors/AppError");

const MAX_IMAGENS = 3;
const MAX_BYTES_POR_IMAGEM = 3 * 1024 * 1024;

function falhar(msg) {
  throw new AppError(msg, 400, "IMAGEM_INVALIDA");
}

/**
 * Recebe o array cru vindo do corpo e devolve um array de data URLs ja
 * validado/saneado, ou lanca AppError (400) na primeira imagem suspeita.
 * Retorna null quando nao ha imagem (para gravar NULL no banco).
 */
function validarImagensBug(imagens) {
  if (imagens === undefined || imagens === null) return null;
  if (!Array.isArray(imagens)) falhar("Formato de imagens invalido.");
  if (imagens.length === 0) return null;
  if (imagens.length > MAX_IMAGENS) falhar(`No maximo ${MAX_IMAGENS} imagens por relato.`);

  return imagens.map(
    (item) => validarImagemDataUrl(item, { maxBytes: MAX_BYTES_POR_IMAGEM }).media
  );
}

module.exports = { validarImagensBug, MAX_IMAGENS, MAX_BYTES_POR_IMAGEM };
