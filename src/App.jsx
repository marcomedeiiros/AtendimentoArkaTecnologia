import React, { useState, useEffect, useRef } from 'react';
import {
  LayoutGrid, Users, Zap, MessageSquare, ShieldCheck, Plus, Trash2, Circle,
  Send, Search, CheckCircle2, XCircle, AlertTriangle, Sparkles, Power, Loader2,
  Eye, QrCode, GitFork, ArrowRight, Clock, RefreshCw, Smartphone, Play, Settings,
  ChevronRight, Check, MessageCircle, X, ExternalLink, UserCheck, HelpCircle, FileText, Lock
} from 'lucide-react';
import { EmojiIcon, FormattedMessage } from './components/EmojiIcon';
import { VisualFlowEditor } from './components/flow/VisualFlowEditor';

function limparCnpj(v) { return String(v || '').replace(/\D/g, ''); }
function mascararCnpj(v) {
  const c = limparCnpj(v).slice(0, 14);
  return c
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
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
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], p2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const d1 = calc(c.slice(0, 12), p1);
  const d2 = calc(c.slice(0, 12) + d1, p2);
  return c === c.slice(0, 12) + String(d1) + String(d2);
}

const temStorage = typeof window !== 'undefined' && !!window.storage;
async function carregar(chave, padrao) {
  try {
    if (temStorage) {
      const r = await window.storage.get(chave, true);
      return r ? JSON.parse(r.value) : padrao;
    }
    const raw = localStorage.getItem(chave);
    return raw ? JSON.parse(raw) : padrao;
  } catch (e) { return padrao; }
}
async function salvar(chave, valor) {
  try {
    if (temStorage) await window.storage.set(chave, JSON.stringify(valor), true);
    else localStorage.setItem(chave, JSON.stringify(valor));
    return true;
  } catch (e) { return false; }
}

const SEED_EQUIPE = [
  { id: 'e1', nome: 'Marina Souza', cargo: 'Atendimento Especializado', status: 'online' },
  { id: 'e2', nome: 'Diego Alves', cargo: 'Suporte Técnico N2', status: 'offline' },
  { id: 'e3', nome: 'Bruna Lima', cargo: 'Gerente Comercial', status: 'online' },
];

const SEED_FLUXOS = [
  {
    id: 'f1',
    nome: 'Fluxo 1: Atendimento de Orçamentos',
    gatilho: 'orçamento',
    ativo: true,
    passos: [
      { id: 'p1', tipo: 'gatilho', titulo: 'Gatilho Recebido', desc: 'Cliente digita "orçamento"' },
      { id: 'p2', tipo: 'mensagem', titulo: 'Perguntar CNPJ', desc: 'Solicita o CNPJ para consulta de cadastro' },
      { id: 'p3', tipo: 'condicao', titulo: 'Validar CNPJ do Cliente', desc: 'Verifica se possui contrato de parceiro ativo' },
      { id: 'p4', tipo: 'mensagem', titulo: 'Resposta Inicial Bot', desc: 'Olá! Sou a IA da Arka. Vou preparar seu orçamento agora mesmo.' },
      { id: 'p5', tipo: 'delay', titulo: 'Aguardar 1.5s', desc: 'Simula digitação humana' },
      { id: 'p6', tipo: 'acao', titulo: 'Desconto Automático', desc: 'Se for parceiro -> Aplica 15% de desconto automático na proposta' },
    ]
  },
  {
    id: 'f2',
    nome: 'Fluxo 2: Reenvio de 2ª Via de Boleto',
    gatilho: 'boleto',
    ativo: true,
    passos: [
      { id: 'p21', tipo: 'gatilho', titulo: 'Gatilho Recebido', desc: 'Cliente digita "boleto"' },
      { id: 'p22', tipo: 'mensagem', titulo: 'Solicitar CNPJ', desc: 'Por favor informe seu CNPJ para consultar títulos em aberto...' },
      { id: 'p23', tipo: 'delay', titulo: 'Aguardar 2.0s', desc: 'Consulta no sistema ERP Arka' },
      { id: 'p24', tipo: 'acao', titulo: 'Gerar Linha Digitável', desc: 'Envia PDF + código Pix/Boleto atualizado' }
    ]
  },
  {
    id: 'f3',
    nome: 'Fluxo 3: Consulta de Horário de Suporte',
    gatilho: 'horário',
    ativo: true,
    passos: [
      { id: 'p31', tipo: 'gatilho', titulo: 'Gatilho Recebido', desc: 'Cliente digita "horário"' },
      { id: 'p32', tipo: 'mensagem', titulo: 'Informa Horário', desc: 'Nosso atendimento funciona de segunda a sexta, das 8h às 18h.' }
    ]
  }
];

const SEED_PARCEIROS = [
  { cnpj: '11222333000181', razaoSocial: 'Empresa Exemplo LTDA', status: 'ativo' },
  { cnpj: '00000000000191', razaoSocial: 'Banco do Brasil SA', status: 'ativo' },
];

