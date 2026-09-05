const { z } = require("zod");
const { SETORES } = require("../../shared/helpers/setor.helper");

// Fonte unica dos cargos validos. O service e o front espelham esta lista, mas a
// autoridade de "cargo existe?" mora aqui, na borda da API.
const CARGOS_VALIDOS = ["Administrador", "Financeiro", "Técnico", "Comercial"];

// PATCH /:id/status -- `ativo` PRECISA ser booleano. Sem isso, um valor ambiguo
// (ex.: a string "false", que e truthy) faria os guards do service
// (auto-desativacao, ultimo admin) trabalharem sobre a coisa errada.
const alterarStatusSchema = z.object({
  ativo: z.boolean(),
});

// PATCH /:id/cargo -- cargo restrito a allowlist. Barra qualquer valor fora dela
// antes mesmo de tocar no banco (fecha o "cargo arbitrario").
const alterarCargoSchema = z.object({
  cargo: z.enum(CARGOS_VALIDOS),
});

// PATCH /:id/setores -- os setores EXTRAS, alem do que o cargo ja da.
//
// A allowlist vem de `SETORES` (setor.helper), e nao de uma lista escrita aqui:
// duas listas dos mesmos quatro nomes acabam divergindo, e a que diverge vira
// um setor que se consegue conceder e que `podeAcessarSetor` nunca reconhece --
// permissao que a tela mostra e o servidor ignora.
const alterarSetoresSchema = z.object({
  setores: z.array(z.enum(SETORES)).max(SETORES.length),
});

// PATCH /:id/senha -- string com no minimo 6 caracteres (o service reconfere).
const redefinirSenhaSchema = z.object({
  senha: z.string().min(6, "A senha precisa de pelo menos 6 caracteres."),
});

// Em qual ranking a pessoa concorre. Nulo = nenhum, que e o padrao e o caso
// do supervisor. `nullable` explicito para poder TIRAR alguem do ranking.
const alterarRankingSchema = z
  .object({
    equipeRanking: z.enum(["sede", "externo"]).nullable().optional(),
    supervisorRanking: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Nada para atualizar" });

module.exports = {
  alterarRankingSchema,
  CARGOS_VALIDOS,
  alterarStatusSchema,
  alterarCargoSchema,
  alterarSetoresSchema,
  redefinirSenhaSchema,
};
