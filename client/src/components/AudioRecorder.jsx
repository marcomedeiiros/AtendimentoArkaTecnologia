import React, { useState, useRef, useEffect } from 'react';
import { Mic, Square, Trash2, Send, AlertCircle, Waves } from 'lucide-react';

/**
 * SUPRESSÃO DE RUÍDO -- o pedido que faz o áudio do atendimento sair limpo.
 *
 * Antes daqui a captação era `{ audio: true }`: o navegador entregava o
 * microfone cru, com o ar-condicionado, o teclado, o ventilador e a conversa da
 * mesa ao lado. Do outro lado, um cliente ouvindo tudo isso por cima da voz.
 *
 * As três chaves fazem coisas diferentes, e as três importam num escritório:
 *
 *   noiseSuppression  -> tira o ruído CONSTANTE de fundo (ar, ventilador, chiado)
 *   echoCancellation  -> tira o retorno do próprio alto-falante, que é o que faz
 *                        a gravação sair com eco quando ninguém usa fone
 *   autoGainControl   -> nivela o volume: quem fala longe do microfone não sai
 *                        sussurrando, quem fala perto não estoura
 *
 * `channelCount: 1` porque voz não tem estéreo: dois canais só dobrariam o
 * tamanho do arquivo com a mesma informação nos dois lados.
 *
 * NÃO é processamento nosso -- é o processamento nativo do navegador (o mesmo
 * que uma chamada de vídeo usa), pedido por constraint. Um filtro escrito à mão
 * com AudioContext custaria CPU, atrasaria a gravação e, feito por aproximação,
 * cortaria pedaço de voz junto com o ruído.
 */
const CONSTRAINTS_LIMPAS = {
  audio: {
    noiseSuppression: true,
    echoCancellation: true,
    autoGainControl: true,
    channelCount: 1,
  },
};

/**
 * Pede o microfone com supressão e, se o navegador recusar as constraints, pede
 * de novo sem elas.
 *
 * O fallback não é zelo excessivo: `getUserMedia` rejeita com
 * `OverconstrainedError` quando o dispositivo não suporta algo que foi pedido, e
 * sem esta segunda tentativa o gravador simplesmente pararia de funcionar em
 * navegador antigo ou microfone incomum -- trocando "áudio com ruído" por
 * "nenhum áudio", que é muito pior.
 */
async function capturarMicrofone() {
  try {
    return await navigator.mediaDevices.getUserMedia(CONSTRAINTS_LIMPAS);
  } catch (e) {
    // Permissão negada é decisão do usuário: não há o que tentar de novo.
    if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') throw e;
    return navigator.mediaDevices.getUserMedia({ audio: true });
  }
}

export default function AudioRecorder({ onSendAudio, onCancel }) {
  const [isRecording, setIsRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [erro, setErro] = useState('');
  const [supressao, setSupressao] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);

  useEffect(() => {
    iniciarGravacao();
    return () => {
      pararGravacaoSilenciosamente();
    };
  }, []);

  const iniciarGravacao = async () => {
    try {
      setErro('');
      const stream = await capturarMicrofone();
      // Registra o que o navegador de fato aplicou: `noiseSuppression: true` é
      // um PEDIDO, e nem todo navegador/dispositivo atende. Mostrar só quando
      // está ativo de verdade evita prometer na tela o que não aconteceu.
      const ajustes = stream.getAudioTracks()[0]?.getSettings?.() || {};
      setSupressao(ajustes.noiseSuppression === true);

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);

      setSeconds(0);
      timerRef.current = setInterval(() => {
        setSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      setErro('Permissão de microfone negada ou indisponível.');
    }
  };

  const pararGravacaoSilenciosamente = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
    }
  };

  const handleCancel = () => {
    pararGravacaoSilenciosamente();
    setIsRecording(false);
    if (onCancel) onCancel();
  };

  const handleSend = () => {
    if (!mediaRecorderRef.current || !isRecording) return;

    if (timerRef.current) clearInterval(timerRef.current);

    mediaRecorderRef.current.onstop = () => {
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/ogg; codecs=opus' });
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64DataUrl = reader.result;
        onSendAudio(base64DataUrl);
      };
      reader.readAsDataURL(audioBlob);

      mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
      setIsRecording(false);
    };

    mediaRecorderRef.current.stop();
  };

  const formatSecs = (s) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  if (erro) {
    return (
      <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-falha/15 text-falha-400 text-xs font-semibold border border-falha/30 w-full">
        <span className="flex items-center gap-1.5"><AlertCircle size={14} /> {erro}</span>
        <button onClick={handleCancel} className="underline text-[11px]">Fechar</button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 p-2 rounded-xl bg-red-500/10 border border-red-500/30 w-full animate-pulse">
      <div className="flex items-center gap-2 text-red-400 font-mono text-xs font-bold min-w-0">
        <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping shrink-0" />
        <span>Gravando áudio... {formatSecs(seconds)}</span>
        {/* Só aparece quando o navegador CONFIRMOU a supressão (getSettings), e
            não porque nós a pedimos. Um selo que mente sobre a qualidade do
            áudio é pior do que nenhum selo. */}
        {supressao && (
          <span
            className="hidden sm:inline-flex items-center gap-1 font-sans font-semibold text-[10px] px-1.5 py-0.5 rounded-md border bg-ativo/15 border-ativo/30 text-ativo-400 shrink-0"
            title="O navegador está filtrando o ruído de fundo, o eco e nivelando o volume desta gravação."
          >
            <Waves size={11} /> ruído reduzido
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={handleCancel}
          type="button"
          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-falha-400 transition-colors"
          title="Cancelar gravação"
        >
          <Trash2 size={15} />
        </button>

        <button
          onClick={handleSend}
          type="button"
          className="px-3 py-1.5 rounded-xl bg-acao hover:bg-acao-200 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition-all shadow-md"
        >
          <Send size={13} /> Enviar Áudio
        </button>
      </div>
    </div>
  );
}
