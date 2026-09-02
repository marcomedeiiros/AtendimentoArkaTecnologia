// RECONEXAO DA INSTANCIA WHATSAPP -- O UNICO LUGAR QUE MANDA RECONECTAR.
//
// Antes havia DUAS vias independentes tentando religar o WhatsApp: o watchdog
// do `server.js` (a cada 30s) e o backoff disparado pelo webhook de
// `connection.update`. Cada uma com seu proprio relogio, sem saber da outra.
// Isso derrubava o pareamento em vez de salvar, por tres motivos:
//
//   1. `connecting` NAO e queda -- e o estado normal enquanto o socket sobe.
//      Tratar como queda e pedir reconexao no meio do handshake faz o Baileys
//      abrir um SEGUNDO socket com as mesmas credenciais. O WhatsApp mata um
//      dos dois com `stream:error / conflict: replaced`, a sessao nunca chega
//      a `open`, e o ciclo se repete sozinho para sempre.
//
//   2. `/instance/connect` EMITE QR CODE. Quando a instancia ja perdeu o
//      pareamento, cada chamada gera um QR novo -- estourando o `QRCODE_LIMIT`
//      e trocando, a cada 30s, o QR que o operador esta tentando escanear na
//      tela. Aqui usamos `/instance/restart`, que religa a sessao existente
//      sem emitir QR nenhum. Emitir QR e ato deliberado de quem opera o
//      painel, nunca de um timer.
//
//   3. Sem teto de tentativas, um pareamento perdido vira martelada infinita e
//      silenciosa: o painel fica em "Conectando" e ninguem descobre que so
//      falta reescanear o QR. Depois de MAX_TENTATIVAS desistimos de proposito
//      e levantamos `precisaParear`, que o /status leva ate a tela.
const evolutionApi = require("../../infrastructure/external/evolution-api.client");
const env = require("../../config/env");
const logger = require("../../config/logger");

const INTERVALO_MS = Number(process.env.WHATSAPP_RECONEXAO_INTERVALO_MS) || 30 * 1000;

// Espera antes da 1a tentativa e base do backoff: 30s, 1m, 2m, 4m, 8m, 16m.
const BASE_ESPERA_MS = 30 * 1000;
const MAX_TENTATIVAS = 6;

// Quanto tempo `connecting` ainda e considerado normal. Um pareamento saudavel
// abre em segundos; com `syncFullHistory` ligado a sincronizacao inicial pode
// esticar bastante, por isso a folga e generosa. Passou disso, o socket travou
// e ai sim vale reiniciar.
const LIMITE_CONNECTING_MS =
  Number(process.env.WHATSAPP_LIMITE_CONNECTING_MS) || 3 * 60 * 1000;

let timer = null;
let verificando = false;

// So agimos depois de ter visto a instancia conectada ao menos uma vez: numa
// instancia nova, ainda sem o primeiro QR escaneado, `close` e o estado
// esperado e reiniciar nao ajudaria em nada.
let jaEsteveConectado = false;
let tentativa = 0;
let proximaTentativaEm = 0;
let connectingDesde = null;
let precisaParear = false;

function _resetar() {
  tentativa = 0;
  proximaTentativaEm = 0;
  connectingDesde = null;
  precisaParear = false;
}

function _esperaMs(n) {
  return BASE_ESPERA_MS * Math.pow(2, Math.max(0, n - 1));
}

// QR PEDIDO PELO PAINEL -- janela curta em que um QR novo NAO e sintoma.
//
// Medido em producao (02/09/2026): `/instance/connect` devolve QR sempre que o
// socket em memoria nao esta autenticado, mesmo com a credencial no volume
// intacta -- aquela instancia voltou a `open` sozinha depois de um restart,
// sem ninguem escanear nada. Ou seja, "veio QR" nao prova pareamento perdido.
// Sem esta janela, o operador que clica em "Gerar QR" veria a tela anunciar um
// problema que ele mesmo acabou de provocar.
let qrPedidoEm = 0;
const JANELA_QR_PEDIDO_MS = 60 * 1000;

function registrarPedidoDeQr() {
  qrPedidoEm = Date.now();
}

// Chamado quando a Evolution emite QR sem ninguem ter pedido -- unico caso em
// que isso sugere pareamento perdido. Nao adianta reiniciar: so um humano com o
// celular na mao resolve. Paramos de tentar e deixamos o recado no /status.
function marcarPrecisaParear(motivo) {
  if (Date.now() - qrPedidoEm < JANELA_QR_PEDIDO_MS) return;
  if (precisaParear) return;
  precisaParear = true;
  tentativa = MAX_TENTATIVAS;
  logger.error(
    "[Reconexao] Pareamento do WhatsApp perdido -- e preciso reescanear o QR no painel",
    { instance: env.evolutionApi.instance, motivo }
  );
}

