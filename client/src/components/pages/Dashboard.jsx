import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import {
  Users, ShieldCheck, Clock, TrendingUp,
  Download, ArrowRight, Activity, CheckCircle2, Inbox,
  BarChart3, FileText, Loader2, Star, MessageCircle, X, LifeBuoy, ClipboardList, UserCheck, Bot,
  Trophy
} from 'lucide-react';
// So o Doughnut sobrou nesta tela: ele precisa de ArcElement. Escalas e
// elementos de linha/barra ficaram registrados sem grafico que os usasse.
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { Doughnut } from 'react-chartjs-2';
import { EmojiIcon } from './EmojiIcon';
import { exportarRelatorioPdf } from '../../utils/exportarPdf';
import { hojeISO, FUSO_BR } from '../../utils/data';
import HelpDeskPainel from './HelpDeskPainel';
import RegistroConversas from './RegistroConversas';
import RelatoriosClientes from './RelatoriosClientes';
import Rankings from './Rankings';
import { avisar } from '../../utils/dialogo';
import { DashboardAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

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
    ['Gerado em', new Date().toLocaleString('pt-BR', { timeZone: FUSO_BR })],
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
  a.href = url; a.download = `relatorio-arka-${hojeISO()}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

export default function Dashboard({ equipe, fluxos, parceiros, conversas, setAba }) {
  const metricas = useMemo(
    () => calcularMetricas(conversas, parceiros, equipe),
    [conversas, parceiros, equipe]
  );
  const [gerandoPdf, setGerandoPdf] = useState(false);
  const [abaAtiva, setAbaAtiva] = useState('geral');

  // Modulos que ESTA pessoa pode ver, do servidor. Sem a lista (sessao antiga)
  // mostramos a aba: quem decide de verdade e o servidor, e esconder por falta
  // de informacao esconderia de quem tem direito.
  const { usuario } = useAuth();
  const podeVerRankings = !Array.isArray(usuario?.permissoes) || usuario.permissoes.includes('rankings');
  const graficosRef = useRef(null);

  // ── O RESUMO DA SATISFACAO VEM DO SERVIDOR ──────────────────────────────
  //
  // Os quatro numeros do alto (media, total, % de promotores, detratores) e a
  // distribuicao eram calculados aqui, sobre `conversas` -- a lista da Central,
  // que o servidor recorta por setor para quem nao e Administrador. O numero
  // mudava com QUEM estava logado, sem nada na tela dizendo isso, e nao tinha
  // janela de tempo (a parede somava o ciclo; aqui somava tudo).
  //
  // Agora vem pronto, com a janela e a regua declaradas.
  // (auditoria-regra-no-front-end-10-09.md, F1)
  const [satisfacao, setSatisfacao] = useState(null);
  useEffect(() => {
    let vivo = true;
    DashboardAPI.satisfacao()
      .then(d => { if (vivo) setSatisfacao(d); })
      // Falhar aqui nao pode derrubar a tela: sem o resumo, a aba cai no
      // calculo local de antes -- que e impreciso, mas nao e branco.
      .catch(() => {});
    return () => { vivo = false; };
  }, []);

  // Filtros da aba de avaliacoes: nota (0 = todas), texto e setor.
  const [filtroNota, setFiltroNota] = useState(0);
  const [buscaAval, setBuscaAval] = useState('');
  const [filtroSetor, setFiltroSetor] = useState('');

  // ---------- Avaliações ----------
  //
  // UMA LINHA POR ATENDIMENTO (OS), e não por conversa.
  //
  // A conversa é o fio permanente do cliente: ela guarda só a avaliação do
  // ciclo em curso. Listar conversas aqui mostraria uma única nota por cliente
  // e esconderia todo o histórico de feedbacks. Cada OS traz também o SETOR em
  // que ela foi atendida -- que é o que classifica o feedback.
  const avaliacoesPorOS = useMemo(() => conversas.flatMap(c => {
    const lista = c.atendimentos && c.atendimentos.length ? c.atendimentos : null;
    if (!lista) return [c];
    return lista.map(a => ({
      ...c,
      linhaId: a.id,
      ticket: a.os,
      setor: a.setor || c.setor,
      avaliacao: a.avaliacao ?? null,
      avaliacaoStatus: a.avaliacaoStatus ?? null,
      feedback: a.feedback ?? null,
      fechadoEm: a.fechadoEm,
      // ── O ATENDENTE DE UMA AVALIACAO SAI DA OS, E DE MAIS NENHUM LUGAR ──
      //
      // Havia um `|| c.ultimoAtendenteNome` aqui, e ele era o defeito relatado
      // em 10/09/2026: aquele campo e da CONVERSA e e mutavel -- muda quando
      // outra pessoa abre o mesmo fio depois. O resultado era a nota 5 que o
      // cliente deu ao Lucas aparecendo como sendo do Rangel, so porque ele
      // tocou a conversa em seguida.
      //
      // A pergunta e por OS ("quem fez o trabalho que o cliente avaliou?"), e o
      // dado por OS existe. Faltando ele, a tela escreve "nao registrado" ou
      // "Bot" logo abaixo -- que e verdade -- em vez de um nome errado. Nome
      // errado numa avaliacao e pior que nome nenhum: ninguem desconfia dele.
      atendenteNome: a.atendenteNome || null,
      ultimoAtendenteNome: a.atendenteNome || null,
    }));
  }), [conversas]);

  const avaliacoes = useMemo(() => {
    const avaliadas = avaliacoesPorOS
      .filter(c => c.avaliacao != null && c.avaliacao > 0)
      // Mais recentes primeiro quando houver data de fechamento.
      .sort((a, b) => new Date(b.fechadoEm || 0) - new Date(a.fechadoEm || 0));
    // ── AQUI SO FICA O QUE A TABELA PRECISA ─────────────────────────────
    //
    // Esta conta produzia tambem a media, a distribuicao, a media por setor e
    // -- o pior -- QUEM E PROMOTOR E QUEM E DETRATOR (`nota >= 4`, `nota <= 2`).
    // Aquela era a unica definicao desses dois no sistema inteiro: definicao de
    // negocio morando num `.jsx`, calculada sobre uma lista recortada por setor
    // e sem janela de tempo. Foi para o servidor
    // (`dashboardService.satisfacao`), e NAO ficou uma copia aqui: copia de
    // regua e o que envelhece calado.
    //
    // O que sobra e o material da TABELA: as linhas, quantas sao, e os setores
    // que aparecem no filtro -- tudo sobre o que esta na tela, e nao sobre como
    // a empresa mede satisfacao.
    const total = avaliadas.length;
    const setores = [...new Set(avaliadas.map(c => c.setor || 'Geral'))].sort();

    return { avaliadas, total, setores };
  }, [avaliacoesPorOS]);

  // OS CARTOES LEEM O SERVIDOR; A TABELA CONTINUA LOCAL.
  //
  // Sao perguntas diferentes: o cartao responde "como esta a satisfacao da
  // empresa neste ciclo" (agregado, igual ao da parede) e a tabela responde
  // "quais feedbacks EU consigo abrir" -- essa e por acesso, e a legenda diz.
  //
  // Enquanto a resposta nao chega, os cartoes usam a conta local de antes: um
  // numero aproximado por dois segundos e melhor que quatro caixas vazias.
  // Placeholder NEUTRO enquanto a resposta nao chega -- e nao uma segunda
  // implementacao da conta. Zero aqui nao afirma nada: a media vai `null`, e a
  // tela escreve "–" no lugar de um numero inventado.
  const resumo = satisfacao || {
    media: null,
    total: 0,
    distribuicao: [1, 2, 3, 4, 5].map(nota => ({ nota, qtd: 0 })),
    promotores: 0,
    detratores: 0,
    neutros: 0,
    porSetor: [],
  };
  // A barra mais alta do grafico. Isto e DESENHO (a escala do grafico), e nao
  // regra -- por isso continua sendo calculado aqui.
  const maxQtd = Math.max(1, ...resumo.distribuicao.map(d => d.qtd));
  const janelaResumo = satisfacao?.janela || null;

  // "01/09 a 30/09" -- o ciclo por extenso.
  //
  // O `fim` que o servidor manda e EXCLUSIVO (e o instante em que o ciclo
  // seguinte comeca), entao escreve-se o dia ANTERIOR a ele: sem isso o rotulo
  // erra por um dia inteiro. Mesmo cuidado do intervalo na tela de Rankings.
  const intervaloSatisfacao = useMemo(() => {
    if (!janelaResumo?.inicio || !janelaResumo?.fim) return null;
    const dia = (iso, recuar = false) => {
      const d = new Date(iso);
      if (recuar) d.setDate(d.getDate() - 1);
      return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: FUSO_BR });
    };
    return `${dia(janelaResumo.inicio)} a ${dia(janelaResumo.fim, true)}`;
  }, [janelaResumo]);

  // A LEGENDA QUE FALTAVA: escopo, janela e regua, escritos.
  //
  // O numero antigo nao era so impreciso -- ele nao dizia do que era. Duas
  // pessoas de cargos diferentes liam valores diferentes com o mesmo rotulo,
  // e nao havia como desconfiar. Agora o proprio painel diz de onde vem.
  const legendaSatisfacao = satisfacao && intervaloSatisfacao
    ? `Empresa inteira · ciclo de ${intervaloSatisfacao} · promotor é nota ${satisfacao.regua.promotorMinimo} ou mais, detrator é ${satisfacao.regua.detratorMaximo} ou menos`
    : null;

  // Aplica os filtros da aba sobre a lista de avaliacoes.
  const feedbacksFiltrados = useMemo(() => {
    const termo = buscaAval.trim().toLowerCase();
    return avaliacoes.avaliadas.filter(c => {
      if (filtroNota && c.avaliacao !== filtroNota) return false;
      if (filtroSetor && (c.setor || 'Geral') !== filtroSetor) return false;
      if (termo) {
        // Inclui o atendente: permite filtrar as avaliacoes de uma pessoa.
        const alvo = `${c.cliente || ''} ${c.telefone || ''} ${c.feedback || ''} ${c.atendenteNome || c.ultimoAtendenteNome || ''}`.toLowerCase();
        if (!alvo.includes(termo)) return false;
      }
      return true;
    });
  }, [avaliacoes, filtroNota, filtroSetor, buscaAval]);

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
      avisar('Não foi possível gerar o PDF: ' + e.message);
    } finally {
      setGerandoPdf(false);
    }
  }, [metricas]);

  const exportarAvaliacoesCsv = useCallback(() => {
    const linhas = [
      ['Cliente', 'Telefone', 'Nota', 'Atendente', 'Setor', 'Finalizado em', 'Comentário'],
      ...feedbacksFiltrados.map(c => [
        c.cliente || '',
        c.telefone || '',
        c.avaliacao,
        c.atendenteNome || c.ultimoAtendenteNome || '',
        c.setor || 'Geral',
        c.fechadoEm
          ? new Date(c.fechadoEm).toLocaleString('pt-BR', { timeZone: FUSO_BR })
          : '',
        (c.feedback || '').replace(/[\r\n;]+/g, ' '),
      ]),
    ];
    const csv = linhas.map(r => r.join(';')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `avaliacoes-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [feedbacksFiltrados]);

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
    <div className="fade-in space-y-6 baixa:lg:space-y-4">
      {/* Header com abas */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-linha">
        {/* `flex-wrap`: com cinco abas a barra estourava a largura em tela
            estreita. O header pai ja quebra em coluna no `sm`, mas os botoes
            entre si nao quebravam -- eles saiam para fora da tela. */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
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
          <button
            onClick={() => setAbaAtiva('helpdesk')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${
              abaAtiva === 'helpdesk'
                ? 'bg-acao/15 border-acao/40 text-acao-200'
                : 'bg-grafite-700 border-linha text-slate-400 hover:text-white hover:border-slate-500'
            }`}>
            <LifeBuoy size={13} className="inline mr-1.5 -mt-0.5" /> Help Desk
          </button>
          <button
            onClick={() => setAbaAtiva('registro')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${
              abaAtiva === 'registro'
                ? 'bg-acao/15 border-acao/40 text-acao-200'
                : 'bg-grafite-700 border-linha text-slate-400 hover:text-white hover:border-slate-500'
            }`}>
            <ClipboardList size={13} className="inline mr-1.5 -mt-0.5" /> Registro
          </button>
          <button
            onClick={() => setAbaAtiva('relatorios')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${
              abaAtiva === 'relatorios'
                ? 'bg-acao/15 border-acao/40 text-acao-200'
                : 'bg-grafite-700 border-linha text-slate-400 hover:text-white hover:border-slate-500'
            }`}>
            <FileText size={13} className="inline mr-1.5 -mt-0.5" /> Relatórios Clientes (CNPJ)
          </button>
          {/* Cor de medalha (ambar), e nao o verde das demais: e a unica aba
              sobre DESEMPENHO DA EQUIPE, e o ambar e a cor que a plataforma ja
              usa para o podio no painel de parede. */}
          {/* A ABA SEGUE O MODULO `rankings`, e nao o `dashboard` que abriu esta
              tela. As duas permissoes sao independentes na matriz: sem esta
              guarda, quem tem Visao Geral mas nao tem Rankings veria a aba e
              levaria 403 ao clicar -- uma porta que existe e nao abre e pior do
              que porta nenhuma. O servidor barra de verdade; isto e a 1a camada. */}
          {podeVerRankings && (
            <button
              onClick={() => setAbaAtiva('ranking')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${
                abaAtiva === 'ranking'
                  ? 'bg-espera/15 border-espera/40 text-espera-400'
                  : 'bg-grafite-700 border-linha text-slate-400 hover:text-white hover:border-slate-500'
              }`}>
              <Trophy size={13} className="inline mr-1.5 -mt-0.5" /> Ranking do Time
            </button>
          )}
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
        {abaAtiva === 'avaliacoes' && avaliacoes.total > 0 && (
          <button onClick={exportarAvaliacoesCsv}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-300 text-xs font-semibold border border-yellow-500/30 transition-all shrink-0">
            <Download size={14} /> Exportar Avaliações
          </button>
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

            <div className="glass-panel rounded-2xl p-5 border border-linha flex flex-col justify-center gap-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white font-display flex items-center gap-2">
                  <Star size={15} className="text-yellow-400" /> Satisfação dos clientes
                </h3>
                <button onClick={() => setAbaAtiva('avaliacoes')}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-300 text-[11px] font-semibold border border-yellow-500/30 transition-all">
                  Ver todas <ArrowRight size={11} />
                </button>
              </div>

              {legendaSatisfacao && (
                <p className="text-[10px] text-slate-500 -mt-1 mb-2 leading-relaxed">{legendaSatisfacao}</p>
              )}

              {resumo.total === 0 ? (
                <p className="text-xs text-slate-400 leading-relaxed">
                  Ainda não há avaliações elas aparecem aqui assim que os clientes avaliarem os atendimentos.
                </p>
              ) : (
                <>
                  <div className="flex items-end gap-5">
                    <div>
                      <div className="flex items-center gap-0.5 mb-1">{renderEstrelas(Math.round(resumo.media ?? 0))}</div>
                      <div className="text-3xl font-bold text-white font-display leading-none">
                        {resumo.media == null ? "–" : resumo.media.toFixed(1)}<span className="text-sm text-slate-500 font-normal"> / 5</span>
                      </div>
                    </div>
                    <div className="flex-1 grid grid-cols-3 gap-2 text-center">
                      <div>
                        <div className="text-lg font-bold text-yellow-300 font-display">{resumo.total}</div>
                        <div className="text-[10px] text-slate-400">avaliações</div>
                      </div>
                      <div>
                        <div className="text-lg font-bold text-ativo-400 font-display">
                          {Math.round((resumo.promotores / resumo.total) * 100)}%
                        </div>
                        <div className="text-[10px] text-slate-400">satisfação</div>
                      </div>
                      <div>
                        <div className="text-lg font-bold text-falha-400 font-display">{resumo.detratores}</div>
                        <div className="text-[10px] text-slate-400">1-2 ⭐</div>
                      </div>
                    </div>
                  </div>

                  {/* Mini barra de distribuição (5→1) */}
                  <div className="flex h-2.5 rounded-full overflow-hidden border border-linha/40 bg-grafite-600/40">
                    {[5, 4, 3, 2, 1].map(n => {
                      const item = resumo.distribuicao.find(d => d.nota === n);
                      const pct = resumo.total > 0 ? (item.qtd / resumo.total) * 100 : 0;
                      const cor = n >= 4 ? '#10b981' : n === 3 ? '#f59e0b' : '#ef4444';
                      return pct > 0 ? (
                        <div key={n} style={{ width: `${pct}%`, background: cor }} title={`${n}★ ${item.qtd} (${pct.toFixed(0)}%)`} />
                      ) : null;
                    })}
                  </div>
                </>
              )}
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
                  <div key={c.linhaId || c.id} className="flex items-center justify-between p-3 rounded-xl bg-grafite-600/60 border border-linha/60">
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
          {legendaSatisfacao && (
            <p className="text-[11px] text-slate-500 leading-relaxed">{legendaSatisfacao}</p>
          )}
          {/* Cards de resumo */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="glass-panel rounded-2xl p-6 border border-linha text-center">
              <div className="flex items-center justify-center gap-1 mb-2">
                {renderEstrelas(Math.round(resumo.media ?? 0))}
              </div>
              <div className="text-3xl font-bold text-white font-display">
                {resumo.media == null ? "–" : resumo.media.toFixed(1)}
              </div>
              <div className="text-xs text-slate-400 mt-1">Média CSAT</div>
            </div>
            <div className="glass-panel rounded-2xl p-6 border border-linha text-center">
              <div className="text-3xl font-bold text-yellow-300 font-display">{resumo.total}</div>
              <div className="text-xs text-slate-400 mt-1">Avaliações recebidas</div>
            </div>
            <div className="glass-panel rounded-2xl p-6 border border-linha text-center">
              <div className="text-3xl font-bold text-ativo-400 font-display">
                {resumo.total > 0 ? Math.round((resumo.promotores / resumo.total) * 100) : 0}%
              </div>
              <div className="text-xs text-slate-400 mt-1">Satisfação (4-5 ⭐)</div>
            </div>
            <div className="glass-panel rounded-2xl p-6 border border-linha text-center">
              <div className="text-3xl font-bold text-falha-400 font-display">{resumo.detratores}</div>
              <div className="text-xs text-slate-400 mt-1">Precisam de atenção (1-2 ⭐)</div>
            </div>
          </div>

          {/* Média por setor */}
          {resumo.porSetor.length > 0 && (
            <div className="glass-panel rounded-2xl p-5 border border-linha">
              <h3 className="text-sm font-bold text-white font-display mb-4 flex items-center gap-2">
                <Users size={15} className="text-acao-200" /> Média por Setor
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {resumo.porSetor.map(s => (
                  <button
                    key={s.setor}
                    onClick={() => setFiltroSetor(filtroSetor === s.setor ? '' : s.setor)}
                    className={`text-left rounded-xl p-3 border transition-all ${
                      filtroSetor === s.setor
                        ? 'bg-acao/10 border-acao/40'
                        : 'bg-grafite-600/40 border-linha hover:border-slate-500'
                    }`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-white truncate">{s.setor}</span>
                      <span className="flex items-center gap-1 text-xs font-bold text-yellow-300 shrink-0">
                        {s.media.toFixed(1)} <Star size={11} className="fill-yellow-400 text-yellow-400" />
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1">{s.qtd} avaliação(ões)</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Distribuição por nota (clicável: filtra os feedbacks) */}
          <div className="glass-panel rounded-2xl p-5 border border-linha">
            <h3 className="text-sm font-bold text-white font-display mb-1 flex items-center gap-2">
              <BarChart3 size={15} className="text-yellow-400" /> Distribuição por Nota
            </h3>
            <p className="text-[11px] text-slate-500 mb-4">Clique numa nota para filtrar os feedbacks abaixo.</p>
            <div className="space-y-2">
              {[5, 4, 3, 2, 1].map(nota => {
                const item = resumo.distribuicao.find(d => d.nota === nota);
                const pct = resumo.total > 0 ? (item.qtd / resumo.total) * 100 : 0;
                const ativo = filtroNota === nota;
                return (
                  <button
                    key={nota}
                    onClick={() => setFiltroNota(ativo ? 0 : nota)}
                    className={`w-full flex items-center gap-3 rounded-lg px-2 py-1.5 transition-all border ${
                      ativo ? 'bg-yellow-500/10 border-yellow-500/40' : 'border-transparent hover:bg-grafite-600/40'
                    }`}>
                    <div className="flex items-center gap-1 w-16 shrink-0 justify-end">
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
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tabela de feedbacks */}
          <div className="glass-panel rounded-2xl p-5 border border-linha">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <h3 className="text-sm font-bold text-white font-display flex items-center gap-2">
                <MessageCircle size={15} className="text-acao-200" /> Feedbacks
                <span className="text-slate-500 font-normal">({feedbacksFiltrados.length})</span>
              </h3>
              {/* O RECORTE DESTA TABELA E OUTRO, e agora ela diz isso.

                  Os cartoes acima sao o agregado da empresa no ciclo, do
                  servidor. Esta lista sai das conversas que ESTA pessoa
                  acessa -- o servidor recorta por setor para quem nao e
                  Administrador --, e sem a linha abaixo os dois blocos
                  pareciam falar do mesmo conjunto. Era dai que vinha a
                  impressao de numero errado. */}
              <span className="text-[10px] text-slate-500 sm:order-last sm:w-full">
                Os feedbacks que você acessa, de todo o período
              </span>
              {avaliacoes.total > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={buscaAval}
                    onChange={e => setBuscaAval(e.target.value)}
                    placeholder="Buscar cliente, telefone ou comentário..."
                    className="bg-grafite-700 border border-linha rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-acao/50 w-full sm:w-64"
                  />
                  <select
                    value={filtroSetor}
                    onChange={e => setFiltroSetor(e.target.value)}
                    className="bg-grafite-700 border border-linha rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-acao/50">
                    <option value="">Todos os setores</option>
                    {avaliacoes.setores.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              )}
            </div>

            {(filtroNota > 0 || filtroSetor || buscaAval) && (
              <div className="flex flex-wrap items-center gap-2 mb-3">
                {filtroNota > 0 && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-yellow-500/15 text-yellow-300 border border-yellow-500/30">
                    Nota {filtroNota} <Star size={9} className="fill-yellow-400 text-yellow-400" />
                    <button onClick={() => setFiltroNota(0)} className="hover:text-white"><X size={10} /></button>
                  </span>
                )}
                {filtroSetor && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/30">
                    {filtroSetor}
                    <button onClick={() => setFiltroSetor('')} className="hover:text-white"><X size={10} /></button>
                  </span>
                )}
                <button
                  onClick={() => { setFiltroNota(0); setFiltroSetor(''); setBuscaAval(''); }}
                  className="text-[10px] text-slate-400 hover:text-white underline underline-offset-2">
                  limpar filtros
                </button>
              </div>
            )}

            {avaliacoes.total === 0 ? (
              <div className="text-center py-10">
                <Star size={32} className="mx-auto text-slate-600 mb-3" />
                <p className="text-sm text-slate-400">Nenhuma avaliação recebida ainda.</p>
                <p className="text-xs text-slate-500 mt-1">As avaliações aparecerão aqui quando os clientes avaliarem os atendimentos.</p>
              </div>
            ) : feedbacksFiltrados.length === 0 ? (
              <div className="text-center py-10 text-sm text-slate-400">
                Nenhuma avaliação para os filtros selecionados.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-linha text-slate-400">
                      <th className="text-left py-2.5 px-3 font-semibold">Cliente</th>
                      <th className="text-left py-2.5 px-3 font-semibold">Telefone</th>
                      <th className="text-center py-2.5 px-3 font-semibold">Nota</th>
                      <th className="text-left py-2.5 px-3 font-semibold">Atendente</th>
                      <th className="text-left py-2.5 px-3 font-semibold">Setor</th>
                      <th className="text-left py-2.5 px-3 font-semibold">Finalizado em</th>
                      <th className="text-left py-2.5 px-3 font-semibold">Comentário</th>
                    </tr>
                  </thead>
                  <tbody>
                    {feedbacksFiltrados.slice(0, 100).map(c => (
                      <tr key={c.linhaId || c.id} className={`border-b border-linha/40 hover:bg-grafite-600/40 transition-colors ${
                        c.avaliacao <= 2 ? 'bg-falha/5' : ''
                      }`}>
                        <td className="py-2.5 px-3 text-white font-semibold">{c.cliente}</td>
                        <td className="py-2.5 px-3 text-slate-400 font-mono">{c.telefone || '-'}</td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center justify-center gap-0.5">
                            {renderEstrelas(c.avaliacao)}
                          </div>
                        </td>
                        {/* Quem atendeu: e o dado que liga a nota a uma pessoa.
                            Sem responsavel, o "-" nao dizia NADA -- podia ser
                            atendimento do bot ou pessoa que respondeu sem
                            assumir. Agora separamos os dois casos: sem ninguem
                            ter aberto (`atendidoEm` vazio) foi o bot; com
                            `atendidoEm` e sem nome, alguem atendeu antes do
                            registro existir e isso fica dito como "nao
                            registrado", em vez de virar um tracinho mudo. */}
                        <td className="py-2.5 px-3">
                          {(c.atendenteNome || c.ultimoAtendenteNome) ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-500/15 text-purple-300 border border-purple-500/30"
                              title={c.atendenteCargo ? `${c.atendenteNome} · ${c.atendenteCargo}` : (c.atendenteNome || c.ultimoAtendenteNome)}>
                              <UserCheck size={10} /> {c.atendenteNome || c.ultimoAtendenteNome}
                            </span>
                          ) : c.atendidoEm ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-600/30 text-slate-400 border border-linha"
                              title="Uma pessoa atendeu, mas o responsável não ficou registrado (atendimento anterior a este registro).">
                              <UserCheck size={10} /> não registrado
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-acao/10 text-acao-200 border border-acao/30"
                              title="Atendimento feito só pelo chatbot: ninguém da equipe assumiu esta conversa.">
                              <Bot size={10} /> Bot
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/30">
                            {c.setor || 'Geral'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {c.fechadoEm ? (
                            <span className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-300">
                              <Clock size={11} className="text-slate-500 shrink-0" />
                              {new Date(c.fechadoEm).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: FUSO_BR })}
                              {' '}
                              {new Date(c.fechadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: FUSO_BR })}
                            </span>
                          ) : (
                            <span className="text-slate-600 text-[11px]">-</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-slate-300 max-w-xs truncate" title={c.feedback || ''}>{c.feedback || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ============= ABA: HELP DESK ============= */}
      {abaAtiva === 'helpdesk' && <HelpDeskPainel />}

      {/* ============= ABA: REGISTRO DE CONVERSAS ============= */}
      {abaAtiva === 'registro' && <RegistroConversas conversas={conversas} equipe={equipe} />}

      {/* Sem props: busca do servidor. `conversas` esta aqui em maos, mas vem
          filtrada por setor -- ver o comentario no topo de RelatoriosClientes. */}
      {abaAtiva === 'relatorios' && <RelatoriosClientes />}

      {abaAtiva === 'ranking' && podeVerRankings && <Rankings />}
    </div>
  );
}
