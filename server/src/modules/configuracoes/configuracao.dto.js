const { z } = require("zod");

// Mapa chave -> valor de configuracao. A AUTORIDADE e o service, que so grava
// chaves conhecidas (allowlist DEFINICOES), mascara segredos e faz String(valor).
// Aqui, na borda, so garantimos que o corpo e um objeto. Corpo ausente vira {}.
const salvarConfiguracoesSchema = z.preprocess(
  (v) => (v == null ? {} : v),
  z.record(z.unknown())
);

module.exports = { salvarConfiguracoesSchema };
