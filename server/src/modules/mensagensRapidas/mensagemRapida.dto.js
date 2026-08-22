const { z } = require("zod");

// Categorias e icones conhecidos (espelham o front). Valor fora da lista cai no
// padrao, em vez de recusar -- mantem robusto a versoes diferentes do cliente.
const CATEGORIAS = ["pagamento", "consulta", "encerramento", "suporte", "geral"];
const ICONES = ["pix", "search", "clock", "bye", "noreturn", "monitor", "default"];

// Anexo cru vindo do cliente. O `media` e barrado cedo por tamanho de string
// (a validacao real -- tipo raster + magic bytes -- roda no service, via
// imagemSegura). ~28 MB de string cobre uma imagem de ate ~20 MB em base64.
const anexoSchema = z
  .object({
    media: z.string().max(28_000_000),
    mimetype: z.string().max(120).optional().nullable(),
    fileName: z.string().max(300).optional().nullable(),
  })
  .optional()
  .nullable();

const baseSchema = {
  titulo: z.string().trim().min(1, "Informe um titulo").max(120),
  texto: z.string().max(4096).optional().default(""),
  categoria: z.string().optional().transform((v) => (CATEGORIAS.includes(v) ? v : "geral")),
  icon: z.string().optional().transform((v) => (ICONES.includes(v) ? v : "default")),
  anexo: anexoSchema,
};

// Uma mensagem precisa ter texto OU anexo (nao pode ser so um titulo vazio).
function exigirConteudo(d, ctx) {
  const temTexto = !!(d.texto && d.texto.trim());
  const temAnexo = !!(d.anexo && d.anexo.media);
  if (!temTexto && !temAnexo) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Informe o texto ou anexe uma imagem",
      path: ["texto"],
    });
  }
}

const criarMensagemRapidaSchema = z.object(baseSchema).superRefine(exigirConteudo);
const atualizarMensagemRapidaSchema = z.object(baseSchema).superRefine(exigirConteudo);

module.exports = {
  criarMensagemRapidaSchema,
  atualizarMensagemRapidaSchema,
  CATEGORIAS,
  ICONES,
};
