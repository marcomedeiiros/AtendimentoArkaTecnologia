/**
 * Armazenamento de MÍDIA EM DISCO (imagens, vídeos, áudios, documentos).
 *
 * Por que existe: a mídia era guardada como data URL base64 dentro do banco.
 * Um vídeo de 20MB virava ~27MB de texto no SQLite -- o banco inchava, cada
 * leitura pesava e a memória do Node subia junto. Agora os bytes vão para o
 * disco e o banco guarda só o caminho relativo do arquivo.
 *
 * SEGURANÇA:
 *  - O nome do arquivo é SEMPRE gerado aqui (uuid + extensão derivada do
 *    mimetype). Nada que venha do cliente vira caminho -- é o que impede path
 *    traversal ("../../etc/passwd") e sobrescrita de arquivo.
 *  - Na leitura, o caminho resolvido é conferido contra a pasta base: qualquer
 *    coisa fora dela é recusada, mesmo que o valor no banco seja adulterado.
 *
 * OPERAÇÃO: a pasta é definida por MEDIA_DIR (padrão ./dados/midia). Em Docker,
 * aponte para um VOLUME -- sem isso a mídia some quando o container é
 * reconstruído.
 */
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const logger = require("../../config/logger");

const BASE_DIR = path.resolve(process.env.MEDIA_DIR || path.join(process.cwd(), "dados", "midia"));

// Extensão a partir do mimetype. Lista fechada: um mimetype desconhecido cai em
// ".bin" em vez de virar uma extensão arbitrária vinda do cliente.
const EXTENSOES = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "video/3gpp": "3gp",
  "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac",
  "audio/wav": "wav", "audio/webm": "weba", "audio/opus": "opus",
  "application/pdf": "pdf", "application/zip": "zip",
  "text/plain": "txt", "text/csv": "csv",
};

function extensaoDe(mimetype) {
  return EXTENSOES[String(mimetype || "").toLowerCase().split(";")[0].trim()] || "bin";
}

// Caminho absoluto seguro a partir do relativo guardado no banco.
function caminhoAbsoluto(relativo) {
  if (typeof relativo !== "string" || !relativo) return null;
  const abs = path.resolve(BASE_DIR, relativo);
  // Confere que continua dentro da pasta base (defesa contra traversal).
  if (abs !== BASE_DIR && !abs.startsWith(BASE_DIR + path.sep)) return null;
  return abs;
}

/**
 * Grava os bytes de uma data URL (ou base64 cru) e devolve
 * { arquivo, mimetype, bytes } -- `arquivo` é o caminho RELATIVO para o banco.
 * Devolve null se não houver conteúdo utilizável.
 */
async function salvarDataUrl(dataUrl, mimetypeSugerido = null) {
  if (typeof dataUrl !== "string" || !dataUrl) return null;

  let base64 = dataUrl;
  let mimetype = mimetypeSugerido;
  if (dataUrl.startsWith("data:")) {
    const virgula = dataUrl.indexOf(",");
    if (virgula === -1) return null;
    mimetype = mimetype || (dataUrl.slice(5, virgula).split(";")[0] || "").trim();
    base64 = dataUrl.slice(virgula + 1);
  }

  let buffer;
  try {
    buffer = Buffer.from(base64, "base64");
  } catch {
    return null;
  }
  if (!buffer.length) return null;

  // Subpasta por ano/mês: evita milhares de arquivos num diretório só.
  const agora = new Date();
  const subpasta = path.join(String(agora.getFullYear()), String(agora.getMonth() + 1).padStart(2, "0"));
  const nome = `${crypto.randomUUID()}.${extensaoDe(mimetype)}`;
  const relativo = path.join(subpasta, nome);

  const destino = path.join(BASE_DIR, relativo);
  await fsp.mkdir(path.dirname(destino), { recursive: true });
  await fsp.writeFile(destino, buffer);

  return { arquivo: relativo.split(path.sep).join("/"), mimetype, bytes: buffer.length };
}

// Stream de leitura + tamanho, para servir o arquivo sem carregar na memória.
async function abrirParaLeitura(relativo) {
  const abs = caminhoAbsoluto(relativo);
  if (!abs) return null;
  try {
    const stat = await fsp.stat(abs);
    if (!stat.isFile()) return null;
    return { stream: fs.createReadStream(abs), tamanho: stat.size };
  } catch {
    return null;
  }
}

// Remoção best-effort (ex.: ao excluir a mensagem). Nunca lança.
async function remover(relativo) {
  const abs = caminhoAbsoluto(relativo);
  if (!abs) return false;
  try {
    await fsp.unlink(abs);
    return true;
  } catch {
    return false;
  }
}

// Cria a pasta no boot para falhar cedo (permissão/volume) em vez de só no
// primeiro upload.
(async () => {
  try {
    await fsp.mkdir(BASE_DIR, { recursive: true });
    logger.info("Armazenamento de midia pronto", { pasta: BASE_DIR });
  } catch (e) {
    logger.error("Nao foi possivel criar a pasta de midia", { pasta: BASE_DIR, message: e.message });
  }
})();

module.exports = { salvarDataUrl, abrirParaLeitura, remover, BASE_DIR };
