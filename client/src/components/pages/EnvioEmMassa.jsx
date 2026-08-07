import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Send, Plus, Trash2, Upload, Play, Pause, StopCircle,
  CheckCircle2, XCircle, Clock, Users, MessageSquare,
  AlertTriangle, FileText, X, RotateCcw, Download
} from 'lucide-react';
import { WhatsAppAPI } from '../../services/api';

function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

function horaAgora() {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// Persistencia da campanha. Antes esses helpers existiam mas nunca eram
// chamados: por isso o F5 zerava nome, mensagem e destinatarios. Agora o rascunho
// da campanha vive no localStorage e sobrevive a recarregar a pagina.
const CHAVE = 'arka_envio_massa';
function carregar(padrao) {
  try {
    const raw = localStorage.getItem(CHAVE);
    return raw ? { ...padrao, ...JSON.parse(raw) } : padrao;
  } catch { return padrao; }
}
function salvar(valor) {
  try { localStorage.setItem(CHAVE, JSON.stringify(valor)); } catch { /* cota cheia */ }
}

// Personaliza a mensagem por destinatario. {nome} vira o nome; {primeiro_nome}
// vira so o primeiro. Sem placeholder, todo mundo recebe o mesmo texto.
function personalizar(texto, dest) {
  const nome = dest.nome || '';
  return String(texto)
    .replace(/\{nome\}/gi, nome)
    .replace(/\{primeiro_nome\}/gi, nome.split(' ')[0] || nome);
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
        className="flex-1 min-w-[160px] bg-grafite-700 border border-linha rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-acao/50" />
      <input value={telefone} onChange={e => setTelefone(e.target.value)}
        onPaste={onPaste}
        placeholder="Telefone (ex: 11987654321)"
        className="w-44 bg-grafite-700 border border-linha rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-acao/50 font-mono" />
      <button onClick={adicionar}
        className="px-3 py-2 rounded-xl bg-acao/15 hover:bg-acao/25 text-acao-200 text-xs font-semibold border border-acao/30 flex items-center gap-1.5 transition-all">
        <Plus size={13} /> Adicionar
      </button>
    </div>
  );
}

function BarraProgresso({ total, enviados, erros, status }) {
  const pct     = total > 0 ? Math.round((enviados / total) * 100) : 0;
  const pctErro = total > 0 ? Math.round((erros    / total) * 100) : 0;

  const corBarra =
    status === 'concluido' ? 'bg-ativo' :
    status === 'pausado'   ? 'bg-espera'   :
    status === 'enviando'  ? 'bg-acao'  : 'bg-slate-600';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-white">{pct}% concluído</span>
        <span className="text-slate-400">
          <span className="text-ativo-400 font-semibold">{enviados}</span> enviados ·{' '}
          <span className="text-falha-400 font-semibold">{erros}</span> erros ·{' '}
          {total} total
        </span>
      </div>
      <div className="h-3 bg-grafite-600 rounded-full overflow-hidden border border-linha flex">
        <div className={`h-full transition-all duration-500 ${corBarra}`} style={{ width: `${pct}%` }} />
        {pctErro > 0 && (
          <div className="h-full bg-falha/70" style={{ width: `${pctErro}%` }} />
        )}
      </div>
    </div>
  );
}

