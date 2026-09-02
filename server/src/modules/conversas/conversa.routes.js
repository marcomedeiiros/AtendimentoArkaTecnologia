const router = require("express").Router();
const conversaController = require("./conversa.controller");
const conversaStream = require("./conversa.stream");
const validate = require("../../shared/middlewares/validate.middleware");
const { authMiddleware } = require("../../shared/middlewares/auth.middleware");
const { exigirModulo } = require("../permissoes/modulo.middleware");
const { midiaLimiter, correcaoLimiter } = require("../../shared/middlewares/rateLimit.middleware");
const {
  enviarMensagemSchema,
  adicionarNotaSchema,
  iniciarConversaSchema,
  atualizarStatusSchema,
  validarCnpjSchema,
  enviarMidiaSchema,
  atualizarFlagsSchema,
  encaminharMensagemSchema,
  editarMensagemSchema,
  atualizarSetorSchema,
  definirAtendenteSchema,
  avaliarAtendimentoSchema,
  corrigirTextoSchema,
} = require("./conversa.dto");

// SSE: autenticado pelo ticket na query (o EventSource nao manda header).
// Precisa vir ANTES do authMiddleware global e antes de "/:id".
router.get("/stream", (req, res) => conversaStream.stream(req, res));

// Midia de uma mensagem, servida por URL (o <img>/<video> nao manda header
// Authorization): autenticada pelo token assinado em ?t=. Tambem precisa vir
// antes do authMiddleware global. Ver midiaToken.helper.
router.get("/mensagens/:mensagemId/midia", midiaLimiter, (req, res, next) =>
  conversaController.servirMidia(req, res).catch(next)
);

router.use(authMiddleware);
// Central de Atendimento -> modulo "atendimento" na matriz de permissoes.
router.use(exigirModulo("atendimento"));

router.post("/stream-ticket", (req, res) => conversaStream.criarTicket(req, res));
router.get("/", (req, res, next) => conversaController.listar(req, res).catch(next));

// ANTES de "/:id": "estados" casaria com o parametro e cairia em `obter`.
// Retrato barato (status/setor/responsavel/versao, sem mensagem nenhuma) para a
// Central reconciliar de minuto em minuto -- ver conversaService.listarEstados.
router.get("/estados", (req, res, next) =>
  conversaController.listarEstados(req, res).catch(next)
);

// PARA QUEM DA PARA TRANSFERIR -- e ANTES de "/:id", senao "atendentes" seria
// lido como um id de conversa.
//
// Vive aqui, e nao em /api/equipe, de proposito. O seletor de transferencia
// usava a lista da equipe, que exige o modulo "equipe" (a tela de GESTAO). Na
// matriz de permissoes esse modulo e do grupo A -- so o Comercial o tem por
// padrao -- entao Tecnico e Financeiro levavam 403 e o seletor aparecia vazio
// ("Nenhum outro operador com conta"), com a base cheia de operadores.
//
// A correcao nao podia ser dar "equipe" ao Tecnico: isso abriria a tela de
// gestao junto. Transferir e atendimento, e o guard aqui e o `exigirModulo
// ("atendimento")` la de cima -- o mesmo que ele ja precisa ter para abrir
// esta tela. O payload traz so o que serve para escolher (id, nome, cargo,
// presenca): sem e-mail, sem nada de gestao.
router.get("/atendentes", (req, res, next) =>
  conversaController.listarAtendentes(req, res).catch(next)
);
// A LISTA DE MOTIVOS DE ENCERRAMENTO -- e ANTES de "/:id", pela mesma razao das
// duas rotas acima: "motivos" seria lido como id de conversa.
//
// Vive aqui, e nao em /api/configuracoes, porque quem precisa dela e a tela de
// ATENDIMENTO, no instante de fechar. A tela de configuracoes exige perfil de
// Administrador; se a lista viesse de la, o atendente comum receberia 403 no
// modal de fechamento e ficaria sem nenhuma opcao para escolher -- travado numa
// acao obrigatoria. Mesmo raciocinio de "/atendentes" logo acima.
router.get("/motivos-encerramento", (req, res, next) =>
  conversaController.listarMotivos(req, res).catch(next)
);

