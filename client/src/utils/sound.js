// Som de notificação gerado via Web Audio API — sem arquivo externo.
// Toca dois toques curtos e agradáveis ("ti-tim") quando chega mensagem nova.

let ctx = null;

function getCtx() {
  if (typeof window === 'undefined') return null;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!ctx) ctx = new AudioCtx();
  return ctx;
}

// Navegadores bloqueiam áudio até o primeiro gesto do usuário. Este listener
// cria/retoma o contexto no primeiro clique/tecla, deixando o som pronto para
// tocar depois quando chegar uma mensagem (mesmo sem gesto naquele instante).
function desbloquear() {
  const audio = getCtx();
  if (audio && audio.state === 'suspended') audio.resume().catch(() => {});
}
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', desbloquear, { once: false });
  window.addEventListener('keydown', desbloquear, { once: false });
}

export function playPing() {
  const audio = getCtx();
  if (!audio) return;
  if (audio.state === 'suspended') audio.resume().catch(() => {});

  const agora = audio.currentTime;
  const notas = [
    { freq: 880,  start: 0,    dur: 0.14 }, // A5
    { freq: 1318, start: 0.14, dur: 0.20 }, // E6
  ];

  const master = audio.createGain();
  master.gain.value = 0.5;
  master.connect(audio.destination);

  notas.forEach(({ freq, start, dur }) => {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, agora + start);
    gain.gain.exponentialRampToValueAtTime(0.6, agora + start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, agora + start + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(agora + start);
    osc.stop(agora + start + dur + 0.02);
  });
}
