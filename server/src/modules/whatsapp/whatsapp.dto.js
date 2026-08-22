const { z } = require("zod");

// O corpo pode chegar ausente (ex.: cliente que manda so ?instance= na query, ou
// um DELETE sem body). Tratamos undefined/null como objeto vazio para os campos
// OPCIONAIS nao falharem por "esperava objeto". Campos obrigatorios (ex.: texto)
// continuam barrando corpo vazio, que e o certo.
const corpo = (shape, refine) => {
  let esquema = z.object(shape);
  if (refine) esquema = esquema.refine(refine.check, refine.opts);
  return z.preprocess((v) => (v == null ? {} : v), esquema);
};

const nomeInstancia = z.string().min(1).max(120).optional();

// Rotas que so precisam saber a instancia (conectar/desconectar/reiniciar/excluir).
const instanceOnlySchema = corpo({ instance: nomeInstancia });

// Envio avulso/em massa: telefone e texto obrigatorios.
const enviarSchema = corpo({
  telefone: z.string().min(8, "Informe o telefone"),
  texto: z.string().min(1, "Escreva a mensagem"),
  instance: nomeInstancia,
});

// Criar instancia / configurar webhook: nome da instancia e URL publica base.
const instanciaConfigSchema = corpo({
  instance: nomeInstancia,
  baseUrlPublica: z.string().url().max(300).optional().or(z.literal("")),
});

// Resposta ao cliente (usada pelo n8n via webhook secret): precisa de texto e de
// um destino (conversaId OU telefone).
const responderSchema = corpo(
  {
    conversaId: z.string().optional(),
    telefone: z.string().min(8).optional(),
    texto: z.string().min(1, "Escreva a mensagem"),
    instance: nomeInstancia,
  },
  {
    check: (d) => Boolean(d.conversaId || d.telefone),
    opts: { message: "Informe conversaId ou telefone", path: ["telefone"] },
  }
);

module.exports = {
  instanceOnlySchema,
  enviarSchema,
  instanciaConfigSchema,
  responderSchema,
};
