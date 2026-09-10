/**
 * OS DOIS SONS DO PAINEL, um por TELA.
 *
 *   ARKACHATMonitoramento.mp3   o som do MODO TV. Alto, para ser ouvido de
 *                               longe: ele existe para a tela na parede.
 *   blipnotificacaomensagem.mp3 o som da CENTRAL, no dia a dia de quem esta no
 *                               chat. Discreto, porque toca muitas vezes.
 *
 * Antes havia UM som para as duas telas. Quem escutava de longe nao tinha como
 * saber se aquilo era da parede ou do computador de alguem.
 *
 * QUEM DECIDE QUAL TOCA NAO E ESTE ARQUIVO -- e o AppContext, que e o unico
 * lugar onde se sabe se o Modo TV esta ligado. E a decisao e SO essa: uma tela,
 * um som. Aqui so ficam os canos.
 *
 * ── POR QUE ESTE ARQUIVO E MAIS COMPLICADO DO QUE PARECE ────────────────────
 *
 * Navegador nao toca audio sem gesto do usuario. As tres camadas abaixo existem
 * por isso, e nenhuma delas e redundante:
 *
 *   1. Web Audio API com o buffer ja decodificado -- o caminho bom. Toca na
 *      hora, sem latencia de decodificacao, e aceita ganho > 1;
 *   2. HTML5 `Audio` -- plano B quando o buffer ainda nao decodificou (primeiros
 *      segundos da pagina) ou quando o AudioContext nao existe;
 *   3. um chime SINTETIZADO por oscilador -- ultimo recurso. Se o arquivo nao
 *      carregou (rede, 404, nome errado), ainda sai som. Sem isto, um arquivo
 *      ausente deixava o painel MUDO em silencio -- a pior falha possivel para
 *      um alerta, porque ela nao se anuncia.
 */

// Um estado por arquivo. Era tudo singular aqui (`audioBufferGlobal`,
// `audioInstancia`, um `fetch` no topo do modulo), e por isso o segundo som nao
// tinha onde existir.
const ARQUIVOS = {
  monitoramento: '/ARKACHATMonitoramento.mp3',
  mensagem: '/blipnotificacaomensagem.mp3',
};

const sons = {
  monitoramento: { buffer: null, elemento: null },
  mensagem: { buffer: null, elemento: null },
};

let audioDesbloqueado = false;
let audioCtxGlobal = null;

function obterAudioContext() {
  if (!audioCtxGlobal && typeof window !== 'undefined') {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtxGlobal = new AudioContextClass();
    }
  }
  return audioCtxGlobal;
}

function obterAudioElemento(nome) {
  const som = sons[nome];
  if (!som) return null;
  if (!som.elemento && typeof window !== 'undefined') {
    som.elemento = new Audio(ARQUIVOS[nome]);
    som.elemento.preload = 'auto';
  }
  return som.elemento;
}

// Pre-carrega e decodifica OS DOIS arquivos na inicializacao. Decodificar na
// hora de tocar custaria a latencia justamente no instante em que o som
// importa.
if (typeof window !== 'undefined') {
  Object.keys(ARQUIVOS).forEach((nome) => {
    fetch(ARQUIVOS[nome])
      .then(r => r.arrayBuffer())
      .then(arrayBuffer => {
        const ctx = obterAudioContext();
        if (ctx) {
          ctx.decodeAudioData(arrayBuffer, (decoded) => {
            sons[nome].buffer = decoded;
          }, () => {});
        }
      })
      .catch(() => {});
  });
}

/**
 * Destrava o audio no primeiro gesto do usuario.
 *
 * Toca um dos arquivos em volume quase zero e pausa. E o unico jeito de o
 * navegador considerar a pagina "autorizada" -- depois disso os alertas
 * automaticos passam. Basta destravar UM elemento: a permissao e da pagina, nao
 * do arquivo.
 */
export function desbloquearAudioGlobal() {
  if (audioDesbloqueado) return;
  try {
    const ctx = obterAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume();
    }
    const a = obterAudioElemento('mensagem') || obterAudioElemento('monitoramento');
    if (a) {
      a.volume = 0.01;
      const p = a.play();
      if (p !== undefined) {
        p.then(() => {
          a.pause();
          a.currentTime = 0;
          a.volume = 1.0;
          audioDesbloqueado = true;
        }).catch(() => {});
      }
    }
  } catch (e) {}
}

// Registra ouvintes em multiplos eventos para forcar o desbloqueio
if (typeof window !== 'undefined') {
  const eventos = ['click', 'pointerdown', 'keydown', 'touchstart', 'scroll', 'mousemove', 'focus', 'load'];
  const handler = () => {
    desbloquearAudioGlobal();
    if (audioDesbloqueado) {
      eventos.forEach(ev => window.removeEventListener(ev, handler));
    }
  };
  eventos.forEach(ev => window.addEventListener(ev, handler, { passive: true }));
}

