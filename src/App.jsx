import React, { useState, useEffect, useRef } from 'react';
import {
  LayoutGrid, Users, Zap, MessageSquare, ShieldCheck, Plus, Trash2, Circle,
  Send, Search, CheckCircle2, XCircle, AlertTriangle, Sparkles, Power, Loader2,
  Eye, QrCode, GitFork, ArrowRight, Clock, RefreshCw, Smartphone, Play, Settings,
  ChevronRight, Check, MessageCircle, X, ExternalLink, UserCheck, HelpCircle, FileText
} from 'lucide-react';

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
  { id: 'e1', nome: 'Marina Souza', cargo: 'Atendimento', status: 'online' },
  { id: 'e2', nome: 'Diego Alves', cargo: 'Suporte técnico', status: 'offline' },
  { id: 'e3', nome: 'Bruna Lima', cargo: 'Comercial', status: 'online' },
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
    statusAtendimento: 'aguardando', // 'aguardando' | 'em_atendimento' | 'finalizado'
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

const T = {
  bg: '#0F1115', sidebar: '#0B0D11', panel: '#171A21', panelAlt: '#1D2129', border: '#282D38',
  text: '#EBEDF2', muted: '#8A93A6', accent: '#FF7A29', accentSoft: 'rgba(255,122,41,0.14)',
  verde: '#33C481', verdeBg: 'rgba(51,196,129,0.12)', vermelho: '#F0555F', vermelhoBg: 'rgba(240,85,95,0.12)',
  azul: '#5B8CFF', azulBg: 'rgba(91,140,255,0.12)', roxo: '#9B51E0', roxoBg: 'rgba(155,81,224,0.14)',
  amarelo: '#F59E0B', amareloBg: 'rgba(245,158,11,0.14)'
};

const NAV = [
  { id: 'dashboard', label: 'Visão geral', icon: LayoutGrid },
  { id: 'atendimento', label: 'Atendimento', icon: MessageSquare },
  { id: 'automacoes', label: 'Fluxo de automações', icon: GitFork },
  { id: 'whatsapp', label: 'Integração WhatsApp', icon: MessageCircle },
  { id: 'equipe', label: 'Equipe', icon: Users },
  { id: 'parceiros', label: 'Parceiros (CNPJ)', icon: ShieldCheck },
];

