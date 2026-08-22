const { z } = require("zod");

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

// PATCH /:id/senha -- string com no minimo 6 caracteres (o service reconfere).
const redefinirSenhaSchema = z.object({
  senha: z.string().min(6, "A senha precisa de pelo menos 6 caracteres."),
});

module.exports = {
  CARGOS_VALIDOS,
  alterarStatusSchema,
  alterarCargoSchema,
  redefinirSenhaSchema,
};
