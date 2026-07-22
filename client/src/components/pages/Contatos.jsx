import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Users, Plus, Search, Trash2, Pencil, Save, X,
  Phone, MessageSquare, Star, StarOff, Tag, Filter,
  ChevronDown, UserCheck, Circle
} from 'lucide-react';

async function carregar(chave, padrao) {
  try { const r = localStorage.getItem(chave); return r ? JSON.parse(r) : padrao; } catch { return padrao; }
}
async function salvar(chave, valor) {
  try { localStorage.setItem(chave, JSON.stringify(valor)); } catch {}
}

function limparTel(v) { return String(v || '').replace(/\D/g, ''); }
function mascararTel(v) {
  const n = limparTel(v).slice(0, 11);
  if (n.length === 11) return n.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
  if (n.length === 10) return n.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
  return n;
}

const TAGS_CORES = {
  cliente:   'bg-blue-500/15 text-blue-400 border-blue-500/30',
  parceiro:  'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  suporte:   'bg-purple-500/15 text-purple-400 border-purple-500/30',
  vip:       'bg-amber-500/15 text-amber-400 border-amber-500/30',
  inativo:   'bg-slate-600/30 text-slate-400 border-slate-600/40',
};
const TAGS_DISPONIVEIS = Object.keys(TAGS_CORES);

const SEED_CONTATOS = [
  { id:'ct_1', nome:'João Pereira',   telefone:'11987654321', email:'joao@email.com',   empresa:'',                    tag:'cliente',  favorito: false, observacoes:'' },
  { id:'ct_2', nome:'Ricardo Nunes',  telefone:'21991238877', email:'',                empresa:'',                    tag:'cliente',  favorito: false, observacoes:'' },
  { id:'ct_3', nome:'Beatriz Santos', telefone:'31988771122', email:'beatriz@ex.com',   empresa:'Empresa Exemplo LTDA', tag:'parceiro', favorito: true,  observacoes:'Renovação contratual em andamento.' },
];