function ArkaLogo({ size = 36, style = {} }) {
  return (
    <img
      src="/arka_tecnologia_logo-removebg-preview.png"
      alt="Logo Arka Tecnologia"
      style={{
        height: size,
        width: 'auto',
        maxHeight: size,
        objectFit: 'contain',
        filter: 'brightness(0) invert(1)',
        flexShrink: 0,
        ...style,
      }}
    />
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
    <div style={{ minHeight: '100vh', background: T.bg, color: T.text, fontFamily: "'Poppins', sans-serif", display: 'flex' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400&family=JetBrains+Mono:wght@500&display=swap');
        * { box-sizing: border-box; font-family: 'Poppins', sans-serif !important; }
        body { margin: 0; font-family: 'Poppins', sans-serif; }
        input::placeholder, textarea::placeholder { color: #5C6478; }
        .spin { animation: spin 0.9s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity:0; transform: translateY(6px);} to { opacity:1; transform: translateY(0);} }
        .fade-in { animation: fadeIn 0.3s ease both; }
        ::-webkit-scrollbar { width: 8px; } ::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 8px; }
        .navitem:hover { background: ${T.panelAlt} !important; }
        .btn-primary:hover { filter: brightness(1.08); }
        .pulse { animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .4; } }
        @media (max-width: 900px) { .sidebar-label { display:none; } .sidebar { width: 62px !important; } }
      `}</style>

      {carregando ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: T.muted }}>
          <Loader2 size={16} className="spin" /> Carregando painel Arka Tecnologia...
        </div>
      ) : (
        <>
          <Sidebar aba={aba} setAba={setAba} whatsAppConectado={whatsAppConectado} conversas={conversas} />
          <main style={{ flex: 1, minWidth: 0, padding: 24, overflowY: 'auto', height: '100vh' }}>
            {aba === 'dashboard' && <Dashboard equipe={equipe} fluxos={fluxos} parceiros={parceiros} conversas={conversas} setAba={setAba} />}
            {aba === 'atendimento' && <AtendimentoView conversas={conversas} setConversas={atualizarConversas} fluxos={fluxos} parceiros={parceiros} />}
            {aba === 'automacoes' && <FluxoBuilderView fluxos={fluxos} setFluxos={atualizarFluxos} equipe={equipe} />}
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
    <aside className="sidebar" style={{ width: 240, flexShrink: 0, background: T.sidebar, borderRight: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column', padding: '18px 12px', height: '100vh' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '4px 8px 20px' }}>
        <ArkaLogo size={38} />
        <div className="sidebar-label">
          <div style={{ fontWeight: 700, fontSize: 15, color: T.text, lineHeight: 1.15, letterSpacing: '-0.01em' }}>Arka Tecnologia</div>
          <div style={{ fontSize: 10.5, color: T.muted, marginTop: 2, fontWeight: 400 }}>Painel de atendimento</div>
        </div>
      </div>

      <div
        onClick={() => setAba('whatsapp')}
        style={{
          margin: '0 4px 16px', padding: '8px 10px', borderRadius: 9, cursor: 'pointer',
          background: whatsAppConectado ? T.verdeBg : T.vermelhoBg,
          border: `1px solid ${whatsAppConectado ? T.verde + '44' : T.vermelho + '44'}`,
          display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, fontWeight: 600,
          color: whatsAppConectado ? T.verde : T.vermelho
        }}
        className="sidebar-label"
      >
        <span className="pulse" style={{ width: 8, height: 8, borderRadius: '50%', background: 'currentColor' }} />
        <span>{whatsAppConectado ? 'WhatsApp Conectado' : 'WhatsApp Desconectado'}</span>
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {NAV.map((item) => {
          const Icon = item.icon;
          const ativo = aba === item.id;
          return (
            <button
              key={item.id}
              className="navitem"
              onClick={() => setAba(item.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: 9,
                border: 'none', cursor: 'pointer', textAlign: 'left',
                background: ativo ? T.accentSoft : 'transparent', color: ativo ? T.accent : T.text,
                fontSize: 13, fontWeight: ativo ? 600 : 500, justifyContent: 'space-between'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Icon size={15} style={{ flexShrink: 0 }} />
                <span className="sidebar-label">{item.label}</span>
              </div>
              {item.id === 'atendimento' && naFila > 0 && (
                <span style={{
                  padding: '2px 7px', borderRadius: 999, background: T.accent, color: '#0F1115',
                  fontSize: 10.5, fontWeight: 700
                }}>
                  {naFila}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div style={{ marginTop: 'auto', padding: 12, borderRadius: 10, background: T.panelAlt, fontSize: 11, color: T.muted, display: 'flex', alignItems: 'center', gap: 8 }} className="sidebar-label">
        <ArkaLogo size={18} />
        <span>Ferramenta própria da <strong>Arka Tecnologia</strong></span>
      </div>
    </aside>
  );
}

function Header({ titulo, subtitulo }) {
  return (
    <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>{titulo}</h1>
        <p style={{ color: T.muted, fontSize: 13, margin: '4px 0 0', fontWeight: 400 }}>{subtitulo}</p>
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 9, padding: '8px 14px', borderRadius: 10,
        background: T.panel, border: `1px solid ${T.border}`, boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
      }}>
        <ArkaLogo size={24} />
        <span style={{ fontWeight: 600, fontSize: 13.5, color: T.text, letterSpacing: '-0.01em' }}>
          Arka Tecnologia
        </span>
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
    { label: 'Conversas na Fila de Espera', valor: aguardandoFila, icon: MessageSquare, cor: T.accent, acao: () => setAba('atendimento') },
    { label: 'Em Atendimento Humano', valor: emAtendimento, icon: UserCheck, cor: T.azul, acao: () => setAba('atendimento') },
    { label: 'Parceiros Validados no Chat', valor: parceirosValidados, icon: ShieldCheck, cor: T.verde, acao: () => setAba('parceiros') },
    { label: 'Equipe Ativa Online', valor: `${online}/${equipe.length}`, icon: Users, cor: T.roxo, acao: () => setAba('equipe') },
  ];

  return (
    <div className="fade-in">
      <Header titulo="Visão geral de Atendimentos" subtitulo="Fila de entrada de clientes WhatsApp, atendimentos ativos e validação de CNPJ da Arka Tecnologia." />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 24 }}>
        {cards.map((c) => (
          <div
            key={c.label}
            onClick={c.acao}
            style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 13, padding: 16, cursor: 'pointer', transition: 'transform 0.15s ease' }}
          >
            <c.icon size={16} color={c.cor} />
            <div style={{ fontSize: 24, fontWeight: 700, marginTop: 10 }}>{c.valor}</div>
            <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>{c.label}</div>
          </div>
        ))}
      </div>

      <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 13, padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 13.5 }}>Fila de Espera Recente (Aguardando Atendimento)</div>
          <button onClick={() => setAba('atendimento')} style={{ ...btnPrimary, padding: '5px 10px', fontSize: 11.5 }}>
            Ir para Fila de Atendimento <ArrowRight size={12} />
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {conversas.filter((c) => c.statusAtendimento === 'aguardando').map((c) => (
            <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: T.panelAlt, borderRadius: 9, fontSize: 12.5 }}>
              <div>
                <div style={{ fontWeight: 600 }}>{c.cliente}</div>
                <div style={{ fontSize: 11, color: T.muted }}>Tel: {c.telefone || '+55 11 99999-0000'}</div>
              </div>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: T.amarelo, fontWeight: 600, fontSize: 11, background: T.amareloBg, padding: '4px 9px', borderRadius: 999 }}>
                <Clock size={12} /> Aguardando Atendimento
              </span>
            </div>
          ))}
          {conversas.filter((c) => c.statusAtendimento === 'aguardando').length === 0 && (
            <div style={{ fontSize: 12, color: T.muted, textAlign: 'center', padding: 12 }}>
              Nenhuma conversa aguardando na fila de espera.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AtendimentoView({ conversas, setConversas, fluxos, parceiros }) {
  const [tabFila, setTabFila] = useState('aguardando'); // 'aguardando' | 'em_atendimento'
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
    const nova = conversas.map((c) =>
      c.id === id ? { ...c, statusAtendimento: 'em_atendimento' } : c
    );
    setConversas(nova);
    setTabFila('em_atendimento');
    setSelecionada(id);
  }

  function finalizarAtendimento(id) {
    if (!window.confirm('Deseja finalizar este atendimento?')) return;
    const nova = conversas.map((c) =>
      c.id === id ? { ...c, statusAtendimento: 'finalizado' } : c
    );
    setConversas(nova);
    setSelecionada(null);
  }

  function apagarChat(id, e) {
    if (e) e.stopPropagation();
    if (!window.confirm('Deseja realmente apagar este chat de atendimento? Esta ação não pode ser desfeita.')) return;
    const nova = conversas.filter((c) => c.id !== id);
    setConversas(nova);
    if (selecionada === id) {
      setSelecionada(null);
    }
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

  function simularNovoAtendimento() {
    const novoId = 'c' + Date.now();
    const nomes = ['Carlos Mendes (Tech Solutions)', 'Luciana Rocha', 'Fernando Prado (Grupo Alfa)', 'Mariana Costa'];
    const nomeAleatorio = nomes[Math.floor(Math.random() * nomes.length)];
    const novoChat = {
      id: novoId,
      cliente: nomeAleatorio,
      telefone: '+55 11 9' + Math.floor(10000000 + Math.random() * 90000000),
      statusAtendimento: 'aguardando',
      cnpj: null,
      cnpjVerificado: false,
      mensagens: [
        { de: 'cliente', texto: 'Olá Arka Tecnologia! Gostaria de um orçamento para a minha empresa.', hora: horaAgora() }
      ]
    };
    setConversas([novoChat, ...conversas]);
    setTabFila('aguardando');
  }

  function simularClienteEnvioCNPJ() {
    if (!conversa) return;
    const cnpjTeste = '11222333000181';
    const parceiroEncontrado = parceiros.find((p) => p.cnpj === cnpjTeste && p.status === 'ativo');

    const nova = conversas.map((c) =>
      c.id === conversa.id
        ? {
          ...c,
          cnpj: cnpjTeste,
          cnpjVerificado: true,
          mensagens: [
            ...c.mensagens,
            { de: 'cliente', texto: `Meu CNPJ é ${mascararCnpj(cnpjTeste)}`, hora: horaAgora() },
            { de: 'equipe', texto: `[🤖 Automação Arka]: ✅ CNPJ ${mascararCnpj(cnpjTeste)} identificado e validado! Razão Social: ${parceiroEncontrado?.razaoSocial || 'Empresa Exemplo LTDA'} (Parceiro Cadastrado).`, hora: horaAgora() }
          ]
        }
        : c
    );
    setConversas(nova);
  }

  const fluxoSugerido = conversa
    ? fluxos.find((f) => f.ativo && conversa.mensagens.some((m) => m.de === 'cliente' && m.texto.toLowerCase().includes(f.gatilho)))
    : null;

  function executarFluxoCompleto(fluxo) {
    if (!conversa || !fluxo) return;
    const msgsBot = fluxo.passos
      .filter((p) => p.tipo === 'mensagem' || p.tipo === 'acao')
      .map((p) => ({ de: 'equipe', texto: `[🤖 ${p.titulo}]: ${p.desc || p.texto}`, hora: horaAgora() }));

    const nova = conversas.map((c) =>
      c.id === conversa.id
        ? { ...c, mensagens: [...c.mensagens, ...msgsBot] }
        : c
    );
    setConversas(nova);
  }

  const qtdAguardando = conversas.filter((c) => c.statusAtendimento === 'aguardando').length;
  const qtdEmAtendimento = conversas.filter((c) => c.statusAtendimento === 'em_atendimento').length;

  return (
    <div className="fade-in" style={{ height: '100%' }}>
      <div style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <Header titulo="Central de Atendimentos" subtitulo="Assuma conversas da fila de espera, consulte CNPJ sob demanda e automatize respostas." />

      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 14, height: 'calc(100vh - 150px)' }}>

        <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', background: T.panelAlt, borderBottom: `1px solid ${T.border}` }}>
            <button
              onClick={() => setTabFila('aguardando')}
              style={{
                padding: '12px 6px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                background: tabFila === 'aguardando' ? T.panel : 'transparent',
                color: tabFila === 'aguardando' ? T.accent : T.muted,
                borderBottom: tabFila === 'aguardando' ? `2px solid ${T.accent}` : '2px solid transparent'
              }}
            >
              📥 Fila ({qtdAguardando})
            </button>
            <button
              onClick={() => setTabFila('em_atendimento')}
              style={{
                padding: '12px 6px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                background: tabFila === 'em_atendimento' ? T.panel : 'transparent',
                color: tabFila === 'em_atendimento' ? T.verde : T.muted,
                borderBottom: tabFila === 'em_atendimento' ? `2px solid ${T.verde}` : '2px solid transparent'
              }}
            >
              💬 Em Atendimento ({qtdEmAtendimento})
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {conversasFiltradas.map((c) => {
              const ehAtivo = selecionada === c.id && c.statusAtendimento === 'em_atendimento';
              const ultimaMsg = c.mensagens[c.mensagens.length - 1];

              return (
                <div
                  key={c.id}
                  onClick={() => {
                    if (c.statusAtendimento === 'em_atendimento') setSelecionada(c.id);
                  }}
                  style={{
                    borderRadius: 10, padding: '11px 12px',
                    background: ehAtivo ? T.panelAlt : 'rgba(255,255,255,0.02)',
                    border: `1px solid ${ehAtivo ? T.accent + '66' : T.border}`,
                    cursor: c.statusAtendimento === 'em_atendimento' ? 'pointer' : 'default',
                    display: 'flex', flexDirection: 'column', gap: 6, position: 'relative'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>
                      {c.cliente}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); setEspiandoChat(c); }}
                        title="Espiar mensagem sem abrir"
                        style={{ ...iconBtn, width: 26, height: 26, background: T.panel }}
                      >
                        <Eye size={12} color={T.azul} />
                      </button>
                      <button
                        onClick={(e) => apagarChat(c.id, e)}
                        title="Apagar chat"
                        style={{ ...iconBtn, width: 26, height: 26, background: T.panel }}
                      >
                        <Trash2 size={12} color={T.vermelho} />
                      </button>
                    </div>
                  </div>

                  <div style={{ fontSize: 11, color: T.muted }}>
                    Tel: {c.telefone || '+55 11 99999-0000'}
                  </div>

                  <div style={{ fontSize: 10.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                    {c.cnpjVerificado ? (
                      c.cnpj && parceiros.some((p) => p.cnpj === limparCnpj(c.cnpj) && p.status === 'ativo') ? (
                        <span style={{ color: T.verde }}>✅ Parceiro: {mascararCnpj(c.cnpj)}</span>
                      ) : (
                        <span style={{ color: T.vermelho }}>⚠️ Cliente Avulso ({mascararCnpj(c.cnpj)})</span>
                      )
                    ) : (
                      <span style={{ color: T.muted, opacity: 0.8 }}>❓ CNPJ não informado</span>
                    )}
                  </div>

                  <div style={{ fontSize: 11.5, color: T.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', background: T.panel, padding: '4px 8px', borderRadius: 6 }}>
                    {ultimaMsg ? `💬 ${ultimaMsg.texto}` : 'Sem mensagens'}
                  </div>

                  {c.statusAtendimento === 'aguardando' && (
                    <button
                      onClick={(e) => atenderConversa(c.id, e)}
                      style={{
                        marginTop: 4, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        padding: '8px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
                        background: T.verde, color: '#0F1115', fontSize: 12, fontWeight: 700,
                        boxShadow: '0 2px 8px rgba(51,196,129,0.3)'
                      }}
                    >
                      <UserCheck size={14} /> ATENDER CONVERSA AGORA
                    </button>
                  )}
                </div>
              );
            })}

            {conversasFiltradas.length === 0 && (
              <div style={{ padding: 24, textAlign: 'center', color: T.muted, fontSize: 12 }}>
                {tabFila === 'aguardando' ? 'Nenhuma conversa na fila de espera.' : 'Você não possui atendimentos ativos no momento.'}
              </div>
            )}
          </div>
        </div>

        {/* Coluna Direita: Janela de Atendimento Ativo */}
        <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {!conversa || conversa.statusAtendimento !== 'em_atendimento' ? (
            <div style={{ margin: 'auto', color: T.muted, fontSize: 13, textAlign: 'center', maxWidth: 360, padding: 20 }}>
              <MessageSquare size={42} color={T.accent} style={{ marginBottom: 12, opacity: 0.6 }} />
              <div style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 6 }}>Nenhum atendimento selecionado</div>
              <p style={{ margin: 0, fontSize: 12, color: T.muted }}>
                Vá até a <strong>Fila de Espera</strong> na coluna ao lado e clique no botão <strong>"ATENDER CONVERSA AGORA"</strong> para abrir a visualização direta de mensagens.
              </p>
            </div>
          ) : (
            <>
              <div style={{ padding: '12px 16px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: T.panelAlt }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {conversa.cliente}
                    <span style={{ fontSize: 11, fontWeight: 500, color: T.muted }}>({conversa.telefone})</span>
                  </div>

                  <div style={{ fontSize: 11, marginTop: 3 }}>
                    {!conversa.cnpjVerificado ? (
                      <span style={{ color: T.amarelo, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                        <HelpCircle size={13} /> CNPJ ainda não informado pelo cliente
                      </span>
                    ) : ehParceiro ? (
                      <span style={{ color: T.verde, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                        <CheckCircle2 size={13} /> Parceiro Cadastrado: {parceiroCadastrado?.razaoSocial} ({mascararCnpj(conversa.cnpj)})
                      </span>
                    ) : (
                      <span style={{ color: T.vermelho, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                        <AlertTriangle size={13} /> CNPJ {mascararCnpj(conversa.cnpj)} (Sem Contrato Parceiro)
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {!conversa.cnpjVerificado && (
                    <>
                      <button onClick={solicitarCnpjBot} style={{ ...btnPrimary, background: T.accentSoft, color: T.accent, padding: '6px 10px', fontSize: 11 }}>
                        🤖 Bot: Pedir CNPJ
                      </button>
                      <button onClick={() => setModalCnpj(true)} style={{ ...btnPrimary, background: T.azulBg, color: T.azul, padding: '6px 10px', fontSize: 11 }}>
                        🔎 Validar CNPJ
                      </button>
                    </>
                  )}

                  <button onClick={() => finalizarAtendimento(conversa.id)} style={{ ...btnPrimary, background: T.verdeBg, color: T.verde, padding: '6px 10px', fontSize: 11 }}>
                    <Check size={13} /> Concluir
                  </button>
                  <button onClick={() => apagarChat(conversa.id)} style={{ ...btnPrimary, background: T.vermelhoBg, color: T.vermelho, padding: '6px 10px', fontSize: 11 }}>
                    <Trash2 size={13} /> Apagar
                  </button>
                </div>
              </div>

              <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
                {conversa.mensagens.map((m, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: m.de === 'cliente' ? 'flex-start' : 'flex-end', marginBottom: 12 }}>
                    <div style={{
                      maxWidth: '78%', padding: '10px 14px', borderRadius: m.de === 'cliente' ? '4px 14px 14px 14px' : '14px 4px 14px 14px',
                      background: m.de === 'cliente' ? T.panelAlt : T.accent, color: m.de === 'cliente' ? T.text : '#0F1115', fontSize: 13,
                      boxShadow: '0 2px 6px rgba(0,0,0,0.15)'
                    }}>
                      <div style={{ fontSize: 10, opacity: 0.7, marginBottom: 3, fontWeight: 600 }}>
                        {m.de === 'cliente' ? conversa.cliente : 'Arka Tecnologia'}
                      </div>
                      {m.texto}
                      <div style={{ fontSize: 9.5, opacity: 0.6, marginTop: 4, textAlign: 'right' }}>{m.hora}</div>
                    </div>
                  </div>
                ))}
              </div>

              {fluxoSugerido && (
                <div style={{ margin: '0 14px 10px', background: T.accentSoft, border: `1px solid ${T.accent}55`, borderRadius: 10, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Zap size={16} color={T.accent} style={{ flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>⚡ Executar Fluxo de Automação: {fluxoSugerido.nome}</div>
                    <div style={{ fontSize: 11, color: T.muted }}>Palavra-chave "{fluxoSugerido.gatilho}" detectada na mensagem.</div>
                  </div>
                  <button onClick={() => executarFluxoCompleto(fluxoSugerido)} style={{ ...btnPrimary, padding: '6px 12px', fontSize: 11.5 }}>
                    <Play size={12} /> Disparar Fluxo
                  </button>
                </div>
              )}

              <div style={{ padding: 12, borderTop: `1px solid ${T.border}`, display: 'flex', gap: 8, background: T.panelAlt }}>
                <input
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && enviarResposta(texto)}
                  placeholder="Digite sua mensagem oficial ou insira um CNPJ para validar..."
                  style={{ ...inputStyle('100%'), flex: 1 }}
                />
                <button onClick={() => enviarResposta(texto)} style={{ ...btnPrimary, padding: '0 16px' }}><Send size={15} /></button>
              </div>
            </>
          )}
        </div>
      </div>

      {espiandoChat && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(3px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 20
        }}>
          <div className="fade-in" style={{
            background: T.panel, border: `1px solid ${T.border}`, borderRadius: 14,
            width: '100%', maxWidth: 520, maxHeight: '80vh', display: 'flex', flexDirection: 'column',
            boxShadow: '0 20px 40px rgba(0,0,0,0.5)'
          }}>
            <div style={{ padding: '14px 18px', borderBottom: `1px solid ${T.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: T.panelAlt, borderRadius: '14px 14px 0 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Eye size={16} color={T.azul} />
                <span style={{ fontWeight: 600, fontSize: 14 }}>Espiando Chat: {espiandoChat.cliente}</span>
              </div>
              <button onClick={() => setEspiandoChat(null)} style={{ ...iconBtn, width: 26, height: 26 }}><X size={14} /></button>
            </div>

            <div style={{ padding: 16, overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 11.5, color: T.muted, background: T.panelAlt, padding: '8px 12px', borderRadius: 8 }}>
                <strong>Status Atendimento:</strong> {espiandoChat.statusAtendimento === 'aguardando' ? '📥 Fila de Espera' : '💬 Em Atendimento'}<br />
                <strong>CNPJ:</strong> {espiandoChat.cnpjVerificado ? mascararCnpj(espiandoChat.cnpj) : 'Pendente de informação'}
              </div>

              {espiandoChat.mensagens.map((m, idx) => (
                <div key={idx} style={{ display: 'flex', justifyContent: m.de === 'cliente' ? 'flex-start' : 'flex-end' }}>
                  <div style={{
                    maxWidth: '85%', padding: '8px 12px', borderRadius: 8,
                    background: m.de === 'cliente' ? T.panelAlt : T.accentSoft, color: T.text, fontSize: 12.5,
                    border: `1px solid ${T.border}`
                  }}>
                    <div style={{ fontSize: 10, color: T.muted, marginBottom: 2 }}>{m.de === 'cliente' ? espiandoChat.cliente : 'Equipe'} • {m.hora}</div>
                    {m.texto}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ padding: 14, borderTop: `1px solid ${T.border}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setEspiandoChat(null)} style={{ ...btnPrimary, background: T.panelAlt, color: T.text }}>Fechar Espião</button>
              {espiandoChat.statusAtendimento === 'aguardando' ? (
                <button onClick={(e) => { atenderConversa(espiandoChat.id, e); setEspiandoChat(null); }} style={{ ...btnPrimary, background: T.verde }}>
                  <UserCheck size={14} /> ATENDER CONVERSA AGORA
                </button>
              ) : (
                <button onClick={() => { setSelecionada(espiandoChat.id); setEspiandoChat(null); }} style={btnPrimary}>
                  Abrir Atendimento <ExternalLink size={13} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {modalCnpj && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(3px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 20
        }}>
          <div className="fade-in" style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 14, width: '100%', maxWidth: 420, padding: 20 }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Validar CNPJ do Cliente</div>
            <div style={{ fontSize: 12, color: T.muted, marginBottom: 14 }}>
              Digite o CNPJ da empresa para pesquisar se é um Parceiro cadastrado com contrato ativo na Arka Tecnologia.
            </div>
            <input
              value={inputCnpjManual}
              onChange={(e) => setInputCnpjManual(mascararCnpj(e.target.value))}
              placeholder="00.000.000/0000-00"
              style={{ ...inputStyle('100%'), marginBottom: 16 }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setModalCnpj(false)} style={{ ...btnPrimary, background: T.panelAlt, color: T.text }}>Cancelar</button>
              <button onClick={validarCnpjManual} style={btnPrimary}>Validar & Cadastrar no Chat</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FluxoBuilderView({ fluxos, setFluxos, equipe }) {
  const [novoNome, setNovoNome] = useState('');
  const [novoGatilho, setNovoGatilho] = useState('');

  function criarFluxo() {
    if (!novoNome.trim() || !novoGatilho.trim()) return;
    const novo = {
      id: 'f' + Date.now(),
      nome: novoNome.trim(),
      gatilho: novoGatilho.trim().toLowerCase(),
      ativo: true,
      passos: [
        { id: 'p1', tipo: 'gatilho', titulo: 'Gatilho Recebido', desc: `Cliente digita "${novoGatilho.trim()}"` },
        { id: 'p2', tipo: 'mensagem', titulo: 'Perguntar CNPJ', desc: 'Por favor informe o CNPJ da sua empresa' },
        { id: 'p3', tipo: 'condicao', titulo: 'Validar Cadastro Parceiro', desc: 'Consulta banco de dados CNPJ Arka' },
        { id: 'p4', tipo: 'mensagem', titulo: 'Resposta Personalizada', desc: 'Olá! Como podemos te ajudar?' }
      ]
    };
    setFluxos([...fluxos, novo]);
    setNovoNome(''); setNovoGatilho('');
  }

  function alternarStatus(id) {
    setFluxos(fluxos.map((f) => (f.id === id ? { ...f, ativo: !f.ativo } : f)));
  }

  function removerFluxo(id) {
    if (!window.confirm('Deseja excluir este fluxo de automação?')) return;
    setFluxos(fluxos.filter((f) => f.id !== id));
  }

  const tipoCores = {
    gatilho: { bg: T.accentSoft, cor: T.accent, icon: Zap },
    condicao: { bg: T.roxoBg, cor: T.roxo, icon: GitFork },
    mensagem: { bg: T.azulBg, cor: T.azul, icon: MessageSquare },
    delay: { bg: 'rgba(255,255,255,0.06)', cor: T.muted, icon: Clock },
    acao: { bg: T.verdeBg, cor: T.verde, icon: CheckCircle2 },
    transferencia: { bg: T.amareloBg, cor: T.amarelo, icon: Users }
  };

  return (
    <div className="fade-in">
      <Header titulo="Fluxo de Automações & Chatbot" subtitulo="Monte fluxos sequenciais e inteligentes com solicitação e validação de CNPJ." />

      <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16, marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Criar Novo Fluxo de Resposta Automática</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Nome do Fluxo (ex: Atendimento Boleto)" style={inputStyle(260)} />
          <input value={novoGatilho} onChange={(e) => setNovoGatilho(e.target.value)} placeholder="Palavra-chave Gatilho (ex: boleto)" style={inputStyle(220)} />
          <button onClick={criarFluxo} style={btnPrimary}><Plus size={15} /> Criar Fluxo de Resposta</button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {fluxos.map((f) => (
          <div key={f.id} style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 13, padding: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, paddingBottom: 10, borderBottom: `1px solid ${T.border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ padding: '6px 12px', borderRadius: 8, background: T.accentSoft, color: T.accent, fontWeight: 600, fontSize: 12 }}>
                  ⚡ {f.gatilho}
                </div>
                <div style={{ fontSize: 14.5, fontWeight: 600 }}>{f.nome}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  onClick={() => alternarStatus(f.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 999, border: 'none', cursor: 'pointer',
                    background: f.ativo ? T.verdeBg : T.panelAlt, color: f.ativo ? T.verde : T.muted, fontSize: 11.5, fontWeight: 600
                  }}
                >
                  <Power size={13} /> {f.ativo ? 'Fluxo Ativo' : 'Pausado'}
                </button>
                <button onClick={() => removerFluxo(f.id)} style={iconBtn}><Trash2 size={13} color={T.vermelho} /></button>
              </div>
            </div>

            <div style={{ fontSize: 12, fontWeight: 600, color: T.muted, marginBottom: 10 }}>PASSO A PASSO DO FLUXO:</div>
            <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 8 }}>
              {f.passos.map((passo, idx) => {
                const cfg = tipoCores[passo.tipo] || tipoCores.mensagem;
                const IconeEtapa = cfg.icon;

                return (
                  <React.Fragment key={passo.id || idx}>
                    <div style={{
                      minWidth: 190, background: T.panelAlt, border: `1px solid ${T.border}`, borderRadius: 11, padding: 12,
                      display: 'flex', flexDirection: 'column', gap: 6, position: 'relative'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ padding: 4, borderRadius: 6, background: cfg.bg, color: cfg.cor }}>
                          <IconeEtapa size={14} />
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 600, color: cfg.cor, textTransform: 'uppercase' }}>
                          Etapa {idx + 1}
                        </span>
                      </div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 2 }}>{passo.titulo}</div>
                      <div style={{ fontSize: 11, color: T.muted }}>{passo.desc || passo.texto}</div>
                    </div>

                    {idx < f.passos.length - 1 && (
                      <div style={{ display: 'flex', alignItems: 'center', color: T.muted }}>
                        <ChevronRight size={18} />
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WhatsAppView({ conectado, setConectado, conversas }) {
  const [instancia, setInstancia] = useState('arka-wapi-oficial');
  const [webhookUrl, setWebhookUrl] = useState('https://api.arkatecnologia.com.br/webhook/v1/whatsapp');

  return (
    <div className="fade-in">
      <Header titulo="Integração WhatsApp API" subtitulo="Gerencie a conexão oficial com o WhatsApp Web, webhooks e sincronização de mensagens." />

      <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 13, padding: 18, marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12, background: conectado ? T.verdeBg : T.vermelhoBg,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <MessageCircle size={24} color={conectado ? T.verde : T.vermelho} />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              Instância: {instancia}
              <span style={{
                fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 999,
                background: conectado ? T.verdeBg : T.vermelhoBg, color: conectado ? T.verde : T.vermelho
              }}>
                {conectado ? 'ONLINE' : 'DESCONECTADO'}
              </span>
            </div>
            <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>
              API Status: Conexão WebSocket Estável • 99.9% Uptime
            </div>
          </div>
        </div>

        <button
          onClick={() => setConectado(!conectado)}
          style={{
            ...btnPrimary,
            background: conectado ? T.vermelhoBg : T.verdeBg,
            color: conectado ? T.vermelho : T.verde
          }}
        >
          <Power size={15} /> {conectado ? 'Desconectar WhatsApp' : 'Reconectar WhatsApp'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        {/* QR Code de Conexão */}
        <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 13, padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>QR Code de Autenticação</div>
          <div style={{ fontSize: 12, color: T.muted, marginBottom: 16 }}>Escaneie no app do WhatsApp: Dispositivos Conectados</div>

          <div style={{ background: '#FFF', padding: 14, borderRadius: 12, marginBottom: 14, display: 'inline-block' }}>
            <QrCode size={160} color="#0F1115" />
          </div>

          <div style={{ fontSize: 11, color: T.verde, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
            <Check size={14} /> WhatsApp Pareado & Sincronizado
          </div>
        </div>

        <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 13, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Configurações de Webhook da Arka</div>

          <div>
            <label style={{ fontSize: 11.5, color: T.muted, display: 'block', marginBottom: 4 }}>URL do Webhook (Recebimento)</label>
            <input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} style={inputStyle('100%')} />
          </div>

          <div>
            <label style={{ fontSize: 11.5, color: T.muted, display: 'block', marginBottom: 4 }}>Nome da Instância</label>
            <input value={instancia} onChange={(e) => setInstancia(e.target.value)} style={inputStyle('100%')} />
          </div>

          <div style={{ padding: 12, borderRadius: 9, background: T.panelAlt, fontSize: 11.5, color: T.muted }}>
            🔒 Validação e verificação de CNPJ da <strong>Arka Tecnologia</strong> habilitada nas mensagens do WhatsApp.
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
    <div className="fade-in">
      <Header titulo="Equipe de Atendimento" subtitulo="Gerencie os operadores e atendentes da Arka Tecnologia." />

      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do atendente" style={inputStyle(200)} />
        <input value={cargo} onChange={(e) => setCargo(e.target.value)} placeholder="Cargo (ex: Suporte técnico)" style={inputStyle(220)} />
        <button onClick={adicionar} style={btnPrimary}><Plus size={14} /> Adicionar Atendente</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
        {equipe.map((e) => (
          <div key={e.id} style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 12, padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 9, background: T.accentSoft, color: T.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
                {e.nome.charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.nome}</div>
                <div style={{ fontSize: 11.5, color: T.muted }}>{e.cargo}</div>
              </div>
              <button onClick={() => remover(e.id)} style={iconBtn}><Trash2 size={13} color={T.vermelho} /></button>
            </div>
            <button
              onClick={() => alternarStatus(e.id)}
              style={{
                marginTop: 12, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '7px 0', borderRadius: 8, border: `1px solid ${T.border}`, cursor: 'pointer',
                background: e.status === 'online' ? T.verdeBg : T.panelAlt, color: e.status === 'online' ? T.verde : T.muted, fontSize: 11.5, fontWeight: 600,
              }}
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
    <div className="fade-in">
      <Header titulo="Parceiros Cadastrados (CNPJ)" subtitulo="Cadastro oficial de parceiros com contrato ativo para validação automatizada." />

      <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 12, padding: 14, marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input value={cnpjInput} onChange={(e) => { setCnpjInput(mascararCnpj(e.target.value)); setErro(''); }} placeholder="00.000.000/0000-00" style={inputStyle(190)} />
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Razão social da empresa" style={inputStyle(260)} />
          <button onClick={adicionar} style={btnPrimary}><Plus size={14} /> Cadastrar parceiro</button>
        </div>
        {erro && <div style={{ color: T.vermelho, fontSize: 11.5, marginTop: 8 }}>{erro}</div>}
      </div>

      <div style={{ position: 'relative', marginBottom: 12, maxWidth: 320 }}>
        <Search size={13} color={T.muted} style={{ position: 'absolute', left: 10, top: 10 }} />
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome ou CNPJ" style={{ ...inputStyle('100%'), paddingLeft: 30 }} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtrados.map((p) => (
          <div key={p.cnpj} style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 11, padding: 13, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{p.razaoSocial}</div>
              <div style={{ fontSize: 11, color: T.muted, fontFamily: "'JetBrains Mono', monospace" }}>{mascararCnpj(p.cnpj)}</div>
            </div>
            <button
              onClick={() => alternarStatus(p.cnpj)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 999, border: 'none', cursor: 'pointer',
                background: p.status === 'ativo' ? T.verdeBg : T.vermelhoBg, color: p.status === 'ativo' ? T.verde : T.vermelho, fontSize: 11, fontWeight: 600,
              }}
            >
              {p.status === 'ativo' ? <CheckCircle2 size={12} /> : <XCircle size={12} />} {p.status === 'ativo' ? 'Ativo' : 'Inativo'}
            </button>
            <button onClick={() => remover(p.cnpj)} style={iconBtn}><Trash2 size={13} color={T.vermelho} /></button>
          </div>
        ))}
        {filtrados.length === 0 && <div style={{ color: T.muted, fontSize: 12.5 }}>Nenhum parceiro encontrado.</div>}
      </div>
    </div>
  );
}

function inputStyle(width) {
  return {
    width, padding: '9px 12px', borderRadius: 9, border: `1px solid ${T.border}`,
    background: T.panelAlt, color: T.text, fontSize: 12.5, outline: 'none',
  };
}
const btnPrimary = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 9, border: 'none',
  background: T.accent, color: '#0F1115', fontWeight: 600, fontSize: 12.5, cursor: 'pointer',
};
const iconBtn = {
  width: 28, height: 28, borderRadius: 8, border: `1px solid ${T.border}`, background: T.panelAlt,
  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
};
function horaAgora() {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}