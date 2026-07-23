import React, { useEffect, useRef } from 'react';
import { Terminal, CheckCircle2, AlertTriangle, Loader2, Play, X, Trash2, Clock } from 'lucide-react';

export function FlowExecutionLogs({ logs, isRunning, onClear, onClose, activeNodeId }) {
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs.length]);

  return (
    <div className="absolute bottom-4 left-4 z-30 w-full max-w-lg glass-panel border border-[#2A3040] rounded-2xl shadow-2xl overflow-hidden fade-in">
      <div className="p-3 bg-[#1E2330] border-b border-[#2A3040] flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-bold text-white font-display">
          <Terminal size={15} className="text-orange-400" />
          <span>Console de Execução em Tempo Real</span>
          {isRunning && (
            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400 font-mono">
              <Loader2 size={10} className="animate-spin" /> EXECUTANDO
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onClear}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 text-xs flex items-center gap-1 transition-colors"
            title="Limpar logs"
          >
            <Trash2 size={12} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 text-xs transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="p-3 max-h-56 overflow-y-auto font-mono text-[11px] space-y-2 bg-[#0B0D12]">
        {logs.length === 0 ? (
          <div className="text-slate-500 text-center py-4 font-sans text-xs">
            Clique no botão <strong className="text-orange-400">"Simular Execução"</strong> na barra superior para iniciar o teste.
          </div>
        ) : (
          logs.map((log, index) => (
            <div
              key={index}
              className={`p-2 rounded-lg border transition-all flex items-start justify-between gap-2 ${
                log.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : log.type === 'error'
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                  : log.type === 'running'
                  ? 'bg-orange-500/10 border-orange-500/30 text-orange-300'
                  : 'bg-slate-900 border-slate-800 text-slate-300'
              }`}
            >
              <div className="flex items-start gap-2 min-w-0 flex-1">
                {log.type === 'success' && <CheckCircle2 size={13} className="text-emerald-400 shrink-0 mt-0.5" />}
                {log.type === 'error' && <AlertTriangle size={13} className="text-rose-400 shrink-0 mt-0.5" />}
                {log.type === 'running' && <Loader2 size={13} className="text-orange-400 animate-spin shrink-0 mt-0.5" />}
                {log.type === 'info' && <Play size={12} className="text-blue-400 shrink-0 mt-0.5" />}
                
                <div className="break-words leading-tight">
                  <span className="font-semibold">{log.title}</span>
                  {log.message && <p className="text-[10px] text-slate-400 mt-0.5">{log.message}</p>}
                </div>
              </div>

              {log.timeMs && (
                <span className="text-[10px] opacity-75 font-mono px-1.5 py-0.5 rounded bg-black/40 shrink-0 flex items-center gap-1">
                  <Clock size={10} /> {log.timeMs}ms
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