function ModalContato({ contato, onSalvar, onFechar }) {
  const [nome,    setNome]    = useState(contato?.nome       || '');
  const [tel,     setTel]     = useState(contato?.telefone   || '');
  const [email,   setEmail]   = useState(contato?.email      || '');
  const [empresa, setEmpresa] = useState(contato?.empresa    || '');
  const [tag,     setTag]     = useState(contato?.tag        || 'cliente');
  const [obs,     setObs]     = useState(contato?.observacoes|| '');

  function salvar() {
    if (!nome.trim() || limparTel(tel).length < 10) return;
    onSalvar({
      id:           contato?.id || 'ct_' + Date.now(),
      nome:         nome.trim(),
      telefone:     limparTel(tel),
      email:        email.trim(),
      empresa:      empresa.trim(),
      tag,
      favorito:     contato?.favorito || false,
      observacoes:  obs.trim(),
    });
  }

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass-panel border border-[#2A3040] rounded-2xl w-full max-w-md shadow-2xl fade-in overflow-hidden">
        <div className="p-4 bg-[#1E2330] border-b border-[#2A3040] flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-sm text-white">
            <UserCheck size={16} className="text-orange-400" />
            {contato?.id ? 'Editar Contato' : 'Novo Contato'}
          </div>
          <button onClick={onFechar} className="text-slate-400 hover:text-white transition-colors"><X size={16}/></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="text-xs text-slate-400 font-medium block mb-1">Nome *</label>
              <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome completo"
                className="w-full bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50" />
            </div>
            <div>
              <label className="text-xs text-slate-400 font-medium block mb-1">Telefone * (WhatsApp)</label>
              <input value={tel} onChange={e => setTel(e.target.value)} placeholder="(11) 98765-4321"
                className="w-full bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50 font-mono" />
            </div>
            <div>
              <label className="text-xs text-slate-400 font-medium block mb-1">E-mail</label>
              <input value={email} onChange={e => setEmail(e.target.value)} placeholder="email@empresa.com" type="email"
                className="w-full bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50" />
            </div>
            <div>
              <label className="text-xs text-slate-400 font-medium block mb-1">Empresa</label>
              <input value={empresa} onChange={e => setEmpresa(e.target.value)} placeholder="Nome da empresa"
                className="w-full bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50" />
            </div>
            <div>
              <label className="text-xs text-slate-400 font-medium block mb-1">Classificação</label>
              <select value={tag} onChange={e => setTag(e.target.value)}
                className="w-full bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-orange-500/50">
                {TAGS_DISPONIVEIS.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 font-medium block mb-1">Observações</label>
              <textarea value={obs} onChange={e => setObs(e.target.value)} rows={3} placeholder="Notas internas..."
                className="w-full bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50 resize-none" />
            </div>
          </div>
        </div>
        <div className="p-4 bg-[#1E2330] border-t border-[#2A3040] flex justify-end gap-2">
          <button onClick={onFechar} className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700 transition-colors">Cancelar</button>
          <button onClick={salvar} disabled={!nome.trim() || limparTel(tel).length < 10}
            className="px-4 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 shadow-md shadow-orange-500/20 disabled:opacity-50 transition-all">
            <Save size={13}/> Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

const CardContato = React.memo(function CardContato({ contato, onEditar, onRemover, onToggleFav, onIniciarChat }) {
  const tagCor = TAGS_CORES[contato.tag] || TAGS_CORES.inativo;
  const iniciais = contato.nome.split(' ').slice(0,2).map(p => p[0]).join('').toUpperCase();

  return (
    <div className="glass-panel p-4 rounded-2xl border border-[#2A3040] hover:border-slate-600/60 transition-all flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-orange-500/15 border border-orange-500/30 text-orange-400 font-bold text-sm flex items-center justify-center shrink-0">
            {iniciais}
          </div>
          <div className="min-w-0">
            <div className="font-bold text-xs text-white truncate">{contato.nome}</div>
            {contato.empresa && <div className="text-[10px] text-slate-400 truncate">{contato.empresa}</div>}
          </div>
        </div>
        <button onClick={() => onToggleFav(contato.id)} className="shrink-0 text-slate-500 hover:text-amber-400 transition-colors p-1">
          {contato.favorito ? <Star size={14} className="text-amber-400 fill-amber-400"/> : <StarOff size={14}/>}
        </button>
      </div>

      <div className="space-y-1">
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <Phone size={11} className="text-slate-500 shrink-0"/>
          <span className="font-mono">{mascararTel(contato.telefone)}</span>
        </div>
        {contato.email && (
          <div className="flex items-center gap-2 text-[11px] text-slate-400 truncate">
            <span className="text-slate-500 text-[10px] shrink-0">@</span>
            <span className="truncate">{contato.email}</span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${tagCor}`}>
          {contato.tag}
        </span>
        <div className="flex items-center gap-1">
          <button onClick={() => onIniciarChat(contato)} title="Iniciar atendimento"
            className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-emerald-500/20 text-emerald-400 transition-colors">
            <MessageSquare size={12}/>
          </button>
          <button onClick={() => onEditar(contato)} title="Editar"
            className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-blue-500/20 text-blue-400 transition-colors">
            <Pencil size={12}/>
          </button>
          <button onClick={() => onRemover(contato.id)} title="Remover"
            className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-rose-500/20 text-rose-400 transition-colors">
            <Trash2 size={12}/>
          </button>
        </div>
      </div>
      {contato.observacoes && (
        <p className="text-[10px] text-slate-500 italic border-t border-[#2A3040] pt-2 line-clamp-2">{contato.observacoes}</p>
      )}
    </div>
  );
});

export default function Contatos({ conversas = [], setConversas, setAba }) {
  const [contatos,     setContatos]  = useState([]);
  const [carregando,   setCarregando] = useState(true);
  const [modalAberto,  setModal]      = useState(false);
  const [editando,     setEditando]   = useState(null);
  const [busca,        setBusca]      = useState('');
  const [tagFiltro,    setTagFiltro]  = useState('todas');
  const [apenasEstrelas, setEstrelas] = useState(false);
  const [ordenacao,    setOrdenacao]  = useState('nome'); 

  useEffect(() => {
    carregar('arka:contatos', null).then(d => {
      const base = d || SEED_CONTATOS;
      setContatos(base);
      setCarregando(false);
    });
  }, []);

  useEffect(() => {
    if (carregando) return;
    setContatos(prev => {
      const tels = new Set(prev.map(c => c.telefone));
      const novos = conversas
        .filter(c => c.telefone && !tels.has(limparTel(c.telefone)))
        .map(c => ({
          id:       'ct_conv_' + c.id,
          nome:     c.cliente,
          telefone: limparTel(c.telefone),
          email:    '',
          empresa:  '',
          tag:      'cliente',
          favorito: false,
          observacoes: '',
        }));
      if (novos.length === 0) return prev;
      const atualizado = [...prev, ...novos];
      salvar('arka:contatos', atualizado);
      return atualizado;
    });
  }, [conversas, carregando]);

  useEffect(() => {
    if (!carregando && contatos.length > 0) salvar('arka:contatos', contatos);
  }, [contatos, carregando]);

  const salvarContato = useCallback((ct) => {
    setContatos(prev => {
      const idx = prev.findIndex(c => c.id === ct.id);
      if (idx >= 0) { const n = [...prev]; n[idx] = ct; return n; }
      return [...prev, ct];
    });
    setModal(false); setEditando(null);
  }, []);

  const removerContato = useCallback((id) => {
    if (!window.confirm('Remover este contato?')) return;
    setContatos(prev => prev.filter(c => c.id !== id));
  }, []);

  const toggleFavorito = useCallback((id) => {
    setContatos(prev => prev.map(c => c.id === id ? { ...c, favorito: !c.favorito } : c));
  }, []);

  function iniciarChat(contato) {
    if (!setConversas) return;
    const id = 'c_' + Date.now();
    const nova = {
      id,
      cliente:          contato.nome,
      telefone:         mascararTel(contato.telefone),
      statusAtendimento:'aguardando',
      cnpj:             null,
      cnpjVerificado:   false,
      lido:             false,
      mensagens:        [{
        de:   'sistema',
        texto:`Conversa iniciada a partir dos contatos.`,
        hora: new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}),
      }],
    };
    setConversas(prev => [nova, ...prev]);
    if (setAba) setAba('atendimento');
  }

  const listaFiltrada = useMemo(() => {
    let lista = contatos;

    if (apenasEstrelas) lista = lista.filter(c => c.favorito);
    if (tagFiltro !== 'todas') lista = lista.filter(c => c.tag === tagFiltro);

    if (busca.trim()) {
      const q = busca.toLowerCase();
      lista = lista.filter(c =>
        c.nome.toLowerCase().includes(q) ||
        c.telefone.includes(limparTel(busca)) ||
        (c.empresa || '').toLowerCase().includes(q) ||
        (c.email   || '').toLowerCase().includes(q)
      );
    }

    return [...lista].sort((a, b) => {
      if (ordenacao === 'nome') return a.nome.localeCompare(b.nome, 'pt-BR');

      if (b.favorito !== a.favorito) return b.favorito ? 1 : -1;
      return b.id.localeCompare(a.id);
    });
  }, [contatos, busca, tagFiltro, apenasEstrelas, ordenacao]);

  const contagemPorTag = useMemo(() => {
    const m = { todas: contatos.length };
    TAGS_DISPONIVEIS.forEach(t => { m[t] = contatos.filter(c => c.tag === t).length; });
    return m;
  }, [contatos]);

  if (carregando) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-400 text-xs gap-2">
        <Circle size={14} className="animate-spin text-orange-500" />
        Carregando contatos...
      </div>
    );
  }

  return (
    <div className="fade-in space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight font-display">Contatos</h1>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">
            {contatos.length} contato{contatos.length !== 1 ? 's' : ''} cadastrado{contatos.length !== 1 ? 's' : ''}.
          </p>
        </div>
        <button onClick={() => { setEditando(null); setModal(true); }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-400 text-slate-950 text-xs font-bold shadow-md shadow-orange-500/20 transition-all shrink-0">
          <Plus size={14}/> Novo Contato
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="relative flex-1 min-w-0">
          <Search size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500"/>
          <input value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por nome, telefone, empresa ou e-mail..."
            className="w-full bg-[#161922] border border-[#2A3040] rounded-xl pl-9 pr-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50" />
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <button onClick={() => setEstrelas(v => !v)}
            className={`p-2 rounded-xl border transition-all ${apenasEstrelas ? 'bg-amber-500/15 border-amber-500/30 text-amber-400' : 'bg-[#1E2330] border-[#2A3040] text-slate-400 hover:text-amber-400'}`}
            title="Apenas favoritos">
            <Star size={14}/>
          </button>
          <select value={ordenacao} onChange={e => setOrdenacao(e.target.value)}
            className="bg-[#161922] border border-[#2A3040] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-orange-500/50">
            <option value="nome">A-Z</option>
            <option value="recente">Recentes</option>
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {[['todas', 'Todos'], ...TAGS_DISPONIVEIS.map(t => [t, t.charAt(0).toUpperCase()+t.slice(1)])].map(([key, label]) => {
          const count = contagemPorTag[key] || 0;
          if (key !== 'todas' && count === 0) return null;
          return (
            <button key={key} onClick={() => setTagFiltro(key)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                tagFiltro === key
                  ? 'bg-orange-500/20 border-orange-500/40 text-orange-400'
                  : 'bg-[#1E2330] border-[#2A3040] text-slate-400 hover:text-slate-200'
              }`}>
              {label} ({count})
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {listaFiltrada.map(c => (
          <CardContato key={c.id} contato={c}
            onEditar={ct => { setEditando(ct); setModal(true); }}
            onRemover={removerContato}
            onToggleFav={toggleFavorito}
            onIniciarChat={iniciarChat} />
        ))}
        {listaFiltrada.length === 0 && (
          <div className="col-span-full text-center text-slate-400 text-xs py-12 glass-panel rounded-2xl border border-[#2A3040]">
            <Users size={28} className="text-slate-600 mx-auto mb-2"/>
            {busca ? 'Nenhum contato encontrado para esta busca.' : 'Nenhum contato cadastrado ainda.'}
          </div>
        )}
      </div>

      {modalAberto && (
        <ModalContato contato={editando} onSalvar={salvarContato}
          onFechar={() => { setModal(false); setEditando(null); }}/>
      )}
    </div>
  );
}
