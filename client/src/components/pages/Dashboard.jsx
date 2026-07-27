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

function calcularMetricas(conversas, parceiros, equipe) {

  const ativas = conversas.filter(c => c.statusAtendimento === 'em_atendimento').length;
  const aguardando = conversas.filter(c => c.statusAtendimento === 'aguardando').length;
  const finalizados = conversas.filter(c => c.statusAtendimento === 'finalizado' || c.statusAtendimento === 'resolvido').length;
  return {
    totalAtendimentos: conversas.length,
    demandasAtivas: ativas + aguardando,
    atendimentosAbertos: ativas + aguardando,
    atendimentosPendentes: aguardando,
    atendimentosFechados: finalizados,
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

  const cards = [
    { label: 'Total de Atendimentos', valor: metricas.totalAtendimentos, icon: BarChart3,   color: 'orange',  sublabel: 'Conversas registradas' },
    { label: 'Demandas Ativas',       valor: metricas.demandasAtivas,    icon: Activity,    color: 'emerald', sublabel: 'Em atendimento + fila', onClick: () => setAba('atendimento') },
    { label: 'Equipe Online',         valor: `${metricas.equipeOnline}/${metricas.totalEquipe}`, icon: Users, color: 'blue', sublabel: 'Atendentes disponíveis', onClick: () => setAba('equipe') },
    { label: 'Parceiros Ativos',      valor: metricas.parceirosPeriodo,  icon: ShieldCheck, color: 'purple',  sublabel: 'CNPJs cadastrados ativos', onClick: () => setAba('parceiros') },
  ];

  return (
    <div className="fade-in space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight font-display">Visão Geral</h1>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">Métricas, fila e desempenho da equipe Arka Tecnologia.</p>
        </div>
        <button onClick={() => exportarRelatorio(metricas)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 text-xs font-semibold border border-orange-500/30 transition-all shrink-0">
          <Download size={14} /> Exportar CSV
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(c => <MetricCard key={c.label} {...c} />)}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="glass-panel rounded-2xl p-5 border border-[#2A3040]">
          <h3 className="text-sm font-bold text-white font-display mb-4 flex items-center gap-2">
            <Activity size={15} className="text-emerald-400" /> Distribuição de Status
          </h3>
          <div style={{ height: 220 }} className="flex items-center justify-center">
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

        <div className="glass-panel rounded-2xl p-5 border border-[#2A3040] flex flex-col justify-center gap-3">
          <h3 className="text-sm font-bold text-white font-display flex items-center gap-2">
            <TrendingUp size={15} className="text-orange-400" /> Situação atual
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
