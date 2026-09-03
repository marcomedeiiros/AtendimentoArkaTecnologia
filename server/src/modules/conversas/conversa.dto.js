const { z } = require("zod");

const { SETORES } = require("../../shared/helpers/setor.helper");

// ── O QUE O SCHEMA NAO DECLARA, O SCHEMA APAGA ──────────────────────────────
//
// `validate` faz `req.body = schema.parse(req.body)`, e `z.object` DESCARTA
// chave que ele nao conhece. Este schema declarava so `texto` -- entao o
// `respondendoAId` que a Central manda em toda resposta era removido do corpo
// antes de o controller ler, silenciosamente e sem erro nenhum.
//
// O efeito era o "responder" do WhatsApp nao funcionar de ponta a ponta, e por
// dois caminhos ao mesmo tempo: sem o id nao se monta o `quoted` do envio (a
// mensagem chegava ao cliente solta, sem citar coisa nenhuma) e nada era gravado
// em `Mensagem.respondendoAId` (entao a propria Central tambem nao desenhava o
// trecho citado na bolha). Parecia recurso quebrado no WhatsApp; era campo comido
// na porta de entrada.
const enviarMensagemSchema = z.object({
  texto: z.string().min(1),
  // `nullish`: a Central manda `respondendoAId: null` quando a resposta nao cita
  // ninguem -- e null tem de passar, nao virar erro de validacao.
  respondendoAId: z.string().min(1).nullish(),
});

// Nota interna: texto e so isso. Sem `respondendoAId` de proposito -- citar uma
// mensagem e um recurso do WhatsApp, e a nota nunca chega la.
//
// O teto de 2000 existe porque a nota vai para a MESMA linha do tempo das
// mensagens: sem limite, um relatorio colado inteiro empurraria a conversa para
// fora da tela e viajaria em toda cauda de evento enviada pelo SSE.
const adicionarNotaSchema = z.object({
  texto: z.string().min(1, "Escreva a nota").max(2000, "Nota muito longa (maximo 2000 caracteres)"),
});

// Corretor de texto da caixa de mensagem. So o texto: o corretor nao conhece
// conversa, cliente nem destino -- ele recebe uma frase e devolve a frase
// corrigida, e quem decide enviar e o atendente.
//
// O teto casa com o `MAX_CARACTERES` do correcao.client: recusar aqui, na
// porta, e mais barato (e mais claro para quem le o erro) do que gastar a
// chamada da API para receber um limite estourado do outro lado.
const corrigirTextoSchema = z.object({
  texto: z
    .string()
    .min(1, "Escreva algo para corrigir")
    .max(4000, "Texto muito longo para corrigir (maximo 4000 caracteres)"),
});

// Conversa iniciada pelo painel (botao de enviar da Central).
//
// O telefone e validado de leve aqui (tamanho plausivel) e normalizado de
// verdade no service, que e quem sabe as regras de DDI/DDD -- deixar a
// normalizacao no schema esconderia a regra num lugar onde ninguem procura.
// A MENSAGEM E OPCIONAL, e essa e a unica coisa que muda entre os dois modos.
//
// Sem texto, a conversa e so ABERTA no painel: nada sai para o WhatsApp e o
// cliente nao recebe nada. Serve para deixar o fio pronto antes de falar --
// registrar quem vai ser atendido, ja no setor certo, e escrever depois.
//
// Continua sendo `string` quando vem: quem decide se esta vazia e o service,
// que ja fazia o `trim`. Exigir `min(1)` aqui de novo obrigaria a tela a NAO
// mandar o campo, em vez de poder mandar string vazia -- duas formas de dizer
// a mesma coisa, e a que ninguem lembra vira erro 400 sem motivo.
const iniciarConversaSchema = z.object({
  telefone: z.string().min(8, "Informe DDD + numero"),
  nome: z.string().max(120).optional(),
  setor: z.enum(SETORES).optional(),
  texto: z.string().optional(),
});

const atualizarStatusSchema = z.object({
  status: z.enum(["pendente", "aberta", "fechada"]),
  // MOTIVO DO ENCERRAMENTO. Opcional AQUI de proposito, e exigido no service.
  //
  // A obrigatoriedade nao e do formato, e da situacao: so vale quando o status e
  // "fechada". Escrever isso como um `superRefine` neste schema resolveria
  // metade -- a outra metade e que o motivo tambem precisa EXISTIR na lista
  // configurada, e essa lista mora no banco. Um schema nao consulta banco.
  //
  // Deixar as duas checagens juntas no service e o que impede a regra de valer
  // pela metade em um dos dois lugares.
  motivo: z.string().trim().min(1).max(60).optional(),
});

