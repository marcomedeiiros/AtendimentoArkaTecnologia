const { z } = require("zod");

// Matriz cargo -> modulo -> boolean. A AUTORIDADE e o service, que so aceita
// cargos/modulos conhecidos e exige boolean (ignora o resto). Aqui, na borda, so
// garantimos que o corpo e um objeto (barra array/string/numero). Corpo ausente
// vira {} (salvar sem mudancas = aplica o padrao).
const salvarPermissoesSchema = z.preprocess(
  (v) => (v == null ? {} : v),
  z.record(z.unknown())
);

module.exports = { salvarPermissoesSchema };
