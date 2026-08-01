import React, { useState, useEffect, useCallback } from 'react';
import {
  Workflow, Play, Power, Trash2, Plus, RefreshCw, Loader2,
  CheckCircle2, XCircle, Clock, Pencil, ExternalLink
} from 'lucide-react';
import { N8nAPI } from '../../services/api';

function formatarData(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatarDuracao(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 60000)} min`;
}

const STATUS_EXEC = {
  success: { label: 'Sucesso', cor: 'text-ativo-400', Icon: CheckCircle2 },
  error:   { label: 'Erro',    cor: 'text-falha-400',    Icon: XCircle },
  running: { label: 'Rodando', cor: 'text-espera-400',   Icon: Loader2 },
};

export default function PainelN8n() {
  const [conexao, setConexao] = useState(null);
  const [workflows, setWorkflows] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [ocupadoId, setOcupadoId] = useState(null);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('');
    try {
      const st = await N8nAPI.status();
      setConexao(st);
      if (st?.conectado) {
        setWorkflows(await N8nAPI.listar());
      } else {
        setWorkflows([]);
      }
    } catch (e) {
      setErro(e.message);
      setConexao({ conectado: false, erro: e.message });
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const acao = useCallback(async (id, fn) => {
    setOcupadoId(id); setErro('');
    try {
      await fn();
      setWorkflows(await N8nAPI.listar());
    } catch (e) {
      setErro(e.message);
    } finally {
      setOcupadoId(null);
    }
  }, []);

  const criar = async () => {
    const nome = window.prompt('Nome do novo workflow no n8n:');
    if (!nome?.trim()) return;
    await acao('novo', () => N8nAPI.criar(nome.trim()));
  };

  const renomear = async (w) => {
    const nome = window.prompt('Novo nome:', w.nome);
    if (!nome?.trim() || nome === w.nome) return;
    await acao(w.id, () => N8nAPI.renomear(w.id, nome.trim()));
  };

  const excluir = async (w) => {
    if (!window.confirm(`Excluir o workflow "${w.nome}" do n8n?\n\nEssa ação é feita no próprio n8n e não pode ser desfeita.`)) return;
    await acao(w.id, () => N8nAPI.remover(w.id));
  };

  const conectado = !!conexao?.conectado;

  return (
    <div className="space-y-4">
      <div className="glass-panel p-5 rounded-2xl border border-linha flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`w-11 h-11 rounded-2xl flex items-center justify-center border ${
            conectado
              ? 'bg-ativo/15 text-ativo-400 border-ativo/30'
              : 'bg-falha/15 text-falha-400 border-falha/30'
          }`}>
            <Workflow size={22} />
          </div>
          <div>
            <div className="font-bold text-sm text-white font-display flex items-center gap-2">
              Automações n8n
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                conectado ? 'bg-ativo/20 text-ativo-400' : 'bg-falha/20 text-falha-400'
              }`}>
                {conectado ? '🟢 n8n Online' : '🔴 Offline'}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {conectado
                ? `${workflows.length} workflow(s) • resposta em ${conexao.latenciaMs ?? '—'} ms`
                : 'Configure a URL e a API Key do n8n em Configurações.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={carregar} disabled={carregando}
            className="px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-2 bg-grafite-700 border border-linha text-slate-300 hover:text-white hover:border-slate-600 transition-all disabled:opacity-60">
            <RefreshCw size={14} className={carregando ? 'animate-spin' : ''} /> Atualizar
          </button>
          <button onClick={criar} disabled={!conectado || ocupadoId === 'novo'}
            className="px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-2 bg-acao hover:bg-acao-200 text-slate-950 transition-all disabled:opacity-50">
            {ocupadoId === 'novo' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Novo Workflow
          </button>
        </div>
      </div>

      {(erro || (!conectado && conexao?.erro)) && (
        <div className="p-3 rounded-xl bg-espera/10 border border-espera/30 text-xs text-espera-400">
          {erro || conexao.erro}
        </div>
      )}

      {carregando ? (
        <div className="space-y-2">
          {[0, 1, 2].map(i => (
            <div key={i} className="glass-panel p-4 rounded-2xl border border-linha animate-pulse flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-slate-700/50" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-40 rounded bg-slate-700/50" />
                <div className="h-2.5 w-64 rounded bg-slate-700/40" />
              </div>
            </div>
          ))}
        </div>
      ) : workflows.length === 0 ? (
        <div className="glass-panel p-10 rounded-2xl border border-linha text-center">
          <div className="inline-flex p-4 rounded-2xl bg-grafite-600 border border-linha mb-3 text-slate-500">
            <Workflow size={30} />
          </div>
          <p className="text-xs font-semibold text-slate-300">
            {conectado ? 'Nenhum workflow no n8n.' : 'n8n não conectado.'}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">
            {conectado
              ? 'Crie o primeiro com o botão "Novo Workflow".'
              : 'Informe URL e API Key em Configurações e teste a conexão.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {workflows.map(w => {
            const st = STATUS_EXEC[w.ultimaExecucao?.status] || null;
            const ocupado = ocupadoId === w.id;
            return (
              <div key={w.id} className="glass-panel p-4 rounded-2xl border border-linha flex flex-wrap items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center border shrink-0 ${
                  w.ativo
                    ? 'bg-ativo/15 text-ativo-400 border-ativo/30'
                    : 'bg-slate-700/30 text-slate-500 border-slate-700'
                }`}>
                  <Workflow size={18} />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-white truncate">{w.nome}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                      w.ativo ? 'bg-ativo/20 text-ativo-400' : 'bg-slate-600/30 text-slate-400'
                    }`}>
                      {w.status}
                    </span>
                    {!w.webhookPath && (
                      <span className="text-[10px] text-slate-500" title="Sem nó de Webhook: não dá para executar manualmente">
                        sem webhook
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                    <span className="flex items-center gap-1">
                      {st ? <st.Icon size={11} className={st.cor} /> : <Clock size={11} />}
                      Última: {formatarData(w.ultimaExecucao?.em)}
                    </span>
                    <span>Execuções: <strong className="text-slate-300">{w.execucoes}</strong></span>
                    <span>Tempo médio: <strong className="text-slate-300">{formatarDuracao(w.tempoMedioMs)}</strong></span>
                    {w.proximaExecucao && <span>Próxima: {w.proximaExecucao}</span>}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => acao(w.id, () => N8nAPI.executar(w.id))}
                    disabled={ocupado || !w.webhookPath}
                    title={w.webhookPath ? 'Executar agora' : 'Adicione um Webhook Trigger no n8n para executar manualmente'}
                    className="p-2 rounded-lg bg-slate-800/80 hover:bg-acao/20 text-acao-200 transition-colors disabled:opacity-40">
                    {ocupado ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                  </button>
                  <button onClick={() => acao(w.id, () => N8nAPI.alternarAtivo(w.id, !w.ativo))}
                    disabled={ocupado} title={w.ativo ? 'Desativar' : 'Ativar'}
                    className={`p-2 rounded-lg bg-slate-800/80 transition-colors disabled:opacity-40 ${
                      w.ativo ? 'text-ativo-400 hover:bg-ativo/20' : 'text-slate-400 hover:bg-slate-700'
                    }`}>
                    <Power size={13} />
                  </button>
                  <button onClick={() => renomear(w)} disabled={ocupado} title="Renomear"
                    className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 transition-colors disabled:opacity-40">
                    <Pencil size={13} />
                  </button>
                  <button onClick={() => excluir(w)} disabled={ocupado} title="Excluir workflow"
                    className="p-2 rounded-lg bg-slate-800/80 hover:bg-falha/20 text-falha-400 transition-colors disabled:opacity-40">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
