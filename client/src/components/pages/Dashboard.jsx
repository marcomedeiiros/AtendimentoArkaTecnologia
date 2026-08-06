import { useState, useMemo, useRef, useCallback } from 'react';
import {
  Users, ShieldCheck, Clock, TrendingUp,
  Download, ArrowRight, Activity, CheckCircle2, Inbox,
  BarChart3, FileText, Loader2, Star, MessageCircle
} from 'lucide-react';
// So o Doughnut sobrou nesta tela: ele precisa de ArcElement. Escalas e
// elementos de linha/barra ficaram registrados sem grafico que os usasse.
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { Doughnut } from 'react-chartjs-2';
import { EmojiIcon } from './EmojiIcon';
import { exportarRelatorioPdf } from '../../utils/exportarPdf';

ChartJS.register(ArcElement, Tooltip, Legend);

const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#94A3B8', font: { size: 11 }, boxWidth: 12 } },
    tooltip: {
      backgroundColor: '#1E2330',
      titleColor: '#F8FAFC',
      bodyColor: '#94A3B8',
      borderColor: '#2A3040',
      borderWidth: 1
    }
  },
  scales: {
    x: { ticks: { color: '#64748B', font: { size: 10 } }, grid: { color: '#1E2330' } },
    y: { ticks: { color: '#64748B', font: { size: 10 } }, grid: { color: '#1E2330' } }
  }
};

function calcularMetricas(conversas, parceiros, equipe) {

  // Status atuais: aberta | pendente | fechada.
  const ativas = conversas.filter(c => c.statusAtendimento === 'aberta').length;
  const aguardando = conversas.filter(c => c.statusAtendimento === 'pendente').length;
  const finalizados = conversas.filter(c => c.statusAtendimento === 'fechada').length;
  return {
    totalAtendimentos: conversas.length,
    demandasAtivas: ativas + aguardando,
    atendimentosAbertos: ativas + aguardando,
    atendimentosPendentes: aguardando,
    atendimentosFechados: finalizados,
    parceirosPeriodo: parceiros.filter(p => p.status === 'ativo').length,
    equipeOnline: equipe.filter(e => e.status === 'online').length,
    totalEquipe: equipe.length
  };
}

