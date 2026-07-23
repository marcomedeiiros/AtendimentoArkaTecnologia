import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Send, Plus, Trash2, Upload, Play, Pause, StopCircle,
  CheckCircle2, XCircle, Clock, Users, MessageSquare,
  AlertTriangle, FileText, X, RotateCcw, Download
} from 'lucide-react';

function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

function horaAgora() {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

async function carregar(chave, padrao) {
  try {
    const raw = localStorage.getItem(chave);
    return raw ? JSON.parse(raw) : padrao;
  } catch { return padrao; }
}
async function salvar(chave, valor) {
  try { localStorage.setItem(chave, JSON.stringify(valor)); } catch {}
}

function FormContato({ onAdicionar }) {
  const [nome, setNome]       = useState('');
  const [telefone, setTelefone] = useState('');

  function adicionar() {
    const tel = telefone.replace(/\D/g, '');
    if (!nome.trim() || tel.length < 10) return;
    onAdicionar({ id: 'dest_' + Date.now(), nome: nome.trim(), telefone: tel });
    setNome(''); setTelefone('');
  }

  function onPaste(e) {
    const texto = e.clipboardData.getData('text');
    const linhas = texto.split('\n').map(l => l.trim()).filter(Boolean);
    if (linhas.length <= 1) return; 

    e.preventDefault();
    const novos = linhas.flatMap(linha => {
      const partes = linha.split(/[|;\t,]/);
      if (partes.length >= 2) {
        const tel = partes[partes.length - 1].replace(/\D/g, '');
        const nm  = partes.slice(0, partes.length - 1).join(' ').trim();
        if (nm && tel.length >= 10) return [{ id: 'dest_' + Date.now() + Math.random(), nome: nm, telefone: tel }];
      }
      return [];
    });
    if (novos.length > 0) onAdicionar(novos);
  }

  return (
    <div className="flex flex-wrap gap-2">
      <input value={nome} onChange={e => setNome(e.target.value)}
        placeholder="Nome do destinatário"
        className="flex-1 min-w-[160px] bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50" />
      <input value={telefone} onChange={e => setTelefone(e.target.value)}
        onPaste={onPaste}
        placeholder="Telefone (ex: 11987654321)"
        className="w-44 bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50 font-mono" />
      <button onClick={adicionar}
        className="px-3 py-2 rounded-xl bg-orange-500/15 hover:bg-orange-500/25 text-orange-400 text-xs font-semibold border border-orange-500/30 flex items-center gap-1.5 transition-all">
        <Plus size={13} /> Adicionar
      </button>
    </div>
  );
}

function BarraProgresso({ total, enviados, erros, status }) {
  const pct     = total > 0 ? Math.round((enviados / total) * 100) : 0;
  const pctErro = total > 0 ? Math.round((erros    / total) * 100) : 0;

  const corBarra =
    status === 'concluido' ? 'bg-emerald-500' :
    status === 'pausado'   ? 'bg-amber-500'   :
    status === 'enviando'  ? 'bg-orange-500'  : 'bg-slate-600';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-white">{pct}% concluído</span>
        <span className="text-slate-400">
          <span className="text-emerald-400 font-semibold">{enviados}</span> enviados ·{' '}
          <span className="text-rose-400 font-semibold">{erros}</span> erros ·{' '}
          {total} total
        </span>
      </div>
      <div className="h-3 bg-[#1E2330] rounded-full overflow-hidden border border-[#2A3040] flex">
        <div className={`h-full transition-all duration-500 ${corBarra}`} style={{ width: `${pct}%` }} />
        {pctErro > 0 && (
          <div className="h-full bg-rose-500/70" style={{ width: `${pctErro}%` }} />
        )}
      </div>
    </div>
  );
}

