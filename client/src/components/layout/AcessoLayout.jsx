/**
 * Moldura das telas /login e /cadastrar.
 *
 * A esquerda nao e ilustracao: e o produto rodando. Um cliente escreve, o
 * atendente responde e o ✓✓ fica azul -- que e literalmente o ciclo que a
 * pessoa vai repetir depois de entrar. Explicar isso em texto exigiria um
 * paragrafo; a cena leva tres segundos.
 *
 * A grade atras existe para dar leitura de console, nao de papel de parede:
 * ela e mascarada para aparecer perto do conteudo e sumir nas bordas.
 */
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';

function Logo({ size = 34 }) {
  return (
    <img
      src="/arka_tecnologia_logo-removebg-preview.png"
      alt="Arka Tecnologia"
      style={{ height: size, width: 'auto', objectFit: 'contain', filter: 'brightness(0) invert(1)' }}
    />
  );
}

// Cada bolha entra na ordem dos `atraso`, encadeando a conversa.
function Cena() {
  return (
    <div className="w-full max-w-sm space-y-2.5" aria-hidden="true">
      <div className="cena-bolha max-w-[80%] rounded-2xl rounded-tl-sm bg-grafite-600 px-3.5 py-2.5 text-xs text-texto shadow-lg"
        style={{ animationDelay: '0.35s' }}>
        Bom dia! Preciso Liberar acesso para um novo funcionario.
      </div>

      <div className="cena-bolha flex w-14 items-center justify-center gap-1 rounded-2xl rounded-tl-sm bg-grafite-600 px-3 py-3 shadow-lg"
        style={{ animationDelay: '1.05s' }}>
        {[0, 1, 2].map(i => (
          <span key={i} className="cena-ponto h-1.5 w-1.5 rounded-full bg-texto-suave"
            style={{ animationDelay: `${i * 0.16}s` }} />
        ))}
      </div>

      <div className="cena-bolha ml-auto max-w-[80%] rounded-2xl rounded-tr-sm bg-bolha px-3.5 py-2.5 text-xs text-texto shadow-lg"
        style={{ animationDelay: '2.3s' }}>
        Bom dia! Me passa o acesso do anydesk por gentileza!
        <span className="mt-1 flex items-center justify-end gap-1 text-[9px] text-texto-suave">
          09:14
          <span className="cena-lida inline-flex" style={{ animationDelay: '3.1s' }}>
            <Check size={11} className="-mr-[7px]" />
            <Check size={11} />
          </span>
        </span>
      </div>
    </div>
  );
}

export default function AcessoLayout({ titulo, subtitulo, children, rodape }) {
  return (
    <div className="min-h-screen bg-grafite-900 text-texto lg:grid lg:grid-cols-[1.05fr_minmax(420px,0.95fr)]">

      {/* ── Painel de marca ─────────────────────────────────────────────── */}
      <section className="relative hidden overflow-hidden border-r border-linha lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="grade-tecnica pointer-events-none absolute inset-0" />

        <header className="relative flex items-center gap-3">
          <Logo />
          <div className="h-7 w-px bg-linha" />
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-texto-suave">
            Central de Atendimento
          </p>
        </header>

        <div className="relative space-y-9">
          <h1 className="max-w-lg font-display text-4xl font-bold leading-[1.15] tracking-tight text-texto xl:text-5xl">
            Todo o WhatsApp da empresa
            <span className="text-acao-200"> em uma fila só.</span>
          </h1>
          <Cena />
        </div>

        {/* O rodape e legenda da cena, nao enfeite: e o ciclo de vida real de
            uma conversa no painel, na ordem em que acontece. */}
        <footer className="relative flex items-center gap-2.5 font-mono text-[10px] uppercase tracking-[0.16em] text-texto-fraco">
          <span className="h-1.5 w-1.5 rounded-full bg-espera" /> pendente
          <span className="text-linha-forte">→</span>
          <span className="h-1.5 w-1.5 rounded-full bg-ativo" /> aberta
          <span className="text-linha-forte">→</span>
          <span className="h-1.5 w-1.5 rounded-full bg-quieto" /> fechada
        </footer>
      </section>

      {/* ── Formulário ──────────────────────────────────────────────────── */}
      <section className="relative flex min-h-screen items-center justify-center px-5 py-12 sm:px-10">
        <div className="grade-tecnica pointer-events-none absolute inset-0 lg:hidden" />

        <div className="relative w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo size={30} />
          </div>

          <h2 className="font-display text-2xl font-bold tracking-tight text-texto">{titulo}</h2>
          <p className="mt-1.5 text-sm text-texto-suave">{subtitulo}</p>

          <div className="mt-7">{children}</div>

          <p className="mt-7 text-center text-xs text-texto-suave">{rodape}</p>
        </div>
      </section>
    </div>
  );
}

// Campo de formulario. O rotulo em mono, curto e em caixa alta, faz o
// formulario ler como painel de operacao e nao como cadastro de site.
export function Campo({ id, rotulo, erro, dica, ...props }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-texto-suave">
        {rotulo}
      </label>
      <input
        id={id}
        aria-invalid={!!erro}
        aria-describedby={erro ? `${id}-erro` : undefined}
        className={`w-full rounded-xl border bg-grafite-800 px-3.5 py-2.5 text-sm text-texto placeholder-texto-fraco outline-none transition-colors focus:border-acao focus:ring-2 focus:ring-acao/25 ${
          erro ? 'border-falha/60' : 'border-linha'
        }`}
        {...props}
      />
      {erro && (
        <p id={`${id}-erro`} className="mt-1.5 text-[11px] text-falha-400">{erro}</p>
      )}
      {!erro && dica && <p className="mt-1.5 text-[11px] text-texto-fraco">{dica}</p>}
    </div>
  );
}

export function LinkAcesso({ to, children }) {
  // O padding vertical existe pelo alvo de toque, nao pelo espacamento: em
  // elemento inline ele aumenta a area clicavel sem empurrar a linha, entao o
  // link passa de 17px de altura para uma faixa confortavel no dedo sem mudar
  // nada do layout.
  return (
    <Link
      to={to}
      className="px-1 py-2.5 font-semibold text-acao-200 underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
    >
      {children}
    </Link>
  );
}
