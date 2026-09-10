// RECONEXAO DA INSTANCIA WHATSAPP -- O UNICO LUGAR QUE MANDA RECONECTAR.
//
// Objetivo, em uma linha: PAREAR UMA VEZ, e so voltar a pedir QR quando o
// WhatsApp de fato tiver invalidado a sessao.
//
// AS QUATRO SITUACOES QUE ESTE MODULO PRECISA SEPARAR
// ---------------------------------------------------
//   CONNECTED               socket aberto, nada a fazer
//   RECONNECTING            handshake em andamento -- NAO tocar
//   DISCONNECTED_TEMPORARY  caiu, credencial intacta -> religar sozinho
//   LOGGED_OUT              o WhatsApp derrubou o pareamento -> so o QR resolve
//
// A regra que nunca se quebra: DISCONNECTED_TEMPORARY jamais vira LOGGED_OUT
// por cansaco, por tempo ou por palpite. Vira LOGGED_OUT com EVIDENCIA:
// `disconnectionReasonCode` 401/403 vindo da propria Evolution, ou a ausencia
// confirmada da credencial no banco dela sem cofre para restaurar.
//
// TRES ARMADILHAS QUE JA CUSTARAM O PAREAMENTO AQUI
// -------------------------------------------------
// 1. `connecting` NAO e queda -- e o estado normal enquanto o socket sobe.
//    Reconectar no meio do handshake faz o Baileys abrir um SEGUNDO socket com
//    a mesma credencial; o WhatsApp mata um dos dois com `conflict: replaced` e
//    a sessao nunca chega a `open`. Por isso ha o `LIMITE_CONNECTING_MS`.
//
// 2. A chamada certa depende do estado, e usar a errada nao faz nada:
//      `close`      -> `/instance/connect`  (recria o socket; NAO apaga nada)
//      `connecting` -> `/instance/restart`  (derruba o socket travado)
//    `/instance/restart` RECUSA instancia em `close` (instance.controller.ts:361)
//    -- e devolve a recusa como HTTP 200 `{error:true}`. O codigo antigo usava
//    `restart` para tudo, e ainda por cima com PUT, que na 2.4.0-rc2 nem existe
//    (a rota so aceita POST). Ou seja: a reconexao automatica NUNCA funcionou.
//    Ela falhava em silencio, queimava as seis tentativas e a tela mandava
//    reescanear o QR com a sessao perfeitamente valida no Postgres.
//
// 3. "Veio QR" NAO prova pareamento perdido. `/instance/connect` devolve o
//    `qrCode` que estiver na memoria da instancia, sem verificar se ele e novo
//    (instance.controller.ts:332-336). Quem prova pareamento perdido e a
//    ausencia da credencial no banco -- ver `whatsapp.sessao.js`.
const evolutionApi = require("../../infrastructure/external/evolution-api.client");
const cofre = require("./whatsapp.sessao");
const env = require("../../config/env");
const logger = require("../../config/logger");

const INTERVALO_MS = Number(process.env.WHATSAPP_RECONEXAO_INTERVALO_MS) || 15 * 1000;

// BACKOFF: rapido no comeco, porque a esmagadora maioria das quedas dura
// segundos; folgado depois, para nao martelar a Evolution nem o WhatsApp.
// Esgotada a escada, NAO desistimos -- continuamos no ultimo degrau para
// sempre, enquanto a sessao continuar valida. Foi a desistencia definitiva do
// modelo antigo (6 tentativas, ~31 min) que transformava um apagao de rede
// mais longo num pedido de QR desnecessario.
const ESCADA_MS = [1_000, 2_000, 5_000, 10_000, 20_000, 30_000, 60_000];

// Jitter para nao sincronizar rajadas quando varios processos sobem juntos.
const JITTER = 0.2;

// ── FLAPPING: QUANDO RELIGAR RAPIDO E O PROBLEMA, NAO A SOLUCAO ─────────────
//
// A escada acima comeca em 1s porque a esmagadora maioria das quedas dura
// segundos. Isso e certo para UMA queda -- e errado quando a sessao esta sendo
// DISPUTADA.
//
// O que aconteceu em producao (10/09/2026, auditoria-integracao-whatsapp-10-09
// secao 9): o log da Evolution registrou 23 `conflict: replaced` em 12
// segundos. `replaced` e o WhatsApp dizendo "outra conexao assumiu esta
// sessao". Cada socket novo substitui o anterior, que morre antes de terminar a
// inicializacao (`failed to send initial passive iq`, `Failed to upload
// pre-keys`) -- e a instancia nunca chega a funcionar de verdade, so aparece
// como `open` por um instante.
//
// Nesse cenario, `_resetar()` a cada `open` fazia a escada RECOMECAR do 1s
// depois de uma sessao que durou 15 segundos. Ou seja: quanto pior a disputa,
// mais rapido nos jogavamos sockets nela. Somos parte do laco.
//
// A correcao NAO e desistir (a sessao continua valida, e o QR nunca ajuda
// aqui). E parar de martelar: contamos as quedas numa janela e, quando elas se
// repetem, a escada passa a comecar num degrau folgado em vez do primeiro.
const JANELA_FLAP_MS = Number(process.env.WHATSAPP_JANELA_FLAP_MS) || 10 * 60 * 1000;
// Tres quedas em dez minutos nao e "azar": e padrao. Duas ainda podem ser duas
// quedas independentes de rede.
const QUEDAS_PARA_FLAP = Number(process.env.WHATSAPP_QUEDAS_PARA_FLAP) || 3;
// Degrau minimo enquanto o flapping durar: o 4o da escada, 10s. Segue
// religando -- so nao em rajada. Dez vezes o piso anterior (1s) e ainda rapido
// o suficiente para nao atrasar de forma sensivel a volta de uma queda comum.
const DEGRAU_MINIMO_FLAP = 4;