const validarCnpjSchema = z.object({
  // 11 = CPF sem pontuacao. Peneira grossa contra campo vazio; quem valida de
  // verdade e `documentoValido` no servico -- ver parceiro.dto.js.
  cnpj: z.string().min(11),
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

// Teto POR TIPO, alinhado ao que o WhatsApp aceita. Existe para o operador
// receber um "nao" claro AQUI em vez de um erro opaco da Evolution depois de
// esperar o upload de 15MB: a imagem de 8MB era aceita por nos e recusada la.
const MAX_POR_TIPO = {
  imagem: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  documento: MAX_BYTES,
};
const emMB = (bytes) => `${(bytes / (1024 * 1024)).toFixed(bytes >= 1024 * 1024 ? 1 : 2)}MB`;

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

/**
 * Assinatura de CONTAINER por familia (audio, video, documento).
 *
 * Terceira camada da defesa: o mimetype declarado ja passou pela allowlist, e o
 * download ainda serve com nosniff + CSP sandbox. Isto barra na ENTRADA um
 * arquivo que so finge ser midia -- um .html renomeado para .ogg nunca chega ao
 * disco.
 *
 * A checagem e por FAMILIA, nao por mimetype exato, de proposito: o gravador do
 * navegador as vezes rotula webm como ogg (e vice-versa), e reprovar por isso
 * quebraria o envio de audio sem ganho de seguranca nenhum -- o que importa e
 * "isto e mesmo um container de audio/video?".
 */
const ASSINATURAS = {
  audio: [
    { nome: "ogg", casa: (b) => b.toString("ascii", 0, 4) === "OggS" },
    { nome: "webm/mkv", casa: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
    { nome: "mp4/m4a", casa: (b) => b.toString("ascii", 4, 8) === "ftyp" },
    { nome: "wav", casa: (b) => b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WAVE" },
    { nome: "mp3(id3)", casa: (b) => b.toString("ascii", 0, 3) === "ID3" },
    // MPEG/AAC cru: sincronizacao 0xFF seguida de 0xE_/0xF_.
    { nome: "mpeg/adts", casa: (b) => b[0] === 0xff && (b[1] & 0xe0) === 0xe0 },
    { nome: "amr", casa: (b) => b.toString("ascii", 0, 5) === "#!AMR" },
  ],
  video: [
    { nome: "mp4/3gp/mov", casa: (b) => b.toString("ascii", 4, 8) === "ftyp" },
    { nome: "webm/mkv", casa: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
    { nome: "ogg", casa: (b) => b.toString("ascii", 0, 4) === "OggS" },
  ],
  documento: [
    { nome: "pdf", casa: (b) => b.toString("ascii", 0, 4) === "%PDF" },
    // docx/xlsx/pptx e zip: todos sao ZIP por dentro.
    { nome: "zip", casa: (b) => b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07) },
    // doc/xls/ppt antigos (OLE2).
    { nome: "ole2", casa: (b) => b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0 },
  ],
};

// Tipos sem assinatura confiavel: texto e o "octet-stream" generico. Barrar
// esses por bytes seria adivinhacao -- eles ficam de pe nas outras camadas
// (allowlist de Content-Type, nosniff, download como anexo).
const SEM_ASSINATURA = new Set(["text/plain", "text/csv", "application/octet-stream"]);

function cabecalhoDaMedia(media) {
  try {
    // 32 bytes bastam para toda assinatura desta tabela; nao decodificamos o
    // arquivo inteiro so para olhar o comeco dele.
    const b64 = extrairBase64(media).replace(/\s/g, "").slice(0, 64);
    return Buffer.from(b64, "base64");
  } catch {
    return Buffer.alloc(0);
  }
}

function assinaturaFamiliaConfere(media, tipo, mime) {
  if (SEM_ASSINATURA.has(mime)) return true;
  const tabela = ASSINATURAS[tipo];
  if (!tabela) return true;
  const buf = cabecalhoDaMedia(media);
  if (buf.length < 12) return false;
  return tabela.some((a) => {
    try { return a.casa(buf); } catch { return false; }
  });
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
    caption: z
      .string()
      .max(4096)
      .optional()
      .transform((v) => (typeof v === "string" ? v.replace(/\0/g, "").trim() || undefined : undefined)),
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
    const tetoDoTipo = MAX_POR_TIPO[d.tipo] || MAX_BYTES;
    if (!info.url && info.bytes > tetoDoTipo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        // Mensagem com os dois numeros: o operador precisa saber o quanto passou,
        // nao so que passou.
        message: `Arquivo de ${emMB(info.bytes)} excede o limite de ${emMB(tetoDoTipo)} para ${d.tipo}`,
        path: ["media"],
      });
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
    } else if (!info.url && !assinaturaFamiliaConfere(d.media, d.tipo, mime)) {
      // Audio, video e documento: os bytes tambem precisam ser do que dizem ser.
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `O conteudo enviado nao parece ser um arquivo de ${d.tipo} valido`,
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

// Importacao do historico do WhatsApp. Corpo inteiro opcional: o clique padrao
// da tela nao manda nada e o service usa os proprios tetos.
//
// `limite` NAO e uma preferencia de gosto -- e quantas mensagens uma requisicao
// pode arrastar antes de virar espera. O teto de verdade vive no service
// (MAX_POR_IMPORTACAO), porque quem sabe o custo de cada pagina e ele; aqui so
// barramos numero absurdo/negativo na porta.
const importarHistoricoSchema = z.object({
  limite: z.coerce.number().int().min(1).max(3000).optional(),
  // Desligar o download da midia torna a importacao muito mais rapida quando o
  // historico e antigo (os bytes provavelmente nao existem mais nos servidores
  // do WhatsApp e cada tentativa e uma ida perdida).
  baixarMidia: z.boolean().optional(),
});

module.exports = {
  enviarMensagemSchema,
  adicionarNotaSchema,
  corrigirTextoSchema,
  importarHistoricoSchema,
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
