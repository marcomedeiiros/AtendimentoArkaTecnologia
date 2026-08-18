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

const enviarMidiaSchema = z
  .object({
    tipo: z.enum(["imagem", "video", "documento", "audio", "localizacao"]),
    media: z.string().optional(), // base64 (data URL) ou URL publica
    mimetype: z.string().optional(),
    fileName: z.string().optional(),
    caption: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    name: z.string().optional(),
    address: z.string().optional(),
  })
  .refine(
    (d) => (d.tipo === "localizacao" ? d.latitude != null && d.longitude != null : !!d.media),
    { message: "Informe 'media' (ou latitude/longitude para localizacao)" }
  );

module.exports = {
  enviarMensagemSchema,
  iniciarConversaSchema,
  atualizarStatusSchema,
  validarCnpjSchema,
  enviarMidiaSchema,
  atualizarFlagsSchema,
};