// Quanto tempo `connecting` ainda e normal. Com `syncFullHistory` ligado a
// sincronizacao inicial estica bastante, por isso a folga e generosa. Passou
// disso, o socket travou e ai sim vale derrubar e religar.
const LIMITE_CONNECTING_MS =
  Number(process.env.WHATSAPP_LIMITE_CONNECTING_MS) || 3 * 60 * 1000;

// Codigos do Baileys em que o WhatsApp REALMENTE invalidou a sessao.
// Tudo o que nao esta aqui -- 408 timeout, 428 connectionClosed, 440
// connectionReplaced, 500, 503, 515 restartRequired -- e queda temporaria.
const CODIGOS_LOGOUT_REAL = cofre.CODIGOS_LOGOUT_REAL; // [401, 403]

const ESTADOS = {
  CONNECTED: "CONNECTED",
  RECONNECTING: "RECONNECTING",
  TEMPORARIO: "DISCONNECTED_TEMPORARY",
  DESLOGADO: "LOGGED_OUT",
  DESCONHECIDO: "UNKNOWN", // a Evolution nao respondeu -- nao e queda do WhatsApp
  // ── A INSTANCIA NAO EXISTE MAIS NA EVOLUTION (HTTP 404) ───────────────────
  //
  // Sexto estado porque nenhum dos cinco descreve o que acontece, e tratar isto
  // como um deles foi o que produziu o beco sem saida relatado:
  //
  //   - a Evolution RESPONDEU (nao e UNKNOWN);
  //   - o WhatsApp nao derrubou pareamento nenhum (nao e LOGGED_OUT);
  //   - nao ha socket para religar (nao e TEMPORARY): `/instance/connect` num
  //     nome que nao existe devolve 404 para sempre.
  //
  // O `catch` do ciclo era cego e virava `state: "unavailable"` -- entao o
  // painel dizia "Evolution indisponivel", NAO oferecia o QR (porque
  // `podeMostrarQr` exige `evolutionOnline`) e o vigia tentava a cada 15s uma
  // rota que nunca ia funcionar. Sem saida pela tela, so restava desconectar
  // tudo e parear do zero na mao -- foi exatamente o que aconteceu.
  //
  // Com estado proprio, a tela pode oferecer o unico caminho que resolve:
  // recriar a instancia e escanear o QR.
  INEXISTENTE: "INSTANCE_MISSING",
};

// O `code` do AppError que o cliente HTTP levanta no 404 de `/instance/...`.
// Ver evolution-api.client.request -- ele ja distinguia o caso; era o vigia que
// jogava a distincao no lixo.
const CODIGO_INSTANCIA_INEXISTENTE = "INSTANCIA_INEXISTENTE";

// A INSTANCIA VIGIADA VEM DA CONFIGURACAO EFETIVA (banco > .env), nao do .env
// direto. Trocar o nome da instancia na tela de Configuracoes deixava o vigia
// olhando para um nome que nao existe mais: ele reportava "close" para sempre,
// o painel mostrava outra instancia, e as duas telas discordavam sem que nada
// no log dissesse por que. Guardamos o ultimo valor resolvido porque `estado()`
// e sincrono (o /status o chama a cada poll).
let instanciaVigiada = env.evolutionApi.instance;

async function _resolverInstancia() {
  try {
    const nome = await evolutionApi.instanciaPadrao();
    if (nome) instanciaVigiada = nome;
  } catch {
    /* configuracao ilegivel: segue com o ultimo nome conhecido */
  }
  return instanciaVigiada;
}

let timer = null;
// UMA verificacao por vez. Guardamos a PROMESSA, nao um booleano: assim uma
// chamada manual (`/reconectar` no painel) espera a que ja esta rodando em vez
// de comecar uma segunda em paralelo. Booleano so protegia contra o proprio
// timer -- duas vias ainda podiam abrir sockets concorrentes.
let emVoo = null;
// Armado por `reconectarAgora` (o botao do painel) e consumido na proxima
// passada de `_verificar`.
let forcarAgora = false;

