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
};

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
let ultimaAcao = null;
let precisaParear = false;

function _esperaMs(n) {
  const base = ESCADA_MS[Math.min(n, ESCADA_MS.length) - 1];
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
function notificarQueda(state) {
  if (precisaParear) return;
  proximaTentativaEm = 0;
  logger.warn("[WhatsApp] Queda sinalizada pela Evolution", {
    instance: instanciaVigiada,
    state,
  });
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
async function _classificar(instancia) {
  const diag = await evolutionApi.diagnosticoConexao(instancia);
  const codigo = diag?.motivoCodigo ?? null;
  ultimoMotivoCodigo = codigo;

  if (codigo != null && CODIGOS_LOGOUT_REAL.includes(codigo)) {
    return { tipo: ESTADOS.DESLOGADO, codigo, motivo: `Baileys statusCode ${codigo}` };
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
  } catch {
    // A Evolution pode estar subindo ou fora do ar. Isso nao e queda do
    // WhatsApp, e nao ha o que religar enquanto ela nao responde.
    situacao = ESTADOS.DESCONHECIDO;
    return { situacao, state: "unavailable", acao: "nenhuma" };
  }

  // ── CONECTADO ──
  if (state === "open") {
    const voltou = situacao !== ESTADOS.CONNECTED;
    situacao = ESTADOS.CONNECTED;
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
    ultimaAcao,
    cofre: cofre.estado(instancia),
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

module.exports = {
  ESTADOS,
  CODIGOS_LOGOUT_REAL,
  ESCADA_MS,
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