const SEED_CONVERSAS = [
  {
    id: 'c1',
    cliente: 'João Pereira',
    telefone: '+55 11 98765-4321',
    statusAtendimento: 'aguardando',
    cnpj: null,
    cnpjVerificado: false,
    mensagens: [
      { de: 'cliente', texto: 'Oi, boa tarde! Gostaria de um orçamento para a minha empresa.', hora: '09:12' }
    ],
  },
  {
    id: 'c2',
    cliente: 'Ricardo Nunes',
    telefone: '+55 21 99123-8877',
    statusAtendimento: 'aguardando',
    cnpj: null,
    cnpjVerificado: false,
    mensagens: [
      { de: 'cliente', texto: 'Preciso da 2ª via do boleto por favor.', hora: '09:40' }
    ],
  },
  {
    id: 'c3',
    cliente: 'Beatriz Santos (Empresa Exemplo LTDA)',
    telefone: '+55 31 98877-1122',
    statusAtendimento: 'em_atendimento',
    cnpj: '11222333000181',
    cnpjVerificado: true,
    mensagens: [
      { de: 'cliente', texto: 'Olá, solicito atendimento para renovação contratual.' },
      { de: 'equipe', texto: '[🤖 Automação Arka]: Por favor, informe o CNPJ da empresa para consulta.' },
      { de: 'cliente', texto: 'Meu CNPJ é 11.222.333/0001-81' },
      { de: 'equipe', texto: '✅ CNPJ 11.222.333/0001-81 validado! Empresa Exemplo LTDA — Parceiro Cadastrado.' }
    ],
  }
];

const NAV = [
  { id: 'dashboard', label: 'Visão geral', icon: LayoutGrid },
  { id: 'atendimento', label: 'Central de Atendimento', icon: MessageSquare },
  { id: 'automacoes', label: 'Fluxo de Automações', icon: GitFork },
  { id: 'whatsapp', label: 'Integração WhatsApp', icon: MessageCircle },
  { id: 'equipe', label: 'Gestão da Equipe', icon: Users },
  { id: 'parceiros', label: 'Parceiros (CNPJ)', icon: ShieldCheck },
];

function ArkaLogo({ size = 36, className = "" }) {
  return (
    <div className={`relative flex items-center justify-center shrink-0 ${className}`}>
      <img
        src="/arka_tecnologia_logo-removebg-preview.png"
        alt="Logo Arka Tecnologia"
        style={{
          height: size,
          width: 'auto',
          maxHeight: size,
          objectFit: 'contain',
          filter: 'brightness(0) invert(1)',
        }}
      />
    </div>
  );
}

export default function App() {
  const [aba, setAba] = useState('dashboard');
  const [carregando, setCarregando] = useState(true);
  const [equipe, setEquipe] = useState([]);
  const [fluxos, setFluxos] = useState([]);
  const [parceiros, setParceiros] = useState([]);
  const [conversas, setConversas] = useState([]);
  const [whatsAppConectado, setWhatsAppConectado] = useState(true);

  useEffect(() => {
    (async () => {
      const [eq, fl, pa, co] = await Promise.all([
        carregar('arka:equipe', null),
        carregar('arka:fluxos', null),
        carregar('arka:parceiros', null),
        carregar('arka:conversas', null),
      ]);
      const eqF = eq || SEED_EQUIPE, flF = fl || SEED_FLUXOS, paF = pa || SEED_PARCEIROS, coF = co || SEED_CONVERSAS;
      if (!eq) salvar('arka:equipe', eqF);
      if (!fl) salvar('arka:fluxos', flF);
      if (!pa) salvar('arka:parceiros', paF);
      if (!co) salvar('arka:conversas', coF);
      setEquipe(eqF); setFluxos(flF); setParceiros(paF); setConversas(coF);
      setCarregando(false);
    })();
  }, []);

  async function atualizarEquipe(nova) { setEquipe(nova); await salvar('arka:equipe', nova); }
  async function atualizarFluxos(novo) { setFluxos(novo); await salvar('arka:fluxos', novo); }
  async function atualizarParceiros(nova) { setParceiros(nova); await salvar('arka:parceiros', nova); }
  async function atualizarConversas(nova) { setConversas(nova); await salvar('arka:conversas', nova); }

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
          <main className={`flex-1 min-w-0 h-screen ${aba === 'automacoes' ? 'p-0 overflow-hidden' : 'p-6 lg:p-8 overflow-y-auto'}`}>
            {aba === 'dashboard' && <Dashboard equipe={equipe} fluxos={fluxos} parceiros={parceiros} conversas={conversas} setAba={setAba} />}
            {aba === 'atendimento' && <AtendimentoView conversas={conversas} setConversas={atualizarConversas} fluxos={fluxos} parceiros={parceiros} />}
            {aba === 'automacoes' && <VisualFlowEditor fluxos={fluxos} setFluxos={atualizarFluxos} equipe={equipe} />}
            {aba === 'whatsapp' && <WhatsAppView conectado={whatsAppConectado} setConectado={setWhatsAppConectado} conversas={conversas} />}
            {aba === 'equipe' && <EquipeView equipe={equipe} setEquipe={atualizarEquipe} />}
            {aba === 'parceiros' && <ParceirosView parceiros={parceiros} setParceiros={atualizarParceiros} />}
          </main>
        </>
      )}
    </div>
  );
}