// DUAS COISAS DIFERENTES, e confundi-las custa a leitura do problema:
//
//   `situacao`     onde a conexao esta AGORA (vira RECONNECTING assim que
//                  disparamos o religamento);
//   `classificacao` o que a ULTIMA queda foi -- temporaria ou logout. E o
//                  veredito, e ele nao muda so porque ja comecamos a religar.
//
// Sem separar, `situacao` respondia "RECONNECTING" para a pergunta "isso foi
// uma queda ou um logout?", que e justamente a pergunta que este modulo existe
// para responder.
let situacao = ESTADOS.DESCONHECIDO;
let classificacao = null;
let tentativa = 0;
let proximaTentativaEm = 0;
let connectingDesde = null;
let ultimoMotivoCodigo = null;
// QUANDO aquele codigo foi registrado (`disconnectionAt` da Evolution). Sem a
// data, o numero nao diz de QUAL queda ele fala -- ver `_motivoEhDaQuedaAtual`.
let ultimoMotivoEm = null;
// O codigo acima descreve a queda de AGORA, ou sobrou de uma anterior?
let ultimoMotivoVigente = false;
let ultimaAcao = null;
let precisaParear = false;

// A ULTIMA VEZ QUE VIMOS O SOCKET ABERTO NESTE PROCESSO.
//
// E a ancora que separa "o WhatsApp acabou de invalidar a sessao" de "isto e
// lixo de um logout que ja foi resolvido". Ver `_motivoEhDaQuedaAtual`.
let ultimoOpenEm = null;

// ── O HISTORICO DE QUEDAS ───────────────────────────────────────────────────
//
// Serve a duas coisas, e as duas faltavam:
//
//   1. frear a escada quando a sessao esta sendo disputada (ver JANELA_FLAP_MS);
//   2. RESPONDER "quantas vezes caiu?" -- a pergunta que originou a auditoria de
//      10/09 e que so tinha resposta no `docker logs`. Sem este numero, o painel
//      nao distinguia "caiu uma vez e esta demorando" de "caiu oito vezes",
//      que sao problemas diferentes e pedem acoes diferentes.
let quedas = [];

function _registrarQueda(agora) {
  quedas.push(agora);
  _podarQuedas(agora);
}

function _podarQuedas(agora = Date.now()) {
  const limite = agora - JANELA_FLAP_MS;
  if (quedas.length && quedas[0] < limite) {
    quedas = quedas.filter((q) => q >= limite);
  }
  return quedas.length;
}

/** A sessao esta sendo derrubada em serie? */
function _estaFlapando(agora = Date.now()) {
  return _podarQuedas(agora) >= QUEDAS_PARA_FLAP;
}

function _esperaMs(n) {
  // SOB FLAPPING A ESCADA NAO COMECA NO PRIMEIRO DEGRAU.
  //
  // `n` e a tentativa desta queda, e ela volta a 1 a cada religamento. Numa
  // disputa de sessao isso significava reabrir socket 1 segundo depois de uma
  // sessao que durou 15 -- alimentando exatamente a briga que derrubou a
  // anterior. O piso mantem o religamento, mas em ritmo de espera.
  const degrau = _estaFlapando() ? Math.max(n, DEGRAU_MINIMO_FLAP) : n;
  const base = ESCADA_MS[Math.min(degrau, ESCADA_MS.length) - 1];
  return Math.round(base * (1 + (Math.random() * 2 - 1) * JITTER));
}

function _resetar() {
  tentativa = 0;
  proximaTentativaEm = 0;
  connectingDesde = null;
  precisaParear = false;
}

// ── JANELA DO QR PEDIDO PELO PAINEL ─────────────────────────────────────────
// Um QR emitido logo depois de alguem clicar em "Gerar QR" nao e sintoma de
// nada -- foi pedido. Sem esta janela a tela anunciaria ao operador um problema
// que ele mesmo acabou de provocar.
let qrPedidoEm = 0;
const JANELA_QR_PEDIDO_MS = 60 * 1000;

function registrarPedidoDeQr() {
  qrPedidoEm = Date.now();
}

/**
 * Marca que so o celular resolve. Chamado apenas com EVIDENCIA -- nunca por
 * numero de tentativas, nunca por tempo. Ver `_classificar`.
 */
function marcarPrecisaParear(motivo, extra = {}) {
  if (precisaParear) return;
  precisaParear = true;
  situacao = ESTADOS.DESLOGADO;
  classificacao = ESTADOS.DESLOGADO;
  logger.error("[WhatsApp] LOGOUT REAL DETECTADO", {
    instance: instanciaVigiada,
    situacao,
    motivo,
    ...extra,
  });
  logger.error("[WhatsApp] Sessao invalidada -- e preciso reescanear o QR no painel", {
    instance: instanciaVigiada,
  });
}