/** O som do MODO TV. So aquela tela dispara este. */
export function tocarSomMonitoramento(volume = 1.0) {
  tocarSom('monitoramento', volume);
}

/**
 * O NAVEGADOR AINDA ESTA BLOQUEANDO O SOM?
 *
 * ── POR QUE ISTO PRECISA SER PERGUNTAVEL ───────────────────────────────────
 *
 * Navegador nao toca audio automatico antes de um GESTO na pagina. Numa TV de
 * parede -- que fica aberta sozinha, e que recarrega ou volta de um deploy sem
 * ninguem tocar nela -- esse gesto nunca acontece, e o alerta simplesmente nao
 * sai. Nenhum ajuste de codigo muda isso: e regra do navegador.
 *
 * O problema nao e o bloqueio, e o SILENCIO. Da tela, "bloqueado" e
 * "quebrado" sao a mesma coisa: nao sai som e nada explica. Foi exatamente essa
 * a duvida que voltou varias vezes em 10/09/2026 -- e o codigo estava certo.
 *
 * Com isto exposto, o Modo TV pode DIZER que o som esta bloqueado e oferecer o
 * clique que o destrava, em vez de deixar quem olha adivinhando.
 *
 * A resposta e honesta em vez de otimista: so responde "liberado" se o
 * elemento de audio de fato tocou uma vez OU se o AudioContext esta `running`.
 * Qualquer outra coisa e "nao sei se vai sair", e nao se anuncia como liberado.
 */
export function somBloqueado() {
  if (audioDesbloqueado) return false;
  return !(audioCtxGlobal && audioCtxGlobal.state === 'running');
}

/** MENSAGEM nova numa conversa. O som do dia a dia da Central. */
export function tocarSomMensagem(volume = 1.0) {
  tocarSom('mensagem', volume);
}

function tocarSom(nome, volume = 1.0) {
  const som = sons[nome];
  if (!som) return;
  let tocouSucesso = false;

  // Tentativa 1: Tocar via AudioBuffer decodificado (Web Audio API - mais potente)
  try {
    const ctx = obterAudioContext();
    if (ctx && som.buffer) {
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      const source = ctx.createBufferSource();
      const gainNode = ctx.createGain();
      source.buffer = som.buffer;
      gainNode.gain.setValueAtTime(Math.min(1.0, Math.max(0, volume)), ctx.currentTime);
      source.connect(gainNode);
      gainNode.connect(ctx.destination);
      source.start(0);
      tocouSucesso = true;
    }
  } catch (e) {
    tocouSucesso = false;
  }

  // Tentativa 2: Tocar via HTML5 Audio se o AudioBuffer não tiver tocado
  if (!tocouSucesso) {
    try {
      desbloquearAudioGlobal();
      const audio = obterAudioElemento(nome);
      if (audio) {
        audio.currentTime = 0;
        audio.volume = Math.min(1.0, Math.max(0, volume));
        const promise = audio.play();
        if (promise !== undefined) {
          promise.then(() => {
            tocouSucesso = true;
          }).catch(err => {
            console.warn('HTML5 Audio bloqueado:', err);
            tocarChimeIFood(volume);
          });
        }
      } else {
        tocarChimeIFood(volume);
      }
    } catch (err) {
      tocarChimeIFood(volume);
    }
  }
}

function tocarChimeIFood(volume = 1.0) {
  try {
    const ctx = obterAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(volume * 1.8, ctx.currentTime);
    masterGain.connect(ctx.destination);

    const notas = [523.25, 659.25, 783.99, 1046.50];
    const duracaoNota = 0.05;
    const intervaloToques = 0.28;

    [0, intervaloToques].forEach((tempoInicio) => {
      notas.forEach((freq, index) => {
        const t = ctx.currentTime + tempoInicio + (index * duracaoNota);

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t);

        gain.gain.setValueAtTime(0.01, t);
        gain.gain.linearRampToValueAtTime(0.7, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, t + duracaoNota * 1.5);

        const oscSub = ctx.createOscillator();
        const gainSub = ctx.createGain();
        oscSub.type = 'triangle';
        oscSub.frequency.setValueAtTime(freq / 2, t);

        gainSub.gain.setValueAtTime(0.01, t);
        gainSub.gain.linearRampToValueAtTime(0.3, t + 0.01);
        gainSub.gain.exponentialRampToValueAtTime(0.001, t + duracaoNota * 1.5);

        osc.connect(gain);
        gain.connect(masterGain);

        oscSub.connect(gainSub);
        gainSub.connect(masterGain);

        osc.start(t);
        oscSub.start(t);
        osc.stop(t + duracaoNota * 1.8);
        oscSub.stop(t + duracaoNota * 1.8);
      });
    });
  } catch (err) {}
}
