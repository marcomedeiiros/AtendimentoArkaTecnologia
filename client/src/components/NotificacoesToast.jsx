import React from 'react';
import { MessageSquare, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import Avatar from './Avatar';

export default function NotificacoesToast() {
  const { notificacoes, removerNotificacao } = useAppContext();
  const navigate = useNavigate();

  if (!notificacoes || notificacoes.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[60] flex flex-col gap-2 w-[min(92vw,340px)]">
      {notificacoes.map(n => (
        <div
          key={n.id}
          onClick={() => { navigate('/atendimento'); removerNotificacao(n.id); }}
          className="fade-in cursor-pointer glass-panel border border-acao/40 rounded-2xl shadow-2xl shadow-black/40 p-3 flex items-start gap-3 hover:border-acao/70 transition-colors"
        >
          <Avatar nome={n.cliente} size="sm" fotoUrl={n.fotoUrl} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-xs font-bold text-white">
              <MessageSquare size={12} className="text-acao-200 shrink-0" />
              <span className="truncate">{n.cliente} lhe enviou uma mensagem</span>
            </div>
            <p className="text-[11px] text-slate-400 truncate mt-0.5">{n.texto}</p>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); removerNotificacao(n.id); }}
            className="p-1 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 transition-colors shrink-0"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