// O webhook de `connection.update` avisa a queda antes do proximo ciclo. Nao
// reconectamos aqui: apenas liberamos o relogio para a verificacao agir ja na
// proxima passada. Assim continua existindo UM so caminho de reconexao.
//
// ── O DEFEITO QUE ESTE FREIO FECHA ─────────────────────────────────────────
//
// `proximaTentativaEm = 0` cru ANULAVA O BACKOFF. Um aviso do webhook nao e um
// evento raro: em 10/09/2026 a Evolution mandou `connection.update` com
// `state: close` centenas de vezes em minutos -- ate cinco no mesmo segundo, e
// inclusive DEPOIS de a instancia voltar a `open` (ela declara `open` sem
// terminar a sincronizacao, `Timeout in AwaitingInitialSync`, e por isso o
// webhook e o `/connectionState` podiam discordar sendo os dois honestos).
//
// Cada um desses avisos zerava o relogio. A escada de 1s..60s virou decoracao,
// e o vigia passou a disparar `/instance/connect` a cada 15s (o tick do timer)
// independentemente do degrau. A prova esta no log:
//
//   07:53:16  Reconnect attempt: 7   proximoEmMs: 58854
//   07:53:31  Reconnect attempt: 8            <- 15 segundos depois, nao 59
//
// Isso nos colocou DENTRO do laco: socket novo por cima de um que a Evolution
// ainda estava levantando e o WhatsApp derrubando os dois com
// `conflict: replaced`.
//
// A REGRA AGORA: o aviso pode ADIANTAR uma verificacao, nunca ENCURTAR uma
// espera que ja foi decidida. Se ha backoff pendente, nos ja sabemos da queda
// -- o aviso nao traz informacao nova, so pressa.
let avisosIgnorados = 0;
let ultimoAvisoLogadoEm = 0;
const INTERVALO_LOG_AVISO_MS = 60 * 1000;

function notificarQueda(state) {
  if (precisaParear) return;

  const agora = Date.now();
  const backoffPendente = proximaTentativaEm > agora;

  if (backoffPendente) {
    // Ja estamos esperando de proposito. Contamos o aviso (o volume dele e
    // diagnostico: rajada = sessao disputada) e nao tocamos no relogio.
    avisosIgnorados += 1;
  } else {
    proximaTentativaEm = 0;
  }

  // O LOG TAMBEM PRECISAVA DE FREIO. Uma linha por aviso enchia o log de
  // producao com centenas de `Queda sinalizada` identicas -- e enterrava as
  // linhas que importavam (`Reconnect attempt`, `Online`, o cofre). Uma por
  // minuto, com a conta do que foi suprimido, diz a mesma coisa e deixa o log
  // legivel.
  if (agora - ultimoAvisoLogadoEm >= INTERVALO_LOG_AVISO_MS) {
    logger.warn("[WhatsApp] Queda sinalizada pela Evolution", {
      instance: instanciaVigiada,
      state,
      avisosIgnoradosNoBackoff: avisosIgnorados,
      quedasNaJanela: _podarQuedas(agora),
      flapping: _estaFlapando(agora),
    });
    ultimoAvisoLogadoEm = agora;
    avisosIgnorados = 0;
  }
}

// ── CLASSIFICACAO: E QUEDA OU E LOGOUT? ─────────────────────────────────────

/**
 * Decide entre DISCONNECTED_TEMPORARY e LOGGED_OUT usando so evidencia:
 *
 *   1. `disconnectionReasonCode` 401/403 -> logout real, ponto final.
 *   2. credencial ausente no banco da Evolution:
 *        - com cofre e motivo nao-fatal -> restaura e segue como temporario;
 *        - sem cofre -> logout real (nada a recuperar).
 *   3. qualquer outro caso -> temporario.
 *
 * Quando nao conseguimos ler o banco (`null` = "nao sei"), assumimos sessao
 * valida. Errar para o lado de tentar reconectar custa algumas chamadas; errar
 * para o outro lado custa um QR que nao era necessario.
 */
/**
 * ESTE `disconnectionReasonCode` FALA DA QUEDA DE AGORA, OU SOBROU DE ANTES?
 *
 * ── O DEFEITO QUE ISTO FECHA ───────────────────────────────────────────────
 *
 * A Evolution ESCREVE `disconnectionReasonCode` quando o socket cai e NUNCA o
 * apaga quando a instancia volta. O numero fica gravado na linha para sempre.
 *
 * `_classificar` lia esse campo como evidencia da queda ATUAL, e por isso um
 * logout que ja tinha sido resolvido continuava condenando a instancia:
 *
 *   1. o WhatsApp invalida a sessao -> a Evolution grava 401;
 *   2. o operador reescaneia o QR e o WhatsApp volta -- mas a linha SEGUE com
 *      401, porque nada limpa aquele campo;
 *   3. na primeira oscilacao de rede depois disso, o vigia le o 401 velho,
 *      declara LOGOUT REAL, para de reconectar sozinho e o painel manda
 *      reescanear o QR de novo;
 *   4. o operador reescaneia, funciona um tempo, cai, e o painel manda
 *      reescanear outra vez.
 *
 * Era o "fica caindo direto" relatado -- e o painel mostrando `CONNECTED` ao
 * lado de "401 (logout real)" era o mesmo defeito a olho nu: o motivo nao podia
 * ser o da queda atual, porque nao havia queda nenhuma.
 *
 * ── A ANCORA ───────────────────────────────────────────────────────────────
 *
 * O codigo so e evidencia se a queda que ele descreve for POSTERIOR a ultima
 * vez que a sessao esteve de pe. Duas marcas respondem isso, e vale a mais
 * recente das duas:
 *
 *   `ultimoOpenEm`    preciso, mas morre no restart do container;
 *   `cofre.salvoEm`   sobrevive ao restart -- a credencial nova de um
 *                     pareamento e sempre gravada no cofre (hash diferente).
 *
 * Sem data no motivo, ou sem ancora nenhuma (nunca vimos a sessao de pe e nao
 * ha cofre), mantemos o comportamento antigo e confiamos no codigo: e o cenario
 * de instalacao nova, em que um 401 provavelmente e mesmo real.
 */