function MetricCard({ label, valor, icon: Icon, color, sublabel, onClick }) {
  const map = {
    orange: 'bg-acao/10 border-acao/30 text-acao-200',
    emerald:'bg-ativo/10 border-ativo/30 text-ativo-400',
    blue:   'bg-blue-500/10 border-blue-500/30 text-blue-400',
    purple: 'bg-purple-500/10 border-purple-500/30 text-purple-400',
    amber:  'bg-espera/10 border-espera/30 text-espera-400',
    indigo: 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400'
  };
  return (
    <div onClick={onClick} className={`glass-card p-5 rounded-2xl border border-linha flex flex-col justify-between gap-3 ${onClick ? 'cursor-pointer hover:border-acao/40 transition-all' : ''}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-400">{label}</span>
        <span className={`p-2 rounded-xl border ${map[color] || map.orange}`}><Icon size={15} /></span>
      </div>
      <div>
        <div className="text-3xl font-bold text-white tracking-tight font-display">{valor}</div>
        {sublabel && <div className="text-[11px] text-slate-500 mt-1">{sublabel}</div>}
      </div>
    </div>
  );
}

function exportarRelatorio(metricas) {
  const linhas = [
    ['Relatório Arka Tecnologia',''],
    ['Gerado em', new Date().toLocaleString('pt-BR')],
    ['',''],
    ['Métrica','Valor'],
    ['Total de Atendimentos', metricas.totalAtendimentos],
    ['Demandas Ativas', metricas.demandasAtivas],
    ['Abertos', metricas.atendimentosAbertos],
    ['Pendentes', metricas.atendimentosPendentes],
    ['Fechados', metricas.atendimentosFechados],
    ['Parceiros Ativos', metricas.parceirosPeriodo],
    ['Equipe Online', `${metricas.equipeOnline}/${metricas.totalEquipe}`],
  ];
  const csv = linhas.map(r => r.join(';')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `relatorio-arka-${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

export default function Dashboard({ equipe, fluxos, parceiros, conversas, setAba }) {
  const metricas = useMemo(
    () => calcularMetricas(conversas, parceiros, equipe),
    [conversas, parceiros, equipe]
  );
  const [gerandoPdf, setGerandoPdf] = useState(false);
  const [abaAtiva, setAbaAtiva] = useState('geral');
  const graficosRef = useRef(null);

  // ---------- Avaliações ----------
  const avaliacoes = useMemo(() => {
    const avaliadas = conversas.filter(c => c.avaliacao != null && c.avaliacao > 0);
    const total = avaliadas.length;
    const soma = avaliadas.reduce((s, c) => s + c.avaliacao, 0);
    const media = total > 0 ? (soma / total) : 0;
    const distribuicao = [1, 2, 3, 4, 5].map(n => ({
      nota: n,
      qtd: avaliadas.filter(c => c.avaliacao === n).length
    }));
    const maxQtd = Math.max(1, ...distribuicao.map(d => d.qtd));
    return { avaliadas, total, media, distribuicao, maxQtd };
  }, [conversas]);

  const exportarPdf = useCallback(async () => {
    setGerandoPdf(true);
    try {
      await exportarRelatorioPdf({
        elemento: graficosRef.current,
        filtros: 'Período: últimos 7 dias • Todas as instâncias • Todos os status',
        metricas: [
          ['Total de Atendimentos', metricas.totalAtendimentos],
          ['Demandas Ativas', metricas.demandasAtivas],
          ['Abertos', metricas.atendimentosAbertos],
          ['Pendentes', metricas.atendimentosPendentes],
          ['Fechados', metricas.atendimentosFechados],
          ['Parceiros Ativos', metricas.parceirosPeriodo],
          ['Equipe Online', `${metricas.equipeOnline}/${metricas.totalEquipe}`],
        ],
        resumo:
          `No período, foram registrados ${metricas.totalAtendimentos} atendimento(s), ` +
          `sendo ${metricas.atendimentosAbertos} em aberto, ${metricas.atendimentosPendentes} pendente(s) ` +
          `e ${metricas.atendimentosFechados} fechado(s). A equipe conta com ${metricas.equipeOnline} de ` +
          `${metricas.totalEquipe} operador(es) online e ${metricas.parceirosPeriodo} parceiro(s) ativo(s).`
      });
    } catch (e) {
      window.alert('Não foi possível gerar o PDF: ' + e.message);
    } finally {
      setGerandoPdf(false);
    }
  }, [metricas]);

  const doughnutData = useMemo(() => {
    // Sem `|| 1`: um zero real precisa aparecer como zero. O fallback antigo
    // pintava uma fatia de tamanho 1 para categoria vazia, o que fazia o grafico
    // mostrar uma divisao igual em tres partes quando nao havia nada.
    const abertos  = conversas.filter(c => c.statusAtendimento === 'aberta').length;
    const aguard   = conversas.filter(c => c.statusAtendimento === 'pendente').length;
    const fechados = conversas.filter(c => c.statusAtendimento === 'fechada').length;
    return {
      labels: ['Em atendimento', 'Aguardando', 'Finalizados'],
      datasets: [{
        data: [abertos, aguard, fechados],
        backgroundColor: ['rgba(249,115,22,0.8)', 'rgba(245,158,11,0.8)', 'rgba(16,185,129,0.8)'],
        borderColor: ['#F97316', '#F59E0B', '#10B981'],
        borderWidth: 2,
        hoverOffset: 6
      }]
    };
  }, [conversas]);

  const cards = [
    { label: 'Total de Atendimentos', valor: metricas.totalAtendimentos, icon: BarChart3,   color: 'orange',  sublabel: 'Conversas registradas' },
    { label: 'Demandas Ativas',       valor: metricas.demandasAtivas,    icon: Activity,    color: 'emerald', sublabel: 'Em atendimento + fila', onClick: () => setAba('atendimento') },
    { label: 'Equipe Online',         valor: `${metricas.equipeOnline}/${metricas.totalEquipe}`, icon: Users, color: 'blue', sublabel: 'Atendentes disponíveis', onClick: () => setAba('equipe') },
    { label: 'Parceiros Ativos',      valor: metricas.parceirosPeriodo,  icon: ShieldCheck, color: 'purple',  sublabel: 'CNPJs cadastrados ativos', onClick: () => setAba('parceiros') },
  ];

  const renderEstrelas = (nota) => {
    return [...Array(5)].map((_, i) => (
      <Star key={i} size={14} className={i < nota ? 'text-yellow-400 fill-yellow-400' : 'text-slate-600'} />
    ));
  };

  return (
    <div className="fade-in space-y-6">
      {/* Header com abas */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-linha">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setAbaAtiva('geral')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${
              abaAtiva === 'geral'
                ? 'bg-acao/15 border-acao/40 text-acao-200'
                : 'bg-grafite-700 border-linha text-slate-400 hover:text-white hover:border-slate-500'
            }`}>
            <BarChart3 size={13} className="inline mr-1.5 -mt-0.5" /> Visão Geral
          </button>
          <button
            onClick={() => setAbaAtiva('avaliacoes')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${
              abaAtiva === 'avaliacoes'
                ? 'bg-yellow-500/15 border-yellow-500/40 text-yellow-300'
                : 'bg-grafite-700 border-linha text-slate-400 hover:text-white hover:border-slate-500'
            }`}>
            <Star size={13} className="inline mr-1.5 -mt-0.5" /> Avaliações
          </button>
        </div>
        {abaAtiva === 'geral' && (
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => exportarRelatorio(metricas)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-acao/10 hover:bg-acao/20 text-acao-200 text-xs font-semibold border border-acao/30 transition-all shrink-0">
              <Download size={14} /> Exportar CSV
            </button>
            <button onClick={exportarPdf} disabled={gerandoPdf}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-falha/10 hover:bg-falha/20 text-falha-400 text-xs font-semibold border border-falha/30 transition-all shrink-0 disabled:opacity-60">
              {gerandoPdf ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
              {gerandoPdf ? 'Gerando...' : 'Exportar Relatório'}
            </button>
          </div>
        )}
      </div>

      {/* ============= ABA: VISÃO GERAL ============= */}
      {abaAtiva === 'geral' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {cards.map(c => <MetricCard key={c.label} {...c} />)}
          </div>

          <div ref={graficosRef} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="glass-panel rounded-2xl p-5 border border-linha">
              <h3 className="text-sm font-bold text-white font-display mb-4 flex items-center gap-2">
                <Activity size={15} className="text-ativo-400" /> Distribuição de Status
              </h3>
              <div style={{ height: 220 }} className="flex items-center justify-center">
                <Doughnut data={doughnutData} options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  cutout: '65%',
                  plugins: {
                    legend: { position: 'bottom', labels: { color: '#94A3B8', font: { size: 11 }, boxWidth: 12 } },
                    tooltip: CHART_DEFAULTS.plugins.tooltip
                  }
                }} />
              </div>
            </div>

            <div className="glass-panel rounded-2xl p-5 border border-linha flex flex-col justify-center gap-3">
              <h3 className="text-sm font-bold text-white font-display flex items-center gap-2">
                <TrendingUp size={15} className="text-acao-200" /> Situação atual
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                O histórico por período (7/30/90 dias) aparecerá aqui assim que os atendimentos
                começarem a ser registrados pelo WhatsApp. Por enquanto, os números refletem o estado atual em tempo real.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { icon: Inbox,        color: 'blue',    label: 'Abertos',   val: metricas.atendimentosAbertos  },
              { icon: Clock,        color: 'amber',   label: 'Pendentes', val: metricas.atendimentosPendentes },
              { icon: CheckCircle2, color: 'emerald', label: 'Fechados',  val: metricas.atendimentosFechados  },
            ].map(({ icon: Icon, color, label, val }) => {
              const map = { blue:'bg-blue-500/10 border-blue-500/30 text-blue-400', amber:'bg-espera/10 border-espera/30 text-espera-400', emerald:'bg-ativo/10 border-ativo/30 text-ativo-400' };
              return (
                <div key={label} className="glass-panel p-5 rounded-2xl border border-linha flex items-center gap-4">
                  <div className={`p-3 rounded-xl border ${map[color]}`}><Icon size={18} /></div>
                  <div>
                    <div className="text-2xl font-bold text-white font-display">{val}</div>
                    <div className="text-xs text-slate-400">{label}</div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="glass-panel rounded-2xl p-5 border border-linha">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <EmojiIcon name="inbox" label="Fila de Espera" size="md" />
                </div>
                <button onClick={() => setAba('atendimento')}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-acao/10 hover:bg-acao/20 text-acao-200 text-xs font-semibold border border-acao/30 transition-all">
                  Central <ArrowRight size={12} />
                </button>
              </div>
              <div className="space-y-2">
                {conversas.filter(c => c.statusAtendimento === 'pendente').map(c => (
                  <div key={c.id} className="flex items-center justify-between p-3 rounded-xl bg-grafite-600/60 border border-linha/60">
                    <div>
                      <div className="font-semibold text-xs text-white">{c.cliente}</div>
                      <div className="text-[11px] text-slate-400 font-mono">{c.telefone || '+55 11 99999-0000'}</div>
                    </div>
                    <EmojiIcon name="clock" label="Aguardando" size="sm" />
                  </div>
                ))}
                {conversas.filter(c => c.statusAtendimento === 'pendente').length === 0 && (
                  <div className="text-xs text-slate-400 text-center py-4">Fila vazia no momento.</div>
                )}
              </div>
            </div>

            <div className="glass-panel rounded-2xl p-5 border border-linha">
              <div className="flex items-center gap-2 mb-4">
                <Users size={15} className="text-acao-200" />
                <h3 className="text-sm font-bold text-white font-display">Equipe</h3>
                <span className="ml-auto text-xs text-slate-400">
                  <span className="text-ativo-400 font-semibold">{metricas.equipeOnline}</span>/{metricas.totalEquipe} online
                </span>
              </div>
              <div className="space-y-2">
                {equipe.map(e => (
                  <div key={e.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-acao/15 text-acao-200 text-xs font-bold flex items-center justify-center border border-acao/30">
                        {e.nome.charAt(0)}
                      </div>
                      <div>
                        <div className="text-xs text-white font-semibold">{e.nome}</div>
                        <div className="text-[10px] text-slate-500">{e.cargo}</div>
                      </div>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${e.status === 'online' ? 'bg-ativo/15 text-ativo-400' : 'bg-slate-700 text-slate-400'}`}>
                      {e.status === 'online' ? 'Online' : 'Offline'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ============= ABA: AVALIAÇÕES ============= */}
      {abaAtiva === 'avaliacoes' && (
        <>
          {/* Cards de resumo */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="glass-panel rounded-2xl p-6 border border-linha text-center">
              <div className="flex items-center justify-center gap-1 mb-2">
                {renderEstrelas(Math.round(avaliacoes.media))}
              </div>
              <div className="text-3xl font-bold text-white font-display">
                {avaliacoes.media.toFixed(1)}
              </div>
              <div className="text-xs text-slate-400 mt-1">Média CSAT</div>
            </div>
            <div className="glass-panel rounded-2xl p-6 border border-linha text-center">
              <div className="text-3xl font-bold text-yellow-300 font-display">{avaliacoes.total}</div>
              <div className="text-xs text-slate-400 mt-1">Avaliações recebidas</div>
            </div>
            <div className="glass-panel rounded-2xl p-6 border border-linha text-center">
              <div className="text-3xl font-bold text-ativo-400 font-display">
                {avaliacoes.total > 0 ? Math.round((avaliacoes.distribuicao.filter(d => d.nota >= 4).reduce((s, d) => s + d.qtd, 0) / avaliacoes.total) * 100) : 0}%
              </div>
              <div className="text-xs text-slate-400 mt-1">Satisfação (4-5 ⭐)</div>
            </div>
          </div>

          {/* Distribuição por nota */}
          <div className="glass-panel rounded-2xl p-5 border border-linha">
            <h3 className="text-sm font-bold text-white font-display mb-5 flex items-center gap-2">
              <BarChart3 size={15} className="text-yellow-400" /> Distribuição por Nota
            </h3>
            <div className="space-y-3">
              {[5, 4, 3, 2, 1].map(nota => {
                const item = avaliacoes.distribuicao.find(d => d.nota === nota);
                const pct = avaliacoes.total > 0 ? (item.qtd / avaliacoes.total) * 100 : 0;
                return (
                  <div key={nota} className="flex items-center gap-3">
                    <div className="flex items-center gap-1 w-20 shrink-0 justify-end">
                      <span className="text-xs font-semibold text-white">{nota}</span>
                      <Star size={12} className="text-yellow-400 fill-yellow-400" />
                    </div>
                    <div className="flex-1 h-5 bg-grafite-600/60 rounded-full overflow-hidden border border-linha/40">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${pct}%`,
                          background: nota >= 4 ? 'linear-gradient(90deg, #10b981, #34d399)' : nota === 3 ? 'linear-gradient(90deg, #f59e0b, #fbbf24)' : 'linear-gradient(90deg, #ef4444, #f87171)'
                        }}
                      />
                    </div>
                    <span className="text-xs text-slate-400 w-16 text-right font-mono">
                      {item.qtd} ({pct.toFixed(0)}%)
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Tabela de feedbacks */}
          <div className="glass-panel rounded-2xl p-5 border border-linha">
            <h3 className="text-sm font-bold text-white font-display mb-4 flex items-center gap-2">
              <MessageCircle size={15} className="text-acao-200" /> Feedbacks Recentes
            </h3>
            {avaliacoes.avaliadas.length === 0 ? (
              <div className="text-center py-10">
                <Star size={32} className="mx-auto text-slate-600 mb-3" />
                <p className="text-sm text-slate-400">Nenhuma avaliação recebida ainda.</p>
                <p className="text-xs text-slate-500 mt-1">As avaliações aparecerão aqui quando os clientes avaliarem os atendimentos.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-linha text-slate-400">
                      <th className="text-left py-2.5 px-3 font-semibold">Cliente</th>
                      <th className="text-left py-2.5 px-3 font-semibold">Telefone</th>
                      <th className="text-center py-2.5 px-3 font-semibold">Nota</th>
                      <th className="text-left py-2.5 px-3 font-semibold">Setor</th>
                      <th className="text-left py-2.5 px-3 font-semibold">Comentário</th>
                    </tr>
                  </thead>
                  <tbody>
                    {avaliacoes.avaliadas.slice(0, 50).map(c => (
                      <tr key={c.id} className="border-b border-linha/40 hover:bg-grafite-600/40 transition-colors">
                        <td className="py-2.5 px-3 text-white font-semibold">{c.cliente}</td>
                        <td className="py-2.5 px-3 text-slate-400 font-mono">{c.telefone || '-'}</td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center justify-center gap-0.5">
                            {renderEstrelas(c.avaliacao)}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/30">
                            {c.setor || 'Geral'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-300 max-w-xs truncate">{c.feedback || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
