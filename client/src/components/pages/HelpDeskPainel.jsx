/**
 * Painel de Suporte (Help Desk) conteúdo da aba dentro da Visão Geral.
 *
 * Tudo derivado das conversas que já existem no banco: backlog, tempos de
 * resposta/resolução, SLA, volume e recorte por setor. Só leitura.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Inbox, Timer, CheckCircle2, Gauge, Star, RefreshCw,
  Loader2, AlertTriangle, Clock, TrendingUp, SlidersHorizontal, Save, Lock, Tag,
  X, Plus, RotateCcw
} from 'lucide-react';
import { HelpDeskAPI, ConfiguracoesAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useAppContext } from '../../context/AppContext';
import { FUSO_BR } from '../../utils/data';

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
        Metas usadas para calcular o <strong className="text-slate-300">SLA</strong> dos indicadores acima
        Ao salvar, os números são recalculados na hora vale para toda a equipe.
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

// Mesmos limites do servidor (configuracao.service.motivosEncerramento). Estão
// repetidos aqui de propósito, e não é duplicação de regra: o servidor é a
// autoridade e continua rejeitando o que passar. Isto é só para o erro aparecer
// enquanto a pessoa digita, em vez de depois de um round-trip.
const MOTIVO_MAX_CHARS = 60;
const MOTIVOS_MAX = 30;

/**
 * EDITOR DA TAXONOMIA DE MOTIVOS.
 *
 * Vive ao lado da quebra "por que procuraram", e não na tela de Configurações,
 * porque quem revisa a lista é quem acabou de ler o gráfico: você percebe que
 * "Erro ou indisponibilidade" virou 40% do volume e precisa quebrar em dois
 * exatamente nesse instante. Editar num lugar e conferir em outro é o que faz a
 * revisão trimestral nunca acontecer.
 *
 * ── A LISTA CURTA É A FUNCIONALIDADE ────────────────────────────────────────
 *
 * O aviso sobre tamanho não é decoração. Toda taxonomia grande é preenchida no
 * automático pelo primeiro item que serve, e o relatório que sai dela continua
 * bonito enquanto mente. Por isso o teto de 30 é do servidor, e por isso a tela
 * avisa antes disso.
 */
