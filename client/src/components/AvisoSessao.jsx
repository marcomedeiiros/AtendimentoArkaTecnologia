/**
 * Aviso de entrada e saida da plataforma.
 *
 * Separado do NotificacoesToast de proposito: aquele vive no AppContext e so
 * existe dentro do painel, enquanto estes avisos precisam aparecer tambem em
 * /login -- que e justamente onde a pessoa cai depois de sair ou de perder a
 * sessao. Por isso mora no AuthProvider, que envolve tudo.
 *
 * Duas formas, porque sao duas coisas diferentes:
 *
 * - entrada e saida sao TRANSICOES. Ganham o centro da tela e um circulo
 *   girando: alguma coisa esta de fato acontecendo atras (o painel montando,
 *   a sessao sendo descartada), e o giro diz "aguarde um instante".
 *
 * - sessao expirada nao e transicao, e aviso. Nada esta carregando, entao um
 *   spinner ali seria mentira. Fica como faixa embaixo, sem bloquear a tela,
 *   longe do canto onde as notificacoes de mensagem se empilham.
 */
import { Clock, X } from 'lucide-react';

// Circulo com um arco colorido girando. Feito com borda em vez de icone para o
// arco herdar a cor de cada estado sem precisar de duas versoes do desenho.
// Cores FIXAS (nao variaveis de tema): esta tela e sempre escura.
function Girando({ cor }) {
  return (
    <span
      aria-hidden="true"
      className={`block h-9 w-9 animate-spin rounded-full border-[3px] border-white/15 ${cor}`}
    />
  );
}

export default function AvisoSessao({ aviso, onFechar }) {
  if (!aviso) return null;

  // ── Alerta discreto: sessao expirada ──────────────────────────────────────
  if (aviso.tipo === 'expirou') {
    return (
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[80] flex justify-center px-4">
        <div
          role="status"
          className="fade-in glass-panel pointer-events-auto flex max-w-[min(92vw,26rem)] items-center gap-3 rounded-2xl px-4 py-3 text-espera-400 shadow-2xl shadow-black/50 ring-1 ring-espera/60"
        >
          <Clock size={17} className="shrink-0" />
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

  // ── Transicao: entrou ou saiu ─────────────────────────────────────────────
  const entrando = aviso.tipo === 'entrada';

  return (
    // Tela de TRANSICAO: sempre ESCURA e fixa, como as telas de acesso. Cores
    // fixas (nao variaveis de tema) porque ela pode aparecer sobreposta ao painel
    // no exato momento em que o tema claro do usuario e aplicado -- e ai o fundo
    // por variavel de tema (grafite-900) virava branco.
    // Clicar em qualquer lugar fecha: o aviso ja sai sozinho, mas quem esta com
    // pressa nao deveria precisar esperar a animacao terminar.
    <div
      onClick={onFechar}
      style={{ backgroundColor: '#0b141a' }}
      className="fixed inset-0 z-[80] flex items-center justify-center px-4"
    >
      <div
        role="status"
        className="fade-in flex w-[min(92vw,20rem)] flex-col items-center gap-4 text-center"
      >
        <img
          src="/arka_tecnologia_logo-removebg-preview.png"
          alt="Arka Tecnologia"
          // Logo sempre BRANCA aqui (fundo escuro fixo), sem depender do tema.
          style={{ filter: 'brightness(0) invert(1)' }}
          className="h-9 w-auto object-contain"
        />
        <Girando cor={entrando ? 'border-t-[#06cf9c]' : 'border-t-slate-400'} />
        <p className={`text-sm font-bold leading-snug ${entrando ? 'text-[#06cf9c]' : 'text-slate-200'}`}>
          {aviso.texto}
        </p>
      </div>
    </div>
  );
}