// ANTES de "/:id": em Express a primeira rota que casa vence, e "/iniciar"
// casaria com "/:id" se viesse depois.
router.post("/iniciar", validate(iniciarConversaSchema), (req, res, next) =>
  conversaController.iniciarConversa(req, res).catch(next)
);

// CORRETOR DE TEXTO da caixa de mensagem. Nao recebe id de conversa: corrige a
// frase que esta sendo digitada, antes de ela virar mensagem.
//
// Declarada aqui, junto de "/iniciar", pelo habito da casa de por as rotas
// literais antes das de parametro -- ainda que "/corrigir-texto" (POST) nao
// colidisse com "/:id" (GET).
//
// Com limitador: cada clique e uma chamada paga a um provedor externo, e o teto
// generoso do apiLimiter global (~133/min) nao serve de freio para isso.
router.post("/corrigir-texto", correcaoLimiter, validate(corrigirTextoSchema), (req, res, next) =>
  conversaController.corrigirTexto(req, res).catch(next)
);
router.get("/:id", (req, res, next) => conversaController.obter(req, res).catch(next));
router.post("/:id/atender", (req, res, next) => conversaController.atender(req, res).catch(next));
// Historico de atendimentos (OS) do cliente daquele fio de conversa.
router.get("/:id/atendimentos", (req, res, next) =>
  conversaController.atendimentos(req, res).catch(next)
);
router.post("/:id/mensagens", validate(enviarMensagemSchema), (req, res, next) =>
  conversaController.enviarMensagem(req, res).catch(next)
);
// Nota interna. Rota SEPARADA de /mensagens de proposito: o que nao sai para o
// cliente nao compartilha caminho com o que sai (ver adicionarNota no service).
router.post("/:id/notas", validate(adicionarNotaSchema), (req, res, next) =>
  conversaController.adicionarNota(req, res).catch(next)
);
router.post("/:id/midia", validate(enviarMidiaSchema), (req, res, next) =>
  conversaController.enviarMidia(req, res).catch(next)
);
router.post("/mensagens/encaminhar", validate(encaminharMensagemSchema), (req, res, next) =>
  conversaController.encaminharMensagem(req, res).catch(next)
);
router.patch("/mensagens/:mensagemId", validate(editarMensagemSchema), (req, res, next) =>
  conversaController.editarMensagem(req, res).catch(next)
);
router.post("/mensagens/:mensagemId/transcrever", (req, res, next) =>
  conversaController.transcreverAudio(req, res).catch(next)
);
router.delete("/mensagens/:mensagemId", (req, res, next) =>
  conversaController.apagarMensagem(req, res).catch(next)
);
router.post("/:id/solicitar-cnpj", (req, res, next) =>
  conversaController.solicitarCnpj(req, res).catch(next)
);
// DELETE /:id/cnpj foi REMOVIDA junto com o "X" do cabecalho do chat. Correcao
// de CNPJ errado: o cliente responde "NAO" na confirmacao do bot, ou o
// administrador desvincula o contato em Clientes (CNPJ).
router.post("/:id/validar-cnpj", validate(validarCnpjSchema), (req, res, next) =>
  conversaController.validarCnpj(req, res).catch(next)
);
router.patch("/:id/status", validate(atualizarStatusSchema), (req, res, next) =>
  conversaController.atualizarStatus(req, res).catch(next)
);
router.patch("/:id/setor", validate(atualizarSetorSchema), (req, res, next) =>
  conversaController.atualizarSetor(req, res).catch(next)
);
router.patch("/:id/atendente", validate(definirAtendenteSchema), (req, res, next) =>
  conversaController.definirAtendente(req, res).catch(next)
);
router.post("/:id/avaliacao", validate(avaliarAtendimentoSchema), (req, res, next) =>
  conversaController.avaliarAtendimento(req, res).catch(next)
);
router.patch("/:id/flags", validate(atualizarFlagsSchema), (req, res, next) =>
  conversaController.atualizarFlags(req, res).catch(next)
);
router.patch("/:id/lido", (req, res, next) => conversaController.marcarLido(req, res).catch(next));
router.delete("/:id", (req, res, next) => conversaController.remover(req, res).catch(next));

module.exports = router;
