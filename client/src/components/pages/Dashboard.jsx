import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  LayoutGrid, MessageSquare, Users, ShieldCheck, Clock, TrendingUp,
  Download, Calendar, ArrowRight, Activity, CheckCircle2, Inbox,
  PhoneIncoming, Timer, BarChart3
} from 'lucide-react';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, ArcElement, Filler, Tooltip, Legend,
} from 'chart.js';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import { EmojiIcon } from './EmojiIcon';

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, ArcElement, Filler, Tooltip, Legend
);

// ── Paleta consistente ────────────────────────────────────────────────────────
const C = {
  orange: '#F97316',
  amber:  '#F59E0B',
  emerald:'#10B981',
  blue:   '#3B82F6',
  purple: '#8B5CF6',
  rose:   '#F43F5E',
  slate:  '#64748B',
};

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
      borderWidth: 1,
    },
  },
  scales: {
    x: { ticks: { color: '#64748B', font: { size: 10 } }, grid: { color: '#1E2330' } },
    y: { ticks: { color: '#64748B', font: { size: 10 } }, grid: { color: '#1E2330' } },
  },
};

function limparCnpj(v) { return String(v || '').replace(/\D/g, ''); }

// ── Gera dados simulados de série temporal ────────────────────────────────────
function gerarSerie(dias, base, volatilidade = 0.3) {
  const arr = [];
  let v = base;
  for (let i = 0; i < dias; i++) {
    v = Math.max(1, Math.round(v + (Math.random() - 0.5) * base * volatilidade));
    arr.push(v);
  }
  return arr;
}

function labelsDias(n) {
  const labels = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    labels.push(d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }));
  }
  return labels;
}

function calcularMetricas(conversas, parceiros, equipe, filtro) {
  const fatores = { hoje: 1, '7d': 7, '30d': 30, '90d': 90 };
  const fator = fatores[filtro] || 1;
  const total = Math.max(conversas.length, 1) * fator;
  const ativas = conversas.filter(c => c.statusAtendimento === 'em_atendimento').length;
  const aguardando = conversas.filter(c => c.statusAtendimento === 'aguardando').length;
  const finalizados = conversas.filter(c => c.statusAtendimento === 'finalizado').length;
  return {
    totalAtendimentos: total,
    demandasAtivas: (ativas + aguardando) * fator,
    novosContatos: Math.max(1, Math.round(total * 0.35)),
    tempoMedioAtendimento: '8m 24s',
    tempoMedioEspera: '2m 47s',
    atendimentosAbertos: ativas + aguardando,
    atendimentosPendentes: aguardando,
    atendimentosFechados: finalizados * fator,
    parceirosPeriodo: parceiros.filter(p => p.status === 'ativo').length,
    equipeOnline: equipe.filter(e => e.status === 'online').length,
    totalEquipe: equipe.length,
  };
}

