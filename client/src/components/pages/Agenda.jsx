import { useState, useEffect, useMemo } from 'react';
import {
  CalendarDays, Plus, Pencil, Trash2, Save, X, Clock,
  CheckCircle2, Circle, ChevronLeft, ChevronRight, Search, Loader2
} from 'lucide-react';
import Portal from '../Portal';
import { AgendaAPI } from '../../services/api';
import { hojeISO, anoMesHoje } from '../../utils/data';

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
               'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const DIAS_SEMANA = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

// hojeISO vive em utils/data.js: era aqui que o "toISOString" (UTC) fazia a
// Agenda virar o dia as 21h de Brasilia.

function diasNoMes(ano, mes) { return new Date(ano, mes + 1, 0).getDate(); }

function primeiroDiaSemana(ano, mes) { return new Date(ano, mes, 1).getDay(); }

const TIPOS = {
  reuniao:    { label: 'Reunião',       color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  ligacao:    { label: 'Ligação',       color: 'bg-ativo/20 text-ativo-400 border-ativo/30' },
  tarefa:     { label: 'Tarefa',        color: 'bg-espera/20 text-espera-400 border-espera/30' },
  followup:   { label: 'Follow-up',     color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  lembrete:   { label: 'Lembrete',      color: 'bg-falha/20 text-falha-400 border-falha/30' }
};

const PRIORIDADES = {
  alta:   { label: 'Alta',   dot: 'bg-falha-400' },
  media:  { label: 'Média',  dot: 'bg-espera-400' },
  baixa:  { label: 'Baixa',  dot: 'bg-slate-400' }
};

function ModalCompromisso({ compromisso, onSalvar, onFechar, salvando }) {
  const [titulo, setTitulo]       = useState(compromisso?.titulo    || '');
  const [data, setData]           = useState(compromisso?.data       || hojeISO());
  const [hora, setHora]           = useState(compromisso?.hora       || '09:00');
  const [tipo, setTipo]           = useState(compromisso?.tipo       || 'reuniao');
  const [prioridade, setPrioridade] = useState(compromisso?.prioridade || 'media');
  const [descricao, setDescricao] = useState(compromisso?.descricao  || '');
  const [contato, setContato]     = useState(compromisso?.contato    || '');

  function salvar() {
    if (!titulo.trim() || !data) return;
    // Sem id fabricado: o componente pai decide criar (novo) ou atualizar (o que
    // estava sendo editado); o id vem do servidor. `concluido` vai junto para o
    // update nao zerar o estado ao salvar uma edicao.
    onSalvar({
      titulo:     titulo.trim(),
      data,
      hora,
      tipo,
      prioridade,
      descricao:  descricao.trim(),
      contato:    contato.trim(),
      concluido:  compromisso?.concluido || false
    });
  }

  return (
    // Portal: evita que o transform do container `.fade-in` corte o modal.
    <Portal>
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-start sm:items-center justify-center z-50 p-3 sm:p-4 overflow-y-auto">
      <div className="glass-panel border border-linha rounded-2xl w-full max-w-lg shadow-2xl fade-in my-auto flex flex-col max-h-[calc(100dvh-1.5rem)] sm:max-h-[90vh]">
        <div className="p-4 bg-grafite-600 border-b border-linha flex items-center justify-between shrink-0 rounded-t-2xl">
          <div className="flex items-center gap-2 font-bold text-sm text-white min-w-0">
            <CalendarDays size={16} className="text-acao-200 shrink-0" />
            <span className="truncate">{compromisso?.id ? 'Editar Compromisso' : 'Novo Compromisso'}</span>
          </div>
          <button onClick={onFechar} className="text-slate-400 hover:text-white transition-colors shrink-0 ml-2"><X size={16} /></button>
        </div>

        <div className="p-4 sm:p-5 space-y-4 flex-1 overflow-y-auto min-h-0">
          <div>
            <label className="text-xs text-slate-400 font-medium block mb-1.5">Título *</label>
            <input value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Ex: Reunião com cliente Arka..."
              className="w-full bg-grafite-700 border border-linha rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-acao/50" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 font-medium block mb-1.5">Data *</label>
              <input type="date" value={data} onChange={e => setData(e.target.value)}
                className="w-full bg-grafite-700 border border-linha rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-acao/50" />
            </div>
            <div>
              <label className="text-xs text-slate-400 font-medium block mb-1.5">Horário</label>
              <input type="time" value={hora} onChange={e => setHora(e.target.value)}
                className="w-full bg-grafite-700 border border-linha rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-acao/50" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 font-medium block mb-1.5">Tipo</label>
              <select value={tipo} onChange={e => setTipo(e.target.value)}
                className="w-full bg-grafite-700 border border-linha rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-acao/50">
                {Object.entries(TIPOS).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 font-medium block mb-1.5">Prioridade</label>
              <select value={prioridade} onChange={e => setPrioridade(e.target.value)}
                className="w-full bg-grafite-700 border border-linha rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-acao/50">
                {Object.entries(PRIORIDADES).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-400 font-medium block mb-1.5">Contato / Cliente</label>
            <input value={contato} onChange={e => setContato(e.target.value)} placeholder="Nome do cliente ou responsável..."
              className="w-full bg-grafite-700 border border-linha rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-acao/50" />
          </div>

          <div>
            <label className="text-xs text-slate-400 font-medium block mb-1.5">Descrição</label>
            <textarea value={descricao} onChange={e => setDescricao(e.target.value)} rows={3}
              placeholder="Detalhes do compromisso..."
              className="w-full bg-grafite-700 border border-linha rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-acao/50 resize-none" />
          </div>
        </div>

        <div className="p-4 bg-grafite-600 border-t border-linha flex flex-col-reverse sm:flex-row sm:justify-end gap-2 shrink-0 rounded-b-2xl">
          <button onClick={onFechar}
            className="px-3 py-2 sm:py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700 transition-colors">
            Cancelar
          </button>
          <button onClick={salvar} disabled={!titulo.trim() || !data || salvando}
            className="px-4 py-2 sm:py-1.5 rounded-lg bg-acao hover:bg-acao-200 text-slate-950 text-xs font-bold flex items-center justify-center gap-1.5 shadow-md shadow-acao/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
            {salvando ? <><Loader2 size={13} className="animate-spin" /> Salvando...</> : <><Save size={13} /> Salvar</>}
          </button>
        </div>
      </div>
    </div>
    </Portal>
  );
}

function MiniCalendario({ compromissos, dataFoco, setDataFoco }) {
  const [ano, setAno]   = useState(() => anoMesHoje().ano);
  const [mes, setMes]   = useState(() => anoMesHoje().mes);

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
    <div className="glass-panel rounded-2xl p-4 border border-linha">
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
                ehFoco   ? 'bg-acao text-slate-950' :
                ehHoje   ? 'bg-acao/20 text-acao-200 border border-acao/40' :
                'text-slate-400 hover:bg-slate-800 hover:text-white'
              }`}>
              {dia}
              {temEvento && !ehFoco && (
                <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-acao-200" />
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
    <div className={`glass-panel p-3.5 rounded-xl border transition-all ${comp.concluido ? 'border-ativo/30 opacity-70' : 'border-linha hover:border-linha-forte'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5 min-w-0 flex-1">
          <button onClick={() => onToggleConcluido(comp.id)} className="mt-0.5 shrink-0">
            {comp.concluido
              ? <CheckCircle2 size={16} className="text-ativo-400" />
              : <Circle      size={16} className="text-slate-500 hover:text-acao-200 transition-colors" />
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
            className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-falha-400 transition-colors">
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

function ordenar(lista) {
  return [...lista].sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora));
}

export default function Agenda() {
  const [compromissos, setCompromissos] = useState([]);
  const [modalAberto, setModalAberto]   = useState(false);
  const [editando, setEditando]         = useState(null);
  const [dataFoco, setDataFoco]         = useState(hojeISO());
  const [busca, setBusca]               = useState('');
  const [verTodos, setVerTodos]         = useState(false);
  const [carregando, setCarregando]     = useState(true);
  const [erro, setErro]                 = useState('');
  const [salvando, setSalvando]         = useState(false);

  // Agenda agora vem do servidor (compartilhada pela equipe).
  async function carregarLista() {
    setCarregando(true);
    setErro('');
    try {
      setCompromissos(ordenar(await AgendaAPI.listar()));
    } catch (e) {
      setErro(e.message || 'Não foi possível carregar a agenda.');
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => { carregarLista(); }, []);

  // Cria (sem item em edicao) ou atualiza (o id do que estava aberto). Atualiza
  // a lista local com o que o servidor devolveu, sem recarregar tudo.
  async function salvarCompromisso(payload) {
    setSalvando(true);
    setErro('');
    try {
      if (editando?.id) {
        const atualizado = await AgendaAPI.atualizar(editando.id, payload);
        setCompromissos(prev => ordenar(prev.map(c => (c.id === atualizado.id ? atualizado : c))));
      } else {
        const criado = await AgendaAPI.criar(payload);
        setCompromissos(prev => ordenar([...prev, criado]));
      }
      setModalAberto(false); setEditando(null);
    } catch (e) {
      window.alert('Não foi possível salvar: ' + (e.message || 'erro desconhecido'));
    } finally {
      setSalvando(false);
    }
  }

  async function removerCompromisso(id) {
    if (!window.confirm('Remover este compromisso? Isso vale para toda a equipe.')) return;
    const anterior = compromissos;
    setCompromissos(prev => prev.filter(c => c.id !== id)); // otimista
    try {
      await AgendaAPI.remover(id);
    } catch (e) {
      setCompromissos(anterior); // desfaz
      window.alert('Não foi possível remover: ' + (e.message || 'erro desconhecido'));
    }
  }

  async function toggleConcluido(id) {
    const alvo = compromissos.find(c => c.id === id);
    if (!alvo) return;
    const novo = !alvo.concluido;
    setCompromissos(prev => prev.map(c => (c.id === id ? { ...c, concluido: novo } : c))); // otimista
    try {
      await AgendaAPI.definirConcluido(id, novo);
    } catch {
      setCompromissos(prev => prev.map(c => (c.id === id ? { ...c, concluido: !novo } : c))); // desfaz
    }
  }

  async function limparConcluidosAntigos() {
    const anterior = compromissos;
    const hoje = hojeISO();
    setCompromissos(prev => prev.filter(c => !c.concluido || c.data >= hoje)); // otimista
    try {
      await AgendaAPI.limparConcluidosAntigos();
    } catch (e) {
      setCompromissos(anterior);
      window.alert('Não foi possível limpar: ' + (e.message || 'erro desconhecido'));
    }
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-linha">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight font-display">Agenda</h1>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">
            Gerencie compromissos, follow-ups e tarefas da equipe.
            {pendentes > 0 && <span className="ml-2 text-acao-200 font-semibold">{pendentes} pendente{pendentes > 1 ? 's' : ''}</span>}
          </p>
        </div>
        <button onClick={() => { setEditando(null); setModalAberto(true); }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-acao hover:bg-acao-200 text-slate-950 text-xs font-bold shadow-md shadow-acao/20 transition-all shrink-0">
          <Plus size={14} /> Novo Compromisso
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 space-y-4">
          <MiniCalendario compromissos={compromissos} dataFoco={dataFoco} setDataFoco={d => { setDataFoco(d); setVerTodos(false); }} />
          <div className="glass-panel rounded-2xl p-4 border border-linha space-y-2">
            <div className="text-xs font-semibold text-slate-400 mb-2">Ações rápidas</div>
            <button onClick={() => { setDataFoco(hojeISO()); setVerTodos(false); }}
              className={`w-full text-left px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${!verTodos && dataFoco === hojeISO() ? 'bg-acao/15 border-acao/30 text-acao-200' : 'bg-grafite-600 border-linha text-slate-400 hover:text-slate-200'}`}>
              📅 Hoje
            </button>
            <button onClick={() => setVerTodos(true)}
              className={`w-full text-left px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${verTodos ? 'bg-acao/15 border-acao/30 text-acao-200' : 'bg-grafite-600 border-linha text-slate-400 hover:text-slate-200'}`}>
              📋 Todos os compromissos ({compromissos.length})
            </button>
            <button onClick={limparConcluidosAntigos}
              className="w-full text-left px-3 py-2 rounded-xl text-xs font-semibold border bg-grafite-600 border-linha text-slate-400 hover:text-slate-200 transition-all">
              🗑️ Limpar concluídos antigos
            </button>
          </div>
        </div>

        <div className="lg:col-span-8 space-y-4">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar compromisso..."
                className="w-full bg-grafite-700 border border-linha rounded-xl pl-9 pr-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-acao/50" />
            </div>
            <div className="text-xs text-slate-400 shrink-0">
              {verTodos ? 'Todos' : dataFoco} - <span className="text-white font-semibold">{listagem.length}</span>
            </div>
          </div>

          {erro && (
            <div className="rounded-xl border border-falha/30 bg-falha/15 p-3 text-xs font-semibold text-falha-400">
              {erro}
            </div>
          )}

          {carregando ? (
            <div className="flex items-center justify-center gap-2 py-16 text-slate-400 text-xs">
              <Loader2 size={16} className="animate-spin" /> Carregando agenda...
            </div>
          ) : (
            <div className="space-y-2.5">
              {listagem.map(comp => (
                <CardCompromisso key={comp.id} comp={comp}
                  onEditar={c => { setEditando(c); setModalAberto(true); }}
                  onRemover={removerCompromisso}
                  onToggleConcluido={toggleConcluido} />
              ))}
              {listagem.length === 0 && (
                <div className="text-center text-slate-400 text-xs py-12 glass-panel rounded-2xl border border-linha">
                  <CalendarDays size={28} className="text-slate-600 mx-auto mb-2" />
                  {verTodos ? 'Nenhum compromisso cadastrado.' : 'Nenhum compromisso para este dia.'}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {modalAberto && (
        <ModalCompromisso compromisso={editando} onSalvar={salvarCompromisso} salvando={salvando}
          onFechar={() => { if (!salvando) { setModalAberto(false); setEditando(null); } }} />
      )}
    </div>
  );
}
