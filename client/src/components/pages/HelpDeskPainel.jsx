/**
 * Painel de Suporte (Help Desk) conteúdo da aba dentro da Visão Geral.
 *
 * Tudo derivado das conversas que já existem no banco: backlog, tempos de
 * resposta/resolução, SLA, volume e recorte por setor. Só leitura.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Inbox, Timer, CheckCircle2, Gauge, Star, RefreshCw,
  Loader2, AlertTriangle, Clock, TrendingUp, SlidersHorizontal, Save, Lock
} from 'lucide-react';
import { HelpDeskAPI, ConfiguracoesAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

/**
 * Configuração das metas de SLA que alimentam os indicadores acima.
 *
 * As metas viviam como constantes no servidor: mudar de 15 min para 10 min
 * exigia deploy. Agora ficam na tabela de Configuração (chave `helpdesk.sla`) e
 * o painel recalcula na hora.
 *
 * Só quem tem o módulo "configuracoes" enxerga os campos -- e o servidor é a
 * autoridade: a rota de salvar já exige esse módulo, então esconder aqui é
 * apenas conveniência, não a proteção.
 */
function ConfigIndicadores({ sla, onSalvo }) {
  const { usuario } = useAuth();
  const permissoes = usuario?.permissoes;
  const podeEditar = !Array.isArray(permissoes) || permissoes.includes('configuracoes');

  const [respostaMin, setRespostaMin] = useState(sla?.respostaLimiteMin ?? 15);
  const [resolucaoHoras, setResolucaoHoras] = useState(sla?.resolucaoLimiteHoras ?? 24);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState('');

  // Reflete o que veio do servidor quando as métricas são recarregadas.
  useEffect(() => {
    setRespostaMin(sla?.respostaLimiteMin ?? 15);
    setResolucaoHoras(sla?.resolucaoLimiteHoras ?? 24);
  }, [sla?.respostaLimiteMin, sla?.resolucaoLimiteHoras]);

  async function salvar() {
    setSalvando(true); setErro(''); setSalvo(false);
    try {
      await ConfiguracoesAPI.salvar({
        'helpdesk.sla': JSON.stringify({
          respostaMin: Number(respostaMin),
          resolucaoHoras: Number(resolucaoHoras),
        }),
      });
      setSalvo(true);
      setTimeout(() => setSalvo(false), 3000);
      onSalvo?.(); // recarrega os indicadores com a meta nova
    } catch (e) {
      setErro(e.message);
    } finally {
      setSalvando(false);
    }
  }

  const campo = 'w-full bg-grafite-700 border border-linha rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-acao/50';

  return (
    <div className="glass-panel rounded-2xl p-5 border border-linha space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-white font-display flex items-center gap-2">
          <SlidersHorizontal size={15} className="text-acao-200" /> Configurações de métricas e indicadores
        </h3>
        {!podeEditar && (
          <span className="text-[10px] text-slate-500 flex items-center gap-1 shrink-0">
            <Lock size={11} /> somente leitura
          </span>
        )}
      </div>
      <p className="text-[11px] text-slate-400 leading-relaxed">
        Metas usadas para calcular o <strong className="text-slate-300">SLA</strong> dos indicadores acima.
        Ao salvar, os números são recalculados na hora — vale para toda a equipe.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="text-xs text-slate-400 block mb-1.5 font-medium">
            Meta de 1ª resposta <span className="text-slate-500">(minutos)</span>
          </label>
          <input type="number" min="1" max="1440" className={campo} disabled={!podeEditar}
            value={respostaMin} onChange={e => setRespostaMin(e.target.value)} />
          <p className="mt-1 text-[10px] text-slate-500">Padrão: 15 min. Entre 1 min e 24 h.</p>
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1.5 font-medium">
            Meta de resolução <span className="text-slate-500">(horas)</span>
          </label>
          <input type="number" min="1" max="720" className={campo} disabled={!podeEditar}
            value={resolucaoHoras} onChange={e => setResolucaoHoras(e.target.value)} />
          <p className="mt-1 text-[10px] text-slate-500">Padrão: 24 h. Entre 1 h e 30 dias.</p>
        </div>
      </div>

      {erro && <p className="text-[11px] text-falha-400">{erro}</p>}

      {podeEditar && (
        <button onClick={salvar} disabled={salvando}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-acao hover:bg-acao-200 text-slate-950 text-xs font-bold transition-all disabled:opacity-60">
          {salvando ? <Loader2 size={14} className="animate-spin" /> : salvo ? <CheckCircle2 size={14} /> : <Save size={14} />}
          {salvando ? 'Salvando...' : salvo ? 'Salvo!' : 'Salvar metas'}
        </button>
      )}
    </div>
  );
}