function ConfigMotivos({ motivos, onSalvo }) {
  const { usuario } = useAuth();
  const permissoes = usuario?.permissoes;
  const podeEditar = !Array.isArray(permissoes) || permissoes.includes('configuracoes');

  const [lista, setLista] = useState(motivos || []);
  const [novo, setNovo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState('');

  // Reflete o servidor quando as métricas recarregam (inclusive depois de
  // outra pessoa salvar). `join` como dependência: a identidade do array muda a
  // cada resposta HTTP, o conteúdo não -- comparar a referência reabriria a
  // lista do zero a cada 1,5s e apagaria o que a pessoa está digitando.
  const assinatura = (motivos || []).join('|');
  useEffect(() => { setLista(motivos || []); }, [assinatura]); // eslint-disable-line react-hooks/exhaustive-deps

  const adicionar = () => {
    const v = novo.trim();
    if (!v) return;
    if (v.length > MOTIVO_MAX_CHARS) { setErro(`Motivo muito longo (máximo ${MOTIVO_MAX_CHARS} caracteres).`); return; }
    // Comparação sem caixa: "Boleto" e "boleto" viram duas fatias do mesmo
    // assunto no relatório, e ninguém consegue somar as duas de volta depois.
    if (lista.some(m => m.toLowerCase() === v.toLowerCase())) { setErro('Esse motivo já está na lista.'); return; }
    if (lista.length >= MOTIVOS_MAX) { setErro(`A lista chegou ao limite de ${MOTIVOS_MAX} motivos.`); return; }
    setLista([...lista, v]);
    setNovo('');
    setErro('');
  };

  const remover = (m) => { setLista(lista.filter(x => x !== m)); setErro(''); };

  async function salvar(novaLista) {
    const alvo = novaLista ?? lista;
    setSalvando(true); setErro(''); setSalvo(false);
    try {
      await ConfiguracoesAPI.salvar({ 'atendimento.motivos': JSON.stringify(alvo) });
      setSalvo(true);
      setTimeout(() => setSalvo(false), 3000);
      onSalvo?.();
    } catch (e) {
      setErro(e.message);
    } finally {
      setSalvando(false);
    }
  }

  // RESTAURAR O PADRÃO = gravar lista vazia.
  //
  // O servidor devolve MOTIVOS_PADRAO quando a chave está vazia ou ilegível, e
  // é essa regra que se usa aqui. A alternativa seria mandar a lista padrão de
  // volta pelo navegador -- e aí existiriam duas cópias dela, uma no servidor e
  // outra no bundle, livres para divergir no primeiro dia em que alguém
  // editasse só uma.
  const restaurarPadrao = () => { setLista([]); salvar([]); };

  const campo = 'flex-1 min-w-0 bg-grafite-700 border border-linha rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-acao/50';

  return (
    <div className="glass-panel rounded-2xl p-5 border border-linha space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-white font-display flex items-center gap-2">
          <Tag size={15} className="text-acao-200" /> Motivos de encerramento
        </h3>
        {!podeEditar && (
          <span className="text-[10px] text-slate-500 flex items-center gap-1 shrink-0">
            <Lock size={11} /> somente leitura
          </span>
        )}
      </div>
      <p className="text-[11px] text-slate-400 leading-relaxed">
        A lista que o atendente escolhe ao fechar. Mantenha curta — de 8 a 12 itens.
        Lista grande é preenchida no automático, e o relatório continua bonito enquanto mente.
        Revisar por trimestre: divida o motivo que ficou grande demais, junte o que ninguém usa.
      </p>

      <div className="flex flex-wrap gap-1.5">
        {lista.length === 0 ? (
          <p className="text-[11px] text-slate-500 italic py-1">
            Lista vazia — ao salvar assim, o sistema volta aos 12 motivos padrão.
          </p>
        ) : lista.map(m => (
          <span key={m} className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-xl bg-grafite-700 border border-linha text-xs text-slate-200">
            {m}
            {podeEditar && (
              <button onClick={() => remover(m)} title={`Remover "${m}"`}
                className="p-0.5 rounded-lg text-slate-500 hover:text-falha-400 hover:bg-falha/10 transition-colors">
                <X size={12} />
              </button>
            )}
          </span>
        ))}
      </div>

      {podeEditar && (
        <div className="flex gap-2">
          <input
            className={campo}
            value={novo}
            maxLength={MOTIVO_MAX_CHARS}
            placeholder="Novo motivo (ex: Migração de servidor)"
            onChange={e => { setNovo(e.target.value); setErro(''); }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); adicionar(); } }}
          />
          <button onClick={adicionar} disabled={!novo.trim()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-grafite-700 border border-linha text-slate-300 hover:text-white hover:border-linha-forte text-xs font-bold transition-colors disabled:opacity-40 shrink-0">
            <Plus size={13} /> Adicionar
          </button>
        </div>
      )}

      {/* O QUE ACONTECE COM O HISTÓRICO. É a primeira dúvida de quem vai apagar
          um item, e não saber a resposta é o que trava a revisão. */}
      <p className="text-[10px] text-slate-500 leading-relaxed">
        Remover um motivo <strong className="text-slate-400">não altera atendimentos já fechados</strong>:
        eles mantêm o motivo escolhido na época e continuam aparecendo na quebra acima.
        A mudança vale só para os próximos fechamentos.
      </p>

      {erro && <p className="text-[11px] text-falha-400">{erro}</p>}

      {podeEditar && (
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => salvar()} disabled={salvando}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-acao hover:bg-acao-200 text-slate-950 text-xs font-bold transition-all disabled:opacity-60">
            {salvando ? <Loader2 size={14} className="animate-spin" /> : salvo ? <CheckCircle2 size={14} /> : <Save size={14} />}
            {salvando ? 'Salvando...' : salvo ? 'Salvo!' : 'Salvar lista'}
          </button>
          <button onClick={restaurarPadrao} disabled={salvando}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-grafite-700 border border-linha text-slate-400 hover:text-white hover:border-linha-forte text-xs font-bold transition-colors disabled:opacity-60">
            <RotateCcw size={13} /> Restaurar padrão
          </button>
        </div>
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

/**
 * Subtítulo dos KPIs de tempo. A MÉDIA continua no número grande; os percentis
 * entram aqui embaixo.
 *
 * Os três juntos é que contam a história: quando a média está colada no p50, a
 * operação é regular e o número grande pode ser lido sem ressalva. Quando ela
 * está bem acima do p50, existe uma cauda de casos ruins escondida atrás dela —
 * e o p90 mostra o tamanho dessa cauda. É esse cliente, e não o do meio, que
 * liga reclamando.
 */
function fmtPercentis(p50, p90, amostra, unidade) {
  if (!amostra) return 'sem base de cálculo ainda';
  return `p50 ${fmtDuracao(p50, amostra)} · p90 ${fmtDuracao(p90, amostra)} · base: ${amostra} ${unidade}`;
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
  // Pulso de "mudou alguma conversa", vindo do SSE que o painel já mantém
  // aberto (AppContext). É o que substitui o F5: os indicadores são derivados
  // das conversas/atendimentos, então quando eles mudam estes números mudam.
  const { sinalConversas } = useAppContext();

  // `silencioso` evita o spinner nas recargas automáticas: o número troca no
  // lugar, sem a tela inteira piscar a cada mensagem que chega.
  const carregar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCarregando(true);
    setErro('');
    try {
      setDados(await HelpDeskAPI.metricas());
    } catch (e) {
      setErro(e.message);
    } finally {
      if (!silencioso) setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  // Recarrega quando o servidor avisa que algo mudou. Agrupado num pequeno
  // atraso porque uma rajada de eventos (várias mensagens seguidas) deve virar
  // UMA releitura, não uma por evento.
  useEffect(() => {
    if (!sinalConversas) return;
    const t = setTimeout(() => carregar(true), 1500);
    return () => clearTimeout(t);
  }, [sinalConversas, carregar]);

  return (
    <div className="space-y-6 baixa:lg:space-y-4">
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
              sub={fmtPercentis(dados.tempos.respostaP50Seg, dados.tempos.respostaP90Seg, dados.tempos.respostaAmostra, 'atendimento(s)')} />
            <Kpi icon={CheckCircle2} cor="emerald" titulo="Tempo médio de resolução"
              valor={fmtDuracao(dados.tempos.resolucaoMedioSeg, dados.tempos.resolucaoAmostra)}
              sub={fmtPercentis(dados.tempos.resolucaoP50Seg, dados.tempos.resolucaoP90Seg, dados.tempos.resolucaoAmostra, 'fechado(s)')} />
            <Kpi icon={Gauge} cor="orange" titulo={`SLA de resposta (≤ ${dados.sla.respostaLimiteMin} min)`}
              valor={dados.sla.respostaPct == null ? '-' : `${dados.sla.respostaPct}%`}
              sub={`dentro da meta · base: ${dados.tempos.respostaAmostra} atendimento(s)`} />
            <Kpi icon={Gauge} cor="orange" titulo={`SLA de resolução (≤ ${dados.sla.resolucaoLimiteHoras} h)`}
              valor={dados.sla.resolucaoPct == null ? '-' : `${dados.sla.resolucaoPct}%`}
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

          {/* POR QUE OS CLIENTES PROCURAM.
              Esta é a única tabela do painel que responde a uma pergunta de
              CAUSA, e não de volume: as outras dizem quanto e quão rápido, esta
              diz o quê. É a lista que se usa para fazer um chamado deixar de
              existir, em vez de só atendê-lo mais rápido. */}
          <div className="glass-panel rounded-2xl p-5 border border-linha">
            <h3 className="text-sm font-bold text-white font-display mb-1 flex items-center gap-2">
              <Tag size={15} className="text-acao-200" /> Por que procuraram
            </h3>
            <p className="text-[11px] text-slate-500 mb-4">
              Motivo escolhido no fechamento · base: {dados.status.fechada} atendimento(s) fechado(s)
            </p>
            {dados.porMotivo.length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center">
                Nenhum atendimento fechado ainda — o motivo é escolhido no fechamento.
              </p>
            ) : (
              <div className="space-y-2">
                {dados.porMotivo.map(m => (
                  <div key={m.motivo} className="flex items-center gap-3">
                    <div className="w-44 sm:w-56 shrink-0 text-xs truncate" title={m.motivo}>
                      {/* "Não informado" é dado faltando, não uma categoria de
                          negócio: fica em cinza para não disputar leitura com os
                          motivos reais, mas continua visível -- o tamanho dessa
                          barra é o termômetro da qualidade do próprio relatório. */}
                      <span className={m.motivo === 'Não informado' ? 'text-slate-500 italic' : 'text-white font-semibold'}>
                        {m.motivo}
                      </span>
                    </div>
                    <div className="flex-1 h-2 rounded-full bg-grafite-700 overflow-hidden min-w-0">
                      <div
                        className={`h-full rounded-full ${m.motivo === 'Não informado' ? 'bg-slate-600' : 'bg-acao'}`}
                        style={{ width: `${Math.max(m.pct, 2)}%` }}
                      />
                    </div>
                    <div className="w-20 shrink-0 text-right text-xs font-mono text-slate-300">
                      {m.total} <span className="text-slate-500">· {m.pct}%</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
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

          <ConfigMotivos motivos={dados.motivosDisponiveis} onSalvo={carregar} />

          <ConfigIndicadores sla={dados.sla} onSalvo={carregar} />

          <p className="text-[10px] text-slate-500">
            Atualizado em {new Date(dados.geradoEm).toLocaleString('pt-BR', { timeZone: FUSO_BR })}.
          </p>
        </>
      ) : null}
    </div>
  );
}