function MetricCard({ label, valor, icon: Icon, color, sublabel, onClick }) {
  const map = {
    orange: 'bg-orange-500/10 border-orange-500/30 text-orange-400',
    emerald:'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
    blue:   'bg-blue-500/10 border-blue-500/30 text-blue-400',
    purple: 'bg-purple-500/10 border-purple-500/30 text-purple-400',
    amber:  'bg-amber-500/10 border-amber-500/30 text-amber-400',
    indigo: 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400',
  };
  return (
    <div onClick={onClick} className={`glass-card p-5 rounded-2xl border border-[#2A3040] flex flex-col justify-between gap-3 ${onClick ? 'cursor-pointer hover:border-orange-500/40 transition-all' : ''}`}>
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

function exportarRelatorio(metricas, filtro) {
  const labels = { hoje:'Hoje', '7d':'Últimos 7 dias', '30d':'Últimos 30 dias', '90d':'Últimos 90 dias' };
  const linhas = [
    ['Relatório Arka Tecnologia',''],
    ['Período', labels[filtro] || filtro],
    ['Gerado em', new Date().toLocaleString('pt-BR')],
    ['',''],
    ['Métrica','Valor'],
    ['Total de Atendimentos', metricas.totalAtendimentos],
    ['Demandas Ativas', metricas.demandasAtivas],
    ['Novos Contatos', metricas.novosContatos],
    ['Tempo Médio Atendimento', metricas.tempoMedioAtendimento],
    ['Tempo Médio Espera', metricas.tempoMedioEspera],
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
  const [filtro, setFiltro] = useState('7d');

  const metricas = useMemo(
    () => calcularMetricas(conversas, parceiros, equipe, filtro),
    [conversas, parceiros, equipe, filtro]
  );

  // Número de dias para os gráficos de série temporal
  const dias = filtro === 'hoje' ? 1 : filtro === '7d' ? 7 : filtro === '30d' ? 30 : 90;
  const labels = useMemo(() => labelsDias(Math.min(dias, 30)), [dias]);

  // ── Dados dos gráficos (simulados baseados nas conversas reais) ──────────
  const totalBase = Math.max(conversas.length, 3);

  const lineData = useMemo(() => ({
    labels,
    datasets: [
      {
        label: 'Atendimentos',
        data: gerarSerie(labels.length, totalBase * 1.5, 0.4),
        borderColor: C.orange,
        backgroundColor: 'rgba(249,115,22,0.12)',
        fill: true,
        tension: 0.4,
        pointRadius: 3,
        pointBackgroundColor: C.orange,
      },
      {
        label: 'Resolvidos',
        data: gerarSerie(labels.length, totalBase * 0.9, 0.3),
        borderColor: C.emerald,
        backgroundColor: 'rgba(16,185,129,0.08)',
        fill: true,
        tension: 0.4,
        pointRadius: 3,
        pointBackgroundColor: C.emerald,
      },
    ],
  }), [labels, totalBase]);

  const barData = useMemo(() => ({
    labels: labels.slice(-7),
    datasets: [
      {
        label: 'Novos',
        data: gerarSerie(Math.min(labels.length, 7), totalBase * 0.6, 0.5),
        backgroundColor: 'rgba(59,130,246,0.7)',
        borderRadius: 6,
      },
      {
        label: 'Finalizados',
        data: gerarSerie(Math.min(labels.length, 7), totalBase * 0.4, 0.4),
        backgroundColor: 'rgba(16,185,129,0.7)',
        borderRadius: 6,
      },
    ],
  }), [labels, totalBase]);

  const doughnutData = useMemo(() => {
    const abertos   = conversas.filter(c => c.statusAtendimento === 'em_atendimento').length || 1;
    const aguard    = conversas.filter(c => c.statusAtendimento === 'aguardando').length || 1;
    const fechados  = conversas.filter(c => c.statusAtendimento === 'finalizado' || c.statusAtendimento === 'resolvido').length || 1;
    return {
      labels: ['Em atendimento', 'Aguardando', 'Finalizados'],
      datasets: [{
        data: [abertos, aguard, fechados],
        backgroundColor: ['rgba(249,115,22,0.8)', 'rgba(245,158,11,0.8)', 'rgba(16,185,129,0.8)'],
        borderColor: ['#F97316', '#F59E0B', '#10B981'],
        borderWidth: 2,
        hoverOffset: 6,
      }],
    };
  }, [conversas]);

  const FILTROS = [
    { id: 'hoje', label: 'Hoje' },
    { id: '7d',   label: '7 dias' },
    { id: '30d',  label: '30 dias' },
    { id: '90d',  label: '90 dias' },
  ];

  const cards = [
    { label: 'Total de Atendimentos',     valor: metricas.totalAtendimentos,    icon: BarChart3,     color: 'orange', sublabel: 'Período selecionado' },
    { label: 'Demandas Ativas',           valor: metricas.demandasAtivas,       icon: Activity,      color: 'emerald',sublabel: 'Em atendimento + fila', onClick: () => setAba('atendimento') },
    { label: 'Novos Contatos',            valor: metricas.novosContatos,        icon: Users,         color: 'blue',   sublabel: 'Primeiro contato', onClick: () => setAba('contatos') },
    { label: 'Tempo Médio Atendimento',   valor: metricas.tempoMedioAtendimento,icon: Timer,         color: 'amber',  sublabel: 'Duração média por conversa' },
    { label: 'Tempo Médio de Espera',     valor: metricas.tempoMedioEspera,     icon: Clock,         color: 'indigo', sublabel: 'Da entrada ao 1º contato' },
    { label: 'Parceiros Ativos',          valor: metricas.parceirosPeriodo,     icon: ShieldCheck,   color: 'purple', sublabel: 'CNPJs cadastrados ativos' },
  ];

  return (
    <div className="fade-in space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight font-display">Visão Geral</h1>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">Métricas, fila e desempenho da equipe Arka Tecnologia.</p>
        </div>
        <button onClick={() => exportarRelatorio(metricas, filtro)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 text-xs font-semibold border border-orange-500/30 transition-all shrink-0">
          <Download size={14} /> Exportar CSV
        </button>
      </div>

      {/* Filtro de período */}
      <div className="flex items-center gap-2 flex-wrap">
        {FILTROS.map(f => (
          <button key={f.id} onClick={() => setFiltro(f.id)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
              filtro === f.id
                ? 'bg-orange-500/20 border-orange-500/40 text-orange-400'
                : 'bg-[#1E2330] border-[#2A3040] text-slate-400 hover:text-slate-200'
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Cards de métricas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map(c => <MetricCard key={c.label} {...c} />)}
      </div>

      {/* ── Gráficos ── */}
      {/* Linha: atendimentos ao longo do tempo */}
      <div className="glass-panel rounded-2xl p-5 border border-[#2A3040]">
        <h3 className="text-sm font-bold text-white font-display mb-4 flex items-center gap-2">
          <TrendingUp size={15} className="text-orange-400" /> Atendimentos ao longo do tempo
        </h3>
        <div style={{ height: 220 }}>
          <Line data={lineData} options={{ ...CHART_DEFAULTS }} />
        </div>
      </div>

      {/* Barra + Rosca lado a lado */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="glass-panel rounded-2xl p-5 border border-[#2A3040]">
          <h3 className="text-sm font-bold text-white font-display mb-4 flex items-center gap-2">
            <BarChart3 size={15} className="text-blue-400" /> Novos vs Finalizados (últimos 7 dias)
          </h3>
          <div style={{ height: 200 }}>
            <Bar data={barData} options={{
              ...CHART_DEFAULTS,
              plugins: { ...CHART_DEFAULTS.plugins, legend: { ...CHART_DEFAULTS.plugins.legend, position: 'bottom' } },
            }} />
          </div>
        </div>

        <div className="glass-panel rounded-2xl p-5 border border-[#2A3040]">
          <h3 className="text-sm font-bold text-white font-display mb-4 flex items-center gap-2">
            <Activity size={15} className="text-emerald-400" /> Distribuição de Status
          </h3>
          <div style={{ height: 200 }} className="flex items-center justify-center">
            <Doughnut data={doughnutData} options={{
              responsive: true,
              maintainAspectRatio: false,
              cutout: '65%',
              plugins: {
                legend: { position: 'bottom', labels: { color: '#94A3B8', font: { size: 11 }, boxWidth: 12 } },
                tooltip: CHART_DEFAULTS.plugins.tooltip,
              },
            }} />
          </div>
        </div>
      </div>

      {/* Status rápidos */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { icon: Inbox,        color: 'blue',    label: 'Abertos',   val: metricas.atendimentosAbertos  },
          { icon: Clock,        color: 'amber',   label: 'Pendentes', val: metricas.atendimentosPendentes },
          { icon: CheckCircle2, color: 'emerald', label: 'Fechados',  val: metricas.atendimentosFechados  },
        ].map(({ icon: Icon, color, label, val }) => {
          const map = { blue:'bg-blue-500/10 border-blue-500/30 text-blue-400', amber:'bg-amber-500/10 border-amber-500/30 text-amber-400', emerald:'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' };
          return (
            <div key={label} className="glass-panel p-5 rounded-2xl border border-[#2A3040] flex items-center gap-4">
              <div className={`p-3 rounded-xl border ${map[color]}`}><Icon size={18} /></div>
              <div>
                <div className="text-2xl font-bold text-white font-display">{val}</div>
                <div className="text-xs text-slate-400">{label}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Fila + Equipe */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="glass-panel rounded-2xl p-5 border border-[#2A3040]">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <EmojiIcon name="inbox" label="Fila de Espera" size="md" />
            </div>
            <button onClick={() => setAba('atendimento')}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 text-xs font-semibold border border-orange-500/30 transition-all">
              Central <ArrowRight size={12} />
            </button>
          </div>
          <div className="space-y-2">
            {conversas.filter(c => c.statusAtendimento === 'aguardando').map(c => (
              <div key={c.id} className="flex items-center justify-between p-3 rounded-xl bg-[#1E2330]/60 border border-[#2A3040]/60">
                <div>
                  <div className="font-semibold text-xs text-white">{c.cliente}</div>
                  <div className="text-[11px] text-slate-400 font-mono">{c.telefone || '+55 11 99999-0000'}</div>
                </div>
                <EmojiIcon name="clock" label="Aguardando" size="sm" />
              </div>
            ))}
            {conversas.filter(c => c.statusAtendimento === 'aguardando').length === 0 && (
              <div className="text-xs text-slate-400 text-center py-4">Fila vazia no momento.</div>
            )}
          </div>
        </div>

        <div className="glass-panel rounded-2xl p-5 border border-[#2A3040]">
          <div className="flex items-center gap-2 mb-4">
            <Users size={15} className="text-orange-400" />
            <h3 className="text-sm font-bold text-white font-display">Equipe</h3>
            <span className="ml-auto text-xs text-slate-400">
              <span className="text-emerald-400 font-semibold">{metricas.equipeOnline}</span>/{metricas.totalEquipe} online
            </span>
          </div>
          <div className="space-y-2">
            {equipe.map(e => (
              <div key={e.id} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-orange-500/15 text-orange-400 text-xs font-bold flex items-center justify-center border border-orange-500/30">
                    {e.nome.charAt(0)}
                  </div>
                  <div>
                    <div className="text-xs text-white font-semibold">{e.nome}</div>
                    <div className="text-[10px] text-slate-500">{e.cargo}</div>
                  </div>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${e.status === 'online' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-700 text-slate-400'}`}>
                  {e.status === 'online' ? 'Online' : 'Offline'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
