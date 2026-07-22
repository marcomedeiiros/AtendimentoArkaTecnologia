import React, { useState, useEffect } from 'react';
import {
  LayoutGrid, Users, Zap, MessageSquare, ShieldCheck, Plus, Trash2, Circle,
  Search, Power, Loader2, QrCode, GitFork, MessageCircle, X,
  CalendarDays, Send, UserCheck, BookOpen, BarChart3
} from 'lucide-react';
import { EmojiIcon } from './EmojiIcon';
import { VisualFlowEditor } from '../flow/VisualFlowEditor';

import DashboardView     from './Dashboard';
import AtendimentoView   from './AtendimentoView';
import MensagensRapidas  from './MensagensRapidas';
import Agenda            from './Agenda';
import EnvioEmMassa      from './EnvioEmMassa';
import Contatos          from './Contatos';

function limparCnpj(v) { return String(v || '').replace(/\D/g, ''); }
function mascararCnpj(v) {
  const c = limparCnpj(v).slice(0, 14);
  return c
    .replace(/^(\d{2})(\d)/,        '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/,        '.$1/$2')
    .replace(/(\d{4})(\d)/,          '$1-$2');
}
function cnpjValido(v) {
  const c = limparCnpj(v);
  if (c.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(c)) return false;
  const calc = (base, pesos) => {
    const soma = pesos.reduce((acc, p, i) => acc + Number(base[i]) * p, 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const p1 = [5,4,3,2,9,8,7,6,5,4,3,2];
  const p2 = [6,5,4,3,2,9,8,7,6,5,4,3,2];
  const d1 = calc(c.slice(0,12), p1);
  const d2 = calc(c.slice(0,12)+d1, p2);
  return c === c.slice(0,12)+String(d1)+String(d2);
}

// ── Persistência ──────────────────────────────────────────────────────────────
const temStorage = typeof window !== 'undefined' && !!window.storage;
async function carregar(chave, padrao) {
  try {
    if (temStorage) {
      const r = await window.storage.get(chave, true);
      return r ? JSON.parse(r.value) : padrao;
    }
    const raw = localStorage.getItem(chave);
    return raw ? JSON.parse(raw) : padrao;
  } catch { return padrao; }
}
async function salvar(chave, valor) {
  try {
    if (temStorage) await window.storage.set(chave, JSON.stringify(valor), true);
    else localStorage.setItem(chave, JSON.stringify(valor));
    return true;
  } catch { return false; }
}

// ── Seeds ─────────────────────────────────────────────────────────────────────
const SEED_EQUIPE = [
  { id: 'e1', nome: 'Marina Souza', cargo: 'Atendimento Especializado', status: 'online' },
  { id: 'e2', nome: 'Diego Alves',  cargo: 'Suporte Técnico N2',        status: 'offline' },
  { id: 'e3', nome: 'Bruna Lima',   cargo: 'Gerente Comercial',         status: 'online' },
];

const SEED_FLUXOS = [
  {
    id: 'f1', nome: 'Fluxo 1: Atendimento de Orçamentos', gatilho: 'orçamento', ativo: true,
    passos: [
      { id: 'p1', tipo: 'gatilho',  titulo: 'Gatilho Recebido',       desc: 'Cliente digita "orçamento"' },
      { id: 'p2', tipo: 'mensagem', titulo: 'Perguntar CNPJ',         desc: 'Solicita o CNPJ para consulta de cadastro' },
      { id: 'p3', tipo: 'condicao', titulo: 'Validar CNPJ do Cliente', desc: 'Verifica se possui contrato de parceiro ativo' },
      { id: 'p4', tipo: 'mensagem', titulo: 'Resposta Inicial Bot',   desc: 'Olá! Sou a IA da Arka. Vou preparar seu orçamento agora mesmo.' },
      { id: 'p5', tipo: 'delay',    titulo: 'Aguardar 1.5s',          desc: 'Simula digitação humana' },
      { id: 'p6', tipo: 'acao',     titulo: 'Desconto Automático',    desc: 'Se for parceiro -> Aplica 15% de desconto automático na proposta' },
    ],
  },
  {
    id: 'f2', nome: 'Fluxo 2: Reenvio de 2ª Via de Boleto', gatilho: 'boleto', ativo: true,
    passos: [
      { id: 'p21', tipo: 'gatilho',  titulo: 'Gatilho Recebido',    desc: 'Cliente digita "boleto"' },
      { id: 'p22', tipo: 'mensagem', titulo: 'Solicitar CNPJ',      desc: 'Por favor informe seu CNPJ para consultar títulos em aberto...' },
      { id: 'p23', tipo: 'delay',    titulo: 'Aguardar 2.0s',       desc: 'Consulta no sistema ERP Arka' },
      { id: 'p24', tipo: 'acao',     titulo: 'Gerar Linha Digitável',desc: 'Envia PDF + código Pix/Boleto atualizado' },
    ],
  },
  {
    id: 'f3', nome: 'Fluxo 3: Consulta de Horário de Suporte', gatilho: 'horário', ativo: true,
    passos: [
      { id: 'p31', tipo: 'gatilho',  titulo: 'Gatilho Recebido', desc: 'Cliente digita "horário"' },
      { id: 'p32', tipo: 'mensagem', titulo: 'Informa Horário',  desc: 'Nosso atendimento funciona de segunda a sexta, das 8h às 18h.' },
    ],
  },
];

const SEED_PARCEIROS = [
  { cnpj: '11222333000181', razaoSocial: 'Empresa Exemplo LTDA', status: 'ativo' },
  { cnpj: '00000000000191', razaoSocial: 'Banco do Brasil SA',   status: 'ativo' },
];

const SEED_CONVERSAS = [
  {
    id: 'c1', cliente: 'João Pereira', telefone: '+55 11 98765-4321',
    statusAtendimento: 'aguardando', cnpj: null, cnpjVerificado: false, lido: false,
    mensagens: [{ de: 'cliente', texto: 'Oi, boa tarde! Gostaria de um orçamento para a minha empresa.', hora: '09:12' }],
  },
  {
    id: 'c2', cliente: 'Ricardo Nunes', telefone: '+55 21 99123-8877',
    statusAtendimento: 'aguardando', cnpj: null, cnpjVerificado: false, lido: false,
    mensagens: [{ de: 'cliente', texto: 'Preciso da 2ª via do boleto por favor.', hora: '09:40' }],
  },
  {
    id: 'c3', cliente: 'Beatriz Santos (Empresa Exemplo LTDA)', telefone: '+55 31 98877-1122',
    statusAtendimento: 'em_atendimento', cnpj: '11222333000181', cnpjVerificado: true, lido: true,
    mensagens: [
      { de: 'cliente', texto: 'Olá, solicito atendimento para renovação contratual.', hora: '09:50' },
      { de: 'equipe',  texto: '[🤖 Automação Arka]: Por favor, informe o CNPJ da empresa para consulta.', hora: '09:51' },
      { de: 'cliente', texto: 'Meu CNPJ é 11.222.333/0001-81', hora: '09:52' },
      { de: 'equipe',  texto: '✅ CNPJ 11.222.333/0001-81 validado! Empresa Exemplo LTDA — Parceiro Cadastrado.', hora: '09:52' },
    ],
  },
];

// ── Navegação ─────────────────────────────────────────────────────────────────
const NAV = [
  { id: 'dashboard',   label: 'Visão Geral',          icon: LayoutGrid   },
  { id: 'atendimento', label: 'Central de Atendimento',icon: MessageSquare},
  { id: 'contatos',    label: 'Contatos',              icon: Users        },
  { id: 'automacoes',  label: 'Fluxo de Automações',  icon: GitFork      },
  { id: 'whatsapp',    label: 'Integração WhatsApp',   icon: MessageCircle},
  { id: 'equipe',      label: 'Gestão da Equipe',      icon: Users        },
  { id: 'parceiros',   label: 'Parceiros (CNPJ)',      icon: ShieldCheck  },
  { id: 'mensagens',   label: 'Mensagens Rápidas',     icon: Zap          },
  { id: 'agenda',      label: 'Agenda',                icon: CalendarDays },
  { id: 'massa',       label: 'Envio em Massa',        icon: Send         },
];

// ── Logo ──────────────────────────────────────────────────────────────────────
function ArkaLogo({ size = 36, className = '' }) {
  return (
    <div className={`relative flex items-center justify-center shrink-0 ${className}`}>
      <img
        src="/arka_tecnologia_logo-removebg-preview.png"
        alt="Logo Arka Tecnologia"
        style={{ height: size, width: 'auto', maxHeight: size, objectFit: 'contain', filter: 'brightness(0) invert(1)' }}
      />
    </div>
  );
}

// ── App principal ─────────────────────────────────────────────────────────────
export default function App() {
  const [aba,              setAba]              = useState('dashboard');
  const [carregando,       setCarregando]        = useState(true);
  const [equipe,           setEquipe]            = useState([]);
  const [fluxos,           setFluxos]            = useState([]);
  const [parceiros,        setParceiros]         = useState([]);
  const [conversas,        setConversas]         = useState([]);
  const [whatsAppConectado,setWhatsAppConectado] = useState(true);

  useEffect(() => {
    (async () => {
      const [eq, fl, pa, co] = await Promise.all([
        carregar('arka:equipe',    null),
        carregar('arka:fluxos',    null),
        carregar('arka:parceiros', null),
        carregar('arka:conversas', null),
      ]);
      const eqF = eq || SEED_EQUIPE;
      const flF = fl || SEED_FLUXOS;
      const paF = pa || SEED_PARCEIROS;
      const coF = co || SEED_CONVERSAS;
      if (!eq) salvar('arka:equipe',    eqF);
      if (!fl) salvar('arka:fluxos',    flF);
      if (!pa) salvar('arka:parceiros', paF);
      if (!co) salvar('arka:conversas', coF);
      setEquipe(eqF); setFluxos(flF); setParceiros(paF); setConversas(coF);
      setCarregando(false);
    })();
  }, []);

  async function atualizarEquipe(nova)    { setEquipe(nova);    await salvar('arka:equipe',    nova); }
  async function atualizarFluxos(novo)    { setFluxos(novo);    await salvar('arka:fluxos',    novo); }
  async function atualizarParceiros(nova) { setParceiros(nova); await salvar('arka:parceiros', nova); }
  async function atualizarConversas(nova) {
    // Aceita função (prev => ...) ou valor direto, para compatibilidade
    if (typeof nova === 'function') {
      setConversas(prev => {
        const resultado = nova(prev);
        salvar('arka:conversas', resultado);
        return resultado;
      });
    } else {
      setConversas(nova);
      await salvar('arka:conversas', nova);
    }
  }

  // Abas que usam layout sem padding (full-screen)
  const abaFullScreen = aba === 'automacoes';

  return (
    <div className="min-h-screen bg-[#0B0D12] text-[#F3F4F8] flex font-sans antialiased selection:bg-orange-500/30 selection:text-orange-200">
      {carregando ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400">
          <Loader2 className="w-7 h-7 text-orange-500 animate-spin" />
          <span className="text-sm font-medium tracking-wide">Inicializando Arka Tecnologia...</span>
        </div>
      ) : (
        <>
          <Sidebar aba={aba} setAba={setAba} whatsAppConectado={whatsAppConectado} conversas={conversas} />
          <main className={`flex-1 min-w-0 h-screen ${abaFullScreen ? 'p-0 overflow-hidden' : 'p-6 lg:p-8 overflow-y-auto'}`}>

            {aba === 'dashboard' && (
              <DashboardView
                equipe={equipe} fluxos={fluxos} parceiros={parceiros}
                conversas={conversas} setAba={setAba}
              />
            )}

            {aba === 'atendimento' && (
              <AtendimentoView
                conversas={conversas} setConversas={atualizarConversas}
                fluxos={fluxos} parceiros={parceiros}
              />
            )}

            {aba === 'contatos' && (
              <Contatos
                conversas={conversas} setConversas={atualizarConversas}
                setAba={setAba}
              />
            )}

            {aba === 'automacoes' && (
              <VisualFlowEditor fluxos={fluxos} setFluxos={atualizarFluxos} equipe={equipe} />
            )}

            {aba === 'whatsapp' && (
              <WhatsAppView
                conectado={whatsAppConectado} setConectado={setWhatsAppConectado}
                conversas={conversas}
              />
            )}

            {aba === 'equipe' && (
              <EquipeView equipe={equipe} setEquipe={atualizarEquipe} />
            )}

            {aba === 'parceiros' && (
              <ParceirosView parceiros={parceiros} setParceiros={atualizarParceiros} />
            )}

            {aba === 'mensagens' && <MensagensRapidas />}

            {aba === 'agenda' && <Agenda />}

            {aba === 'massa' && (
              <EnvioEmMassa conversas={conversas} />
            )}

          </main>
        </>
      )}
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function Sidebar({ aba, setAba, whatsAppConectado, conversas }) {
  const naFila   = conversas.filter(c => c.statusAtendimento === 'aguardando').length;
  const naoLidos = conversas.filter(c => !c.lido && c.statusAtendimento !== 'finalizado' && c.statusAtendimento !== 'resolvido').length;

  // Separa nav em dois grupos para organização visual
  const navPrincipal = NAV.slice(0, 4);  // dashboard, atendimento, contatos, automacoes
  const navSecundario = NAV.slice(4);     // whatsapp, equipe, parceiros, mensagens, agenda, massa

  return (
    <aside className="w-64 shrink-0 bg-[#11141C] border-r border-[#2A3040] flex flex-col p-4 h-screen select-none overflow-y-auto">
      {/* Brand */}
      <div className="flex items-center gap-3 px-2 py-3 mb-4 shrink-0">
        <div className="p-2 rounded-xl bg-gradient-to-br from-orange-500/20 to-amber-500/10 border border-orange-500/30 shadow-lg shadow-orange-500/10">
          <ArkaLogo size={32} />
        </div>
        <div className="sidebar-label">
          <h1 className="font-bold text-base text-white leading-tight tracking-tight font-display">Arka Tecnologia</h1>
          <p className="text-[11px] text-slate-400 font-medium">Painel de Atendimento</p>
        </div>
      </div>

      {/* WhatsApp status */}
      <div
        onClick={() => setAba('whatsapp')}
        className={`mx-1 mb-4 p-2.5 rounded-xl cursor-pointer border transition-all duration-200 flex items-center gap-2.5 text-xs font-semibold shrink-0 ${
          whatsAppConectado
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
            : 'bg-rose-500/10 border-rose-500/30 text-rose-400 hover:bg-rose-500/20'
        }`}
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${whatsAppConectado ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
        <span className="sidebar-label">{whatsAppConectado ? 'WhatsApp Conectado' : 'WhatsApp Offline'}</span>
      </div>

      {/* Nav principal */}
      <nav className="flex flex-col gap-1 flex-1">
        <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider px-3 mb-1">Principal</div>
        {navPrincipal.map(item => <NavItem key={item.id} item={item} aba={aba} setAba={setAba} naFila={naFila} naoLidos={naoLidos} />)}

        <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider px-3 mt-3 mb-1">Ferramentas</div>
        {navSecundario.map(item => <NavItem key={item.id} item={item} aba={aba} setAba={setAba} naFila={naFila} naoLidos={naoLidos} />)}
      </nav>
    </aside>
  );
}

function NavItem({ item, aba, setAba, naFila, naoLidos }) {
  const Icon  = item.icon;
  const ativo = aba === item.id;

  // Badge numérico por item
  const badge =
    item.id === 'atendimento' && naFila > 0   ? naFila   :
    item.id === 'atendimento' && naoLidos > 0 ? naoLidos : null;

  return (
    <button
      onClick={() => setAba(item.id)}
      className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 border ${
        ativo
          ? 'bg-gradient-to-r from-orange-500/20 to-amber-500/10 border-orange-500/40 text-orange-400 shadow-md shadow-orange-500/5'
          : 'bg-transparent border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
      }`}
    >
      <div className="flex items-center gap-3">
        <Icon size={15} className={`shrink-0 ${ativo ? 'text-orange-400' : 'text-slate-400'}`} />
        <span className="sidebar-label">{item.label}</span>
      </div>
      {badge && (
        <span className="px-2 py-0.5 rounded-full bg-orange-500 text-slate-950 font-bold text-[10px] shadow-sm">
          {badge}
        </span>
      )}
    </button>
  );
}

// ── Header reutilizável ───────────────────────────────────────────────────────
export function Header({ titulo, subtitulo, children }) {
  return (
    <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight font-display">{titulo}</h1>
        {subtitulo && <p className="text-slate-400 text-xs sm:text-sm mt-1">{subtitulo}</p>}
      </div>
      {children}
    </div>
  );
}

// ── WhatsAppView ──────────────────────────────────────────────────────────────
function WhatsAppView({ conectado, setConectado, conversas }) {
  const [instancia,   setInstancia]   = useState('arka-wapi-oficial');
  const [webhookUrl,  setWebhookUrl]  = useState('https://api.arkatecnologia.com.br/webhook/v1/whatsapp');

  return (
    <div className="fade-in space-y-6">
      <Header titulo="Integração WhatsApp API" subtitulo="Gerencie a conexão oficial via WhatsApp Web, webhooks e sincronização de dados." />

      <div className="glass-panel p-6 rounded-2xl border border-[#2A3040] flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${conectado ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'}`}>
            <MessageCircle size={24} />
          </div>
          <div>
            <div className="font-bold text-base text-white flex items-center gap-2 font-display">
              Instância: {instancia}
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${conectado ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                {conectado ? 'ONLINE' : 'DESCONECTADO'}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">WebSocket API Estável • 99.9% Uptime</p>
          </div>
        </div>
        <button
          onClick={() => setConectado(!conectado)}
          className={`px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-2 transition-all ${
            conectado ? 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 border border-rose-500/30' : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-md shadow-emerald-500/20'
          }`}
        >
          <Power size={15} /> {conectado ? 'Desconectar WhatsApp' : 'Reconectar WhatsApp'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="glass-panel p-6 rounded-2xl border border-[#2A3040] text-center flex flex-col items-center justify-center">
          <h3 className="font-bold text-sm text-white font-display mb-1">QR Code de Autenticação</h3>
          <p className="text-xs text-slate-400 mb-4">Escaneie no app do WhatsApp: Dispositivos Conectados</p>
          <div className="p-4 bg-white rounded-2xl shadow-lg mb-4 inline-block">
            <QrCode size={160} className="text-slate-950" />
          </div>
          <EmojiIcon name="check" label="WhatsApp Pareado & Sincronizado" size="sm" />
        </div>

        <div className="glass-panel p-6 rounded-2xl border border-[#2A3040] space-y-4">
          <h3 className="font-bold text-sm text-white font-display">Configurações de Webhook</h3>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5 font-medium">URL do Webhook (Recebimento)</label>
            <input value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)}
              className="w-full bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-orange-500/50" />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5 font-medium">Instância Ativa</label>
            <input value={instancia} onChange={e => setInstancia(e.target.value)}
              className="w-full bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-orange-500/50" />
          </div>
          <div className="p-3 rounded-xl bg-[#1E2330] border border-slate-800 text-xs text-slate-400 flex items-center gap-2">
            <EmojiIcon name="lock" label="" size="sm" />
            <span>Validação de CNPJ Arka Tecnologia habilitada.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── EquipeView ────────────────────────────────────────────────────────────────
function EquipeView({ equipe, setEquipe }) {
  const [nome,  setNome]  = useState('');
  const [cargo, setCargo] = useState('');

  function adicionar() {
    if (!nome.trim()) return;
    setEquipe([...equipe, { id: 'e' + Date.now(), nome: nome.trim(), cargo: cargo.trim() || 'Atendimento', status: 'offline' }]);
    setNome(''); setCargo('');
  }
  function remover(id)         { setEquipe(equipe.filter(e => e.id !== id)); }
  function alternarStatus(id)  { setEquipe(equipe.map(e => e.id === id ? { ...e, status: e.status === 'online' ? 'offline' : 'online' } : e)); }

  return (
    <div className="fade-in space-y-6">
      <Header titulo="Gestão da Equipe de Atendimento" subtitulo="Gerencie os operadores e atendentes autorizados da Arka Tecnologia." />
      <div className="flex flex-wrap gap-2.5">
        <input value={nome}  onChange={e => setNome(e.target.value)}  placeholder="Nome do atendente"       className="flex-1 min-w-[200px] bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50" />
        <input value={cargo} onChange={e => setCargo(e.target.value)} placeholder="Cargo (ex: Suporte N2)"  className="flex-1 min-w-[200px] bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50" />
        <button onClick={adicionar} className="px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 shadow-md shadow-orange-500/20 transition-all">
          <Plus size={15} /> Adicionar Atendente
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {equipe.map(e => (
          <div key={e.id} className="glass-panel p-4 rounded-2xl border border-[#2A3040] space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-orange-500/15 text-orange-400 font-bold text-sm flex items-center justify-center border border-orange-500/30">
                {e.nome.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-xs text-white truncate">{e.nome}</div>
                <div className="text-[11px] text-slate-400 truncate">{e.cargo}</div>
              </div>
              <button onClick={() => remover(e.id)} className="text-rose-400 hover:bg-slate-800 p-1.5 rounded-lg"><Trash2 size={13} /></button>
            </div>
            <button
              onClick={() => alternarStatus(e.id)}
              className={`w-full py-2 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                e.status === 'online' ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400' : 'bg-slate-800 border-slate-700 text-slate-400'
              }`}
            >
              <Circle size={8} fill="currentColor" /> {e.status === 'online' ? 'Online' : 'Offline'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── ParceirosView ─────────────────────────────────────────────────────────────
function ParceirosView({ parceiros, setParceiros }) {
  const [cnpjInput, setCnpjInput] = useState('');
  const [nome,      setNome]      = useState('');
  const [erro,      setErro]      = useState('');
  const [busca,     setBusca]     = useState('');

  function adicionar() {
    const c = limparCnpj(cnpjInput);
    if (!cnpjValido(c)) { setErro('CNPJ inválido — confira os números.'); return; }
    if (!nome.trim())   { setErro('Informe a razão social.'); return; }
    setErro('');
    setParceiros([...parceiros.filter(p => p.cnpj !== c), { cnpj: c, razaoSocial: nome.trim(), status: 'ativo' }]);
    setCnpjInput(''); setNome('');
  }
  function remover(c)         { setParceiros(parceiros.filter(p => p.cnpj !== c)); }
  function alternarStatus(c)  { setParceiros(parceiros.map(p => p.cnpj === c ? { ...p, status: p.status === 'ativo' ? 'inativo' : 'ativo' } : p)); }

  const filtrados = parceiros.filter(p =>
    p.razaoSocial.toLowerCase().includes(busca.toLowerCase()) ||
    p.cnpj.includes(limparCnpj(busca))
  );

  return (
    <div className="fade-in space-y-6">
      <Header titulo="Parceiros Cadastrados (CNPJ)" subtitulo="Cadastro oficial de empresas com contrato ativo para validação automatizada." />
      <div className="glass-panel p-5 rounded-2xl border border-[#2A3040] space-y-3">
        <div className="flex flex-wrap gap-2.5">
          <input value={cnpjInput} onChange={e => { setCnpjInput(mascararCnpj(e.target.value)); setErro(''); }}
            placeholder="00.000.000/0000-00"
            className="w-48 bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2 text-xs text-white font-mono placeholder-slate-500 focus:outline-none focus:border-orange-500/50" />
          <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome da empresa"
            className="flex-1 min-w-[200px] bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50" />
          <button onClick={adicionar} className="px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 shadow-md shadow-orange-500/20 transition-all">
            <Plus size={15} /> Cadastrar Parceiro
          </button>
        </div>
        {erro && <div className="text-xs text-rose-400 font-semibold">{erro}</div>}
      </div>

      <div className="relative max-w-xs">
        <Search size={14} className="absolute left-3.5 top-3 text-slate-500" />
        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por nome ou CNPJ"
          className="w-full bg-[#161922] border border-[#2A3040] rounded-xl pl-9 pr-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50" />
      </div>

      <div className="space-y-2.5">
        {filtrados.map(p => (
          <div key={p.cnpj} className="glass-panel p-4 rounded-xl border border-[#2A3040] flex items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="font-bold text-xs text-white">{p.razaoSocial}</div>
              <div className="text-[11px] text-slate-400 font-mono mt-0.5">{mascararCnpj(p.cnpj)}</div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => alternarStatus(p.cnpj)}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                  p.status === 'ativo' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                }`}>
                {p.status === 'ativo' ? 'Ativo' : 'Inativo'}
              </button>
              <button onClick={() => remover(p.cnpj)} className="text-rose-400 hover:bg-slate-800 p-1.5 rounded-lg"><Trash2 size={13} /></button>
            </div>
          </div>
        ))}
        {filtrados.length === 0 && <div className="text-xs text-slate-400">Nenhum parceiro encontrado.</div>}
      </div>
    </div>
  );
}