function _motivoEhDaQuedaAtual(motivoEm, instancia) {
  if (!motivoEm) return true;
  const quando = new Date(motivoEm).getTime();
  if (Number.isNaN(quando)) return true;

  const salvoEm = new Date(cofre.estado(instancia)?.salvoEm || 0).getTime() || null;
  const ancora = Math.max(ultimoOpenEm || 0, salvoEm || 0);
  if (!ancora) return true;

  return quando > ancora;
}

async function _classificar(instancia) {
  const diag = await evolutionApi.diagnosticoConexao(instancia);
  const codigo = diag?.motivoCodigo ?? null;
  ultimoMotivoCodigo = codigo;
  ultimoMotivoEm = diag?.motivoEm ?? null;
  // `motivoEm` ja vinha de `diagnosticoConexao` e nao era lido por ninguem.
  // E ele que datava a evidencia -- sem a data, o codigo nao tinha validade.
  ultimoMotivoVigente = codigo == null ? false : _motivoEhDaQuedaAtual(ultimoMotivoEm, instancia);

  if (codigo != null && CODIGOS_LOGOUT_REAL.includes(codigo)) {
    if (ultimoMotivoVigente) {
      return { tipo: ESTADOS.DESLOGADO, codigo, motivo: `Baileys statusCode ${codigo}` };
    }
    // NAO devolve veredito: segue para a checagem da CREDENCIAL, que e
    // evidencia de agora. Se o pareamento tiver caido de verdade outra vez, e
    // ela que vai dizer -- e ai o QR volta a ser pedido com razao.
    logger.warn(
      "[WhatsApp] disconnectionReasonCode de logout IGNORADO: e anterior a sessao que vimos de pe",
      {
        instance: instancia,
        motivoCodigo: codigo,
        motivoEm: ultimoMotivoEm,
        ultimoOpenEm: ultimoOpenEm ? new Date(ultimoOpenEm).toISOString() : null,
        cofreSalvoEm: cofre.estado(instancia)?.salvoEm || null,
      }
    );
  }

  const presente = await cofre.credencialPresente(instancia);

  if (presente === false) {
    const r = await cofre.restaurar(instancia, codigo);
    if (r.restaurado) {
      return { tipo: ESTADOS.TEMPORARIO, codigo, motivo: "credencial restaurada do cofre" };
    }
    if (r.motivo === "estado_desconhecido") {
      return { tipo: ESTADOS.TEMPORARIO, codigo, motivo: "banco da Evolution ilegivel" };
    }
    return {
      tipo: ESTADOS.DESLOGADO,
      codigo,
      motivo: `credencial ausente no banco da Evolution e sem copia no cofre (${r.motivo})`,
    };
  }

  return {
    tipo: ESTADOS.TEMPORARIO,
    codigo,
    motivo: presente === null ? "credencial nao verificavel" : "credencial intacta",
  };
}

// ── O CICLO ─────────────────────────────────────────────────────────────────

async function verificar() {
  // Coalescencia: quem chegar durante uma verificacao espera a MESMA promessa.
  // E o que garante "no maximo uma conexao ativa por instancia" mesmo quando o
  // timer e um clique no painel coincidem.
  if (emVoo) return emVoo;
  emVoo = _verificar().finally(() => {
    emVoo = null;
  });
  return emVoo;
}

