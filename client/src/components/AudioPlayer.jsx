import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, Volume2, VolumeX } from 'lucide-react';

/**
 * Player de áudio das mensagens.
 *
 * Dois problemas conviviam aqui, e os dois vinham da MESMA causa:
 *
 * 1. "Infinity:NaN" no lugar da duração. Áudio de WhatsApp (opus/ogg) chega sem
 *    a duração no cabeçalho, e o navegador reporta `duration = Infinity`. O
 *    formatador antigo só se defendia de NaN -- Infinity passava direto e
 *    `Infinity % 60` virava NaN na tela.
 * 2. A barra não acompanhava a fala. O `<input range>` ia de 0 a 100 mas o
 *    `value` era o tempo em SEGUNDOS: num áudio de 8s, o cursor andava 8% e
 *    parava. Com duração Infinity então não andava nada.
 *
 * A correção é em três partes: descobrir a duração de verdade (empurrando o
 * cursor para forçar o navegador a varrer o arquivo), trabalhar a barra em
 * PORCENTAGEM (não em segundos) e nunca imprimir número que não seja finito.
 */
export default function AudioPlayer({ src }) {
  const audioRef = useRef(null);
  const [tocando, setTocando] = useState(false);
  const [tempo, setTempo] = useState(0);
  const [duracao, setDuracao] = useState(0);
  const [velocidade, setVelocidade] = useState(1);
  const [mudo, setMudo] = useState(false);
  const [arrastando, setArrastando] = useState(false);

  // Duração conhecida? É o que decide se a barra é arrastável e se o total
  // aparece. Enquanto não sabemos, mostramos "--:--" em vez de mentir.
  const temDuracao = Number.isFinite(duracao) && duracao > 0;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    let cancelado = false;
    let tentouDescobrir = false;
    let voltandoParaInicio = false;

    const aplicarDuracao = (valor) => {
      if (!cancelado && Number.isFinite(valor) && valor > 0) setDuracao(valor);
    };

    // Truque padrão para container sem duração: pedir um tempo absurdo faz o
    // navegador varrer até o fim e então reportar a duração real.
    //
    // Duas guardas que descobri na prática: só depois de HAVE_METADATA (antes
    // disso `duration` é NaN e o truque disparava sempre, à toa), e a volta ao
    // início acontece no evento `seeked` -- fazer isso na hora deixava o áudio
    // PARADO NO FIM, porque o seek para o fim ainda estava em curso e chegava
    // depois do nosso reset.
    const forcarDescoberta = () => {
      if (tentouDescobrir || audio.readyState < 1) return;
      tentouDescobrir = true;
      voltandoParaInicio = true;
      try {
        audio.currentTime = 1e101;
      } catch {
        voltandoParaInicio = false; // navegador recusou o seek: nada a desfazer
      }
    };

    const aoTerminarBusca = () => {
      if (!voltandoParaInicio) return;
      voltandoParaInicio = false;
      try { audio.currentTime = 0; } catch { /* ignora */ }
      if (!cancelado) setTempo(0);
    };

    const lerDuracao = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        aplicarDuracao(audio.duration);
        return;
      }
      // Sem duração no cabeçalho: `seekable` costuma saber depois de carregar.
      if (audio.seekable?.length) {
        const fim = audio.seekable.end(audio.seekable.length - 1);
        if (Number.isFinite(fim) && fim > 0) { aplicarDuracao(fim); return; }
      }
      forcarDescoberta();
    };

    const aoAtualizarTempo = () => { if (!arrastando) setTempo(audio.currentTime); };
    const aoTerminar = () => { setTocando(false); setTempo(0); };
    const aoPausar = () => setTocando(false);
    const aoTocar = () => setTocando(true);

    audio.addEventListener('timeupdate', aoAtualizarTempo);
    audio.addEventListener('loadedmetadata', lerDuracao);
    audio.addEventListener('durationchange', lerDuracao);
    audio.addEventListener('canplay', lerDuracao);
    audio.addEventListener('progress', lerDuracao);
    audio.addEventListener('seeked', aoTerminarBusca);
    audio.addEventListener('ended', aoTerminar);
    audio.addEventListener('pause', aoPausar);
    audio.addEventListener('play', aoTocar);

    // O áudio pode já estar com metadados quando o componente monta.
    lerDuracao();

    return () => {
      cancelado = true;
      audio.removeEventListener('timeupdate', aoAtualizarTempo);
      audio.removeEventListener('loadedmetadata', lerDuracao);
      audio.removeEventListener('durationchange', lerDuracao);
      audio.removeEventListener('canplay', lerDuracao);
      audio.removeEventListener('progress', lerDuracao);
      audio.removeEventListener('seeked', aoTerminarBusca);
      audio.removeEventListener('ended', aoTerminar);
      audio.removeEventListener('pause', aoPausar);
      audio.removeEventListener('play', aoTocar);
    };
    // `tocando`/`arrastando` de fora do array de propósito: são lidos dentro dos
    // handlers e reassinar tudo a cada play/pause é desperdício.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  const alternarPlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => setTocando(false));
    else audio.pause();
  }, []);

  // A barra trabalha em PORCENTAGEM: é o que faz o cursor acompanhar a fala em
  // áudio de qualquer tamanho.
  const progresso = temDuracao ? Math.min(100, (tempo / duracao) * 100) : 0;

  const aoArrastar = (e) => {
    const audio = audioRef.current;
    if (!audio || !temDuracao) return;
    const novo = (Number(e.target.value) / 100) * duracao;
    setTempo(novo);
    audio.currentTime = novo;
  };

  const alternarVelocidade = () => {
    const audio = audioRef.current;
    if (!audio) return;
    const opcoes = [1, 1.5, 2];
    const proxima = opcoes[(opcoes.indexOf(velocidade) + 1) % opcoes.length];
    audio.playbackRate = proxima;
    setVelocidade(proxima);
  };

  const alternarMudo = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !mudo;
    setMudo(!mudo);
  };

  // Nunca imprime valor não-finito: era daqui que saía o "Infinity:NaN".
  const formatar = (segundos) => {
    if (!Number.isFinite(segundos) || segundos < 0) return '--:--';
    const m = Math.floor(segundos / 60);
    const s = Math.floor(segundos % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    // `w-full min-w-0` + max-w em rem: o player acompanha a largura da bolha em
    // vez de ter largura fixa. Antes ele tinha `max-w-xs` cravado e, em bolha
    // estreita, os controles se empurravam para fora.
    <div className="flex w-full min-w-0 max-w-[20rem] items-center gap-2 rounded-xl border border-white/10 bg-slate-900/60 p-2 sm:gap-2.5">
      <audio ref={audioRef} src={src} preload="metadata" />

      <button
        onClick={alternarPlay}
        type="button"
        aria-label={tocando ? 'Pausar áudio' : 'Reproduzir áudio'}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-acao text-slate-950 shadow-md transition-transform hover:scale-105"
      >
        {tocando ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
      </button>

      <div className="min-w-0 flex-1 space-y-1">
        <input
          type="range"
          min={0}
          max={100}
          step={0.1}
          value={progresso}
          onChange={aoArrastar}
          onPointerDown={() => setArrastando(true)}
          onPointerUp={() => setArrastando(false)}
          disabled={!temDuracao}
          aria-label="Posição do áudio"
          className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-slate-700 accent-acao disabled:cursor-default disabled:opacity-60"
        />
        <div className="flex items-center justify-between gap-2 font-mono text-[10px] text-slate-400">
          <span className="tabular-nums">{formatar(tempo)}</span>
          <span className="tabular-nums">{temDuracao ? formatar(duracao) : '--:--'}</span>
        </div>
      </div>

      <button
        onClick={alternarVelocidade}
        type="button"
        className="shrink-0 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-300 transition-colors hover:bg-slate-700"
        title="Velocidade de reprodução"
      >
        {velocidade}x
      </button>

      <button
        onClick={alternarMudo}
        type="button"
        aria-label={mudo ? 'Ativar som' : 'Silenciar'}
        className="shrink-0 p-1 text-slate-400 transition-colors hover:text-white"
      >
        {mudo ? <VolumeX size={14} /> : <Volume2 size={14} />}
      </button>
    </div>
  );
}
