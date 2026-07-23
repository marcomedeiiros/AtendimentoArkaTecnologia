import React, { useState, useEffect, useMemo } from 'react';
import {
  CalendarDays, Plus, Pencil, Trash2, Save, X, Clock,
  CheckCircle2, AlertCircle, Circle, ChevronLeft, ChevronRight, Search
} from 'lucide-react';

async function carregar(chave, padrao) {
  try {
    const raw = localStorage.getItem(chave);
    return raw ? JSON.parse(raw) : padrao;
  } catch { return padrao; }
}
async function salvar(chave, valor) {
  try { localStorage.setItem(chave, JSON.stringify(valor)); } catch {}
}

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
               'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const DIAS_SEMANA = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

function hojeISO() { return new Date().toISOString().slice(0,10); }

function diasNoMes(ano, mes) { return new Date(ano, mes + 1, 0).getDate(); }

function primeiroDiaSemana(ano, mes) { return new Date(ano, mes, 1).getDay(); }

const TIPOS = {
  reuniao:    { label: 'Reunião',       color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  ligacao:    { label: 'Ligação',       color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  tarefa:     { label: 'Tarefa',        color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  followup:   { label: 'Follow-up',     color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  lembrete:   { label: 'Lembrete',      color: 'bg-rose-500/20 text-rose-400 border-rose-500/30' },
};

const PRIORIDADES = {
  alta:   { label: 'Alta',   dot: 'bg-rose-400' },
  media:  { label: 'Média',  dot: 'bg-amber-400' },
  baixa:  { label: 'Baixa',  dot: 'bg-slate-400' },
};

function ModalCompromisso({ compromisso, onSalvar, onFechar }) {
  const [titulo, setTitulo]       = useState(compromisso?.titulo    || '');
  const [data, setData]           = useState(compromisso?.data       || hojeISO());
  const [hora, setHora]           = useState(compromisso?.hora       || '09:00');
  const [tipo, setTipo]           = useState(compromisso?.tipo       || 'reuniao');
  const [prioridade, setPrioridade] = useState(compromisso?.prioridade || 'media');
  const [descricao, setDescricao] = useState(compromisso?.descricao  || '');
  const [contato, setContato]     = useState(compromisso?.contato    || '');

  function salvar() {
    if (!titulo.trim() || !data) return;
    onSalvar({
      id:         compromisso?.id || 'ag_' + Date.now(),
      titulo:     titulo.trim(),
      data,
      hora,
      tipo,
      prioridade,
      descricao:  descricao.trim(),
      contato:    contato.trim(),
      concluido:  compromisso?.concluido || false,
    });
  }

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass-panel border border-[#2A3040] rounded-2xl w-full max-w-lg shadow-2xl fade-in overflow-hidden">
        <div className="p-4 bg-[#1E2330] border-b border-[#2A3040] flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-sm text-white">
            <CalendarDays size={16} className="text-orange-400" />
            {compromisso?.id ? 'Editar Compromisso' : 'Novo Compromisso'}
          </div>
          <button onClick={onFechar} className="text-slate-400 hover:text-white transition-colors"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs text-slate-400 font-medium block mb-1.5">Título *</label>
            <input value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Ex: Reunião com cliente Arka..."
              className="w-full bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 font-medium block mb-1.5">Data *</label>
              <input type="date" value={data} onChange={e => setData(e.target.value)}
                className="w-full bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-orange-500/50" />
            </div>
            <div>
              <label className="text-xs text-slate-400 font-medium block mb-1.5">Horário</label>
              <input type="time" value={hora} onChange={e => setHora(e.target.value)}
                className="w-full bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-orange-500/50" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 font-medium block mb-1.5">Tipo</label>
              <select value={tipo} onChange={e => setTipo(e.target.value)}
                className="w-full bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-orange-500/50">
                {Object.entries(TIPOS).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 font-medium block mb-1.5">Prioridade</label>
              <select value={prioridade} onChange={e => setPrioridade(e.target.value)}
                className="w-full bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-orange-500/50">
                {Object.entries(PRIORIDADES).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-400 font-medium block mb-1.5">Contato / Cliente</label>
            <input value={contato} onChange={e => setContato(e.target.value)} placeholder="Nome do cliente ou responsável..."
              className="w-full bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50" />
          </div>

          <div>
            <label className="text-xs text-slate-400 font-medium block mb-1.5">Descrição</label>
            <textarea value={descricao} onChange={e => setDescricao(e.target.value)} rows={3}
              placeholder="Detalhes do compromisso..."
              className="w-full bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50 resize-none" />
          </div>
        </div>

        <div className="p-4 bg-[#1E2330] border-t border-[#2A3040] flex justify-end gap-2">
          <button onClick={onFechar}
            className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700 transition-colors">
            Cancelar
          </button>
          <button onClick={salvar} disabled={!titulo.trim() || !data}
            className="px-4 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 shadow-md shadow-orange-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
            <Save size={13} /> Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

function MiniCalendario({ compromissos, dataFoco, setDataFoco }) {
  const [ano, setAno]   = useState(() => new Date().getFullYear());
  const [mes, setMes]   = useState(() => new Date().getMonth());

  const hoje = hojeISO();
  const totalDias = diasNoMes(ano, mes);
  const primeiroDS = primeiroDiaSemana(ano, mes);

  const datasComEvento = useMemo(() => {
    const prefixo = `${ano}-${String(mes + 1).padStart(2,'0')}`;
    return new Set(compromissos.filter(c => c.data.startsWith(prefixo)).map(c => c.data));
  }, [compromissos, ano, mes]);

  function navMes(delta) {
    let nm = mes + delta;
    let na = ano;
    if (nm > 11) { nm = 0; na++; }
    if (nm < 0)  { nm = 11; na--; }
    setMes(nm); setAno(na);
  }

  const celulas = [];
  for (let i = 0; i < primeiroDS; i++) celulas.push(null);
  for (let d = 1; d <= totalDias; d++) celulas.push(d);

  return (
    <div className="glass-panel rounded-2xl p-4 border border-[#2A3040]">
      <div className="flex items-center justify-between mb-3">
        <button onClick={() => navMes(-1)} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"><ChevronLeft size={14}/></button>
        <span className="text-xs font-bold text-white">{MESES[mes]} {ano}</span>
        <button onClick={() => navMes(1)}  className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"><ChevronRight size={14}/></button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {DIAS_SEMANA.map(d => (
          <div key={d} className="text-center text-[9px] font-bold text-slate-500 py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {celulas.map((dia, idx) => {
          if (!dia) return <div key={`e_${idx}`} />;
          const iso = `${ano}-${String(mes+1).padStart(2,'0')}-${String(dia).padStart(2,'0')}`;
          const ehHoje    = iso === hoje;
          const ehFoco    = iso === dataFoco;
          const temEvento = datasComEvento.has(iso);
          return (
            <button key={iso} onClick={() => setDataFoco(iso)}
              className={`relative flex flex-col items-center justify-center rounded-lg py-1 text-[11px] font-semibold transition-all ${
                ehFoco   ? 'bg-orange-500 text-slate-950' :
                ehHoje   ? 'bg-orange-500/20 text-orange-400 border border-orange-500/40' :
                'text-slate-400 hover:bg-slate-800 hover:text-white'
              }`}>
              {dia}
              {temEvento && !ehFoco && (
                <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-orange-400" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CardCompromisso({ comp, onEditar, onRemover, onToggleConcluido }) {
  const tipo  = TIPOS[comp.tipo]      || TIPOS.tarefa;
  const prio  = PRIORIDADES[comp.prioridade] || PRIORIDADES.media;

  return (
    <div className={`glass-panel p-3.5 rounded-xl border transition-all ${comp.concluido ? 'border-emerald-500/30 opacity-70' : 'border-[#2A3040] hover:border-slate-600/60'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5 min-w-0 flex-1">
          <button onClick={() => onToggleConcluido(comp.id)} className="mt-0.5 shrink-0">
            {comp.concluido
              ? <CheckCircle2 size={16} className="text-emerald-400" />
              : <Circle      size={16} className="text-slate-500 hover:text-orange-400 transition-colors" />
            }
          </button>
          <div className="min-w-0 flex-1">
            <div className={`font-bold text-xs text-white ${comp.concluido ? 'line-through text-slate-400' : ''}`}>
              {comp.titulo}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${tipo.color}`}>
                {tipo.label}
              </span>
              <div className="flex items-center gap-1 text-[10px] text-slate-400">
                <span className={`w-1.5 h-1.5 rounded-full ${prio.dot}`} />
                {prio.label}
              </div>
              <div className="flex items-center gap-1 text-[10px] text-slate-400">
                <Clock size={10} />
                {comp.hora}
              </div>
              {comp.contato && (
                <span className="text-[10px] text-slate-400 truncate max-w-[120px]">· {comp.contato}</span>
              )}
            </div>
            {comp.descricao && (
              <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed line-clamp-2">{comp.descricao}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => onEditar(comp)}
            className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-blue-400 transition-colors">
            <Pencil size={12} />
          </button>
          <button onClick={() => onRemover(comp.id)}
            className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-rose-400 transition-colors">
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

const SEED_AGENDA = [
  { id:'ag_1', titulo:'Reunião de planejamento', data: hojeISO(), hora:'10:00', tipo:'reuniao',  prioridade:'alta',  descricao:'Planejamento mensal da equipe.', contato:'Marina Souza', concluido: false },
  { id:'ag_2', titulo:'Follow-up cliente Beatriz', data: hojeISO(), hora:'14:30', tipo:'followup', prioridade:'media', descricao:'Verificar renovação contratual.', contato:'Beatriz Santos', concluido: false },
];

export default function Agenda() {
  const [compromissos, setCompromissos] = useState([]);
  const [modalAberto, setModalAberto]   = useState(false);
  const [editando, setEditando]         = useState(null);
  const [dataFoco, setDataFoco]         = useState(hojeISO());
  const [busca, setBusca]               = useState('');
  const [verTodos, setVerTodos]         = useState(false);

  useEffect(() => {
    carregar('arka:agenda', null).then(d => setCompromissos(d || SEED_AGENDA));
  }, []);

  useEffect(() => {
    if (compromissos.length > 0) salvar('arka:agenda', compromissos);
  }, [compromissos]);

  function salvarCompromisso(comp) {
    setCompromissos(prev => {
      const idx = prev.findIndex(c => c.id === comp.id);
      if (idx >= 0) { const n = [...prev]; n[idx] = comp; return n; }
      return [...prev, comp].sort((a,b) => (a.data+a.hora).localeCompare(b.data+b.hora));
    });
    setModalAberto(false); setEditando(null);
  }

  function removerCompromisso(id) {
    if (!window.confirm('Remover este compromisso?')) return;
    setCompromissos(prev => prev.filter(c => c.id !== id));
  }

  function toggleConcluido(id) {
    setCompromissos(prev => prev.map(c => c.id === id ? { ...c, concluido: !c.concluido } : c));
  }

  const listagem = useMemo(() => {
    let lista = verTodos
      ? compromissos
      : compromissos.filter(c => c.data === dataFoco);

    if (busca.trim()) {
      const q = busca.toLowerCase();
      lista = lista.filter(c =>
        c.titulo.toLowerCase().includes(q) ||
        (c.contato || '').toLowerCase().includes(q) ||
        (c.descricao || '').toLowerCase().includes(q)
      );
    }
    return lista.sort((a,b) => (a.data+a.hora).localeCompare(b.data+b.hora));
  }, [compromissos, dataFoco, busca, verTodos]);

  const pendentes = compromissos.filter(c => !c.concluido && c.data >= hojeISO()).length;

  return (
    <div className="fade-in space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight font-display">Agenda</h1>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">
            Gerencie compromissos, follow-ups e tarefas da equipe.
            {pendentes > 0 && <span className="ml-2 text-orange-400 font-semibold">{pendentes} pendente{pendentes > 1 ? 's' : ''}</span>}
          </p>
        </div>
        <button onClick={() => { setEditando(null); setModalAberto(true); }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-400 text-slate-950 text-xs font-bold shadow-md shadow-orange-500/20 transition-all shrink-0">
          <Plus size={14} /> Novo Compromisso
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 space-y-4">
          <MiniCalendario compromissos={compromissos} dataFoco={dataFoco} setDataFoco={d => { setDataFoco(d); setVerTodos(false); }} />
          <div className="glass-panel rounded-2xl p-4 border border-[#2A3040] space-y-2">
            <div className="text-xs font-semibold text-slate-400 mb-2">Ações rápidas</div>
            <button onClick={() => { setDataFoco(hojeISO()); setVerTodos(false); }}
              className={`w-full text-left px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${!verTodos && dataFoco === hojeISO() ? 'bg-orange-500/15 border-orange-500/30 text-orange-400' : 'bg-[#1E2330] border-[#2A3040] text-slate-400 hover:text-slate-200'}`}>
              📅 Hoje
            </button>
            <button onClick={() => setVerTodos(true)}
              className={`w-full text-left px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${verTodos ? 'bg-orange-500/15 border-orange-500/30 text-orange-400' : 'bg-[#1E2330] border-[#2A3040] text-slate-400 hover:text-slate-200'}`}>
              📋 Todos os compromissos ({compromissos.length})
            </button>
            <button onClick={() => { setCompromissos(prev => prev.filter(c => !c.concluido || c.data >= hojeISO())); }}
              className="w-full text-left px-3 py-2 rounded-xl text-xs font-semibold border bg-[#1E2330] border-[#2A3040] text-slate-400 hover:text-slate-200 transition-all">
              🗑️ Limpar concluídos antigos
            </button>
          </div>
        </div>

        <div className="lg:col-span-8 space-y-4">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar compromisso..."
                className="w-full bg-[#161922] border border-[#2A3040] rounded-xl pl-9 pr-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50" />
            </div>
            <div className="text-xs text-slate-400 shrink-0">
              {verTodos ? 'Todos' : dataFoco} - <span className="text-white font-semibold">{listagem.length}</span>
            </div>
          </div>

          <div className="space-y-2.5">
            {listagem.map(comp => (
              <CardCompromisso key={comp.id} comp={comp}
                onEditar={c => { setEditando(c); setModalAberto(true); }}
                onRemover={removerCompromisso}
                onToggleConcluido={toggleConcluido} />
            ))}
            {listagem.length === 0 && (
              <div className="text-center text-slate-400 text-xs py-12 glass-panel rounded-2xl border border-[#2A3040]">
                <CalendarDays size={28} className="text-slate-600 mx-auto mb-2" />
                {verTodos ? 'Nenhum compromisso cadastrado.' : 'Nenhum compromisso para este dia.'}
              </div>
            )}
          </div>
        </div>
      </div>

      {modalAberto && (
        <ModalCompromisso compromisso={editando} onSalvar={salvarCompromisso}
          onFechar={() => { setModalAberto(false); setEditando(null); }} />
      )}
    </div>
  );
}