function fmtDuracao(seg, amostra = 1) {
  if (!amostra) return '-';
  if (!seg || seg < 0) return '-';
  const s = Math.round(seg);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function fmtIdade(min) {
  if (min == null) return '-';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ${min % 60}min`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function Kpi({ icon: Icon, cor, titulo, valor, sub }) {
  const map = {
    blue: 'bg-blue-500/10 border-blue-500/30 text-blue-400',
    amber: 'bg-espera/10 border-espera/30 text-espera-400',
    emerald: 'bg-ativo/10 border-ativo/30 text-ativo-400',
    orange: 'bg-acao/10 border-acao/30 text-acao-200',
    yellow: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-300',
    red: 'bg-falha/10 border-falha/30 text-falha-400',
  };
  return (
    <div className="glass-panel p-5 rounded-2xl border border-linha flex items-center gap-4">
      <div className={`p-3 rounded-xl border shrink-0 ${map[cor]}`}><Icon size={18} /></div>
      <div className="min-w-0">
        <div className="text-2xl font-bold text-white font-display leading-tight">{valor}</div>
        <div className="text-xs text-slate-400">{titulo}</div>
        {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

export default function HelpDeskPainel() {
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      setDados(await HelpDeskAPI.metricas());
    } catch (e) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-slate-400 text-xs sm:text-sm">
          Backlog, tempos de resposta e resolução, SLA e volume em tempo real.
        </p>
        <button onClick={carregar} disabled={carregando}
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-grafite-700 border border-linha text-slate-300 hover:text-white hover:border-linha-forte text-xs font-bold transition-all shrink-0 disabled:opacity-60">
          {carregando ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          Atualizar
        </button>
      </div>

      {erro && (
        <div className="p-3 rounded-xl bg-falha/10 border border-falha/30 text-xs text-falha-400">{erro}</div>
      )}

      {carregando && !dados ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2, 3, 4, 5].map(i => (
            <div key={i} className="glass-panel p-5 rounded-2xl border border-linha animate-pulse h-20" />
          ))}
        </div>
      ) : dados ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Kpi icon={Inbox} cor="amber" titulo="Backlog (fila + em atendimento)"
              valor={dados.backlog.total}
              sub={`${dados.backlog.pendente} na fila · ${dados.backlog.aberta} em atendimento`} />
            <Kpi icon={Clock} cor="red" titulo="Aguardando há mais tempo"
              valor={fmtIdade(dados.backlog.maisAntigoMin)}
              sub={dados.backlog.pendente ? 'conversa mais antiga na fila' : 'fila vazia'} />
            <Kpi icon={Timer} cor="blue" titulo="Tempo médio de 1ª resposta"
              valor={fmtDuracao(dados.tempos.respostaMedioSeg, dados.tempos.respostaAmostra)}
              sub={`base: ${dados.tempos.respostaAmostra} atendimento(s)`} />
            <Kpi icon={CheckCircle2} cor="emerald" titulo="Tempo médio de resolução"
              valor={fmtDuracao(dados.tempos.resolucaoMedioSeg, dados.tempos.resolucaoAmostra)}
              sub={`base: ${dados.tempos.resolucaoAmostra} fechado(s)`} />
            <Kpi icon={Gauge} cor="orange" titulo={`SLA de resposta (≤ ${dados.sla.respostaLimiteMin} min)`}
              valor={dados.sla.respostaPct == null ? '-' : `${dados.sla.respostaPct}%`}
              sub={`taxa de resolução: ${dados.taxaResolucao}%`} />
            <Kpi icon={Star} cor="yellow" titulo="Satisfação (CSAT)"
              valor={dados.csat.total ? dados.csat.media.toFixed(1) : '-'}
              sub={dados.csat.total ? `${dados.csat.total} avaliação(ões)` : 'sem avaliações ainda'} />
          </div>

          <div className="glass-panel rounded-2xl p-5 border border-linha">
            <h3 className="text-sm font-bold text-white font-display mb-4 flex items-center gap-2">
              <TrendingUp size={15} className="text-acao-200" /> Volume de atendimentos
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                ['Hoje', dados.volume.hoje],
                ['Últimos 7 dias', dados.volume.semana],
                ['Últimos 30 dias', dados.volume.mes],
                ['Total', dados.volume.total],
              ].map(([label, val]) => (
                <div key={label} className="p-4 rounded-xl bg-grafite-600/50 border border-linha text-center">
                  <div className="text-2xl font-bold text-white font-display">{val}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{label}</div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-4 mt-4 text-[11px] text-slate-400">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-espera" /> {dados.status.pendente} na fila</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-ativo" /> {dados.status.aberta} em atendimento</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-quieto" /> {dados.status.fechada} fechados</span>
            </div>
          </div>

          <div className="glass-panel rounded-2xl p-5 border border-linha">
            <h3 className="text-sm font-bold text-white font-display mb-4 flex items-center gap-2">
              <AlertTriangle size={15} className="text-espera-400" /> Por setor
            </h3>
            {dados.porSetor.length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center">Nenhum atendimento registrado ainda.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-linha text-slate-400">
                      <th className="text-left py-2.5 px-3 font-semibold">Setor</th>
                      <th className="text-center py-2.5 px-3 font-semibold">Total</th>
                      <th className="text-center py-2.5 px-3 font-semibold">Backlog</th>
                      <th className="text-center py-2.5 px-3 font-semibold">Fechados</th>
                      <th className="text-center py-2.5 px-3 font-semibold">1ª resposta (média)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.porSetor.map(s => (
                      <tr key={s.setor} className="border-b border-linha/40 hover:bg-grafite-600/40 transition-colors">
                        <td className="py-2.5 px-3 text-white font-semibold">{s.setor}</td>
                        <td className="py-2.5 px-3 text-center text-slate-300">{s.total}</td>
                        <td className="py-2.5 px-3 text-center">
                          <span className={s.backlog > 0 ? 'text-espera-400 font-semibold' : 'text-slate-500'}>{s.backlog}</span>
                        </td>
                        <td className="py-2.5 px-3 text-center text-ativo-400">{s.fechadas}</td>
                        <td className="py-2.5 px-3 text-center text-slate-300 font-mono">
                          {fmtDuracao(s.respostaMedioSeg, s.respostaAmostra)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <ConfigIndicadores sla={dados.sla} onSalvo={carregar} />

          <p className="text-[10px] text-slate-500">
            Atualizado em {new Date(dados.geradoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.
          </p>
        </>
      ) : null}
    </div>
  );
}
