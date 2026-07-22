import React from 'react';
import { 
  Bot, CheckCircle2, AlertTriangle, Zap, ShieldCheck, 
  HelpCircle, MessageSquare, Search, Lock, Sparkles, Clock, UserCheck, Flame
} from 'lucide-react';

export function EmojiIcon({ name, label, size = "md", inline = false }) {
  const sizeMap = {
    sm: { container: 'h-5 px-1.5 text-xs gap-1', icon: 12 },
    md: { container: 'h-6 px-2 text-xs gap-1.5', icon: 14 },
    lg: { container: 'h-8 px-3 text-sm gap-2', icon: 16 },
    xl: { container: 'h-10 px-4 text-base gap-2.5', icon: 20 },
  };

  const currentSize = sizeMap[size] || sizeMap.md;

  const configs = {
    bot: {
      bg: 'bg-gradient-to-r from-amber-500/20 via-orange-500/20 to-amber-500/10 border-orange-500/30 text-orange-400',
      icon: Sparkles,
      defaultLabel: 'Arka IA',
    },
    check: {
      bg: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400',
      icon: CheckCircle2,
      defaultLabel: 'Validado',
    },
    warning: {
      bg: 'bg-amber-500/15 border-amber-500/30 text-amber-400',
      icon: AlertTriangle,
      defaultLabel: 'Atenção',
    },
    danger: {
      bg: 'bg-rose-500/15 border-rose-500/30 text-rose-400',
      icon: AlertTriangle,
      defaultLabel: 'Alerta',
    },
    lightning: {
      bg: 'bg-gradient-to-r from-orange-500/20 to-amber-500/20 border-orange-500/40 text-orange-400',
      icon: Zap,
      defaultLabel: 'Automação',
    },
    shield: {
      bg: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400',
      icon: ShieldCheck,
      defaultLabel: 'Parceiro Arka',
    },
    question: {
      bg: 'bg-slate-700/40 border-slate-600/40 text-slate-300',
      icon: HelpCircle,
      defaultLabel: 'Pendente',
    },
    inbox: {
      bg: 'bg-blue-500/15 border-blue-500/30 text-blue-400',
      icon: MessageSquare,
      defaultLabel: 'Fila',
    },
    chat: {
      bg: 'bg-indigo-500/15 border-indigo-500/30 text-indigo-400',
      icon: MessageSquare,
      defaultLabel: 'Chat',
    },
    lock: {
      bg: 'bg-purple-500/15 border-purple-500/30 text-purple-400',
      icon: Lock,
      defaultLabel: 'Seguro',
    },
    clock: {
      bg: 'bg-amber-500/15 border-amber-500/30 text-amber-400',
      icon: Clock,
      defaultLabel: 'Aguardando',
    },
    user: {
      bg: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400',
      icon: UserCheck,
      defaultLabel: 'Operador',
    }
  };

  const config = configs[name] || configs.bot;
  const IconComponent = config.icon;
  const displayText = label !== undefined ? label : config.defaultLabel;

  if (inline) {
    return (
      <span className={`inline-flex items-center align-middle ${config.bg} border rounded-md px-1.5 py-0.5 font-medium shadow-sm transition-transform hover:scale-105 mx-0.5`}>
        <IconComponent size={currentSize.icon} className="shrink-0 mr-1" />
        {displayText && <span>{displayText}</span>}
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center justify-center font-semibold border rounded-lg shadow-sm transition-all duration-200 ${config.bg} ${currentSize.container}`}>
      <IconComponent size={currentSize.icon} className="shrink-0" />
      {displayText && <span>{displayText}</span>}
    </span>
  );
}

export function FormattedMessage({ text }) {
  if (!text) return null;

  let formatted = text;

  if (text.includes('[🤖')) {
    const parts = text.split(/\[🤖\s*([^\]]+)\]/);
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-1.5 mb-1">
          <EmojiIcon name="bot" label={parts[1] || "Arka Bot"} size="sm" />
        </div>
        <div className="leading-relaxed">{parts.slice(2).join('')}</div>
      </div>
    );
  }

  const containsCheck = text.includes('✅');
  const containsWarning = text.includes('⚠️');

  if (containsCheck || containsWarning) {
    const cleanText = text.replace(/[✅⚠️]/g, '').trim();
    return (
      <div className="flex items-start gap-2">
        {containsCheck && <EmojiIcon name="check" label="" size="sm" />}
        {containsWarning && <EmojiIcon name="warning" label="" size="sm" />}
        <span className="flex-1">{cleanText}</span>
      </div>
    );
  }

  return <span>{text}</span>;
}
