// Transcricao de audio (fala -> texto).
//
// Usa a API de transcricao no formato OpenAI (multipart /audio/transcriptions).
// O provedor padrao e a Groq, que roda Whisper large-v3-turbo com camada
// gratuita -- rapido e bom em portugues. Para usar a OpenAI em vez da Groq,
// basta apontar TRANSCRICAO_URL/MODELO e por a chave da OpenAI.
//
// Node 18+ ja traz fetch, FormData e Blob globais, entao nao ha dependencia nova.
const configuracaoService = require("../../modules/configuracoes/configuracao.service");
const AppError = require("../../shared/errors/AppError");

const URL =
  process.env.TRANSCRICAO_URL ||
  "https://api.groq.com/openai/v1/audio/transcriptions";
const MODELO = process.env.TRANSCRICAO_MODELO || "whisper-large-v3-turbo";

// Aceita data URL (data:audio/ogg;base64,....) ou base64 cru. Retorna { base64, mimetype }.
function separarBase64(media, mimetypeFallback) {
  if (typeof media !== "string") {
    throw new AppError("Áudio sem conteúdo para transcrever.", 400, "AUDIO_VAZIO");
  }
  if (media.startsWith("data:")) {
    const [cabecalho, dados] = media.split(",");
    const mime = /data:([^;]+)/.exec(cabecalho)?.[1] || mimetypeFallback || "audio/ogg";
    return { base64: dados, mimetype: mime };
  }
  return { base64: media, mimetype: mimetypeFallback || "audio/ogg" };
}

async function transcrever(media, mimetypeFallback) {
  const apiKey = await configuracaoService.transcricaoApiKey();
  if (!apiKey) {
    throw new AppError(
      "Transcrição não configurada. Adicione a chave (Groq) em Configurações.",
      400,
      "SEM_CHAVE_TRANSCRICAO"
    );
  }

  const { base64, mimetype } = separarBase64(media, mimetypeFallback);
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) {
    throw new AppError("Áudio vazio ou corrompido.", 400, "AUDIO_VAZIO");
  }

  const ext = mimetype.includes("mp") ? "mp3" : mimetype.includes("wav") ? "wav" : "ogg";
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mimetype }), `audio.${ext}`);
  form.append("model", MODELO);
  form.append("language", "pt");
  form.append("response_format", "json");

  let resp;
  try {
    resp = await fetch(URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch (e) {
    throw new AppError(`Falha de rede na transcrição: ${e.message}`, 502, "TRANSCRICAO_REDE");
  }

  if (!resp.ok) {
    const corpo = await resp.text().catch(() => "");
    throw new AppError(
      `Transcrição falhou (${resp.status}). ${corpo.slice(0, 200)}`,
      502,
      "TRANSCRICAO_ERRO"
    );
  }

  const data = await resp.json().catch(() => ({}));
  return String(data.text || "").trim();
}

module.exports = { transcrever };
