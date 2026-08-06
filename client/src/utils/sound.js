let audioInstancia = null;
let audioDesbloqueado = false;
let audioBufferGlobal = null;
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

function obterAudioElemento() {
  if (!audioInstancia && typeof window !== 'undefined') {
    audioInstancia = new Audio('/IFOOD.mp3');
    audioInstancia.preload = 'auto';
  }
  return audioInstancia;
}

// Pré-carrega e decodifica o arquivo /IFOOD.mp3 em memória via ArrayBuffer na inicialização
if (typeof window !== 'undefined') {
  fetch('/IFOOD.mp3')
    .then(r => r.arrayBuffer())
    .then(arrayBuffer => {
      const ctx = obterAudioContext();
      if (ctx) {
        ctx.decodeAudioData(arrayBuffer, (decoded) => {
          audioBufferGlobal = decoded;
        }, () => {});
      }
    })
    .catch(() => {});
}

export function desbloquearAudioGlobal() {
  if (audioDesbloqueado) return;
  try {
    const ctx = obterAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume();
    }
    const a = obterAudioElemento();
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

// Registra ouvintes em múltiplos eventos para forçar o desbloqueio
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

export function playPing() {
  tocarSomNotificacao(1.0);
}

export function tocarSomNotificacao(volume = 1.0) {
  let tocouSucesso = false;

  // Tentativa 1: Tocar via AudioBuffer decodificado (Web Audio API - mais potente)
  try {
    const ctx = obterAudioContext();
    if (ctx && audioBufferGlobal) {
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      const source = ctx.createBufferSource();
      const gainNode = ctx.createGain();
      source.buffer = audioBufferGlobal;
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
      const audio = obterAudioElemento();
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






