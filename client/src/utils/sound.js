/**
 * OS DOIS SONS DO PAINEL, e por que eles sao dois.
 *
 *   ARKACHATMonitoramento.mp3   CHAMADO NOVO entrando na fila. Alto, para ser
 *                               ouvido de longe: ele existe para a TV na parede.
 *   blipnotificacaomensagem.mp3 MENSAGEM chegando no dia a dia da Central.
 *                               Discreto, porque toca muitas vezes por turno.
 *
 * Antes havia UM som para as duas coisas, disparado no mesmo lugar
 * (AppContext), sem distincao de tela nem de momento do atendimento: chamado
 * novo e a decima mensagem da mesma conversa soavam igual. Quem escutava nao
 * tinha como saber se precisava correr ou nao.
 *
 * QUEM DECIDE QUAL TOCA NAO E ESTE ARQUIVO -- e o AppContext, que e o unico
 * lugar onde se sabe ao mesmo tempo (a) que chegou mensagem, (b) se a conversa
 * e nova e (c) se o Modo TV esta ligado. Aqui so ficam os canos.
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
  chamadoNovo: '/ARKACHATMonitoramento.mp3',
  mensagem: '/blipnotificacaomensagem.mp3',
};

const sons = {
  chamadoNovo: { buffer: null, elemento: null },
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
    const a = obterAudioElemento('mensagem') || obterAudioElemento('chamadoNovo');
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

/** CHAMADO NOVO na fila. Hoje so o Modo TV dispara este. */
export function tocarSomChamadoNovo(volume = 1.0) {
  tocarSom('chamadoNovo', volume);
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