function Sidebar({ aba, setAba, whatsAppConectado, conversas }) {
  const naFila = conversas.filter((c) => c.statusAtendimento === 'aguardando').length;

  return (
    <aside className="w-64 shrink-0 bg-[#11141C] border-r border-[#2A3040] flex flex-col p-4 h-screen select-none">
      {/* Brand Header */}
      <div className="flex items-center gap-3 px-2 py-3 mb-4">
        <div className="p-2 rounded-xl bg-gradient-to-br from-orange-500/20 to-amber-500/10 border border-orange-500/30 shadow-lg shadow-orange-500/10">
          <ArkaLogo size={32} />
        </div>
        <div className="sidebar-label">
          <h1 className="font-bold text-base text-white leading-tight tracking-tight font-display">Arka Tecnologia</h1>
          <p className="text-[11px] text-slate-400 font-medium">Painel de Atendimento</p>
        </div>
      </div>

      {/* WhatsApp Status Badge */}
      <div
        onClick={() => setAba('whatsapp')}
        className={`mx-1 mb-5 p-2.5 rounded-xl cursor-pointer border transition-all duration-200 flex items-center gap-2.5 text-xs font-semibold ${
          whatsAppConectado
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
            : 'bg-rose-500/10 border-rose-500/30 text-rose-400 hover:bg-rose-500/20'
        }`}
      >
        <span className={`w-2 h-2 rounded-full ${whatsAppConectado ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
        <span className="sidebar-label">{whatsAppConectado ? 'WhatsApp Conectado' : 'WhatsApp Offline'}</span>
      </div>

      {/* Navigation Links */}
      <nav className="flex flex-col gap-1.5 flex-1">
        {NAV.map((item) => {
          const Icon = item.icon;
          const ativo = aba === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setAba(item.id)}
              className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 border ${
                ativo
                  ? 'bg-gradient-to-r from-orange-500/20 to-amber-500/10 border-orange-500/40 text-orange-400 shadow-md shadow-orange-500/5'
                  : 'bg-transparent border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon size={17} className={`shrink-0 ${ativo ? 'text-orange-400' : 'text-slate-400'}`} />
                <span className="sidebar-label">{item.label}</span>
              </div>
              {item.id === 'atendimento' && naFila > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-orange-500 text-slate-950 font-bold text-[10px] shadow-sm">
                  {naFila}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer Info */}
      <div className="mt-auto p-3 rounded-xl bg-slate-900/60 border border-slate-800/60 text-[11px] text-slate-400 flex items-center gap-2.5">
        <ArkaLogo size={18} />
        <span className="sidebar-label">Plataforma Oficial <strong className="text-slate-200 font-semibold">Arka Tecnologia</strong></span>
      </div>
    </aside>
  );
}

function Header({ titulo, subtitulo }) {
  return (
    <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight font-display">{titulo}</h1>
        <p className="text-slate-400 text-xs sm:text-sm mt-1">{subtitulo}</p>
      </div>
      <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-[#161922] border border-[#2A3040] shadow-sm self-start sm:self-auto">
        <ArkaLogo size={22} />
        <span className="font-semibold text-xs text-slate-200 font-display">Arka Tecnologia</span>
      </div>
    </div>
  );
}

function Dashboard({ equipe, fluxos, parceiros, conversas, setAba }) {
  const online = equipe.filter((e) => e.status === 'online').length;
  const aguardandoFila = conversas.filter((c) => c.statusAtendimento === 'aguardando').length;
  const emAtendimento = conversas.filter((c) => c.statusAtendimento === 'em_atendimento').length;
  const parceirosValidados = conversas.filter((c) => c.cnpjVerificado && parceiros.some((p) => p.cnpj === limparCnpj(c.cnpj) && p.status === 'ativo')).length;

  const cards = [
    { label: 'Conversas na Fila', valor: aguardandoFila, emoji: 'inbox', emojiLabel: 'Fila', acao: () => setAba('atendimento') },
    { label: 'Em Atendimento Humano', valor: emAtendimento, emoji: 'chat', emojiLabel: 'Atendimento', acao: () => setAba('atendimento') },
    { label: 'Parceiros Validados', valor: parceirosValidados, emoji: 'shield', emojiLabel: 'CNPJ Ok', acao: () => setAba('parceiros') },
    { label: 'Equipe Online', valor: `${online}/${equipe.length}`, emoji: 'user', emojiLabel: 'Equipe', acao: () => setAba('equipe') },
  ];

  return (
    <div className="fade-in space-y-6">
      <Header titulo="Visão Geral de Atendimentos" subtitulo="Painel executivo de entrada de clientes WhatsApp, atendimentos ativos e validação de CNPJ da Arka Tecnologia." />
      
      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div
            key={c.label}
            onClick={c.acao}
            className="glass-card p-5 rounded-2xl cursor-pointer group flex flex-col justify-between"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-slate-400 group-hover:text-slate-200 transition-colors">{c.label}</span>
              <EmojiIcon name={c.emoji} label={c.emojiLabel} size="sm" />
            </div>
            <div className="text-3xl font-bold text-white tracking-tight font-display group-hover:text-orange-400 transition-colors">{c.valor}</div>
          </div>
        ))}
      </div>

      {/* Queue Card */}
      <div className="glass-panel rounded-2xl p-6 border border-[#2A3040]">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <EmojiIcon name="inbox" label="Fila de Espera" size="md" />
            <h2 className="text-sm font-bold text-white font-display">Atendimentos Recentes Aguardando</h2>
          </div>
          <button 
            onClick={() => setAba('atendimento')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 text-xs font-semibold transition-all border border-orange-500/30"
          >
            Ir para Central <ArrowRight size={13} />
          </button>
        </div>

        <div className="space-y-2.5">
          {conversas.filter((c) => c.statusAtendimento === 'aguardando').map((c) => (
            <div key={c.id} className="flex items-center justify-between p-3.5 rounded-xl bg-[#1E2330]/60 border border-[#2A3040]/60 hover:border-orange-500/30 transition-all">
              <div>
                <div className="font-semibold text-xs text-white">{c.cliente}</div>
                <div className="text-[11px] text-slate-400 font-mono mt-0.5">Tel: {c.telefone || '+55 11 99999-0000'}</div>
              </div>
              <EmojiIcon name="clock" label="Aguardando Atendimento" size="sm" />
            </div>
          ))}
          {conversas.filter((c) => c.statusAtendimento === 'aguardando').length === 0 && (
            <div className="text-xs text-slate-400 text-center py-6">
              Nenhuma conversa pendente na fila no momento.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AtendimentoView({ conversas, setConversas, fluxos, parceiros }) {
  const [tabFila, setTabFila] = useState('aguardando');
  const [selecionada, setSelecionada] = useState(null);
  const [texto, setTexto] = useState('');
  const [espiandoChat, setEspiandoChat] = useState(null);
  const [modalCnpj, setModalCnpj] = useState(false);
  const [inputCnpjManual, setInputCnpjManual] = useState('');
  const scrollRef = useRef(null);

  const conversa = conversas.find((c) => c.id === selecionada);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [conversa?.mensagens?.length, selecionada]);

  const conversasFiltradas = conversas.filter((c) => c.statusAtendimento === tabFila);
  const ehParceiro = conversa && conversa.cnpjVerificado && parceiros.some((p) => p.cnpj === limparCnpj(conversa.cnpj) && p.status === 'ativo');
  const parceiroCadastrado = conversa && conversa.cnpjVerificado ? parceiros.find((p) => p.cnpj === limparCnpj(conversa.cnpj)) : null;

  function atenderConversa(id, e) {
    if (e) e.stopPropagation();
    const nova = conversas.map((c) => c.id === id ? { ...c, statusAtendimento: 'em_atendimento' } : c);
    setConversas(nova);
    setTabFila('em_atendimento');
    setSelecionada(id);
  }

  function finalizarAtendimento(id) {
    if (!window.confirm('Deseja concluir e finalizar este atendimento?')) return;
    const nova = conversas.map((c) => c.id === id ? { ...c, statusAtendimento: 'finalizado' } : c);
    setConversas(nova);
    setSelecionada(null);
  }

  function apagarChat(id, e) {
    if (e) e.stopPropagation();
    if (!window.confirm('Deseja realmente apagar este atendimento?')) return;
    const nova = conversas.filter((c) => c.id !== id);
    setConversas(nova);
    if (selecionada === id) setSelecionada(null);
  }

  function enviarResposta(txt) {
    if (!txt.trim() || !conversa) return;

    const cnpjNumeros = limparCnpj(txt);
    let conversaAtualizada = { ...conversa };

    if (cnpjNumeros.length === 14 && !conversa.cnpjVerificado) {
      const parceiroEncontrado = parceiros.find((p) => p.cnpj === cnpjNumeros && p.status === 'ativo');
      conversaAtualizada.cnpj = cnpjNumeros;
      conversaAtualizada.cnpjVerificado = true;

      const msgConfirmacao = parceiroEncontrado
        ? `✅ CNPJ ${mascararCnpj(cnpjNumeros)} validado no cadastro! Razão Social: ${parceiroEncontrado.razaoSocial} — Parceiro com Contrato Ativo.`
        : `⚠️ CNPJ ${mascararCnpj(cnpjNumeros)} consultado no sistema. Não possui contrato de parceiro ativo.`;

      conversaAtualizada.mensagens = [
        ...conversaAtualizada.mensagens,
        { de: 'equipe', texto: txt.trim(), hora: horaAgora() },
        { de: 'equipe', texto: `[🤖 Validação Automática Arka]: ${msgConfirmacao}`, hora: horaAgora() }
      ];
    } else {
      conversaAtualizada.mensagens = [
        ...conversaAtualizada.mensagens,
        { de: 'equipe', texto: txt.trim(), hora: horaAgora() }
      ];
    }

    const nova = conversas.map((c) => (c.id === conversa.id ? conversaAtualizada : c));
    setConversas(nova);
    setTexto('');
  }

  function solicitarCnpjBot() {
    if (!conversa) return;
    const txtBot = '[🤖 Arka Tecnologia]: Para prosseguirmos com seu atendimento e verificar benefícios de parceiro, por favor informe o CNPJ da sua empresa:';
    const nova = conversas.map((c) =>
      c.id === conversa.id
        ? { ...c, mensagens: [...c.mensagens, { de: 'equipe', texto: txtBot, hora: horaAgora() }] }
        : c
    );
    setConversas(nova);
  }

  function validarCnpjManual() {
    const c = limparCnpj(inputCnpjManual);
    if (!cnpjValido(c)) { alert('CNPJ inválido!'); return; }
    const parceiroEncontrado = parceiros.find((p) => p.cnpj === c && p.status === 'ativo');

    const msgBot = parceiroEncontrado
      ? `✅ CNPJ ${mascararCnpj(c)} identificado e validado! Razão Social: ${parceiroEncontrado.razaoSocial} (Parceiro Cadastrado).`
      : `⚠️ CNPJ ${mascararCnpj(c)} identificado. Não consta como parceiro cadastrado.`;

    const nova = conversas.map((item) =>
      item.id === conversa.id
        ? {
          ...item,
          cnpj: c,
          cnpjVerificado: true,
          mensagens: [...item.mensagens, { de: 'equipe', texto: `[🤖 Validação de CNPJ]: ${msgBot}`, hora: horaAgora() }]
        }
        : item
    );
    setConversas(nova);
    setInputCnpjManual('');
    setModalCnpj(false);
  }

  const fluxoSugerido = conversa
    ? fluxos.find((f) => f.ativo && conversa.mensagens.some((m) => m.de === 'cliente' && m.texto.toLowerCase().includes(f.gatilho)))
    : null;

  function executarFluxoCompleto(fluxo) {
    if (!conversa || !fluxo) return;
    const msgsBot = fluxo.passos
      .filter((p) => p.tipo === 'mensagem' || p.tipo === 'acao')
      .map((p) => ({ de: 'equipe', texto: `[🤖 ${p.titulo}]: ${p.desc || p.texto}`, hora: horaAgora() }));

    const nova = conversas.map((c) => c.id === conversa.id ? { ...c, mensagens: [...c.mensagens, ...msgsBot] } : c);
    setConversas(nova);
  }

  const qtdAguardando = conversas.filter((c) => c.statusAtendimento === 'aguardando').length;
  const qtdEmAtendimento = conversas.filter((c) => c.statusAtendimento === 'em_atendimento').length;

  return (
    <div className="fade-in space-y-4 h-full flex flex-col">
      <Header titulo="Central de Atendimentos" subtitulo="Assuma conversas da fila de espera, consulte CNPJ em tempo real e automatize respostas." />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 min-h-[550px]">
        {/* Left Column - List */}
        <div className="lg:col-span-4 glass-panel rounded-2xl flex flex-col overflow-hidden border border-[#2A3040]">
          {/* Tabs */}
          <div className="grid grid-cols-2 bg-[#1E2330]/80 border-b border-[#2A3040]">
            <button
              onClick={() => setTabFila('aguardando')}
              className={`py-3 px-2 text-xs font-bold transition-all border-b-2 flex items-center justify-center gap-1.5 ${
                tabFila === 'aguardando'
                  ? 'border-orange-500 text-orange-400 bg-[#161922]'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <EmojiIcon name="inbox" label="" size="sm" />
              <span>Fila ({qtdAguardando})</span>
            </button>
            <button
              onClick={() => setTabFila('em_atendimento')}
              className={`py-3 px-2 text-xs font-bold transition-all border-b-2 flex items-center justify-center gap-1.5 ${
                tabFila === 'em_atendimento'
                  ? 'border-emerald-500 text-emerald-400 bg-[#161922]'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <EmojiIcon name="chat" label="" size="sm" />
              <span>Ativos ({qtdEmAtendimento})</span>
            </button>
          </div>

          {/* List Content */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {conversasFiltradas.map((c) => {
              const ehAtivo = selecionada === c.id && c.statusAtendimento === 'em_atendimento';
              const ultimaMsg = c.mensagens[c.mensagens.length - 1];

              return (
                <div
                  key={c.id}
                  onClick={() => {
                    if (c.statusAtendimento === 'em_atendimento') setSelecionada(c.id);
                  }}
                  className={`p-3.5 rounded-xl border transition-all duration-200 cursor-pointer flex flex-col gap-2 ${
                    ehAtivo
                      ? 'bg-gradient-to-r from-orange-500/10 to-transparent border-orange-500/50 shadow-sm'
                      : 'bg-[#1E2330]/40 border-[#2A3040]/60 hover:border-slate-600/60'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-white">{c.cliente}</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); setEspiandoChat(c); }}
                        title="Espiar conversa"
                        className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-blue-400 transition-colors"
                      >
                        <Eye size={13} />
                      </button>
                      <button
                        onClick={(e) => apagarChat(c.id, e)}
                        title="Apagar chat"
                        className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-rose-400 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  <div className="text-[11px] text-slate-400 font-mono">Tel: {c.telefone || '+55 11 99999-0000'}</div>

                  {/* CNPJ Status */}
                  <div>
                    {c.cnpjVerificado ? (
                      c.cnpj && parceiros.some((p) => p.cnpj === limparCnpj(c.cnpj) && p.status === 'ativo') ? (
                        <EmojiIcon name="shield" label={`Parceiro: ${mascararCnpj(c.cnpj)}`} size="sm" />
                      ) : (
                        <EmojiIcon name="warning" label={`Cliente Avulso (${mascararCnpj(c.cnpj)})`} size="sm" />
                      )
                    ) : (
                      <EmojiIcon name="question" label="CNPJ Pendente" size="sm" />
                    )}
                  </div>

                  <div className="text-[11px] text-slate-300 truncate bg-[#161922] p-2 rounded-lg border border-slate-800">
                    {ultimaMsg ? ultimaMsg.texto : 'Sem mensagens'}
                  </div>

                  {c.statusAtendimento === 'aguardando' && (
                    <button
                      onClick={(e) => atenderConversa(c.id, e)}
                      className="w-full mt-1 py-2 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-emerald-500/20 transition-all"
                    >
                      <UserCheck size={14} /> ATENDER CONVERSA
                    </button>
                  )}
                </div>
              );
            })}

            {conversasFiltradas.length === 0 && (
              <div className="p-8 text-center text-slate-400 text-xs">
                {tabFila === 'aguardando' ? 'Nenhuma conversa na fila.' : 'Nenhum atendimento ativo selecionado.'}
              </div>
            )}
          </div>
        </div>

        {/* Right Column - Chat View */}
        <div className="lg:col-span-8 glass-panel rounded-2xl flex flex-col overflow-hidden border border-[#2A3040]">
          {!conversa || conversa.statusAtendimento !== 'em_atendimento' ? (
            <div className="m-auto text-center p-8 max-w-sm">
              <div className="inline-flex p-4 rounded-2xl bg-orange-500/10 border border-orange-500/20 mb-4 text-orange-400">
                <MessageSquare size={36} />
              </div>
              <h3 className="text-base font-bold text-white font-display mb-1">Nenhum Atendimento Selecionado</h3>
              <p className="text-xs text-slate-400">
                Selecione uma conversa na coluna ao lado ou clique em <strong className="text-emerald-400">"ATENDER CONVERSA"</strong> para iniciar o chat.
              </p>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="p-4 bg-[#1E2330]/80 border-b border-[#2A3040] flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-bold text-sm text-white flex items-center gap-2">
                    {conversa.cliente}
                    <span className="text-xs font-normal text-slate-400 font-mono">({conversa.telefone})</span>
                  </div>

                  <div className="mt-1">
                    {!conversa.cnpjVerificado ? (
                      <EmojiIcon name="question" label="CNPJ Pendente" size="sm" />
                    ) : ehParceiro ? (
                      <EmojiIcon name="shield" label={`Parceiro: ${parceiroCadastrado?.razaoSocial} (${mascararCnpj(conversa.cnpj)})`} size="sm" />
                    ) : (
                      <EmojiIcon name="warning" label={`CNPJ ${mascararCnpj(conversa.cnpj)} (Sem Contrato)`} size="sm" />
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {!conversa.cnpjVerificado && (
                    <>
                      <button 
                        onClick={solicitarCnpjBot}
                        className="px-2.5 py-1.5 rounded-lg bg-orange-500/15 hover:bg-orange-500/25 text-orange-400 text-xs font-semibold border border-orange-500/30 transition-all"
                      >
                        🤖 Pedir CNPJ
                      </button>
                      <button 
                        onClick={() => setModalCnpj(true)}
                        className="px-2.5 py-1.5 rounded-lg bg-blue-500/15 hover:bg-blue-500/25 text-blue-400 text-xs font-semibold border border-blue-500/30 transition-all"
                      >
                        🔎 Validar CNPJ
                      </button>
                    </>
                  )}
                  <button 
                    onClick={() => finalizarAtendimento(conversa.id)}
                    className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 text-xs font-semibold border border-emerald-500/30 transition-all flex items-center gap-1"
                  >
                    <Check size={13} /> Concluir
                  </button>
                  <button 
                    onClick={() => apagarChat(conversa.id)}
                    className="px-2.5 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 text-xs font-semibold border border-rose-500/30 transition-all"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              {/* Chat Thread */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
                {conversa.mensagens.map((m, i) => (
                  <div key={i} className={`flex ${m.de === 'cliente' ? 'justify-start' : 'justify-end'}`}>
                    <div
                      className={`max-w-[80%] p-3.5 rounded-2xl text-xs shadow-md space-y-1 ${
                        m.de === 'cliente'
                          ? 'bg-[#1E2330] text-slate-100 border border-[#2A3040] rounded-tl-xs'
                          : 'bg-gradient-to-r from-orange-500 to-amber-500 text-slate-950 font-medium rounded-tr-xs'
                      }`}
                    >
                      <div className={`text-[10px] font-semibold ${m.de === 'cliente' ? 'text-slate-400' : 'text-slate-900/80'}`}>
                        {m.de === 'cliente' ? conversa.cliente : 'Arka Tecnologia'}
                      </div>
                      <FormattedMessage text={m.texto} />
                      <div className={`text-[9px] text-right ${m.de === 'cliente' ? 'text-slate-400' : 'text-slate-900/70'}`}>{m.hora}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Automation Suggestion Banner */}
              {fluxoSugerido && (
                <div className="mx-4 mb-2 p-3 rounded-xl bg-orange-500/10 border border-orange-500/30 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <EmojiIcon name="lightning" label="" size="sm" />
                    <div>
                      <div className="text-xs font-bold text-white">Executar: {fluxoSugerido.nome}</div>
                      <div className="text-[11px] text-slate-400">Gatilho "{fluxoSugerido.gatilho}" identificado.</div>
                    </div>
                  </div>
                  <button
                    onClick={() => executarFluxoCompleto(fluxoSugerido)}
                    className="px-3 py-1.5 rounded-lg bg-orange-500 text-slate-950 text-xs font-bold flex items-center gap-1 hover:bg-orange-400 transition-colors shadow-sm"
                  >
                    <Play size={12} /> Disparar
                  </button>
                </div>
              )}

              {/* Input Bar */}
              <div className="p-3 bg-[#1E2330]/80 border-t border-[#2A3040] flex items-center gap-2">
                <input
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && enviarResposta(texto)}
                  placeholder="Digite sua mensagem oficial ou CNPJ para consultar..."
                  className="flex-1 bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50 transition-colors"
                />
                <button
                  onClick={() => enviarResposta(texto)}
                  className="p-2.5 rounded-xl bg-orange-500 hover:bg-orange-400 text-slate-950 transition-colors shadow-md shadow-orange-500/20"
                >
                  <Send size={16} />
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Espiar Modal */}
      {espiandoChat && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass-panel border border-[#2A3040] rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl fade-in">
            <div className="p-4 bg-[#1E2330] border-b border-[#2A3040] flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-sm text-white">
                <Eye className="text-blue-400" size={16} />
                Espiando Chat: {espiandoChat.cliente}
              </div>
              <button onClick={() => setEspiandoChat(null)} className="text-slate-400 hover:text-white"><X size={16} /></button>
            </div>
            <div className="p-4 max-h-96 overflow-y-auto space-y-2 text-xs">
              {espiandoChat.mensagens.map((m, idx) => (
                <div key={idx} className={`p-2.5 rounded-xl ${m.de === 'cliente' ? 'bg-[#1E2330] text-slate-200' : 'bg-orange-500/10 text-orange-200 border border-orange-500/20'}`}>
                  <div className="text-[10px] text-slate-400 mb-1">{m.de === 'cliente' ? espiandoChat.cliente : 'Arka IA'} • {m.hora}</div>
                  {m.texto}
                </div>
              ))}
            </div>
            <div className="p-4 bg-[#1E2330] border-t border-[#2A3040] flex justify-end gap-2">
              <button onClick={() => setEspiandoChat(null)} className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs font-semibold">Fechar</button>
            </div>
          </div>
        </div>
      )}

      {/* Validar CNPJ Modal */}
      {modalCnpj && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass-panel border border-[#2A3040] rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl fade-in">
            <h3 className="text-base font-bold text-white font-display">Validar CNPJ do Cliente</h3>
            <p className="text-xs text-slate-400">Insira o CNPJ para pesquisar o status do parceiro na Arka Tecnologia.</p>
            <input
              value={inputCnpjManual}
              onChange={(e) => setInputCnpjManual(mascararCnpj(e.target.value))}
              placeholder="00.000.000/0000-00"
              className="w-full bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2.5 text-xs text-white font-mono placeholder-slate-500 focus:outline-none focus:border-orange-500/50"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setModalCnpj(false)} className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs font-semibold">Cancelar</button>
              <button onClick={validarCnpjManual} className="px-4 py-1.5 rounded-lg bg-orange-500 text-slate-950 text-xs font-bold">Validar & Cadastrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



function WhatsAppView({ conectado, setConectado, conversas }) {
  const [instancia, setInstancia] = useState('arka-wapi-oficial');
  const [webhookUrl, setWebhookUrl] = useState('https://api.arkatecnologia.com.br/webhook/v1/whatsapp');

  return (
    <div className="fade-in space-y-6">
      <Header titulo="Integração WhatsApp API" subtitulo="Gerencie a conexão oficial via WhatsApp Web, webhooks e sincronização de dados." />

      {/* Connection Card */}
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
        {/* QR Code */}
        <div className="glass-panel p-6 rounded-2xl border border-[#2A3040] text-center flex flex-col items-center justify-center">
          <h3 className="font-bold text-sm text-white font-display mb-1">QR Code de Autenticação</h3>
          <p className="text-xs text-slate-400 mb-4">Escaneie no app do WhatsApp: Dispositivos Conectados</p>
          <div className="p-4 bg-white rounded-2xl shadow-lg mb-4 inline-block">
            <QrCode size={160} className="text-slate-950" />
          </div>
          <EmojiIcon name="check" label="WhatsApp Pareado & Sincronizado" size="sm" />
        </div>

        {/* Webhook Config */}
        <div className="glass-panel p-6 rounded-2xl border border-[#2A3040] space-y-4">
          <h3 className="font-bold text-sm text-white font-display">Configurações de Webhook</h3>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5 font-medium">URL do Webhook (Recebimento)</label>
            <input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} className="w-full bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2.5 text-xs text-white font-mono" />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5 font-medium">Instância Ativa</label>
            <input value={instancia} onChange={(e) => setInstancia(e.target.value)} className="w-full bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2.5 text-xs text-white" />
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

function EquipeView({ equipe, setEquipe }) {
  const [nome, setNome] = useState('');
  const [cargo, setCargo] = useState('');

  function adicionar() {
    if (!nome.trim()) return;
    setEquipe([...equipe, { id: 'e' + Date.now(), nome: nome.trim(), cargo: cargo.trim() || 'Atendimento', status: 'offline' }]);
    setNome(''); setCargo('');
  }
  function remover(id) { setEquipe(equipe.filter((e) => e.id !== id)); }
  function alternarStatus(id) {
    setEquipe(equipe.map((e) => (e.id === id ? { ...e, status: e.status === 'online' ? 'offline' : 'online' } : e)));
  }

  return (
    <div className="fade-in space-y-6">
      <Header titulo="Gestão da Equipe de Atendimento" subtitulo="Gerencie os operadores e atendentes autorizados da Arka Tecnologia." />

      <div className="flex flex-wrap gap-2.5">
        <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do atendente" className="flex-1 min-w-[200px] bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50" />
        <input value={cargo} onChange={(e) => setCargo(e.target.value)} placeholder="Cargo (ex: Suporte N2)" className="flex-1 min-w-[200px] bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50" />
        <button onClick={adicionar} className="px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 shadow-md shadow-orange-500/20 transition-all">
          <Plus size={15} /> Adicionar Atendente
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {equipe.map((e) => (
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

function ParceirosView({ parceiros, setParceiros }) {
  const [cnpjInput, setCnpjInput] = useState('');
  const [nome, setNome] = useState('');
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');

  function adicionar() {
    const c = limparCnpj(cnpjInput);
    if (!cnpjValido(c)) { setErro('CNPJ inválido — confira os números.'); return; }
    if (!nome.trim()) { setErro('Informe a razão social.'); return; }
    setErro('');
    setParceiros([...parceiros.filter((p) => p.cnpj !== c), { cnpj: c, razaoSocial: nome.trim(), status: 'ativo' }]);
    setCnpjInput(''); setNome('');
  }
  function remover(c) { setParceiros(parceiros.filter((p) => p.cnpj !== c)); }
  function alternarStatus(c) {
    setParceiros(parceiros.map((p) => (p.cnpj === c ? { ...p, status: p.status === 'ativo' ? 'inativo' : 'ativo' } : p)));
  }

  const filtrados = parceiros.filter((p) => p.razaoSocial.toLowerCase().includes(busca.toLowerCase()) || p.cnpj.includes(limparCnpj(busca)));

  return (
    <div className="fade-in space-y-6">
      <Header titulo="Parceiros Cadastrados (CNPJ)" subtitulo="Cadastro oficial de empresas com contrato ativo para validação automatizada." />

      <div className="glass-panel p-5 rounded-2xl border border-[#2A3040] space-y-3">
        <div className="flex flex-wrap gap-2.5">
          <input value={cnpjInput} onChange={(e) => { setCnpjInput(mascararCnpj(e.target.value)); setErro(''); }} placeholder="00.000.000/0000-00" className="w-48 bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2 text-xs text-white font-mono placeholder-slate-500 focus:outline-none focus:border-orange-500/50" />
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Razão Social da empresa" className="flex-1 min-w-[200px] bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50" />
          <button onClick={adicionar} className="px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 shadow-md shadow-orange-500/20 transition-all">
            <Plus size={15} /> Cadastrar Parceiro
          </button>
        </div>
        {erro && <div className="text-xs text-rose-400 font-semibold">{erro}</div>}
      </div>

      <div className="relative max-w-xs">
        <Search size={14} className="absolute left-3.5 top-3 text-slate-500" />
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por Razão Social ou CNPJ" className="w-full bg-[#161922] border border-[#2A3040] rounded-xl pl-9 pr-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50" />
      </div>

      <div className="space-y-2.5">
        {filtrados.map((p) => (
          <div key={p.cnpj} className="glass-panel p-4 rounded-xl border border-[#2A3040] flex items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="font-bold text-xs text-white">{p.razaoSocial}</div>
              <div className="text-[11px] text-slate-400 font-mono mt-0.5">{mascararCnpj(p.cnpj)}</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => alternarStatus(p.cnpj)}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                  p.status === 'ativo' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                }`}
              >
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