async function _verificar() {
  const instancia = await _resolverInstancia();
  if (!instancia) return { ignorado: "sem_instancia" };

  // Consumido UMA vez: um clique humano em "Reconectar" atravessa a carencia do
  // handshake e o backoff. O operador que clica ja esperou -- mas isso nao lhe
  // da o direito de abrir um segundo socket, e por isso o `emVoo` continua
  // valendo acima: no maximo UMA verificacao por vez, manual ou nao.
  const manual = forcarAgora;
  forcarAgora = false;

  let state;
  try {
    const estadoEvo = await evolutionApi.getConnectionState(instancia);
    state = estadoEvo?.instance?.state || estadoEvo?.state || "close";
  } catch (error) {
    // ── DUAS FALHAS DIFERENTES, E O `catch` CEGO AS CONFUNDIA ──────────────
    //
    // "A Evolution nao respondeu" pede olhar o container. "A instancia nao
    // existe mais" pede recriar e parear -- e nenhuma reconexao do mundo
    // resolve. Tratar as duas como a primeira era o beco sem saida: o painel
    // mandava olhar a Evolution (que estava de pe), nao oferecia o QR e o vigia
    // insistia a cada 15s num nome inexistente.
    if (error?.code === CODIGO_INSTANCIA_INEXISTENTE) {
      situacao = ESTADOS.INEXISTENTE;
      classificacao = ESTADOS.INEXISTENTE;
      // `precisaParear` porque e verdade: so o QR (depois de recriar) resolve.
      // E o mesmo flag que autoriza o QR no /status, entao a tela deixa de ser
      // um beco. Nao passa por `marcarPrecisaParear`: aquele metodo grava
      // `situacao = LOGGED_OUT`, e este caso NAO e o WhatsApp ter derrubado a
      // sessao -- confundir os dois manda o operador procurar o problema no
      // celular em vez de na Evolution.
      if (!precisaParear) {
        precisaParear = true;
        logger.error("[WhatsApp] A INSTANCIA NAO EXISTE MAIS NA EVOLUTION", {
          instance: instancia,
          detalhe: error.message,
          acao: "recriar a instancia e escanear o QR -- reconectar nao resolve",
        });
      }
      // Sem backoff a cumprir: nao ha religamento pendente, ha uma decisao
      // humana pendente.
      proximaTentativaEm = 0;
      return { situacao, classificacao, state: "missing", acao: "nenhuma" };
    }
    // A Evolution pode estar subindo ou fora do ar. Isso nao e queda do
    // WhatsApp, e nao ha o que religar enquanto ela nao responde.
    situacao = ESTADOS.DESCONHECIDO;
    return { situacao, state: "unavailable", acao: "nenhuma" };
  }

  // ── CONECTADO ──
  if (state === "open") {
    const voltou = situacao !== ESTADOS.CONNECTED;
    situacao = ESTADOS.CONNECTED;
    // A ANCORA, atualizada a cada passada em que o socket esta aberto. E o que
    // faz o `disconnectionReasonCode` gravado antes daqui perder validade --
    // ver `_motivoEhDaQuedaAtual`.
    ultimoOpenEm = Date.now();
    // O motivo da ultima queda continua legivel no painel (ele responde "por
    // que caiu da ultima vez?"), mas deixa de ser VIGENTE: nao ha queda em
    // curso, e era isso que fazia a tela mostrar "401 (logout real)" ao lado de
    // `CONNECTED`.
    ultimoMotivoVigente = false;
    if (voltou || tentativa > 0) {
      logger.info("[WhatsApp] Online", {
        instance: instancia,
        situacao,
        aposTentativas: tentativa || null,
      });
    }
    _resetar();
    classificacao = null;
    ultimaAcao = null;
    // Enquanto esta de pe, o cofre se mantem em dia. So escreve quando a
    // credencial mudou de verdade (compara hash) -- ver whatsapp.sessao.js.
    cofre.salvar(instancia).catch(() => {});
    return { situacao, state, acao: "nenhuma" };
  }

  // ── SUBINDO ──
  if (state === "connecting") {
    if (connectingDesde === null) connectingDesde = Date.now();
    const parado = Date.now() - connectingDesde;
    if (parado < LIMITE_CONNECTING_MS && !manual) {
      situacao = ESTADOS.RECONNECTING;
      return { situacao, state, acao: "aguardando_handshake", haMs: parado };
    }
    logger.warn("[WhatsApp] Handshake travado em `connecting` -- vai religar", {
      instance: instancia,
      haMs: parado,
    });
    // Segue para o religamento, com o mesmo backoff das quedas.
  } else {
    connectingDesde = null;
  }

  // ── NUNCA PAREOU ──
  // A prova de que ja houve pareamento nao esta mais em memoria (o modelo
  // antigo nascia desarmado a cada restart da API e nunca mais reconectava se a
  // instancia estivesse fora nesse instante). Agora vem do cofre em disco, que
  // atravessa restart do container.
  if (!cofre.jaFoiPareado(instancia) && (await cofre.credencialPresente(instancia)) !== true) {
    situacao = ESTADOS.DESCONHECIDO;
    return { situacao, state, acao: "nenhuma", motivo: "nunca_pareado" };
  }

  // ── QUEDA OU LOGOUT? ──
  const veredito = await _classificar(instancia);

  if (veredito.tipo === ESTADOS.DESLOGADO) {
    marcarPrecisaParear(veredito.motivo, { motivoCodigo: veredito.codigo });
    return { situacao, classificacao, state, acao: "nenhuma", motivo: "aguardando_qr" };
  }

  if (precisaParear) {
    // A situacao anterior era logout, mas a evidencia agora diz o contrario
    // (credencial de volta -- restaurada, ou reescaneada). Rearma o vigia.
    logger.info("[WhatsApp] Sessao valida de novo -- reconexao automatica rearmada", {
      instance: instancia,
    });
    _resetar();
  }

  situacao = ESTADOS.TEMPORARIO;
  classificacao = ESTADOS.TEMPORARIO;

  const agora = Date.now();
  if (agora < proximaTentativaEm && !manual) {
    return { situacao, classificacao, state, acao: "aguardando_backoff", emMs: proximaTentativaEm - agora };
  }

  // UMA QUEDA, NAO UMA TENTATIVA. `tentativa` saindo do zero e a fronteira de
  // um ciclo novo -- e e isso que o contador de quedas precisa medir. Contar por
  // tentativa transformaria uma queda longa (8 tentativas) em "8 quedas" e
  // dispararia o freio de flapping onde nao ha flapping nenhum.
  if (tentativa === 0) _registrarQueda(agora);

  tentativa += 1;
  const espera = _esperaMs(tentativa);
  proximaTentativaEm = agora + espera;

  // A CHAMADA CERTA PARA O ESTADO CERTO. `restart` exige a instancia viva;
  // `connect` e o unico caminho que recria o socket a partir de `close`, e ele
  // NAO destroi credencial nenhuma -- so le a que esta no banco.
  const usarConnect = state !== "connecting";

  logger.warn("[WhatsApp] Connection closed", { instance: instancia });
  logger.warn("[WhatsApp] Reason: " + (veredito.codigo ?? "desconhecido"), {
    instance: instancia,
    state,
    situacao,
  });
  logger.warn("[WhatsApp] Session still valid -- preserving credentials", {
    instance: instancia,
    evidencia: veredito.motivo,
  });
  logger.warn(`[WhatsApp] Reconnect attempt: ${tentativa}`, {
    instance: instancia,
    via: usarConnect ? "instance/connect" : "instance/restart",
    proximoEmMs: espera,
  });

  connectingDesde = null;

  try {
    if (usarConnect) {
      // Nosso proprio pedido: o QR que voltar daqui nao pode ser lido como
      // sintoma quando o webhook `qrcode.updated` chegar logo em seguida.
      registrarPedidoDeQr();
      await evolutionApi.connect(instancia);
    } else {
      await evolutionApi.restartInstance(instancia);
    }
    ultimaAcao = usarConnect ? "connect" : "restart";
    situacao = ESTADOS.RECONNECTING;
    return { situacao, classificacao, state, acao: ultimaAcao, tentativa };
  } catch (err) {
    // Falhar aqui NAO invalida a sessao. Continua no backoff.
    logger.warn("[WhatsApp] Reconnect attempt failed -- session preserved", {
      instance: instancia,
      tentativa,
      via: usarConnect ? "instance/connect" : "instance/restart",
      message: err.message,
    });
    return { situacao, classificacao, state, acao: "falhou", tentativa, erro: err.message };
  }
}

