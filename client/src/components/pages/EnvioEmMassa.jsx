import { useState, useCallback, useEffect } from 'react';
import {
  Send, Plus, Trash2, Upload, Play, Pause, StopCircle,
  CheckCircle2, XCircle, Clock, Users, MessageSquare,
  AlertTriangle, FileText, X, RotateCcw, Download
} from 'lucide-react';
import { CampanhasAPI } from '../../services/api';
import { FUSO_BR } from '../../utils/data';


// A campanha vive no SERVIDOR (tabela `campanhas`), nao mais no localStorage.
// Antes o rascunho e o laco de envio ficavam no navegador: fechar a aba parava
// a campanha no meio e o intervalo anti-bloqueio era so uma regra de tela.
// Agora a tela cria a campanha, manda iniciar/pausar e acompanha o progresso.

// Status do servidor -> rotulo usado por esta tela.
const STATUS_UI = {
  rascunho: 'idle',
  enviando: 'enviando',
  pausada: 'pausado',
  concluida: 'concluido',
  cancelada: 'idle',
};

// A personalizacao ({nome}, {primeiro_nome}) e feita pelo SERVIDOR, ao enviar.

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
    ['Exportado em', new Date().toLocaleString('pt-BR', { timeZone: FUSO_BR })],
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
  const [erroApi, setErroApi]   = useState('');
  // Id da campanha no servidor (existe a partir do "Iniciar").
  const [campanhaId, setCampanhaId] = useState(null);

  // Espelha o estado do servidor na tela. O progresso NAO e calculado aqui:
  // enviados/falhas/status vem do banco, entao fechar a aba nao perde nada.
  const aplicarDoServidor = useCallback((c) => {
    if (!c) return;
    setStatus(STATUS_UI[c.status] || 'idle');
    setEnviados(c.enviados || 0);
    setErros(c.falhas || 0);
    setIndiceAtual((c.enviados || 0) + (c.falhas || 0));
    if (Array.isArray(c.destinatarios)) {
      setLogs(
        c.destinatarios
          .filter(d => d.status !== 'pendente')
          .map(d => ({
            nome: d.nome || d.telefone,
            telefone: d.telefone,
            status: d.status === 'enviado' ? 'ok' : 'erro',
            motivo: d.erro || null,
            hora: d.enviadoEm
              ? new Date(d.enviadoEm).toLocaleTimeString('pt-BR', {
                  hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: FUSO_BR,
                })
              : '',
          }))
      );
    }
  }, []);

  // Enquanto a campanha roda no servidor, a tela so consulta o progresso.
  useEffect(() => {
    if (!campanhaId || (status !== 'enviando' && status !== 'pausado')) return;
    let vivo = true;
    const id = setInterval(async () => {
      try {
        const c = await CampanhasAPI.obter(campanhaId);
        if (vivo) aplicarDoServidor(c);
      } catch { /* rede instavel: tenta de novo no proximo tique */ }
    }, 2000);
    return () => { vivo = false; clearInterval(id); };
  }, [campanhaId, status, aplicarDoServidor]);

  // Ao abrir a tela, retoma o acompanhamento de uma campanha que ficou rodando
  // (ex.: o operador fechou a aba no meio do envio).
  useEffect(() => {
    (async () => {
      try {
        const lista = await CampanhasAPI.listar();
        const ativa = (lista || []).find(c => c.status === 'enviando' || c.status === 'pausada');
        if (!ativa) return;
        const c = await CampanhasAPI.obter(ativa.id);
        setCampanhaId(c.id);
        setCampanha(c.nome || '');
        setMensagem(c.mensagem || '');
        setIntervaloDe(c.intervaloDe);
        setIntervaloAte(c.intervaloAte);
        setDest((c.destinatarios || []).map(d => ({
          id: d.id, nome: d.nome || d.telefone, telefone: d.telefone,
        })));
        aplicarDoServidor(c);
      } catch { /* sem campanha ativa ou sem permissao: tela em branco mesmo */ }
    })();
  }, [aplicarDoServidor]);

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

  // Limpa a tela para montar uma nova campanha. Nao apaga nada no servidor: a
  // campanha anterior fica no historico com o resultado dela.
  function resetar() {
    setCampanhaId(null);
    setStatus('idle');
    setEnviados(0);
    setErros(0);
    setLogs([]);
    setIndiceAtual(0);
    setErroApi('');
  }

  // Cria a campanha no servidor e manda iniciar. A partir daqui o disparo e do
  // backend: fechar a aba NAO interrompe mais o envio.
  async function iniciarEnvio() {
    if (!mensagem.trim() || destinatarios.length === 0) return;
    if (!window.confirm(`Enviar esta mensagem para ${destinatarios.length} destinatário(s) pelo WhatsApp?`)) return;
    setErroApi('');
    try {
      let id = campanhaId;
      if (!id) {
        const criada = await CampanhasAPI.criar({
          nome: campanha,
          mensagem,
          destinatarios: destinatarios.map(d => ({ nome: d.nome, telefone: d.telefone })),
          intervaloDe: Number(intervaloDe),
          intervaloAte: Number(intervaloAte),
        });
        id = criada.id;
        setCampanhaId(id);
        // O servidor normaliza o intervalo (piso anti-bloqueio) e descarta
        // telefones invalidos/repetidos: refletimos o que ele realmente gravou.
        setIntervaloDe(criada.intervaloDe);
        setIntervaloAte(criada.intervaloAte);
      }
      aplicarDoServidor(await CampanhasAPI.iniciar(id));
      setStatus('enviando'); // o polling assume a partir daqui
    } catch (e) {
      setErroApi(e.message);
    }
  }

  async function pausarResumir() {
    if (!campanhaId) return;
    setErroApi('');
    try {
      const c = status === 'enviando'
        ? await CampanhasAPI.pausar(campanhaId)
        : await CampanhasAPI.iniciar(campanhaId);
      aplicarDoServidor(c);
      setStatus(status === 'enviando' ? 'pausado' : 'enviando');
    } catch (e) {
      setErroApi(e.message);
    }
  }

  async function pararEnvio() {
    if (!campanhaId) { resetar(); return; }
    if (!window.confirm('Cancelar esta campanha? Os envios restantes não serão feitos.')) return;
    try {
      await CampanhasAPI.cancelar(campanhaId);
      setStatus('idle');
      setCampanhaId(null);
    } catch (e) {
      setErroApi(e.message);
    }
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
              Intervalo aleatório entre envios evita bloqueio por spam recomendado: mínimo 2s / máximo 8s.
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

            {/* Erro vindo do servidor (ex.: ja existe campanha em andamento,
                destinatario invalido, sem permissao). */}
            {erroApi && (
              <div className="p-2.5 rounded-xl bg-falha/10 border border-falha/30 text-[11px] text-falha-400">
                {erroApi}
              </div>
            )}

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