function ItemLog({ entry }) {
  const icone =
    entry.status === 'ok'      ? <CheckCircle2 size={12} className="text-ativo-400 shrink-0" /> :
    entry.status === 'erro'    ? <XCircle      size={12} className="text-falha-400    shrink-0" /> :
    entry.status === 'pulado'  ? <AlertTriangle size={12} className="text-espera-400  shrink-0" /> :
                                 <Clock        size={12} className="text-slate-400   shrink-0" />;
  return (
    <div className="flex items-center gap-2 py-1 border-b border-linha/50 last:border-0"
      title={entry.status === 'erro' && entry.motivo ? `Falha: ${entry.motivo}` : undefined}>
      {icone}
      <span className="flex-1 text-[11px] text-slate-300 truncate">{entry.nome}</span>
      {entry.status === 'erro' && entry.motivo && (
        <span className="text-[10px] text-falha-400/80 truncate max-w-[120px] shrink-0">{entry.motivo}</span>
      )}
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
  // Rascunho restaurado do localStorage (uma unica leitura na montagem).
  const [inicial] = useState(() => carregar({
    campanha: '', mensagem: '', destinatarios: [], intervaloDe: 2, intervaloAte: 5,
  }));

  const [campanha, setCampanha]       = useState(inicial.campanha);
  const [mensagem, setMensagem]       = useState(inicial.mensagem);
  const [destinatarios, setDest]      = useState(inicial.destinatarios);
  const [intervaloDe, setIntervaloDe] = useState(inicial.intervaloDe);
  const [intervaloAte, setIntervaloAte] = useState(inicial.intervaloAte);

  // Salva o rascunho sempre que algo relevante muda. O status/progresso do envio
  // NAO e persistido de proposito: e transitorio, cada envio recomeca do zero.
  useEffect(() => {
    salvar({ campanha, mensagem, destinatarios, intervaloDe, intervaloAte });
  }, [campanha, mensagem, destinatarios, intervaloDe, intervaloAte]);

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
        telefone: c.telefone.replace(/\D/g, '')
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

      // Intervalo aleatorio ANTES de cada envio: espaca os disparos para reduzir
      // risco de bloqueio por spam.
      const delay = (intervaloDe + Math.random() * (Math.max(intervaloAte, intervaloDe) - intervaloDe)) * 1000;
      await sleep(delay);

      // Envio REAL pelo WhatsApp (antes isto era um Math.random simulado, por
      // isso "nada acontecia"). Cada falha vira um item de erro no log, sem
      // derrubar a campanha inteira.
      let sucesso = true;
      let motivo = null;
      try {
        await WhatsAppAPI.enviar(dest.telefone, personalizar(mensagem, dest));
      } catch (e) {
        sucesso = false;
        motivo = e.message;
      }

      const entry = {
        nome:     dest.nome,
        telefone: dest.telefone,
        status:   sucesso ? 'ok' : 'erro',
        motivo,
        hora:     horaAgora()
      };

      setLogs(prev => [...prev, entry]);

      if (sucesso) setEnviados(prev => prev + 1);
      else         setErros(prev    => prev + 1);
    }

    if (!paradoRef.current) {
      setStatus('concluido');
    }
  }, [intervaloDe, intervaloAte, mensagem]);

  async function iniciarEnvio() {
    if (!mensagem.trim() || destinatarios.length === 0) return;
    // Agora o envio e real: confirma antes de disparar para todos.
    if (!window.confirm(`Enviar esta mensagem para ${destinatarios.length} destinatário(s) pelo WhatsApp?`)) return;
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
   
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-linha">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight font-display">Envio em Massa</h1>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">
            Dispare mensagens para múltiplos contatos com controle de progresso.
          </p>
        </div>
        {status === 'concluido' && (
          <button onClick={() => exportarLog(logs, campanha)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-ativo/10 hover:bg-ativo/20 text-ativo-400 text-xs font-semibold border border-ativo/30 transition-all">
            <Download size={14} /> Exportar Relatório
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 space-y-4">
          <div className="glass-panel rounded-2xl p-5 border border-linha space-y-4">
            <h3 className="text-sm font-bold text-white font-display flex items-center gap-2">
              <FileText size={15} className="text-acao-200" /> Configuração da Campanha
            </h3>
            <div>
              <label className="text-xs text-slate-400 font-medium block mb-1.5">Nome da Campanha</label>
              <input value={campanha} onChange={e => setCampanha(e.target.value)}
                placeholder="Ex: Promoção Julho 2026..."
                disabled={emExecucao}
                className="w-full bg-grafite-700 border border-linha rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-acao/50 disabled:opacity-50" />
            </div>
            <div>
              <label className="text-xs text-slate-400 font-medium block mb-1.5">
                Mensagem <span className="text-slate-500">({mensagem.length} caracteres)</span>
              </label>
              <textarea value={mensagem} onChange={e => setMensagem(e.target.value)} rows={6}
                placeholder="Digite a mensagem que será enviada para todos os destinatários..."
                disabled={emExecucao}
                className="w-full bg-grafite-700 border border-linha rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-acao/50 resize-none disabled:opacity-50 font-mono leading-relaxed" />
              <p className="mt-1.5 text-[10px] text-slate-500">
                Use <code className="text-acao-200">{'{nome}'}</code> ou <code className="text-acao-200">{'{primeiro_nome}'}</code> para personalizar por destinatário.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 font-medium block mb-1.5">Intervalo mínimo (s)</label>
                <input type="number" min={1} max={60} value={intervaloDe}
                  onChange={e => setIntervaloDe(Number(e.target.value))}
                  disabled={emExecucao}
                  className="w-full bg-grafite-700 border border-linha rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-acao/50 disabled:opacity-50" />
              </div>
              <div>
                <label className="text-xs text-slate-400 font-medium block mb-1.5">Intervalo máximo (s)</label>
                <input type="number" min={1} max={120} value={intervaloAte}
                  onChange={e => setIntervaloAte(Number(e.target.value))}
                  disabled={emExecucao}
                  className="w-full bg-grafite-700 border border-linha rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-acao/50 disabled:opacity-50" />
              </div>
            </div>
            <div className="p-3 rounded-xl bg-espera/5 border border-espera/20 text-[11px] text-espera-400 flex items-start gap-2">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              Intervalo aleatório entre envios evita bloqueio por spam. Recomendado: mínimo 2s / máximo 8s.
            </div>
          </div>

          <div className="glass-panel rounded-2xl p-5 border border-linha space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white font-display flex items-center gap-2">
                <Users size={15} className="text-acao-200" /> Destinatários ({destinatarios.length})
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
                <div key={d.id} className="flex items-center justify-between px-3 py-2 rounded-xl bg-grafite-600 border border-linha">
                  <div>
                    <span className="text-xs font-semibold text-white">{d.nome}</span>
                    <span className="text-[11px] text-slate-400 font-mono ml-2">{d.telefone}</span>
                  </div>
                  {!emExecucao && (
                    <button onClick={() => removerContato(d.id)} className="text-falha-400 hover:bg-slate-800 p-1 rounded-lg transition-colors">
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
                className="text-xs text-falha-400 hover:text-falha-400 flex items-center gap-1 transition-colors">
                <Trash2 size={11} /> Limpar todos
              </button>
            )}
          </div>
        </div>

        <div className="lg:col-span-5 space-y-4">
          <div className="glass-panel rounded-2xl p-5 border border-linha space-y-4">
            <h3 className="text-sm font-bold text-white font-display flex items-center gap-2">
              <Send size={15} className="text-acao-200" /> Controle de Envio
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
              status === 'idle'      ? 'bg-slate-800 border-linha text-slate-400' :
              status === 'enviando'  ? 'bg-acao/10 border-acao/30 text-acao-200' :
              status === 'pausado'   ? 'bg-espera/10  border-espera/30  text-espera-400'  :
              status === 'concluido' ? 'bg-ativo/10 border-ativo/30 text-ativo-400' : ''
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
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-acao to-espera hover:from-acao-200 hover:to-espera-400 text-slate-950 text-xs font-bold flex items-center justify-center gap-2 shadow-md shadow-acao/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
                  <Play size={13} fill="currentColor" /> Iniciar Envio
                </button>
              )}
              {emExecucao && (
                <>
                  <button onClick={pausarResumir}
                    className="flex-1 py-2.5 rounded-xl bg-espera/15 hover:bg-espera/25 text-espera-400 text-xs font-bold border border-espera/30 flex items-center justify-center gap-2 transition-all">
                    {status === 'pausado' ? <><Play size={13} /> Retomar</> : <><Pause size={13} /> Pausar</>}
                  </button>
                  <button onClick={pararEnvio}
                    className="py-2.5 px-3 rounded-xl bg-falha/15 hover:bg-falha/25 text-falha-400 text-xs font-bold border border-falha/30 flex items-center gap-1 transition-all">
                    <StopCircle size={13} /> Parar
                  </button>
                </>
              )}
              {status === 'concluido' && (
                <button onClick={resetar}
                  className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-linha flex items-center justify-center gap-2 transition-all">
                  <RotateCcw size={13} /> Nova Campanha
                </button>
              )}
            </div>
          </div>

          {logs.length > 0 && (
            <div className="glass-panel rounded-2xl p-4 border border-linha space-y-2">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-xs font-bold text-white flex items-center gap-2">
                  <MessageSquare size={13} className="text-acao-200" /> Log de Envios
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
