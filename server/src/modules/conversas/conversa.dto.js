const { z } = require("zod");

const { SETORES } = require("../../shared/helpers/setor.helper");

const enviarMensagemSchema = z.object({
  texto: z.string().min(1),
});

// Conversa iniciada pelo painel (botao de enviar da Central).
//
// O telefone e validado de leve aqui (tamanho plausivel) e normalizado de
// verdade no service, que e quem sabe as regras de DDI/DDD -- deixar a
// normalizacao no schema esconderia a regra num lugar onde ninguem procura.
const iniciarConversaSchema = z.object({
  telefone: z.string().min(8, "Informe DDD + numero"),
  nome: z.string().max(120).optional(),
  setor: z.enum(SETORES).optional(),
  texto: z.string().min(1, "Escreva a mensagem"),
});

const atualizarStatusSchema = z.object({
  status: z.enum(["pendente", "aberta", "fechada"]),
});

const validarCnpjSchema = z.object({
  cnpj: z.string().min(14),
});

const atualizarFlagsSchema = z
  .object({
    favorita: z.boolean().optional(),
    fixada: z.boolean().optional(),
    arquivada: z.boolean().optional(),
    oculta: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Informe ao menos uma flag" });

// Tipos de arquivo aceitos por categoria. Nunca confiar no `mimetype` que o
// front manda de graca: so passa o que estiver nesta lista (e, para documento,
// o octet-stream generico). Fecha o "upload sem checar tipo".
const MIMES_PERMITIDOS = {
  imagem: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  video: ["video/mp4", "video/3gpp", "video/quicktime", "video/webm"],
  audio: ["audio/ogg", "audio/mpeg", "audio/mp4", "audio/aac", "audio/wav", "audio/webm", "audio/opus"],
  documento: [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
    "text/csv",
    "application/zip",
    "application/octet-stream",
  ],
};

// Teto do conteudo decodificado (o body ja e limitado a 30mb no app.js, mas
// isto barra o abuso antes de repassar a midia adiante).
const MAX_BYTES = 20 * 1024 * 1024;

// Aceita data URL, base64 cru ou URL http(s). Devolve { mimeDeclarado, bytes }.
//
// O cabecalho do data URL pode ter parametros ANTES do `;base64`, ex.:
//   data:audio/ogg; codecs=opus;base64,AAAA...
// (o gravador de audio gera exatamente isso). Por isso separamos pela PRIMEIRA
// virgula, em vez de um regex rigido -- senao o audio era rejeitado como
// "base64 invalido" e nao enviava.
function inspecionarMedia(media) {
  const s = String(media || "");
  if (/^https?:\/\//i.test(s)) return { url: true };

  let base64 = s;
  let mimeDeclarado = null;
  if (s.startsWith("data:")) {
    const virgula = s.indexOf(",");
    if (virgula === -1) return { invalido: true };
    const cabecalho = s.slice(5, virgula); // ex.: "audio/ogg; codecs=opus;base64"
    mimeDeclarado = (cabecalho.split(";")[0] || "").trim() || null;
    base64 = s.slice(virgula + 1);
    // data URL sem base64 (texto puro) e incomum aqui; nao validamos como base64.
    if (!/;base64/i.test(cabecalho)) return { mimeDeclarado, bytes: base64.length };
  }

  // base64 valido: so o alfabeto correto e comprimento multiplo de 4.
  const limpo = base64.replace(/\s/g, "");
  if (!limpo || !/^[A-Za-z0-9+/]+={0,2}$/.test(limpo) || limpo.length % 4 !== 0) {
    return { invalido: true };
  }
  const bytes = Math.floor((limpo.length * 3) / 4);
  return { mimeDeclarado, bytes };
}

// Extrai apenas o payload base64 (sem o cabecalho do data URL, se houver).
function extrairBase64(media) {
  const s = String(media || "");
  if (s.startsWith("data:")) {
    const virgula = s.indexOf(",");
    return virgula === -1 ? "" : s.slice(virgula + 1);
  }
  return s;
}

// Defesa em profundidade: nao basta o mimetype declarado estar na allowlist -- o
// conteudo real precisa ser mesmo daquele tipo. Confere os "magic bytes" do
// cabecalho do arquivo para imagens (bloqueia um .exe/.html disfarcado de PNG).
function assinaturaImagemConfere(media, mime) {
  let buf;
  try {
    const b64 = extrairBase64(media).replace(/\s/g, "").slice(0, 32);
    buf = Buffer.from(b64, "base64");
  } catch {
    return false;
  }
  if (buf.length < 12) return false;
  switch (mime) {
    case "image/jpeg":
      return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    case "image/png":
      return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    case "image/gif":
      // "GIF87a" / "GIF89a"
      return buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38;
    case "image/webp":
      // "RIFF" .... "WEBP"
      return buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP";
    default:
      return false;
  }
}

// Nome de arquivo seguro: sem separadores de caminho (evita path traversal) e
// sem caracteres de controle (evita cabecalhos quebrados ao repassar a midia).
function nomeArquivoSeguro(nome) {
  // Allowlist: mantem letras, digitos, ponto, hifen e underscore; tudo mais
  // (separadores de caminho, espacos, controle, unicode) vira underscore.
  return String(nome)
    .replace(/[^A-Za-z0-9._-]+/g, "_") // allowlist: separadores/controle/unicode -> "_"
    .replace(/\.{2,}/g, ".") // colapsa ".." (neutraliza travessia de diretorio)
    .slice(0, 200)
    .trim();
}

const enviarMidiaSchema = z
  .object({
    tipo: z.enum(["imagem", "video", "documento", "audio", "localizacao"]),
    media: z.string().optional(), // base64 (data URL) ou URL publica
    mimetype: z.string().max(120).optional(),
    fileName: z.string().max(255).optional().transform((v) => (v ? nomeArquivoSeguro(v) : v)),
    caption: z.string().max(4096).optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    name: z.string().max(200).optional(),
    address: z.string().max(300).optional(),
  })
  .superRefine((d, ctx) => {
    if (d.tipo === "localizacao") {
      if (d.latitude == null || d.longitude == null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Informe latitude e longitude", path: ["latitude"] });
      }
      return;
    }

    if (!d.media) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Informe 'media'", path: ["media"] });
      return;
    }

    const info = inspecionarMedia(d.media);
    if (info.invalido) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Conteudo de midia invalido (base64 malformado)", path: ["media"] });
      return;
    }

    // O mimetype efetivo e o que o front declarou OU o embutido na data URL.
    const permitidos = MIMES_PERMITIDOS[d.tipo] || [];
    const mime = (d.mimetype || info.mimeDeclarado || "").toLowerCase().split(";")[0].trim();

    // URL http(s): sem bytes para medir; ainda exigimos um mimetype valido.
    if (!info.url && info.bytes > MAX_BYTES) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Arquivo excede o limite de 20MB", path: ["media"] });
    }
    if (!mime) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Informe o mimetype do arquivo", path: ["mimetype"] });
    } else if (!permitidos.includes(mime)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Tipo de arquivo nao permitido para ${d.tipo}: ${mime}`,
        path: ["mimetype"],
      });
    } else if (d.tipo === "imagem" && !info.url && !assinaturaImagemConfere(d.media, mime)) {
      // Mime declarado esta na allowlist, mas os bytes reais nao sao de imagem.
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "O conteudo enviado nao corresponde a uma imagem valida",
        path: ["media"],
      });
    }
  });

// Encaminhar uma mensagem para outra conversa: dois ids obrigatorios.
const encaminharMensagemSchema = z.object({
  mensagemId: z.string().min(1, "Informe a mensagem"),
  conversaDestinoId: z.string().min(1, "Informe a conversa de destino"),
});

// Editar o texto de uma mensagem ja enviada.
const editarMensagemSchema = z.object({
  texto: z.string().min(1, "Informe o novo texto"),
});

// Mover a conversa de setor: so setores conhecidos.
const atualizarSetorSchema = z.object({
  setor: z.enum(SETORES),
});

// Definir/limpar o atendente responsavel. String (id) para definir; null ou
// "" para liberar. Bloqueia objetos/arrays no lugar do id.
const definirAtendenteSchema = z.object({
  atendenteId: z.string().nullable().optional(),
});

// Avaliacao do atendimento: nota 1-5 e feedback opcional. `coerce` aceita a nota
// como numero ou string numerica; o service ainda normaliza (Number/trim).
const avaliarAtendimentoSchema = z.object({
  avaliacao: z.coerce.number().int().min(1).max(5).nullable().optional(),
  feedback: z.string().max(4096).nullable().optional(),
});

module.exports = {
  enviarMensagemSchema,
  iniciarConversaSchema,
  atualizarStatusSchema,
  validarCnpjSchema,
  enviarMidiaSchema,
  atualizarFlagsSchema,
  encaminharMensagemSchema,
  editarMensagemSchema,
  atualizarSetorSchema,
  definirAtendenteSchema,
  avaliarAtendimentoSchema,
};
