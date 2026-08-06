import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, Volume2, VolumeX } from 'lucide-react';

export default function AudioPlayer({ src }) {
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onLoadedMetadata = () => setDuration(audio.duration || 0);
    const onEnded = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('ended', onEnded);
    };
  }, [src]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  };

  const handleSeek = (e) => {
    const audio = audioRef.current;
    if (!audio) return;
    const time = Number(e.target.value);
    audio.currentTime = time;
    setCurrentTime(time);
  };

  const toggleSpeed = () => {
    const audio = audioRef.current;
    if (!audio) return;
    const speeds = [1, 1.5, 2];
    const nextSpeed = speeds[(speeds.indexOf(playbackRate) + 1) % speeds.length];
    audio.playbackRate = nextSpeed;
    setPlaybackRate(nextSpeed);
  };

  const toggleMute = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const formatTime = (secs) => {
    if (!secs || isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="flex items-center gap-2.5 p-2 rounded-xl bg-slate-900/60 border border-white/10 max-w-xs sm:max-w-sm">
      <audio ref={audioRef} src={src} preload="metadata" />

      <button
        onClick={togglePlay}
        type="button"
        className="w-8 h-8 rounded-full bg-acao text-slate-950 flex items-center justify-center shrink-0 hover:scale-105 transition-transform shadow-md"
      >
        {isPlaying ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
      </button>

      <div className="flex-1 min-w-0 space-y-1">
        <input
          type="range"
          min={0}
          max={duration || 100}
          value={currentTime}
          onChange={handleSeek}
          className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-acao"
        />
        <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      <button
        onClick={toggleSpeed}
        type="button"
        className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-[10px] font-bold border border-slate-700 transition-colors"
        title="Velocidade de reprodução"
      >
        {playbackRate}x
      </button>

      <button
        onClick={toggleMute}
        type="button"
        className="text-slate-400 hover:text-white p-1 transition-colors"
      >
        {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
      </button>
    </div>
  );
}
