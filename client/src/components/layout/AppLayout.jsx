/**
 * AppLayout shell visual compartilhado por todas as rotas.
 *
 * Renderiza a Sidebar com NavLink (destaca rota ativa automaticamente)
 * e um <Outlet onde cada página é inserida pelo React Router
 * Substitui o sistema de aba/useState que estava em Home.jsx
 */
import React, { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  LayoutGrid, Users, Zap, MessageSquare, ShieldCheck,
  GitFork, MessageCircle, CalendarDays, Send, Loader2, Menu, X, WifiOff, Settings
} from 'lucide-react';
import { useAppContext } from '../../context/AppContext';
import NotificacoesToast from '../NotificacoesToast';

const NAV_PRINCIPAL = [
  { to: '/atendimento', label: 'Central de Atendimento', icon: MessageSquare },
  { to: '/contatos',    label: 'Contatos',               icon: Users         },
  { to: '/fluxos',      label: 'Fluxo de Automações',    icon: GitFork       },
];

const NAV_MONITORAMENTO = [
  { to: '/dashboard',  label: 'Visão Geral',          icon: LayoutGrid    },
];

const NAV_FERRAMENTAS = [
  { to: '/whatsapp',   label: 'Integração WhatsApp',  icon: MessageCircle },
  { to: '/equipe',     label: 'Gestão da Equipe',     icon: Users         },
  { to: '/parceiros',  label: 'Parceiros (CNPJ)',     icon: ShieldCheck   },
  { to: '/mensagens',  label: 'Mensagens Rápidas',    icon: Zap           },
  { to: '/agenda',     label: 'Agenda',                icon: CalendarDays  },
  { to: '/massa',      label: 'Envio em Massa',        icon: Send          },
  { to: '/configuracoes', label: 'Configurações',      icon: Settings      },
];

function ArkaLogo({ size = 32 }) {
  return (
    <img
      src="/arka_tecnologia_logo-removebg-preview.png"
      alt="Logo Arka Tecnologia"
      style={{
        height: size, width: 'auto', maxHeight: size,
        objectFit: 'contain', filter: 'brightness(0) invert(1)',
      }}
    />
  );
}

