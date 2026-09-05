const router = require("express").Router();
const controller = require("./ranking.controller");
const { authMiddleware } = require("../../shared/middlewares/auth.middleware");
const { adminMiddleware } = require("../../shared/middlewares/admin.middleware");
const { exigirModulo } = require("../permissoes/modulo.middleware");
const { podeVerRelatoriosDeVisita } = require("../../shared/helpers/equipeRanking.helper");
const validate = require("../../shared/middlewares/validate.middleware");
const {
  criarMapeamentoSchema,
  atualizarMapeamentoSchema,
  validarMapeamentoSchema,
  premiacaoSchema,
} = require("./ranking.dto");

// Tudo daqui exige sessao. O que vem DEPOIS dela sao duas portas diferentes,
// e a diferenca importa (ver `exigirRelatorioDeVisita` logo abaixo).
router.use(authMiddleware);

/**
 * A PORTA DA TELA DE RELATORIOS -- mais estreita que o modulo "rankings".
 *
 * ── POR QUE NAO E O MODULO ─────────────────────────────────────────────────
 *
 * A matriz de permissoes e por CARGO, e "quem faz visita tecnica" nao e um
 * cargo: e uma marca por pessoa (`equipeRanking`), porque dois tecnicos do
 * mesmo cargo fazem coisas diferentes. Liberar Relatorios pelo modulo
 * obrigaria a ligar "rankings" para o cargo Tecnico INTEIRO -- e junto com a
 * tela viriam as tabelas de classificacao das duas equipes, com nome e
 * pontuacao de todo mundo, para gente que so precisa mandar o proprio
 * relatorio.
 *
 * Entao a equipe abre SO estas rotas. As rotas de ranking continuam atras de
 * `exigirModulo("rankings")`, exatamente como estavam.
 *
 * ── O QUE ELA NAO FAZ ──────────────────────────────────────────────────────
 *
 * Passar por aqui nao e ver tudo: `mapeamento.service` recorta por dono em
 * TODAS as leituras -- cada tecnico enxerga so os relatorios que ele mesmo
 * enviou, e so o Administrador ve os da equipe inteira. Esta porta decide quem
 * entra na sala; quem decide o que cada um enxerga la dentro e o service.
 *
 * Quem ja tinha o modulo pelo cargo continua entrando: a regra so ADICIONA.
 */
function exigirRelatorioDeVisita(req, res, next) {
  // `req.user` vem do BANCO a cada requisicao (authMiddleware), entao tirar
  // alguem da equipe vale na requisicao seguinte -- e nao quando o token vencer.
  if (podeVerRelatoriosDeVisita(req.user)) return next();
  // Cai para a matriz: nao tira de ninguem o que o cargo ja concedia.
  return exigirModulo("rankings")(req, res, next);
}

/**
 * @openapi
 * /api/rankings/equipes:
 *   get:
 *     tags: [Rankings]
 *     security: [{ bearerAuth: [] }]
 *     summary: Quem concorre em cada ranking e quem supervisiona
 */
router.get("/equipes", exigirModulo("rankings"), (req, res, next) => controller.equipes(req, res).catch(next));

/**
 * @openapi
 * /api/rankings/regras:
 *   get:
 *     tags: [Rankings]
 *     security: [{ bearerAuth: [] }]
 *     summary: Pesos e faixas da pontuacao do atendimento fora da sede
 */
router.get("/regras", exigirRelatorioDeVisita, (req, res, next) => controller.regras(req, res).catch(next));

// ── MAPEAMENTOS -- antes de /:equipe, senao "mapeamentos" cairia na rota do
// ranking e viraria um "ranking chamado mapeamentos" com erro 400.
router.get("/mapeamentos", exigirRelatorioDeVisita, (req, res, next) => controller.listarMapeamentos(req, res).catch(next));
// O PDF. Antes de "/mapeamentos/:id" nao precisa (o caminho e mais longo), mas
// fica junto para quem le a lista ver que o arquivo tem endereco proprio -- e
// que por isso o service reconfere a permissao em vez de confiar na listagem.
router.get("/mapeamentos/:id/arquivo", exigirRelatorioDeVisita, (req, res, next) =>
  controller.baixarMapeamento(req, res).catch(next)
);
router.get("/mapeamentos/:id", exigirRelatorioDeVisita, (req, res, next) => controller.obterMapeamento(req, res).catch(next));
router.post("/mapeamentos", exigirRelatorioDeVisita, validate(criarMapeamentoSchema), (req, res, next) =>
  controller.criarMapeamento(req, res).catch(next)
);
router.patch("/mapeamentos/:id", exigirRelatorioDeVisita, validate(atualizarMapeamentoSchema), (req, res, next) =>
  controller.atualizarMapeamento(req, res).catch(next)
);
// Aprovar/devolver: o guarda de supervisor esta no service, que le o CADASTRO
// (e nao o token) -- assim tirar a marca de supervisor vale na hora, sem
// esperar o token da pessoa expirar.
router.post("/mapeamentos/:id/validar", exigirRelatorioDeVisita, validate(validarMapeamentoSchema), (req, res, next) =>
  controller.validarMapeamento(req, res).catch(next)
);
router.delete("/mapeamentos/:id", exigirRelatorioDeVisita, (req, res, next) => controller.removerMapeamento(req, res).catch(next));

// ── PREMIACAO. So administrador: e o registro do que foi pago a quem.
router.get("/premiacoes", exigirModulo("rankings"), (req, res, next) => controller.listarPremiacoes(req, res).catch(next));
router.post("/premiacoes", adminMiddleware, validate(premiacaoSchema), (req, res, next) =>
  controller.registrarPremiacao(req, res).catch(next)
);
router.delete("/premiacoes/:id", adminMiddleware, (req, res, next) =>
  controller.removerPremiacao(req, res).catch(next)
);

// ── RANKINGS. Por ultimo: `:equipe` casaria com qualquer caminho acima.
router.get("/:equipe/historico", exigirModulo("rankings"), (req, res, next) => controller.historico(req, res).catch(next));
router.get("/:equipe", exigirModulo("rankings"), (req, res, next) => controller.obter(req, res).catch(next));

module.exports = router;
