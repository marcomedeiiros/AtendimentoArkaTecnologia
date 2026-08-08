import { 
  Bot, CheckCircle2, AlertTriangle, Zap, ShieldCheck, 
  HelpCircle, MessageSquare, Lock, Sparkles, Clock, UserCheck
} from 'lucide-react';

export function EmojiIcon({ name, label, size = "md", inline = false }) {
  const sizeMap = {
    sm: { container: 'h-5 px-1.5 text-xs gap-1', icon: 12 },
    md: { container: 'h-6 px-2 text-xs gap-1.5', icon: 14 },
    lg: { container: 'h-8 px-3 text-sm gap-2', icon: 16 },
    xl: { container: 'h-10 px-4 text-base gap-2.5', icon: 20 }
  };

  const currentSize = sizeMap[size] || sizeMap.md;

  const configs = {
    bot: {
      bg: 'bg-gradient-to-r from-espera/20 via-acao/20 to-espera/10 border-acao/30 text-acao-200',
      icon: Sparkles,
      defaultLabel: 'Arka IA'
    },
    check: {
      bg: 'bg-ativo/15 border-ativo/30 text-ativo-400',
      icon: CheckCircle2,
      defaultLabel: 'Validado'
    },
    warning: {
      bg: 'bg-espera/15 border-espera/30 text-espera-400',
      icon: AlertTriangle,
      defaultLabel: 'Atenção'
    },
    danger: {
      bg: 'bg-falha/15 border-falha/30 text-falha-400',
      icon: AlertTriangle,
      defaultLabel: 'Alerta'
    },
    lightning: {
      bg: 'bg-gradient-to-r from-acao/20 to-espera/20 border-acao/40 text-acao-200',
      icon: Zap,
      defaultLabel: 'Automação'
    },
    shield: {
      bg: 'bg-ativo/15 border-ativo/30 text-ativo-400',
      icon: ShieldCheck,
      defaultLabel: 'Parceiro Arka'
    },
    question: {
      bg: 'bg-slate-700/40 border-linha text-slate-300',
      icon: HelpCircle,
      defaultLabel: 'Pendente'
    },
    inbox: {
      bg: 'bg-blue-500/15 border-blue-500/30 text-blue-400',
      icon: MessageSquare,
      defaultLabel: 'Fila'
    },
    chat: {
      bg: 'bg-indigo-500/15 border-indigo-500/30 text-indigo-400',
      icon: MessageSquare,
      defaultLabel: 'Chat'
    },
    lock: {
      bg: 'bg-purple-500/15 border-purple-500/30 text-purple-400',
      icon: Lock,
      defaultLabel: 'Seguro'
    },
    clock: {
      bg: 'bg-espera/15 border-espera/30 text-espera-400',
      icon: Clock,
      defaultLabel: 'Aguardando'
    },
    user: {
      bg: 'bg-ativo/15 border-ativo/30 text-ativo-400',
      icon: UserCheck,
      defaultLabel: 'Operador'
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
        <span className="flex-1">{renderRico(cleanText)}</span>
      </div>
    );
  }

  return <span>{renderRico(text)}</span>;
}

// Renderiza *negrito* (sintaxe do WhatsApp) e preserva quebras de linha. E o que
// faz a assinatura "*Nome*\nmensagem" aparecer com o nome em negrito em cima e a
// mensagem embaixo -- igual ao que o cliente ve no WhatsApp.
function renderRico(texto) {
  const linhas = String(texto).split('\n');
  return linhas.map((linha, li) => (
    <span key={li}>
      {linha.split(/(\*[^*\n]+\*)/g).map((parte, pi) =>
        /^\*[^*\n]+\*$/.test(parte)
          ? <strong key={pi} className="font-bold">{parte.slice(1, -1)}</strong>
          : <span key={pi}>{parte}</span>
      )}
      {li < linhas.length - 1 && <br />}
    </span>
  ));
}
