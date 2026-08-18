import { useEffect, useRef } from 'react';
import { Terminal, CheckCircle2, AlertTriangle, Loader2, Play, X, Trash2, Clock } from 'lucide-react';

export function FlowExecutionLogs({ logs, isRunning, onClear, onClose, activeNodeId }) {
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs.length]);

  // `w-full` com `left-4` estourava 16px para fora da tela: o calc desconta as
  // duas margens laterais.
  return (
    <div className="absolute bottom-4 left-4 z-30 w-[calc(100%-2rem)] max-w-lg glass-panel border border-linha rounded-2xl shadow-2xl overflow-hidden fade-in">
      <div className="p-3 bg-grafite-600 border-b border-linha flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-bold text-white font-display min-w-0">
          <Terminal size={15} className="text-acao-200 shrink-0" />
          <span className="truncate">
            <span className="hidden sm:inline">Console de Execução em Tempo Real</span>
            <span className="sm:hidden">Console</span>
          </span>
          {isRunning && (
            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-acao/20 text-acao-200 font-mono shrink-0">
              <Loader2 size={10} className="animate-spin" /> <span className="hidden sm:inline">EXECUTANDO</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
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

      <div ref={scrollRef} className="p-3 max-h-56 overflow-y-auto font-mono text-[11px] space-y-2 bg-grafite-900">
        {logs.length === 0 ? (
          <div className="text-slate-500 text-center py-4 font-sans text-xs">
            Clique no botão <strong className="text-acao-200">"Simular Execução"</strong> na barra superior para iniciar o teste.
          </div>
        ) : (
          logs.map((log, index) => (
            <div
              key={index}
              className={`p-2 rounded-lg border transition-all flex items-start justify-between gap-2 ${
                log.type === 'success'
                  ? 'bg-ativo/10 border-ativo/30 text-ativo-400'
                  : log.type === 'error'
                  ? 'bg-falha/10 border-falha/30 text-falha-400'
                  : log.type === 'running'
                  ? 'bg-acao/10 border-acao/30 text-acao-200'
                  : 'bg-slate-900 border-linha text-slate-300'
              }`}
            >
              <div className="flex items-start gap-2 min-w-0 flex-1">
                {log.type === 'success' && <CheckCircle2 size={13} className="text-ativo-400 shrink-0 mt-0.5" />}
                {log.type === 'error' && <AlertTriangle size={13} className="text-falha-400 shrink-0 mt-0.5" />}
                {log.type === 'running' && <Loader2 size={13} className="text-acao-200 animate-spin shrink-0 mt-0.5" />}
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
