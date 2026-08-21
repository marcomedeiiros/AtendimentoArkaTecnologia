const { z } = require("zod");

const criarBugSchema = z.object({
  descricao: z.string().min(5, "Descreva o problema com pelo menos 5 caracteres").max(4000),
  pagina: z.string().max(300).optional().nullable(),
  // Barreira barata: limita quantidade e tamanho da string ANTES de decodificar.
  // A validacao de verdade (mime na whitelist + magic bytes) e feita no service,
  // via validarImagensBug -- aqui so evitamos que zod deixe passar algo absurdo.
  imagens: z
    .array(z.string().max(4_500_000))
    .max(3, "No maximo 3 imagens por relato")
    .optional()
    .nullable(),
  // Prioridade escolhida por quem reporta (o admin ainda pode reajustar depois).
  // Valor invalido/ausente cai em "media".
  prioridade: z.enum(["baixa", "media", "alta", "critica"]).optional().default("media"),
});

const atualizarStatusSchema = z.object({
  status: z.enum(["aberto", "resolvido"]),
});

module.exports = { criarBugSchema, atualizarStatusSchema };
