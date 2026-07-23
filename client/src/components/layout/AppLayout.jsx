/**
<<<<<<< HEAD
 * AppLayout shell visual compartilhado por todas as rotas.
 *
 * Renderiza a Sidebar com NavLink (destaca rota ativa automaticamente)
 * e um <Outlet onde cada página é inserida pelo React Router
 * Substitui o sistema de aba/useState que estava em Home.jsx
=======
 * AppLayout — shell visual compartilhado por todas as rotas.
 *
 * Renderiza a Sidebar com NavLink (destaca rota ativa automaticamente)
 * e um <Outlet /> onde cada página é inserida pelo React Router.
 * Substitui o sistema de aba/useState que estava em Home.jsx.
>>>>>>> 5eddf9efedba389287d3c8bd67d57fa6f14c8fcf
 */
import React from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  LayoutGrid, Users, Zap, MessageSquare, ShieldCheck,
  GitFork, MessageCircle, CalendarDays, Send, Loader2
} from 'lucide-react';
import { useAppContext } from '../../context/AppContext';

<<<<<<< HEAD
=======
// ── Mapa de rotas da navegação ────────────────────────────────────────────────
>>>>>>> 5eddf9efedba389287d3c8bd67d57fa6f14c8fcf
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
];

<<<<<<< HEAD
=======
// ── Logo ──────────────────────────────────────────────────────────────────────
>>>>>>> 5eddf9efedba389287d3c8bd67d57fa6f14c8fcf
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

<<<<<<< HEAD
=======
// ── Item de navegação com NavLink ─────────────────────────────────────────────
>>>>>>> 5eddf9efedba389287d3c8bd67d57fa6f14c8fcf
function NavItem({ to, label, icon: Icon, badge }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 border ${
          isActive
            ? 'bg-gradient-to-r from-orange-500/20 to-amber-500/10 border-orange-500/40 text-orange-400 shadow-md shadow-orange-500/5'
            : 'bg-transparent border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <div className="flex items-center gap-3">
            <Icon size={15} className={`shrink-0 ${isActive ? 'text-orange-400' : 'text-slate-400'}`} />
            <span>{label}</span>
          </div>
          {badge > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-orange-500 text-slate-950 font-bold text-[10px] shadow-sm">
              {badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

<<<<<<< HEAD
=======
// ── Sidebar ───────────────────────────────────────────────────────────────────
>>>>>>> 5eddf9efedba389287d3c8bd67d57fa6f14c8fcf
function Sidebar() {
  const { conversas } = useAppContext();

  const naFila = conversas.filter(c => c.statusAtendimento === 'aguardando').length;
  const naoLidos = conversas.filter(
    c => !c.lido && c.statusAtendimento !== 'finalizado' && c.statusAtendimento !== 'resolvido'
  ).length;
  const badgeAtendimento = naFila > 0 ? naFila : naoLidos;

  return (
    <aside className="w-64 shrink-0 bg-[#11141C] border-r border-[#2A3040] flex flex-col p-4 h-screen select-none overflow-y-auto">
<<<<<<< HEAD
    
=======
      {/* Brand */}
>>>>>>> 5eddf9efedba389287d3c8bd67d57fa6f14c8fcf
      <div className="flex items-center gap-3 px-2 py-3 mb-4 shrink-0">
        <div className="p-2 rounded-xl bg-gradient-to-br from-orange-500/20 to-amber-500/10 border border-orange-500/30 shadow-lg shadow-orange-500/10">
          <ArkaLogo size={32} />
        </div>
        <div>
          <h1 className="font-bold text-base text-white leading-tight tracking-tight font-display">
            Arka Tecnologia
          </h1>
          <p className="text-[11px] text-slate-400 font-medium">Painel de Atendimento</p>
        </div>
      </div>

<<<<<<< HEAD
=======
      {/* Navegação */}
>>>>>>> 5eddf9efedba389287d3c8bd67d57fa6f14c8fcf
      <nav className="flex flex-col gap-1 flex-1">
        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider px-3 mb-1">
          Principal
        </p>
        {NAV_PRINCIPAL.map(item => (
          <NavItem
            key={item.to}
            {...item}
            badge={item.to === '/atendimento' ? badgeAtendimento : 0}
          />
        ))}

        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider px-3 mt-3 mb-1">
          Monitoramento
        </p>
        {NAV_MONITORAMENTO.map(item => (
          <NavItem key={item.to} {...item} />
        ))}

        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider px-3 mt-3 mb-1">
          Ferramentas
        </p>
        {NAV_FERRAMENTAS.map(item => (
          <NavItem key={item.to} {...item} />
        ))}
      </nav>
    </aside>
  );
}

<<<<<<< HEAD
=======
// ── AppLayout ─────────────────────────────────────────────────────────────────
>>>>>>> 5eddf9efedba389287d3c8bd67d57fa6f14c8fcf
export default function AppLayout() {
  const { carregando } = useAppContext();
  const location = useLocation();

<<<<<<< HEAD
=======
  // A rota /fluxos usa canvas full-screen sem padding
>>>>>>> 5eddf9efedba389287d3c8bd67d57fa6f14c8fcf
  const isFluxos = location.pathname === '/fluxos';

  if (carregando) {
    return (
      <div className="min-h-screen bg-[#0B0D12] flex flex-col items-center justify-center gap-3 text-slate-400">
        <Loader2 className="w-7 h-7 text-orange-500 animate-spin" />
        <span className="text-sm font-medium tracking-wide">Inicializando Arka Tecnologia...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B0D12] text-[#F3F4F8] flex font-sans antialiased selection:bg-orange-500/30 selection:text-orange-200">
      <Sidebar />
      <main
        className={`flex-1 min-w-0 h-screen ${
          isFluxos ? 'p-0 overflow-hidden' : 'p-6 lg:p-8 overflow-y-auto'
        }`}
      >
<<<<<<< HEAD
=======
        {/* Cada rota é renderizada aqui pelo React Router */}
>>>>>>> 5eddf9efedba389287d3c8bd67d57fa6f14c8fcf
        <Outlet />
      </main>
    </div>
  );
}
