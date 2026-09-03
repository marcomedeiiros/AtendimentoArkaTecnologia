/**
 * AppLayout shell visual compartilhado por todas as rotas.
 *
 * Renderiza a Sidebar com NavLink (destaca rota ativa automaticamente)
 * e um <Outlet onde cada página é inserida pelo React Router
 * Substitui o sistema de aba/useState que estava em Home.jsx
 */
import React, { useState, useLayoutEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { aplicarTema } from '../../utils/tema';
import {
  LayoutGrid, Users, Zap, MessageSquare, ShieldCheck,
  GitFork, MessageCircle, CalendarDays, Send, Loader2, Menu, X, WifiOff, Settings, LogOut, Bug,
  PanelLeftClose, PanelLeftOpen, Sun, Moon
} from 'lucide-react';
import { useAppContext } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import NotificacoesToast from '../NotificacoesToast';
import Avatar from '../Avatar';
import ReportarBug from '../ReportarBug';

// Cada item aponta para um `modulo`. O que aparece vem de `usuario.permissoes`
// (lista de modulos que o perfil pode ver, entregue pelo servidor). Isto e so a
// 1a camada (esconder o menu): o servidor decide o acesso de verdade a cada
// requisicao, entao digitar a URL na mao nao contorna nada.
const NAV_PRINCIPAL = [
  { to: '/atendimento', label: 'Central de Atendimento', icon: MessageSquare, modulo: 'atendimento' },
  { to: '/contatos',    label: 'Contatos',               icon: Users,         modulo: 'contatos' },
  { to: '/fluxos',      label: 'Fluxo de Automações',    icon: GitFork,       modulo: 'fluxos' },
];

// O "Painel da Equipe" saiu daqui: ele nao e mais uma tela navegavel, e sim o
// Modo TV da Central (botao da TV no cabecalho, ao lado do sino). Um item de
// menu para uma tela que roda numa parede sem mouse nunca teve muito uso.
const NAV_MONITORAMENTO = [
  { to: '/dashboard',  label: 'Visão Geral',          icon: LayoutGrid, modulo: 'dashboard' },
];

const NAV_FERRAMENTAS = [
  { to: '/whatsapp',   label: 'Integração WhatsApp',  icon: MessageCircle, modulo: 'whatsapp' },
  { to: '/equipe',     label: 'Gestão da Equipe',     icon: Users,         modulo: 'equipe' },
  { to: '/parceiros',  label: 'Clientes (CNPJ)',     icon: ShieldCheck,   modulo: 'parceiros' },
  { to: '/mensagens',  label: 'Mensagens Rápidas',    icon: Zap,           modulo: 'mensagens' },
  { to: '/agenda',     label: 'Agenda',                icon: CalendarDays, modulo: 'agenda' },
  { to: '/massa',      label: 'Envio em Massa',        icon: Send,          modulo: 'massa' },
  { to: '/bugs',       label: 'Relatos de Bugs',       icon: Bug,           modulo: 'bugs' },
  { to: '/configuracoes', label: 'Configurações',      icon: Settings,      modulo: 'configuracoes' },
];

function ArkaLogo({ size = 32, className = '' }) {
  return (
    <img
      src="/arka_tecnologia_logo-removebg-preview.png"
      alt="Logo Arka Tecnologia"
      className={`arka-logo ${className}`}
      style={{
        height: size,
        width: 'auto',
        maxHeight: size,
        objectFit: 'contain',
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
//
// RECOLHIDA: o `recolhida` sempre vira classe `lg:`, nunca classe seca.
//
// No celular a barra nao e uma coluna do layout -- e uma gaveta que cobre a
// tela e some ao escolher um item. Recolher ali seria trocar rotulos legiveis
// por icones mudos num painel que ja ocupa a tela toda, sem devolver espaco
// nenhum. Entao a faixa de icones existe SO do `lg` para cima; abaixo disso a
// gaveta continua completa mesmo com a preferencia ligada.
function NavItem({ to, label, icon: Icon, badge, onNavigate, recolhida }) {
  return (
    <NavLink
      to={to}
      onClick={onNavigate}
      title={label}
      className={({ isActive }) =>
        `relative flex items-center justify-between gap-1.5 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 border ${
          recolhida ? 'lg:justify-center lg:px-0' : ''
        } ${
          isActive
            ? 'bg-gradient-to-r from-acao/20 to-espera/10 border-acao/40 text-acao-200 shadow-md shadow-acao/5'
            : 'bg-transparent border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <div className={`flex items-center gap-2.5 min-w-0 ${recolhida ? 'lg:gap-0' : ''}`}>
            <Icon size={15} className={`shrink-0 ${isActive ? 'text-acao-200' : 'text-slate-400'}`} />
            <span className={`truncate ${recolhida ? 'lg:hidden' : ''}`}>{label}</span>
          </div>
          {badge > 0 && (
            <>
              {/* `leading-none`: sem isso a altura da linha do badge (20px)
                  passava da linha do texto (16px) e era ELA quem definia a
                  altura do item, deixando so este 4px mais alto que os vizinhos. */}
              <span className={`shrink-0 px-1.5 py-0.5 leading-none rounded-full bg-acao text-slate-950 font-bold text-[10px] shadow-sm ${
                recolhida ? 'lg:hidden' : ''
              }`}>
                {badge}
              </span>
              {/* Recolhida nao cabe o numero, mas "ha conversa esperando" e a
                  informacao que nao pode sumir -- e o unico motivo de alguem
                  olhar para a barra sem estar navegando. Vira um ponto no canto
                  do icone; o numero exato continua no `title`. O `ring` da cor
                  da barra separa o ponto do icone por baixo. */}
              <span
                className={`absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-acao ring-2 ring-grafite-800 ${
                  recolhida ? 'hidden lg:block' : 'hidden'
                }`}
                aria-hidden="true"
              />
            </>
          )}
        </>
      )}
    </NavLink>
  );
}

// Titulo de secao ("Principal", "Ferramentas"). Recolhida, o texto nao cabe --
// mas a SEPARACAO entre os grupos precisa sobreviver, senao os doze icones
// viram uma coluna unica sem hierarquia nenhuma. Vira um filete.
function TituloSecao({ children, recolhida, className = '' }) {
  return (
    <>
      <p className={`text-[9px] font-bold text-slate-500 uppercase tracking-wider px-3 ${className} ${
        recolhida ? 'lg:hidden' : ''
      }`}>
        {children}
      </p>
      {recolhida && (
        <div className="hidden lg:block h-px bg-linha mx-3 mt-3 mb-2" aria-hidden="true" />
      )}
    </>
  );
}

function Sidebar({ aberto, onClose }) {
  const { conversas } = useAppContext();
  const { usuario, sair, tema, alternarTema, navRecolhida, alternarNav } = useAuth();
  const navigate = useNavigate();

  // A gaveta do celular ignora a preferencia: ver o comentario em NavItem.
  const recolhida = navRecolhida;

  const naFila = conversas.filter(c => c.statusAtendimento === 'pendente').length;
  const naoLidos = conversas.filter(
    c => !c.lido && c.statusAtendimento !== 'fechada'
  ).length;
  const badgeAtendimento = naFila > 0 ? naFila : naoLidos;

  // Visibilidade por modulo, a partir de `usuario.permissoes` (do servidor). Se
  // a lista nao veio (sessao antiga), mostra tudo -- o servidor ainda barra o
  // que nao for permitido. Isto aqui e so o "esconder".
  const permissoes = usuario?.permissoes;
  const temLista = Array.isArray(permissoes);
  const podeVer = (item) => !temLista || !item.modulo || permissoes.includes(item.modulo);
  const principais = NAV_PRINCIPAL.filter(podeVer);
  const monitoramento = NAV_MONITORAMENTO.filter(podeVer);
  const ferramentas = NAV_FERRAMENTAS.filter(podeVer);

  return (
    <aside
      /* 17rem, nao 16: em w-64 o rotulo mais longo do proprio menu ("Central de
         Atendimento") pedia 147px num vao de 146. A barra era estreita demais
         para o que ela mesma precisa exibir. */
      /* `baixa:lg:` aperta o espaçamento VERTICAL da barra, nunca a largura: as
         17rem existem porque o rótulo mais longo do próprio menu precisa delas
         (ver comentário acima), e estreitar cortaria texto. Numa tela curta o
         que falta é altura -- com o menu inteiro visível, ninguém precisa rolar
         a barra para achar um item. */
      /* `transition-[width]` junto do `transition-transform` que a gaveta ja
         usava: sem ele a barra SALTA de 17rem para 4.75rem e o conteudo ao lado
         pula junto. `overflow-x-hidden` evita que os rotulos, no meio da
         animacao, empurrem uma barra de rolagem horizontal. */
      /* Padding em ramos EXCLUSIVOS, nao somado ao de baixo: `baixa:lg:p-3` e
         `baixa:lg:p-2` na mesma classe casariam com a mesma media query, e quem
         venceria seria a ordem em que o Tailwind emite as regras -- nao a ordem
         em que eu escrevi. Assim so um dos dois existe no DOM. */
      className={`shrink-0 bg-grafite-800 border-r border-linha flex flex-col altura-app select-none overflow-y-auto overflow-x-hidden
        seguro-barra
        w-[17rem] ${recolhida ? 'p-4 lg:w-[4.75rem] lg:p-2' : 'p-4 baixa:lg:p-3'}
        fixed inset-y-0 left-0 z-50 transition-[transform,width] duration-300 lg:static lg:translate-x-0
        ${aberto ? 'translate-x-0 shadow-2xl shadow-black/50' : '-translate-x-full'}`}
    >
      <div className={`flex items-center gap-3 px-2 py-3 mb-4 baixa:lg:py-1.5 baixa:lg:mb-2 shrink-0 ${
        recolhida ? 'lg:flex-col lg:gap-2 lg:px-0 lg:py-2' : ''
      }`}>
        <div className="p-2 rounded-xl bg-gradient-to-br from-acao/20 to-espera/10 border border-acao/30 shadow-lg shadow-acao/10">
          <ArkaLogo size={32} />
        </div>
        <div className={`flex-1 min-w-0 ${recolhida ? 'lg:hidden' : ''}`}>
          <h1 className="font-bold text-base text-white leading-tight tracking-tight font-display">
            Arka Tecnologia
          </h1>
          <p className="text-[11px] text-slate-400 font-medium">Painel de Atendimento</p>
        </div>

        {/* Recolher/expandir. So no desktop: no celular quem fecha a barra e o
            X ao lado, e a gaveta nao tem estado intermediario. */}
        <button
          onClick={alternarNav}
          title={recolhida ? 'Expandir menu' : 'Recolher menu'}
          aria-label={recolhida ? 'Expandir menu' : 'Recolher menu'}
          aria-expanded={!recolhida}
          className="hidden lg:flex shrink-0 items-center justify-center rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
        >
          {recolhida ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </button>

        <button onClick={onClose} className="lg:hidden p-1.5 -mr-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800" title="Fechar menu">
          <X size={18} />
        </button>
      </div>

      <nav className="flex flex-col gap-1 flex-1">
        {/* O primeiro grupo nao ganha filete: ele ja esta encostado no cabecalho,
            e uma linha ali leria como borda do logo, nao como divisao. */}
        <p className={`text-[9px] font-bold text-slate-500 uppercase tracking-wider px-3 mb-1 ${
          recolhida ? 'lg:hidden' : ''
        }`}>
          Principal
        </p>
        {principais.map(item => (
          <NavItem
            key={item.to}
            {...item}
            badge={item.to === '/atendimento' ? badgeAtendimento : 0}
            onNavigate={onClose}
            recolhida={recolhida}
          />
        ))}

        {monitoramento.length > 0 && (
          <>
            <TituloSecao recolhida={recolhida} className="mt-3 mb-1">Monitoramento</TituloSecao>
            {monitoramento.map(item => (
              <NavItem key={item.to} {...item} onNavigate={onClose} recolhida={recolhida} />
            ))}
          </>
        )}

        {ferramentas.length > 0 && (
          <>
            <TituloSecao recolhida={recolhida} className="mt-3 mb-1">Ferramentas</TituloSecao>
            {ferramentas.map(item => (
              <NavItem key={item.to} {...item} onNavigate={onClose} recolhida={recolhida} />
            ))}
          </>
        )}
      </nav>

      {/* Quem esta logado, e a saida. No rodape porque e o unico item que nao e
          navegacao: nao leva a lugar nenhum do painel, encerra a sessao. */}
      <div className="mt-3 shrink-0 border-t border-linha pt-3">
        {/* Claro/escuro, logo acima do nome. O estado mora no AuthContext (e a
            preferencia por usuario no servidor) -- este botao so alterna, nao
            guarda nada nem toca no DOM: quem aplica o tema e o AppLayout.
            O rotulo diz o DESTINO, nao o estado atual: "Modo claro" quando se
            esta no escuro. Botao que anuncia onde voce ja esta nao ajuda a
            decidir se vale clicar. */}
        <button
          onClick={alternarTema}
          title={tema === 'light' ? 'Mudar para o modo escuro' : 'Mudar para o modo claro'}
          aria-label="Alternar entre modo claro e modo escuro"
          className={`mb-2 flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-xs font-semibold text-texto-suave transition-colors hover:bg-slate-800/40 hover:text-texto ${
            recolhida ? 'lg:justify-center lg:px-0' : ''
          }`}
        >
          {tema === 'light' ? <Moon size={15} className="shrink-0" /> : <Sun size={15} className="shrink-0" />}
          <span className={`truncate ${recolhida ? 'lg:hidden' : ''}`}>
            {tema === 'light' ? 'Modo escuro' : 'Modo claro'}
          </span>
        </button>

        <div className={`flex items-center gap-2.5 px-1 ${recolhida ? 'lg:flex-col lg:gap-1 lg:px-0' : ''}`}>
          {/* Bloco do usuario = atalho para a pagina de perfil (/perfil). */}
          <button
            onClick={() => { navigate('/perfil'); onClose(); }}
            title={usuario?.nome ? `Meu perfil (${usuario.nome})` : 'Meu perfil'}
            className={`flex min-w-0 flex-1 items-center gap-2.5 -mx-1 rounded-lg px-1 py-1 text-left transition-colors hover:bg-slate-800/40 ${
              recolhida ? 'lg:mx-0 lg:flex-none lg:justify-center' : ''
            }`}
          >
            <Avatar nome={usuario?.nome || ''} size="sm" />
            <div className={`min-w-0 flex-1 ${recolhida ? 'lg:hidden' : ''}`}>
              <p className="truncate text-xs font-semibold text-texto">{usuario?.nome}</p>
              <p className="truncate font-mono text-[10px] text-texto-fraco">{usuario?.email}</p>
            </div>
          </button>
          <button
            onClick={sair}
            title="Sair da conta"
            className="shrink-0 rounded-lg p-2 text-texto-suave transition-colors hover:bg-falha/15 hover:text-falha-400"
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>
    </aside>
  );
}

export default function AppLayout() {
  const { carregando, apiOffline } = useAppContext();
  const { tema } = useAuth();
  const location = useLocation();
  const [menuAberto, setMenuAberto] = useState(false);

  // O tema pessoal (claro/escuro) so entra DEPOIS do carregamento. Enquanto
  // `carregando`, a tela "Inicializando..." fica no escuro fixo do boot; quando
  // o painel esta pronto, aplicamos o tema escolhido -- antes do paint
  // (useLayoutEffect), para nao piscar.
  useLayoutEffect(() => {
    if (!carregando) aplicarTema(tema);
  }, [carregando, tema]);

  const isFluxos = location.pathname === '/fluxos';

  if (carregando) {
    return (
      <div className="altura-app-min bg-grafite-900 flex flex-col items-center justify-center gap-3 text-slate-400">
        <Loader2 className="w-7 h-7 text-acao animate-spin" />
        <span className="text-sm font-medium tracking-wide">Inicializando Arka Tecnologia...</span>
      </div>
    );
  }

  return (
    <div className="altura-app-min bg-grafite-900 text-[#F3F4F8] flex font-sans antialiased selection:bg-acao/30 selection:text-acao-200">
      <NotificacoesToast />
      <ReportarBug />
      <Sidebar aberto={menuAberto} onClose={() => setMenuAberto(false)} />

      {/* Backdrop do menu no mobile */}
      {menuAberto && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setMenuAberto(false)}
          aria-hidden="true"
        />
      )}

      {/* `altura-app` (100dvh), e nao `h-screen` (100vh): esta coluna e a que
          termina no CAMPO DE ESCREVER da Central. Com 100vh o rodape dela fica
          embaixo da barra de endereco do celular, e o atendente perde o campo
          de resposta -- ver o comentario em index.css. */}
      <div className="flex-1 min-w-0 flex flex-col altura-app">
        {/* `seguro-cabecalho` afasta o botao do menu do entalhe do iPhone; sem ele o
            dedo cai na barra de status em vez de abrir a barra lateral. */}
        <header className="lg:hidden flex items-center gap-3 h-14 px-4 seguro-cabecalho box-content bg-grafite-800 border-b border-linha shrink-0 sticky top-0 z-30">
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
            /* `baixa:lg:` = tela curta (notebook, ou celular deitado). O padding de
               32px do desktop custa 64px de altura -- 10% de um notebook de 768px
               -- e não compra nada: numa tela baixa o que falta é espaço para o
               conteúdo, não respiro em volta dele. A largura continua folgada. */
            isFluxos
              ? 'p-0 overflow-hidden'
              : 'p-4 sm:p-6 lg:p-8 baixa:lg:px-6 baixa:lg:py-4 overflow-y-auto'
          }`}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}