/**
 * O BOTAO "RECONECTAR" DO PAINEL -- e a UNICA coisa que ele faz.
 *
 * Antes o botao chamava `/instance/restart` cru. Isso e errado por dois
 * motivos, e os dois apareciam na tela como erro:
 *
 *   1. `restart` RECUSA instancia em `close` (o estado mais comum de quem
 *      precisa reconectar) e devolve a recusa como HTTP 200 `{error:true}` --
 *      que o nosso cliente traduz para 502. Ou seja: o botao de recuperar a
 *      conexao falhava exatamente quando era necessario.
 *   2. Ele pulava o vigia. Duas vias mandando reconectar e a receita para dois
 *      sockets com a mesma credencial e um `conflict: replaced` do WhatsApp.
 *
 * Agora o botao ENTRA NO MESMO CAMINHO do vigia: ele zera o backoff, atravessa
 * a carencia do handshake e roda UMA verificacao -- que escolhe `connect` ou
 * `restart` conforme o estado, restaura do cofre se preciso e nunca apaga
 * credencial nem pede QR. Se a sessao estiver mesmo invalidada, a verificacao
 * devolve LOGGED_OUT e ai a tela oferece o QR -- com evidencia, nao por palpite.
 */
async function reconectarAgora() {
  if (emVoo) {
    // Ja ha uma verificacao rodando: esperamos ELA em vez de abrir outra, e so
    // depois forcamos a nossa. Assim o clique nunca cria um socket paralelo.
    await emVoo.catch(() => {});
  }
  forcarAgora = true;
  tentativa = 0;
  proximaTentativaEm = 0;
  try {
    return await verificar();
  } finally {
    forcarAgora = false;
  }
}

/**
 * QR CHEGOU PELO WEBHOOK. Sozinho, isso nao prova nada (ver armadilha 3 no topo
 * do arquivo). Confirmamos contra o banco antes de condenar o pareamento.
 */