// O webhook de `connection.update` avisa a queda antes do proximo ciclo. Nao
// reconectamos aqui: apenas liberamos o relogio para a verificacao agir ja na
// proxima passada. Assim continua existindo UM so caminho de reconexao.
function notificarQueda(state) {
  if (!jaEsteveConectado || precisaParear) return;
  proximaTentativaEm = 0;
  logger.warn("[Reconexao] Queda sinalizada pela Evolution", {
    instance: env.evolutionApi.instance,
    state,
  });
}

async function verificar() {
  // Uma verificacao por vez: a chamada de rede pode demorar mais que o ciclo.
  if (verificando) return { ignorado: "em_execucao" };
  verificando = true;

  try {
    const instancia = env.evolutionApi.instance;
    if (!instancia) return { ignorado: "sem_instancia" };

    let state;
    try {
      const estado = await evolutionApi.getConnectionState(instancia);
      state = estado?.instance?.state || estado?.state || "close";
    } catch {
      // A Evolution pode estar subindo ou fora do ar. Isso nao e queda do
      // WhatsApp, e nao ha o que reiniciar enquanto ela nao responde.
      return { state: "unavailable", acao: "nenhuma" };
    }

    if (state === "open") {
      if (!jaEsteveConectado || tentativa > 0 || precisaParear) {
        logger.info("[Reconexao] WhatsApp online", { instance: instancia });
      }
      jaEsteveConectado = true;
      _resetar();
      return { state, acao: "nenhuma" };
    }

    // `connecting` e o socket subindo -- o estado que mais aparece e o que
    // JAMAIS deve disparar reconexao enquanto for recente. Interromper aqui e
    // exatamente o que gerava o `conflict: replaced`.
    if (state === "connecting") {
      if (connectingDesde === null) connectingDesde = Date.now();
      const parado = Date.now() - connectingDesde;
      if (parado < LIMITE_CONNECTING_MS) {
        return { state, acao: "aguardando_handshake", haMs: parado };
      }
      // Passou do limite: o socket travou em `connecting`. Segue para o
      // reinicio, com o mesmo backoff das quedas.
    } else {
      connectingDesde = null;
    }

    if (!jaEsteveConectado) return { state, acao: "nenhuma", motivo: "nunca_pareado" };
    if (precisaParear) return { state, acao: "nenhuma", motivo: "aguardando_qr" };

    const agora = Date.now();
    if (agora < proximaTentativaEm) {
      return { state, acao: "aguardando_backoff", emMs: proximaTentativaEm - agora };
    }

    if (tentativa >= MAX_TENTATIVAS) {
      marcarPrecisaParear("maximo de tentativas de reinicio sem sucesso");
      return { state, acao: "desistiu" };
    }

    tentativa += 1;
    proximaTentativaEm = agora + _esperaMs(tentativa);
    connectingDesde = null;

    logger.warn(`[Reconexao] Reiniciando a instancia (tentativa ${tentativa}/${MAX_TENTATIVAS})`, {
      instance: instancia,
      state,
      proximaEmMs: _esperaMs(tentativa),
    });

    try {
      // `restart`, nunca `connect`: religa a sessao existente sem emitir QR.
      await evolutionApi.restartInstance(instancia);
      return { state, acao: "reiniciada", tentativa };
    } catch (err) {
      logger.warn("[Reconexao] Falha ao reiniciar a instancia", {
        instance: instancia,
        message: err.message,
      });
      return { state, acao: "falhou", tentativa, erro: err.message };
    }
  } finally {
    verificando = false;
  }
}

// O que o /status precisa saber para a tela parar de mentir "Conectando".
//
// `perdeuPareamento` separa dois casos que pedem QR pelo mesmo motivo tecnico
// mas dizem coisas opostas ao operador: instalar pela primeira vez (esperado) e
// perder um pareamento que estava de pe (problema). Sem essa distincao a tela
// anunciaria "o pareamento foi perdido" no dia da instalacao.
function estado() {
  return {
    precisaParear,
    perdeuPareamento: precisaParear && jaEsteveConectado,
    tentativa,
    maxTentativas: MAX_TENTATIVAS,
    proximaTentativaEm: proximaTentativaEm || null,
  };
}

function iniciar() {
  if (timer) return timer;
  // Folga no boot para a Evolution e o Baileys terminarem de subir -- sem ela
  // a primeira verificacao pegaria um `connecting` legitimo do arranque.
  setTimeout(() => {
    verificar();
    timer = setInterval(() => { verificar(); }, INTERVALO_MS);
    if (timer.unref) timer.unref();
  }, 20_000);
  logger.info("Vigia de reconexao do WhatsApp iniciado", { intervaloMs: INTERVALO_MS });
  return timer;
}

function parar() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  iniciar,
  parar,
  verificar,
  estado,
  notificarQueda,
  marcarPrecisaParear,
  registrarPedidoDeQr,
};