function ItemLog({ entry }) {
  const icone =
    entry.status === 'ok'      ? <CheckCircle2 size={12} className="text-emerald-400 shrink-0" /> :
    entry.status === 'erro'    ? <XCircle      size={12} className="text-rose-400    shrink-0" /> :
    entry.status === 'pulado'  ? <AlertTriangle size={12} className="text-amber-400  shrink-0" /> :
                                 <Clock        size={12} className="text-slate-400   shrink-0" />;
  return (
    <div className="flex items-center gap-2 py-1 border-b border-[#2A3040]/50 last:border-0">
      {icone}
      <span className="flex-1 text-[11px] text-slate-300 truncate">{entry.nome}</span>
      <span className="text-[10px] text-slate-500 font-mono shrink-0">{entry.hora}</span>
    </div>
  );
}

function exportarLog(logs, campanha) {
  const csv = [
    ['Campanha', campanha],
    ['Exportado em', new Date().toLocaleString('pt-BR')],
    [''],
    ['Nome','Telefone','Status','Horário'],
    ...logs.map(l => [l.nome, l.telefone || '', l.status, l.hora]),
  ].map(r => r.join(';')).join('\n');

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href     = url;
  link.download = `envio-massa-${Date.now()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function EnvioEmMassa({ conversas = [] }) {
  const [campanha, setCampanha]       = useState('');
  const [mensagem, setMensagem]       = useState('');
  const [destinatarios, setDest]      = useState([]);
  const [intervaloDe, setIntervaloDe] = useState(2);
  const [intervaloAte, setIntervaloAte] = useState(5);

  const [status, setStatus]   = useState('idle'); 
  const [enviados, setEnviados] = useState(0);
  const [erros, setErros]       = useState(0);
  const [logs, setLogs]         = useState([]);
  const [indiceAtual, setIndiceAtual] = useState(0);

  const pausadoRef = useRef(false);
  const paradoRef  = useRef(false);

  function importarDasConversas() {
    const novos = conversas
      .filter(c => c.telefone)
      .map(c => ({
        id: 'dest_conv_' + c.id,
        nome: c.cliente,
        telefone: c.telefone.replace(/\D/g, ''),
      }));
    setDest(prev => {
      const existentes = new Set(prev.map(d => d.telefone));
      return [...prev, ...novos.filter(n => !existentes.has(n.telefone))];
    });
  }

  function adicionarContato(item) {
    if (Array.isArray(item)) {
      setDest(prev => {
        const existentes = new Set(prev.map(d => d.telefone));
        return [...prev, ...item.filter(n => !existentes.has(n.telefone))];
      });
    } else {
      setDest(prev => {
        if (prev.some(d => d.telefone === item.telefone)) return prev;
        return [...prev, item];
      });
    }
  }

  function removerContato(id) {
    setDest(prev => prev.filter(d => d.id !== id));
  }

  function resetar() {
    paradoRef.current  = true;
    pausadoRef.current = false;
    setStatus('idle');
    setEnviados(0);
    setErros(0);
    setLogs([]);
    setIndiceAtual(0);
  }

  const processarEnvio = useCallback(async (lista, inicio) => {
    for (let i = inicio; i < lista.length; i++) {

      if (paradoRef.current) break;

      while (pausadoRef.current) {
        await sleep(300);
        if (paradoRef.current) return;
      }

      const dest = lista[i];
      setIndiceAtual(i + 1);

      const delay = (intervaloDe + Math.random() * (intervaloAte - intervaloDe)) * 1000;
      await sleep(delay);

      const sucesso = Math.random() > 0.05; 

      const entry = {
        nome:     dest.nome,
        telefone: dest.telefone,
        status:   sucesso ? 'ok' : 'erro',
        hora:     horaAgora(),
      };

      setLogs(prev => [...prev, entry]);

      if (sucesso) setEnviados(prev => prev + 1);
      else         setErros(prev    => prev + 1);
    }

    if (!paradoRef.current) {
      setStatus('concluido');
    }
  }, [intervaloDe, intervaloAte]);

  async function iniciarEnvio() {
    if (!mensagem.trim() || destinatarios.length === 0) return;
    paradoRef.current  = false;
    pausadoRef.current = false;
    setStatus('enviando');
    setEnviados(0);
    setErros(0);
    setLogs([]);
    setIndiceAtual(0);
    await processarEnvio(destinatarios, 0);
  }

  function pausarResumir() {
    if (status === 'enviando') {
      pausadoRef.current = true;
      setStatus('pausado');
    } else if (status === 'pausado') {
      pausadoRef.current = false;
      setStatus('enviando');
     
      processarEnvio(destinatarios, indiceAtual);
    }
  }

  function pararEnvio() {
    paradoRef.current  = true;
    pausadoRef.current = false;
    setStatus('idle');
  }

  const emExecucao = status === 'enviando' || status === 'pausado';

  return (
    <div className="fade-in space-y-6">
   
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight font-display">Envio em Massa</h1>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">
            Dispare mensagens para múltiplos contatos com controle de progresso.
          </p>
        </div>
        {status === 'concluido' && (
          <button onClick={() => exportarLog(logs, campanha)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs font-semibold border border-emerald-500/30 transition-all">
            <Download size={14} /> Exportar Relatório
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 space-y-4">
          <div className="glass-panel rounded-2xl p-5 border border-[#2A3040] space-y-4">
            <h3 className="text-sm font-bold text-white font-display flex items-center gap-2">
              <FileText size={15} className="text-orange-400" /> Configuração da Campanha
            </h3>
            <div>
              <label className="text-xs text-slate-400 font-medium block mb-1.5">Nome da Campanha</label>
              <input value={campanha} onChange={e => setCampanha(e.target.value)}
                placeholder="Ex: Promoção Julho 2026..."
                disabled={emExecucao}
                className="w-full bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50 disabled:opacity-50" />
            </div>
            <div>
              <label className="text-xs text-slate-400 font-medium block mb-1.5">
                Mensagem <span className="text-slate-500">({mensagem.length} caracteres)</span>
              </label>
              <textarea value={mensagem} onChange={e => setMensagem(e.target.value)} rows={6}
                placeholder="Digite a mensagem que será enviada para todos os destinatários..."
                disabled={emExecucao}
                className="w-full bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50 resize-none disabled:opacity-50 font-mono leading-relaxed" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 font-medium block mb-1.5">Intervalo mínimo (s)</label>
                <input type="number" min={1} max={60} value={intervaloDe}
                  onChange={e => setIntervaloDe(Number(e.target.value))}
                  disabled={emExecucao}
                  className="w-full bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-orange-500/50 disabled:opacity-50" />
              </div>
              <div>
                <label className="text-xs text-slate-400 font-medium block mb-1.5">Intervalo máximo (s)</label>
                <input type="number" min={1} max={120} value={intervaloAte}
                  onChange={e => setIntervaloAte(Number(e.target.value))}
                  disabled={emExecucao}
                  className="w-full bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-orange-500/50 disabled:opacity-50" />
              </div>
            </div>
            <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/20 text-[11px] text-amber-400 flex items-start gap-2">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              Intervalo aleatório entre envios evita bloqueio por spam. Recomendado: mínimo 2s / máximo 8s.
            </div>
          </div>

          <div className="glass-panel rounded-2xl p-5 border border-[#2A3040] space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white font-display flex items-center gap-2">
                <Users size={15} className="text-orange-400" /> Destinatários ({destinatarios.length})
              </h3>
              <button onClick={importarDasConversas}
                disabled={emExecucao || conversas.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-xs font-semibold border border-blue-500/30 transition-all disabled:opacity-50">
                <Upload size={12} /> Importar Conversas
              </button>
            </div>

            {!emExecucao && <FormContato onAdicionar={adicionarContato} />}

            <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
              {destinatarios.map(d => (
                <div key={d.id} className="flex items-center justify-between px-3 py-2 rounded-xl bg-[#1E2330] border border-[#2A3040]">
                  <div>
                    <span className="text-xs font-semibold text-white">{d.nome}</span>
                    <span className="text-[11px] text-slate-400 font-mono ml-2">{d.telefone}</span>
                  </div>
                  {!emExecucao && (
                    <button onClick={() => removerContato(d.id)} className="text-rose-400 hover:bg-slate-800 p-1 rounded-lg transition-colors">
                      <X size={12} />
                    </button>
                  )}
                </div>
              ))}
              {destinatarios.length === 0 && (
                <div className="text-xs text-slate-500 text-center py-4">Nenhum destinatário adicionado.</div>
              )}
            </div>

            {destinatarios.length > 0 && !emExecucao && (
              <button onClick={() => setDest([])}
                className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1 transition-colors">
                <Trash2 size={11} /> Limpar todos
              </button>
            )}
          </div>
        </div>

        <div className="lg:col-span-5 space-y-4">
          <div className="glass-panel rounded-2xl p-5 border border-[#2A3040] space-y-4">
            <h3 className="text-sm font-bold text-white font-display flex items-center gap-2">
              <Send size={15} className="text-orange-400" /> Controle de Envio
            </h3>

            {(emExecucao || status === 'concluido') && (
              <BarraProgresso
                total={destinatarios.length}
                enviados={enviados}
                erros={erros}
                status={status}
              />
            )}

            <div className={`px-3 py-2 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
              status === 'idle'      ? 'bg-slate-800 border-slate-700 text-slate-400' :
              status === 'enviando'  ? 'bg-orange-500/10 border-orange-500/30 text-orange-400' :
              status === 'pausado'   ? 'bg-amber-500/10  border-amber-500/30  text-amber-400'  :
              status === 'concluido' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : ''
            }`}>
              {status === 'idle'      && <><Clock size={13} /> Aguardando início</>}
              {status === 'enviando'  && <><Send  size={13} className="animate-pulse" /> Enviando... ({indiceAtual}/{destinatarios.length})</>}
              {status === 'pausado'   && <><Pause size={13} /> Pausado em {indiceAtual}/{destinatarios.length}</>}
              {status === 'concluido' && <><CheckCircle2 size={13} /> Envio concluído!</>}
            </div>

            <div className="flex flex-wrap gap-2">
              {status === 'idle' && (
                <button onClick={iniciarEnvio}
                  disabled={!mensagem.trim() || destinatarios.length === 0}
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-slate-950 text-xs font-bold flex items-center justify-center gap-2 shadow-md shadow-orange-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
                  <Play size={13} fill="currentColor" /> Iniciar Envio
                </button>
              )}
              {emExecucao && (
                <>
                  <button onClick={pausarResumir}
                    className="flex-1 py-2.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 text-xs font-bold border border-amber-500/30 flex items-center justify-center gap-2 transition-all">
                    {status === 'pausado' ? <><Play size={13} /> Retomar</> : <><Pause size={13} /> Pausar</>}
                  </button>
                  <button onClick={pararEnvio}
                    className="py-2.5 px-3 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 text-xs font-bold border border-rose-500/30 flex items-center gap-1 transition-all">
                    <StopCircle size={13} /> Parar
                  </button>
                </>
              )}
              {status === 'concluido' && (
                <button onClick={resetar}
                  className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 flex items-center justify-center gap-2 transition-all">
                  <RotateCcw size={13} /> Nova Campanha
                </button>
              )}
            </div>
          </div>

          {logs.length > 0 && (
            <div className="glass-panel rounded-2xl p-4 border border-[#2A3040] space-y-2">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-xs font-bold text-white flex items-center gap-2">
                  <MessageSquare size={13} className="text-orange-400" /> Log de Envios
                </h3>
                <span className="text-[10px] text-slate-500">{logs.length} registros</span>
              </div>
              <div className="max-h-56 overflow-y-auto space-y-0.5 pr-1">
                {[...logs].reverse().map((entry, i) => (
                  <ItemLog key={i} entry={entry} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