async function avaliarQrRecebido() {
  const instancia = instanciaVigiada;
  if (Date.now() - qrPedidoEm < JANELA_QR_PEDIDO_MS) {
    return { conclusao: "qr_pedido", precisaParear };
  }
  if (!cofre.jaFoiPareado(instancia)) {
    // Instalacao nova: QR e o caminho normal, nao um defeito.
    return { conclusao: "primeiro_pareamento", precisaParear: false };
  }

  const veredito = await _classificar(instancia);
  if (veredito.tipo === ESTADOS.DESLOGADO) {
    marcarPrecisaParear(veredito.motivo, { motivoCodigo: veredito.codigo, gatilho: "qrcode.updated" });
    return { conclusao: "logout_real", precisaParear: true };
  }

  logger.info("[WhatsApp] QR emitido, mas a credencial esta intacta -- seguindo com a reconexao", {
    instance: instancia,
    motivoCodigo: veredito.codigo,
    evidencia: veredito.motivo,
  });
  proximaTentativaEm = 0;
  return { conclusao: "qr_espurio", precisaParear: false };
}

/** O que o /status precisa para a tela parar de mentir "Conectando". */
function estado() {
  const instancia = instanciaVigiada;
  return {
    situacao,
    classificacao,
    precisaParear,
    // Separa "instalar pela primeira vez" (esperado) de "perdi um pareamento
    // que estava de pe" (problema) -- os dois pedem QR, mas dizem coisas
    // opostas ao operador.
    perdeuPareamento: precisaParear && cofre.jaFoiPareado(instancia),
    tentativa,
    proximaTentativaEm: proximaTentativaEm || null,
    ultimoMotivoCodigo,
    // A DATA e a VALIDADE do codigo acima. Sem as duas, o painel nao tinha como
    // distinguir "o WhatsApp derrubou a sessao agora" de "isto sobrou de um
    // logout que ja foi resolvido" -- e mostrava "401 (logout real)" com a
    // instancia perfeitamente online.
    ultimoMotivoEm,
    ultimoMotivoVigente,
    ultimaAcao,
    cofre: cofre.estado(instancia),
    // ── QUANTAS VEZES CAIU ────────────────────────────────────────────────
    //
    // A pergunta que originou a auditoria de 10/09 e que so tinha resposta no
    // `docker logs`. Ela separa dois problemas que a tela mostrava igual:
    // "caiu uma vez e esta demorando para voltar" (rede, Evolution) de "caiu
    // oito vezes em dez minutos" (sessao disputada). As acoes sao opostas.
    quedasNaJanela: _podarQuedas(),
    janelaQuedasMs: JANELA_FLAP_MS,
    // `flapping` tambem explica ao operador por que a espera entre tentativas
    // ficou longa de propositos -- sem isso, o freio pareceria lentidao.
    flapping: _estaFlapando(),
    ultimaQuedaEm: quedas.length ? new Date(quedas[quedas.length - 1]).toISOString() : null,
  };
}

function iniciar() {
  if (timer) return timer;
  // Folga no boot para a Evolution e o Baileys terminarem de subir -- sem ela a
  // primeira verificacao pegaria um `connecting` legitimo do arranque.
  setTimeout(() => {
    verificar().catch(() => {});
    timer = setInterval(() => {
      verificar().catch(() => {});
    }, INTERVALO_MS);
    if (timer.unref) timer.unref();
  }, 20_000);
  logger.info("Vigia de reconexao do WhatsApp iniciado", {
    intervaloMs: INTERVALO_MS,
    escadaMs: ESCADA_MS,
    cofre: cofre.disponivel() ? "ativo" : `inativo (${cofre.porqueIndisponivel()})`,
  });
  return timer;
}

function parar() {
  if (timer) clearInterval(timer);
  timer = null;
}

// ── COSTURA DE TESTE ────────────────────────────────────────────────────────
//
// `verificar-reconexao-whatsapp.js` precisa atravessar o backoff sem esperar de
// verdade (a escada chega a 60s; 25 rodadas levariam minutos). Antes ele usava
// `notificarQueda` para isso -- o que so funcionava porque aquele metodo zerava
// o relogio, que era exatamente o defeito corrigido aqui. Com o freio no lugar,
// o teste precisa de uma porta propria, explicita e fora do caminho de
// producao: nada no servidor chama isto.
const __paraTestes = {
  liberarBackoff() {
    proximaTentativaEm = 0;
  },
  /** Zera o historico, para um teste poder medir a escada sem o freio de flap. */
  zerarQuedas() {
    quedas = [];
  },
  quedas: () => quedas.slice(),
};

module.exports = {
  ESTADOS,
  CODIGOS_LOGOUT_REAL,
  ESCADA_MS,
  DEGRAU_MINIMO_FLAP,
  QUEDAS_PARA_FLAP,
  __paraTestes,
  iniciar,
  parar,
  verificar,
  reconectarAgora,
  estado,
  notificarQueda,
  marcarPrecisaParear,
  registrarPedidoDeQr,
  avaliarQrRecebido,
};
