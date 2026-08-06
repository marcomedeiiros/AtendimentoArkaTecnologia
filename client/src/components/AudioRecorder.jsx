import React, { useState, useRef, useEffect } from 'react';
import { Mic, Square, Trash2, Send, AlertCircle } from 'lucide-react';

export default function AudioRecorder({ onSendAudio, onCancel }) {
  const [isRecording, setIsRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [erro, setErro] = useState('');
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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
      <div className="flex items-center gap-2 text-red-400 font-mono text-xs font-bold">
        <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
        <span>Gravando áudio... {formatSecs(seconds)}</span>
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
