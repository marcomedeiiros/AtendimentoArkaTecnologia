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

// Edicao do relato (o lapis na lista). ALLOWLIST UNICA: so descricao e
// prioridade mudam. Autoria, pagina, prints e data ficam de fora de proposito
// -- eles sao o registro de onde e de quem veio o problema, nao campo editavel.
// A mesma lista e reconferida no service (defesa em profundidade).
const atualizarBugSchema = z
  .object({
    descricao: z.string().min(5, "Descreva o problema com pelo menos 5 caracteres").max(4000).optional(),
    prioridade: z.enum(["baixa", "media", "alta", "critica"]).optional(),
    // Prints na EDICAO (quem esqueceu de anexar na hora, ou quer trocar).
    //
    // Mesmas barreiras do criar: teto de caracteres ANTES de decodificar e no
    // maximo 3. A validacao de verdade (raster na whitelist + magic bytes +
    // reserializacao) e do validarImagensBug, no service.
    //
    // `nullable` tem significado proprio aqui: null/[] = remover todos.
    // AUSENTE (undefined) = nao mexer -- e o que impede um cliente que nao
    // conhece o campo de apagar os prints de um relato ao editar so o texto.
    imagens: z
      .array(z.string().max(4_500_000))
      .max(3, "No maximo 3 imagens por relato")
      .optional()
      .nullable(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "Informe a descricao, a prioridade ou as imagens",
  });

module.exports = { criarBugSchema, atualizarStatusSchema, atualizarBugSchema };