// Item da barra lateral.
//
// O rotulo NUNCA quebra linha. "Central de Atendimento" ocupava 147px num
// espaco de 146 quando o badge aparecia -- um pixel de diferenca -- e a quebra
// resultante levava o item de 38px para 54px. Na pratica: chegava notificacao e
// o menu inteiro se mexia, empurrando os itens de baixo.
//
// `truncate` garante altura constante em qualquer situacao; os paddings e gaps
// mais justos abrem folga suficiente para o texto caber por inteiro mesmo com
// badge de dois digitos, entao a reticencia so apareceria num caso extremo --
// e para esse caso o `title` mostra o nome completo.
function NavItem({ to, label, icon: Icon, badge, onNavigate }) {
  return (
    <NavLink
      to={to}
      onClick={onNavigate}
      title={label}
      className={({ isActive }) =>
        `flex items-center justify-between gap-1.5 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 border ${
          isActive
            ? 'bg-gradient-to-r from-acao/20 to-espera/10 border-acao/40 text-acao-200 shadow-md shadow-acao/5'
            : 'bg-transparent border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <div className="flex items-center gap-2.5 min-w-0">
            <Icon size={15} className={`shrink-0 ${isActive ? 'text-acao-200' : 'text-slate-400'}`} />
            <span className="truncate">{label}</span>
          </div>
          {badge > 0 && (
            // `leading-none`: sem isso a altura da linha do badge (20px) passava
            // da linha do texto (16px) e era ELA quem definia a altura do item,
            // deixando so este 4px mais alto que os vizinhos.
            <span className="shrink-0 px-1.5 py-0.5 leading-none rounded-full bg-acao text-slate-950 font-bold text-[10px] shadow-sm">
              {badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

function Sidebar({ aberto, onClose }) {
  const { conversas } = useAppContext();

  const naFila = conversas.filter(c => c.statusAtendimento === 'pendente').length;
  const naoLidos = conversas.filter(
    c => !c.lido && c.statusAtendimento !== 'fechada'
  ).length;
  const badgeAtendimento = naFila > 0 ? naFila : naoLidos;

  return (
    <aside
      /* 17rem, nao 16: em w-64 o rotulo mais longo do proprio menu ("Central de
         Atendimento") pedia 147px num vao de 146. A barra era estreita demais
         para o que ela mesma precisa exibir. */
      className={`w-[17rem] shrink-0 bg-grafite-800 border-r border-linha flex flex-col p-4 h-screen select-none overflow-y-auto
        fixed inset-y-0 left-0 z-50 transition-transform duration-300 lg:static lg:translate-x-0
        ${aberto ? 'translate-x-0 shadow-2xl shadow-black/50' : '-translate-x-full'}`}
    >
      <div className="flex items-center gap-3 px-2 py-3 mb-4 shrink-0">
        <div className="p-2 rounded-xl bg-gradient-to-br from-acao/20 to-espera/10 border border-acao/30 shadow-lg shadow-acao/10">
          <ArkaLogo size={32} />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-bold text-base text-white leading-tight tracking-tight font-display">
            Arka Tecnologia
          </h1>
          <p className="text-[11px] text-slate-400 font-medium">Painel de Atendimento</p>
        </div>
        <button onClick={onClose} className="lg:hidden p-1.5 -mr-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800" title="Fechar menu">
          <X size={18} />
        </button>
      </div>

      <nav className="flex flex-col gap-1 flex-1">
        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider px-3 mb-1">
          Principal
        </p>
        {NAV_PRINCIPAL.map(item => (
          <NavItem
            key={item.to}
            {...item}
            badge={item.to === '/atendimento' ? badgeAtendimento : 0}
            onNavigate={onClose}
          />
        ))}

        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider px-3 mt-3 mb-1">
          Monitoramento
        </p>
        {NAV_MONITORAMENTO.map(item => (
          <NavItem key={item.to} {...item} onNavigate={onClose} />
        ))}

        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider px-3 mt-3 mb-1">
          Ferramentas
        </p>
        {NAV_FERRAMENTAS.map(item => (
          <NavItem key={item.to} {...item} onNavigate={onClose} />
        ))}
      </nav>
    </aside>
  );
}

export default function AppLayout() {
  const { carregando, apiOffline } = useAppContext();
  const location = useLocation();
  const [menuAberto, setMenuAberto] = useState(false);

  const isFluxos = location.pathname === '/fluxos';

  if (carregando) {
    return (
      <div className="min-h-screen bg-grafite-900 flex flex-col items-center justify-center gap-3 text-slate-400">
        <Loader2 className="w-7 h-7 text-acao animate-spin" />
        <span className="text-sm font-medium tracking-wide">Inicializando Arka Tecnologia...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-grafite-900 text-[#F3F4F8] flex font-sans antialiased selection:bg-acao/30 selection:text-acao-200">
      <NotificacoesToast />
      <Sidebar aberto={menuAberto} onClose={() => setMenuAberto(false)} />

      {/* Backdrop do menu no mobile */}
      {menuAberto && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setMenuAberto(false)}
          aria-hidden="true"
        />
      )}

      <div className="flex-1 min-w-0 flex flex-col h-screen">        
        <header className="lg:hidden flex items-center gap-3 h-14 px-4 bg-grafite-800 border-b border-linha shrink-0 sticky top-0 z-30">
          <button
            onClick={() => setMenuAberto(true)}
            className="p-2 -ml-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
            title="Abrir menu"
          >
            <Menu size={20} />
          </button>
          <ArkaLogo size={22} />
          <span className="font-bold text-sm text-white tracking-tight font-display">Arka Tecnologia</span>
        </header>

        {apiOffline && (
          <div className="shrink-0 flex items-center gap-2.5 px-4 py-2.5 bg-espera/10 border-b border-espera/30 text-espera-400 text-xs">
            <WifiOff size={14} className="shrink-0" />
            <span>
              Back-end offline nada esta sendo salvo. Rode{' '}
              <code className="px-1.5 py-0.5 rounded bg-espera/15 font-mono">cd server &amp;&amp; npm run dev</code>
              {' '}e atualize a pagina.
            </span>
          </div>
        )}

        <main
          className={`flex-1 min-w-0 min-h-0 ${
            isFluxos ? 'p-0 overflow-hidden' : 'p-4 sm:p-6 lg:p-8 overflow-y-auto'
          }`}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
