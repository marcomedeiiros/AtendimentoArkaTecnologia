/**
 * Aviso de entrada e saida da plataforma.
 *
 * Separado do NotificacoesToast de proposito: aquele vive no AppContext e so
 * existe dentro do painel, enquanto estes avisos precisam aparecer tambem em
 * /login -- que e justamente onde a pessoa cai depois de sair ou de perder a
 * sessao. Por isso mora no AuthProvider, que envolve tudo.
 *
 * Fica embaixo e centralizado, longe do canto superior direito onde as
 * notificacoes de mensagem se empilham: dois avisos diferentes disputando o
 * mesmo canto viram um so borrao.
 */
import { CheckCircle2, LogOut, Clock, X } from 'lucide-react';

// `ring` e nao `border-*`: .glass-panel define a borda pelo atalho `border:`,
// que sobrescreve qualquer border-color do Tailwind -- a cor de destaque saia
// cinza. O anel fica por fora e nao entra nessa disputa.
const ESTILOS = {
  entrada: { Icone: CheckCircle2, cor: 'ring-1 ring-acao/60 text-acao-200' },
  saida:   { Icone: LogOut,       cor: 'ring-1 ring-linha-forte text-texto' },
  expirou: { Icone: Clock,        cor: 'ring-1 ring-espera/60 text-espera-400' },
};

export default function AvisoSessao({ aviso, onFechar }) {
  if (!aviso) return null;
  const { Icone, cor } = ESTILOS[aviso.tipo] || ESTILOS.entrada;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[80] flex justify-center px-4">
      {/* `status` e nao `alert`: sao confirmacoes do que a pessoa acabou de
          fazer, entao o leitor de tela anuncia sem interromper o que ela faz. */}
      <div
        role="status"
        className={`fade-in glass-panel pointer-events-auto flex max-w-[min(92vw,26rem)] items-center gap-3 rounded-2xl px-4 py-3 shadow-2xl shadow-black/50 ${cor}`}
      >
        <Icone size={17} className="shrink-0" />
        <p className="flex-1 text-xs font-semibold leading-snug">{aviso.texto}</p>
        <button
          onClick={onFechar}
          title="Fechar aviso"
          className="shrink-0 rounded-lg p-1 text-texto-suave transition-colors hover:bg-grafite-600 hover:text-texto"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
