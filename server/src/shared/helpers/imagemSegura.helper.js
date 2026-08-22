/**
 * Validacao de imagens enviadas pelo cliente como data URL base64.
 *
 * SEGURANCA (defesa em profundidade): imagens vindas do cliente sao guardadas e
 * depois renderizadas/enviadas. O servidor NAO confia no que o front declarou.
 * Esta e a barreira de verdade, compartilhada por quem aceita imagem (relatos de
 * bug, anexos de mensagem rapida, etc.):
 *
 *   1. So raster: PNG/JPEG/WebP/GIF. SVG e recusado de proposito (pode carregar
 *      <script> e virar XSS ao ser aberto).
 *   2. Confere os "magic bytes" apos decodificar o base64 -> ninguem declara
 *      image/png e contrabandeia HTML/JS.
 *   3. Limita tamanho ANTES de decodificar (nao gasta CPU/memoria com payload
 *      gigante) e reserializa a partir dos bytes conferidos (descarta sujeira).
 */
const AppError = require("../errors/AppError");

// Assinatura de bytes iniciais por mime permitido.
const ASSINATURAS = {
  "image/png": (b) =>
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  "image/jpeg": (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/gif": (b) =>
    b.length >= 6 &&
    b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 &&
    (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61,
  "image/webp": (b) =>
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50, // WEBP
};

// data:<mime>;base64,<dados>  (jpg aceito como alias de jpeg)
const RE_DATA_URL = /^data:(image\/(?:png|jpe?g|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/;
const RE_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function normalizarMime(mime) {
  return mime === "image/jpg" ? "image/jpeg" : mime;
}

function falhar(msg) {
  throw new AppError(msg, 400, "IMAGEM_INVALIDA");
}

/**
 * Valida UMA imagem em data URL. Devolve { media, mimetype } saneados, ou lanca
 * AppError(400). `maxBytes` limita o conteudo decodificado.
 */
function validarImagemDataUrl(dataUrl, { maxBytes = 3 * 1024 * 1024 } = {}) {
  if (typeof dataUrl !== "string") falhar("Imagem invalida.");
  // base64 infla ~33%; teto de caracteres antes mesmo de decodificar.
  const maxChars = Math.ceil((maxBytes * 4) / 3) + 64;
  if (dataUrl.length > maxChars) falhar("Imagem grande demais.");

  const m = RE_DATA_URL.exec(dataUrl);
  if (!m) falhar("So aceitamos imagens PNG, JPEG, WebP ou GIF.");

  const mime = normalizarMime(m[1]);
  const base64 = m[2];
  if (!RE_BASE64.test(base64)) falhar("Conteudo da imagem corrompido.");

  let bytes;
  try {
    bytes = Buffer.from(base64, "base64");
  } catch {
    falhar("Conteudo da imagem corrompido.");
  }
  if (bytes.length === 0) falhar("Imagem vazia.");
  if (bytes.length > maxBytes) falhar("Imagem grande demais.");

  const confere = ASSINATURAS[mime];
  if (!confere || !confere(bytes)) {
    // Tipo declarado nao bate com o conteudo real: possivel contrabando.
    falhar("O arquivo nao parece ser uma imagem valida.");
  }

  // Reserializa a partir dos bytes conferidos, no mime canonico.
  return { media: `data:${mime};base64,${bytes.toString("base64")}`, mimetype: mime };
}

// data:<mime>;base64,<dados> para video (mp4/webm/mov/3gp).
const RE_DATA_URL_VIDEO = /^data:(video\/(?:mp4|webm|quicktime|3gpp));base64,([A-Za-z0-9+/]+={0,2})$/;

/**
 * Valida UM video em data URL. Devolve { media, mimetype } saneados, ou lanca
 * AppError(400). Mesma defesa da imagem: teto de tamanho antes de decodificar,
 * alfabeto base64 e uma checagem leve de assinatura (mp4/mov tem "ftyp";
 * webm tem o cabecalho EBML). Nao reserializa (video e grande).
 */
function validarVideoDataUrl(dataUrl, { maxBytes = 20 * 1024 * 1024 } = {}) {
  if (typeof dataUrl !== "string") falhar("Vídeo inválido.");
  const maxChars = Math.ceil((maxBytes * 4) / 3) + 64;
  if (dataUrl.length > maxChars) falhar("Vídeo grande demais.");

  const m = RE_DATA_URL_VIDEO.exec(dataUrl);
  if (!m) falhar("Só aceitamos vídeo MP4, WebM, MOV ou 3GP.");

  const mime = m[1];
  const base64 = m[2];
  if (!RE_BASE64.test(base64)) falhar("Conteúdo do vídeo corrompido.");

  // So os primeiros bytes bastam para conferir a assinatura (nao decodifica tudo).
  let cabecalho;
  try {
    cabecalho = Buffer.from(base64.slice(0, 64), "base64");
  } catch {
    falhar("Conteúdo do vídeo corrompido.");
  }
  const bytesEstimados = Math.floor((base64.replace(/=+$/, "").length * 3) / 4);
  if (bytesEstimados === 0) falhar("Vídeo vazio.");
  if (bytesEstimados > maxBytes) falhar("Vídeo grande demais.");

  const ehFtyp = cabecalho.length >= 12 && cabecalho.toString("ascii", 4, 8) === "ftyp"; // mp4/mov/3gp
  const ehWebm =
    cabecalho.length >= 4 &&
    cabecalho[0] === 0x1a && cabecalho[1] === 0x45 && cabecalho[2] === 0xdf && cabecalho[3] === 0xa3;
  if (!ehFtyp && !ehWebm) {
    falhar("O arquivo não parece ser um vídeo válido.");
  }

  // Devolve a data URL como veio (bytes preservados), com o mime canonico.
  return { media: dataUrl, mimetype: mime };
}

module.exports = { validarImagemDataUrl, validarVideoDataUrl };
