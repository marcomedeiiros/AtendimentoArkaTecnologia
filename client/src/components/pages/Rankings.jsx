/**
 * 🏆 RANKINGS -- duas competicoes separadas, e nunca uma tabela so.
 *
 * ── POR QUE ABAS, E NAO UMA LISTA COM UMA COLUNA "EQUIPE" ──────────────────
 *
 * Nao e organizacao visual: os totais nem sao comparaveis. Na sede o teto
 * cresce com o volume (cada atendimento vale 1 ponto, sem limite); no externo o
 * teto e 100, fechado. Numa tabela unica a equipe externa apareceria sempre
 * atras por causa da escala, e nao do trabalho -- e a primeira pessoa a
 * perceber isso pararia de confiar no ranking inteiro.
 *
 * Por isso nao existe nem endpoint que devolva os dois juntos: a separacao
 * mora no servidor, e a tela nao teria como misturar mesmo que quisesse.
 *
 * ── OS CRITERIOS APARECEM SEMPRE ───────────────────────────────────────────
 *
 * Cada linha abre e mostra de onde vieram os pontos. Ranking que so mostra o
 * total gera desconfianca em vez de disputa: quem esta em terceiro precisa
 * saber em QUAL parcela perdeu, senao a unica leitura possivel e "o sistema nao
 * gosta de mim". Os numeros das parcelas vem do servidor prontos -- a tela nao
 * recalcula nada.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Trophy, Medal, Building2, Car, ChevronDown, ChevronRight, Loader2, AlertCircle,
  TrendingUp, TrendingDown, Minus, Sparkles, Gift, ClipboardList, Calendar, Eraser,
  RotateCcw,
} from 'lucide-react';
import { RankingsAPI, DashboardAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { FUSO_BR } from '../../utils/data';
import { avisar, confirmar, pedirTexto } from '../../utils/dialogo';

const MEDALHAS = ['--medalha-1', '--medalha-2', '--medalha-3'];
const medalha = (v, o = 1) => `rgb(var(${v}) / ${o})`;

const ABAS = [
  { id: 'sede', rotulo: 'Atendimento na Sede', Icon: Building2 },
  { id: 'externo', rotulo: 'Atendimento Fora da Sede', Icon: Car },
];

const MES_NOME = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

const competenciaAtual = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

function rotuloCompetencia(comp) {
  const [ano, mes] = String(comp || '').split('-').map(Number);
  if (!ano || !mes) return comp;
  return `${MES_NOME[mes - 1]}/${ano}`;
}

// Os ultimos 18 meses. Suficiente para comparar com o ano passado e curto o
// bastante para caber num select sem virar rolagem infinita.
function mesesDisponiveis() {
  const out = [];
  const d = new Date();
  for (let i = 0; i < 18; i += 1) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

function iniciais(nome = '') {
  const p = String(nome).trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '?';
  if (p.length === 1) return p[0].slice(0, 2).toUpperCase();
  return (p[0][0] + p[p.length - 1][0]).toUpperCase();
}

// "4 min", "58 s" -- o tempo ate assumir vem em segundos do servidor.
function duracao(seg) {
  if (seg == null) return null;
  if (seg < 60) return `${Math.round(seg)} s`;
  const min = Math.round(seg / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}

/**
 * O valor de um criterio, escrito do jeito que ele significa.
 *
 * "1 de 3 notas" e nao "0,0": amostra pequena demais nao e desempenho ruim, e
 * mostrar zero ali seria acusar a pessoa de algo que ela nao fez. Vale para os
 * dois rankings -- a sede tem minimo de avaliacoes, o externo tem minimo de
 * mapeamentos, pela mesma razao.
 */
function valorCriterio(c) {
  if (c.conta === false) {
    return { texto: `${c.amostra ?? 0} de ${c.minimo ?? 3}`, fraco: true };
  }
  if (c.valor == null) return { texto: '—', fraco: true };
  if (c.chave === 'nota') return { texto: c.valor.toFixed(1).replace('.', ','), fraco: false };
  if (c.chave === 'agilidade') return { texto: duracao(c.valor) || '—', fraco: false };
  return { texto: `${c.valor}${c.sufixo || ''}`, fraco: false };
}

const EVOLUCAO = {
  subiu: { Icon: TrendingUp, cor: 'text-ativo-400', titulo: 'Subiu de posição em relação ao mês anterior' },
  caiu: { Icon: TrendingDown, cor: 'text-falha-400', titulo: 'Caiu de posição em relação ao mês anterior' },
  manteve: { Icon: Minus, cor: 'text-texto-fraco', titulo: 'Manteve a posição do mês anterior' },
  novo: { Icon: Sparkles, cor: 'text-acao-200', titulo: 'Sem posição no mês anterior' },
};

function Evolucao({ estado, anterior }) {
  const e = EVOLUCAO[estado] || EVOLUCAO.novo;
  const { Icon } = e;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${e.cor}`} title={e.titulo}>
      <Icon size={12} className="shrink-0" />
      {anterior?.posicao ? `${anterior.posicao}º` : 'novo'}
    </span>
  );
}

/** O pódio. Os três primeiros ganham cartão próprio; o resto vai na tabela. */
function Podio({ classificacao, premiacoes }) {
  const tres = classificacao.slice(0, 3);
  if (!tres.length) return null;
  // Ordem visual 2 - 1 - 3, como num pódio de verdade: o primeiro no meio e
  // mais alto. Numa lista 1-2-3 o olho lê ordem de leitura, não hierarquia.
  const ordem = [tres[1], tres[0], tres[2]].filter(Boolean);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
      {ordem.map((p) => {
        const cor = MEDALHAS[p.posicao - 1];
        const premio = premiacoes?.find((x) => x.posicao === p.posicao);
        return (
          <div
            key={p.usuarioId}
            className={`rounded-2xl border p-4 flex flex-col items-center text-center ${p.posicao === 1 ? 'sm:-mt-3 sm:pb-6' : ''}`}
            style={{
              borderColor: medalha(cor, 0.45),
              background: `linear-gradient(180deg, ${medalha(cor, 0.14)}, ${medalha(cor, 0.02)})`,
            }}
          >
            <span className="relative mb-2" style={{ width: 56, height: 56 }}>
              <span
                className="w-full h-full rounded-full border grid place-items-center font-display font-bold text-base"
                style={{ borderColor: medalha(cor, 0.5), background: medalha(cor, 0.16), color: medalha(cor) }}
              >
                {iniciais(p.nome)}
              </span>
              <Medal
                className="absolute left-1/2"
                style={{
                  width: 26, height: 26, bottom: -14, transform: 'translateX(-50%)',
                  color: medalha(cor), fill: medalha(cor, 0.22),
                  filter: 'drop-shadow(0 0 3px rgb(var(--grafite-800))) drop-shadow(0 0 3px rgb(var(--grafite-800)))',
                }}
                aria-hidden="true"
              />
            </span>
            <p className="mt-3 font-bold text-sm text-texto truncate max-w-full">{p.nome}</p>
            <p className="font-display font-extrabold text-2xl tabular-nums" style={{ color: medalha(cor) }}>
              {p.pontos}
              <span className="text-xs font-bold text-texto-fraco ml-1">pts</span>
            </p>
            <div className="mt-1"><Evolucao estado={p.evolucao} anterior={p.anterior} /></div>
            {premio && (
              <p className="mt-2 text-[10px] px-2 py-1 rounded-full border flex items-center gap-1"
                style={{ borderColor: medalha(cor, 0.4), color: medalha(cor) }}>
                <Gift size={10} /> {premio.premio || 'Premiado'}{premio.valor ? ` · ${premio.valor}` : ''}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function LinhaTabela({ p, aberta, onAlternar }) {
  const temMedalha = p.posicao <= 3;
  const cor = MEDALHAS[p.posicao - 1] || '--quieto';
  return (
    <>
      <tr
        className="border-t border-linha hover:bg-grafite-700/40 cursor-pointer"
        onClick={onAlternar}
        title="Ver os critérios que geraram a pontuação"
      >
        <td className="py-2.5 px-3">
          <span className="font-display font-extrabold tabular-nums text-sm"
            style={{ color: temMedalha ? medalha(cor) : 'rgb(var(--texto-suave))' }}>
            {p.posicao}º
          </span>
        </td>
        <td className="py-2.5 px-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-7 h-7 rounded-full border grid place-items-center text-[10px] font-bold shrink-0"
              style={{
                borderColor: temMedalha ? medalha(cor, 0.5) : 'rgb(var(--linha-forte))',
                background: temMedalha ? medalha(cor, 0.15) : 'rgb(var(--grafite-600))',
                color: temMedalha ? medalha(cor) : 'rgb(var(--texto-suave))',
              }}>
              {iniciais(p.nome)}
            </span>
            <div className="min-w-0">
              <span className="font-semibold text-xs text-texto truncate block">{p.nome}</span>
              {/* NO CELULAR A INFORMAÇÃO DESCE PARA CÁ.
                  As colunas de registros, último atendimento e evolução somam
                  quase 400px e obrigavam a rolar a tabela de lado para chegar
                  aos pontos -- justamente o número pelo qual a tabela existe.
                  Elas somem nas telas estreitas e o essencial delas aparece
                  aqui embaixo, numa linha só. */}
              {/* `max-w` explícito: numa tabela de layout automático o
                  `truncate` sozinho não segura -- a coluna cresce até caber o
                  texto inteiro, e uma razão social longa voltaria a empurrar a
                  largura mínima da tabela para cima. (Sem escrever a tag aqui:
                  o verificador de responsividade procura a marcação no texto e
                  acusaria esta linha como uma tabela sem container rolável.) */}
              <span className="lg:hidden text-[10px] text-texto-fraco truncate block max-w-[11rem]">
                {p.registros} {p.registros === 1 ? 'registro' : 'registros'}
                {p.ultimo?.empresa || p.ultimo?.cliente
                  ? ` · ${p.ultimo.empresa || p.ultimo.cliente}`
                  : ''}
              </span>
            </div>
          </div>
        </td>
        <td className="py-2.5 px-3 text-right font-display font-extrabold tabular-nums text-texto">{p.pontos}</td>
        <td className="py-2.5 px-3 text-right tabular-nums text-texto-suave text-xs hidden lg:table-cell">{p.registros}</td>
        {/* ÚLTIMO ATENDIMENTO -- de qualquer data, e não do mês selecionado.
            São perguntas diferentes: os pontos dizem "como foi o mês", esta
            coluna diz "quando essa pessoa atendeu pela última vez" -- e ela só
            é útil justamente quando a resposta é antiga. */}
        {/* Teto de largura + truncate: uma razão social de 50 caracteres
            ("SALVADOR ASSESSORIA E RECUPERACAO DE CREDITO LTDA") sozinha
            empurrava a tabela para 817px de largura mínima. O nome inteiro fica
            no `title`. */}
        <td className="py-2.5 px-3 text-[11px] text-texto-suave hidden lg:table-cell">
          {p.ultimo ? (
            <div className="flex items-baseline gap-1.5 min-w-0">
              <span className="text-texto truncate max-w-[16rem]" title={p.ultimo.empresa || p.ultimo.cliente || ''}>
                {p.ultimo.empresa || p.ultimo.cliente || '—'}
              </span>
              <span className="text-texto-fraco shrink-0">
                {p.ultimo.quando
                  ? new Date(p.ultimo.quando).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: FUSO_BR })
                  : ''}
              </span>
            </div>
          ) : (
            <span className="text-texto-fraco">—</span>
          )}
        </td>
        <td className="py-2.5 px-3 hidden sm:table-cell"><Evolucao estado={p.evolucao} anterior={p.anterior} /></td>
        <td className="py-2.5 px-3 text-right text-texto-fraco">
          {aberta ? <ChevronDown size={14} className="inline" /> : <ChevronRight size={14} className="inline" />}
        </td>
      </tr>
      {aberta && (
        <tr className="bg-grafite-800/60">
          <td colSpan={7} className="px-3 pb-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 pt-1">
              {p.criterios.map((c) => {
                const v = valorCriterio(c);
                return (
                  <div key={c.chave} className="rounded-xl border border-linha bg-grafite-700/60 p-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-texto-fraco truncate">{c.rotulo}</p>
                    <div className="flex items-baseline justify-between gap-2 mt-0.5">
                      <span className={`text-sm font-semibold ${v.fraco ? 'text-texto-fraco' : 'text-texto'}`}>{v.texto}</span>
                      <span className="text-xs font-display font-extrabold text-acao-200 tabular-nums">+{c.pontos}</span>
                    </div>
                  </div>
                );
              })}
              <div className="rounded-xl border border-acao/40 bg-acao/10 p-2.5 flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-acao-200">Total</span>
                <span className="text-lg font-display font-extrabold text-acao-200 tabular-nums">{p.pontos}</span>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/** Evolução mês a mês, por pessoa. */
function Historico({ dados }) {
  if (!dados?.pessoas?.length) return null;
  const comDados = dados.pessoas.filter((p) => p.meses.some((m) => m.pontos > 0));
  if (!comDados.length) return null;

  return (
    <div className="mt-5">
      <h4 className="text-xs font-bold text-texto flex items-center gap-2 mb-2">
        <Calendar size={13} className="text-acao-200" /> Evolução dos últimos meses
      </h4>
      <div className="overflow-x-auto rounded-xl border border-linha">
        <table className="w-full text-xs">
          <thead className="bg-grafite-700">
            <tr>
              <th className="text-left py-2 px-3 font-bold text-texto-suave">Funcionário</th>
              {dados.competencias.map((c) => (
                <th key={c} className="py-2 px-3 font-bold text-texto-suave text-right whitespace-nowrap">
                  {rotuloCompetencia(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {comDados.map((p) => (
              <tr key={p.usuarioId} className="border-t border-linha">
                <td className="py-2 px-3 font-semibold text-texto whitespace-nowrap">{p.nome}</td>
                {dados.competencias.map((c) => {
                  const m = p.meses.find((x) => x.competencia === c);
                  return (
                    <td key={c} className="py-2 px-3 text-right tabular-nums whitespace-nowrap">
                      {m ? (
                        <>
                          <span className="text-texto font-semibold">{m.pontos}</span>
                          <span className="text-texto-fraco text-[10px] ml-1">{m.posicao}º</span>
                        </>
                      ) : (
                        <span className="text-texto-fraco">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Rankings() {
  const { usuario } = useAuth();
  const [aba, setAba] = useState('sede');
  const [competencia, setCompetencia] = useState(competenciaAtual());
  const [dados, setDados] = useState(null);
  const [historico, setHistorico] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [abertas, setAbertas] = useState(() => new Set());
  const [limpando, setLimpando] = useState(false);

  const meses = useMemo(mesesDisponiveis, []);
  const ehAdmin = usuario?.cargo === 'Administrador';

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      // Em paralelo: o histórico não depende do ranking do mês, e esperar um
      // pelo outro só faria a tela demorar o dobro sem motivo.
      const [r, h] = await Promise.all([
        RankingsAPI.obter(aba, competencia),
        RankingsAPI.historico(aba, competencia, 6),
      ]);
      setDados(r);
      setHistorico(h);
    } catch (e) {
      setErro(e?.message || 'Não foi possível carregar o ranking.');
      setDados(null);
    } finally {
      setCarregando(false);
    }
  }, [aba, competencia]);

  useEffect(() => { carregar(); }, [carregar]);
  // Trocar de aba ou de mês fecha os detalhes: manter aberto o de outra pessoa,
  // em outro ranking, mostraria critérios que não são os daquela linha.
  useEffect(() => { setAbertas(new Set()); }, [aba, competencia]);

  const alternar = (id) => setAbertas((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  /**
   * Registrar o prêmio de uma posição.
   *
   * O vencedor NÃO é escolhido aqui: o servidor lê quem está na posição no
   * ranking calculado. A tela só informa o que foi dado -- deixar a tela mandar
   * o id do premiado permitiria premiar quem não ganhou.
   */
  const premiar = async (posicao) => {
    const premio = await pedirTexto(
      `O que o ${posicao}º lugar de ${rotuloCompetencia(competencia)} recebeu?`,
      { titulo: 'Registrar premiação', placeholder: 'Ex.: Vale-presente, folga, bônus' }
    );
    if (!premio) return;
    const valor = await pedirTexto('Valor ou descrição (opcional)', {
      titulo: 'Registrar premiação', placeholder: 'Ex.: R$ 200,00',
    });
    try {
      await RankingsAPI.registrarPremiacao({
        ranking: aba, competencia, posicao, premio, valor: valor || null,
      });
      await carregar();
    } catch (e) {
      avisar(e?.message || 'Não foi possível registrar.', { titulo: 'Premiação não registrada' });
    }
  };

  /**
   * UM BOTÃO DE LIMPAR POR RANKING -- o da aba que está aberta.
   *
   * Antes havia um só, e ele zerava a sede: quem estivesse na aba "Fora da
   * Sede" clicava e via a OUTRA equipe zerar. Agora o botão pertence à aba e o
   * texto diz o nome da equipe -- não dá para limpar a sede sem estar olhando
   * para ela.
   *
   * Limpar NÃO APAGA NADA: grava um instante, e a contagem daquele ranking
   * recomeça dali. Meses já encerrados antes do instante continuam inteiros (é
   * o `pisoDoMes` no servidor), então uma premiação de julho não some porque
   * alguém limpou em setembro.
   */
  const limparRanking = async () => {
    const ok = await confirmar(
      `A pontuação de "${rotuloAba}" volta a zero e passa a contar a partir de agora` +
      (aba === 'sede' ? ', aqui e no Modo TV.' : '.') + '\n\n' +
      'Nenhum atendimento, avaliação ou relatório é apagado, os meses já ' +
      'encerrados continuam como estão, e dá para desfazer no botão "Restaurar".',
      {
        titulo: `Limpar os dados de ${rotuloAba.toLowerCase()}?`,
        rotuloConfirmar: 'Limpar',
        rotuloCancelar: 'Deixar como está',
        perigo: true,
      }
    );
    if (!ok) return;
    setLimpando(true);
    try {
      await DashboardAPI.limparPainel(aba);
      // Recarrega: o `zeradoEm` que vem junto é o que troca este botão pelo de
      // restaurar e acende o aviso. Sem isto a tela só diria que está limpa no
      // próximo F5.
      await carregar();
      avisar('A contagem recomeça a partir de agora. Nada foi apagado.', {
        titulo: 'Dados limpos', tipo: 'info',
      });
    } catch (e) {
      avisar(e?.message || 'Não foi possível limpar.', { titulo: 'Limpeza não concluída' });
    } finally {
      setLimpando(false);
    }
  };

  /**
   * Desfaz a limpeza -- o botão que faltava.
   *
   * Ele existia na tela anterior e não veio junto na mudança para cá; sem ele,
   * quem clicasse em limpar ficava com o painel vazio e nenhum caminho de
   * volta. Só aparece quando há o que desfazer.
   */
  const restaurarRanking = async () => {
    const ok = await confirmar(
      `Os dados anteriores de "${rotuloAba}" voltam a aparecer. Eles nunca foram apagados: ` +
      'a limpeza só tinha marcado a partir de quando contar.',
      { titulo: 'Restaurar os dados?', rotuloConfirmar: 'Restaurar' }
    );
    if (!ok) return;
    setLimpando(true);
    try {
      await DashboardAPI.restaurarPainel(aba);
      await carregar();
      avisar('Os dados voltaram.', { titulo: 'Dados restaurados', tipo: 'info' });
    } catch (e) {
      avisar(e?.message || 'Não foi possível restaurar.', { titulo: 'Restauração não concluída' });
    } finally {
      setLimpando(false);
    }
  };

  const remover = async (p) => {
    const ok = await confirmar(`Remover o registro de premiação de ${p.usuarioNome}?`, {
      titulo: 'Remover premiação', rotuloConfirmar: 'Remover', perigo: true,
    });
    if (!ok) return;
    try {
      await RankingsAPI.removerPremiacao(p.id);
      await carregar();
    } catch (e) {
      avisar(e?.message || 'Não foi possível remover.');
    }
  };

  const lista = dados?.classificacao || [];
  const rotuloAba = ABAS.find((a) => a.id === aba)?.rotulo || '';
  // Desde quando ESTE ranking está contando. Vem do servidor junto com a
  // classificação, e não de um estado local: quem limpou pode ter sido outro
  // administrador, em outra máquina.
  const zeradoEm = dados?.zeradoEm ? new Date(dados.zeradoEm) : null;

  return (
    // Sem padding nem título próprios: isto é o CONTEÚDO de uma aba da Visão
    // Geral, que já tem cabeçalho. Um segundo "Rankings" logo abaixo do título
    // da tela faria a aba parecer outra página dentro da página.
    <div className="space-y-4 fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-xs text-texto-fraco min-w-0">
          Duas competições separadas as atividades e os indicadores são diferentes.
        </p>

        {/* OS CONTROLES FICAM JUNTOS, no alto e à direita.
            O botão de limpar estava numa faixa própria abaixo, e ali ele lia
            como se pertencesse às abas -- que é justamente o que ele NÃO faz
            (zera o Modo TV, não esta tela). Ao lado do seletor de mês fica
            claro que os dois são controles do quadro, e não da lista. */}
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <div className="flex items-center gap-2">
            <label htmlFor="ranking-mes" className="text-[11px] font-semibold text-texto-suave shrink-0">Mês</label>
            <select
              id="ranking-mes"
              value={competencia}
              onChange={(e) => setCompetencia(e.target.value)}
              className="bg-grafite-700 border border-linha rounded-xl px-3 py-2 text-xs text-texto focus:outline-none focus:border-acao/50"
            >
              {meses.map((m) => (
                <option key={m} value={m}>{rotuloCompetencia(m)}</option>
              ))}
            </select>
          </div>

          {/* O botão é o da ABA ABERTA, e some quando não há o que fazer: com o
              ranking zerado, o que cabe ali é restaurar, não limpar de novo. */}
          {ehAdmin && !zeradoEm && (
            <button
              onClick={limparRanking}
              disabled={limpando}
              title={`Zera a contagem de ${rotuloAba} a partir de agora nada é apagado, e dá para desfazer`}
              className="px-3 py-2 rounded-xl bg-falha/15 border border-falha/40 text-falha-400 hover:bg-falha/25 text-[11px] font-bold flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              {limpando ? <Loader2 size={12} className="animate-spin" /> : <Eraser size={12} />}
              {/* No celular só o essencial: o nome inteiro da equipe é o que
                  estoura a linha, e o `title` guarda a frase completa. */}
              <span className="sm:hidden">Limpar</span>
              <span className="hidden sm:inline">
                {aba === 'sede' ? 'Limpar dados de atendimento na sede' : 'Limpar atendimento fora da sede'}
              </span>
            </button>
          )}

          {ehAdmin && zeradoEm && (
            <button
              onClick={restaurarRanking}
              disabled={limpando}
              title={`Faz os dados de ${rotuloAba} anteriores à limpeza voltarem a aparecer`}
              className="px-3 py-2 rounded-xl bg-acao/15 border border-acao/40 text-acao-400 hover:bg-acao/25 text-[11px] font-bold flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              {limpando ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
              Restaurar dados
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {ABAS.map(({ id, rotulo, Icon }) => (
          <button
            key={id}
            onClick={() => setAba(id)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border flex items-center gap-1.5 ${
              aba === id
                ? 'bg-espera/15 border-espera/40 text-espera-400'
                : 'bg-grafite-700 border-linha text-texto-suave hover:text-texto hover:border-linha-forte'
            }`}
          >
            <Icon size={13} /> {rotulo}
          </button>
        ))}
      </div>

      {erro && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-falha/10 border border-falha/30 text-falha-400 text-xs">
          <AlertCircle size={14} className="shrink-0" /> {erro}
        </div>
      )}

      {/* POR QUE A TABELA ESTÁ VAZIA.
          Um ranking zerado é indistinguível de uma equipe que não atendeu --
          e foi exatamente essa confusão que fez alguém procurar defeito onde
          houve um clique. O aviso diz desde quando está contando e lembra que
          nada foi apagado. */}
      {zeradoEm && dados?.zeradoNoMes && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-espera/10 border border-espera/30 text-espera-400 text-xs">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>
            Contando a partir de{' '}
            <strong>
              {zeradoEm.toLocaleString('pt-BR', { timeZone: FUSO_BR, dateStyle: 'short', timeStyle: 'short' })}
            </strong>
            {' '}o que veio antes não foi apagado, só deixou de ser somado.
            {ehAdmin && ' Use "Restaurar dados" para voltar tudo.'}
          </span>
        </div>
      )}

      <div className="glass-panel border border-linha rounded-2xl p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h3 className="text-sm font-bold text-texto">
            {dados?.rotulo || ''}  {rotuloCompetencia(competencia)}
          </h3>
          {/* QUEM VALIDA -- e a frase parou de dizer "não concorre".
              Ela era verdade enquanto havia uma marca de supervisor que excluía
              a pessoa da lista. Com a supervisão passando a ser do cargo de
              Administrador, quem valida TAMBÉM concorre se estiver marcado numa
              equipe -- e o nome dele aparece na tabela logo abaixo. A frase
              antiga se contradizia na mesma tela.

              Só na aba externa: é lá que existe algo a validar (o relatório de
              visita). Na sede não há validação nenhuma, e anunciar validador
              faria pensar que alguém aprova atendimento. */}
          {aba === 'externo' && dados?.supervisores?.length > 0 && (
            <span className="text-[11px] text-texto-fraco min-w-0 truncate" title={dados.supervisores.map((s) => s.nome).join(', ')}>
              Valida os relatórios: {dados.supervisores.map((s) => s.nome).join(', ')}
            </span>
          )}
        </div>

        {carregando && !dados ? (
          <div className="py-14 grid place-items-center"><Loader2 size={22} className="animate-spin text-acao" /></div>
        ) : lista.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm font-semibold text-texto-suave">Nenhum participante neste ranking ainda.</p>
            {/* Diz O QUE FAZER. Uma tela vazia sem instrução vira chamado de
                suporte -- e a causa aqui é sempre a mesma: ninguém foi marcado. */}
            <p className="text-[11px] text-texto-fraco mt-1 max-w-md mx-auto">
              Em <strong className="text-texto-suave">Gestão da Equipe</strong>, defina quem concorre em
              cada ranking. Enquanto ninguém estiver marcado, a lista fica vazia.
            </p>
          </div>
        ) : (
          <>
            <Podio classificacao={lista} premiacoes={dados?.premiacoes} />

            <div className="overflow-x-auto rounded-xl border border-linha">
              <table className="w-full text-xs">
                <thead className="bg-grafite-700">
                  <tr>
                    <th className="text-left py-2 px-3 font-bold text-texto-suave w-14">Pos.</th>
                    <th className="text-left py-2 px-3 font-bold text-texto-suave">Funcionário</th>
                    <th className="text-right py-2 px-3 font-bold text-texto-suave w-20">Pontos</th>
                    <th className="text-right py-2 px-3 font-bold text-texto-suave w-24 hidden lg:table-cell">
                      {aba === 'sede' ? 'Avaliados' : 'Relatórios'}
                    </th>
                    <th className="text-left py-2 px-3 font-bold text-texto-suave hidden lg:table-cell">Último atendimento</th>
                    <th className="text-left py-2 px-3 font-bold text-texto-suave w-24 hidden sm:table-cell">Evolução</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {lista.map((p) => (
                    <LinhaTabela
                      key={p.usuarioId}
                      p={p}
                      aberta={abertas.has(p.usuarioId)}
                      onAlternar={() => alternar(p.usuarioId)}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-[10px] text-texto-fraco mt-3 leading-relaxed">
              {aba === 'sede' ? (
                <>
                  {/* Os tetos vêm do SERVIDOR, e não escritos aqui: um texto
                      com os números copiados envelhece calado no dia em que
                      alguém mexe no peso, e passa a explicar outra conta. */}
                  Pontuação de 0 a 100: volume de atendimentos ({dados?.pesos?.tetos?.atendimentos ?? 35}),
                  nota média × {dados?.pesos?.nota ?? 7} ({dados?.pesos?.tetos?.nota ?? 35}, a partir
                  de {dados?.minimoAvaliacoes ?? 3} notas) e agilidade até
                  assumir ({dados?.pesos?.tetos?.agilidade ?? 30}).
                  {' '}<strong className="text-texto-suave">Só pontua atendimento fechado que o cliente
                  avaliou</strong> as três parcelas saem da mesma base.
                  {' '}A agilidade usa a mediana, para que uma conversa esquecida não derrube o mês inteiro.
                  {' '}É exatamente a mesma conta do painel de parede.
                </>
              ) : (
                <>
                  Pontuação de 0 a 100: mapeamentos aprovados (25), relatório completo (25), entrega no
                  prazo (20), evidências por visita (15) e ausência de retorno para correção (15).
                  {' '}As três parcelas de qualidade só contam a partir de 3 relatórios entregues.
                </>
              )}
            </p>

            {ehAdmin && (
              <div className="mt-4 pt-4 border-t border-linha">
                <p className="text-[11px] font-bold text-texto-suave mb-2 flex items-center gap-1.5">
                  <Gift size={12} className="text-espera-400" /> Premiação de {rotuloCompetencia(competencia)}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {[1, 2, 3].map((pos) => {
                    const reg = dados?.premiacoes?.find((x) => x.posicao === pos);
                    const alvo = lista.find((p) => p.posicao === pos);
                    if (!alvo) return null;
                    return reg ? (
                      <span key={pos} className="text-[11px] px-2.5 py-1.5 rounded-xl border border-linha bg-grafite-700 text-texto-suave flex items-center gap-2">
                        <strong className="text-texto">{pos}º {reg.usuarioNome}</strong>
                        <span>{reg.premio}{reg.valor ? ` · ${reg.valor}` : ''}</span>
                        <button onClick={() => remover(reg)} className="text-falha-400 hover:underline">remover</button>
                      </span>
                    ) : (
                      <button
                        key={pos}
                        onClick={() => premiar(pos)}
                        className="text-[11px] px-2.5 py-1.5 rounded-xl border border-espera/40 bg-espera/10 text-espera-400 font-semibold hover:bg-espera/20 transition-colors"
                      >
                        Registrar prêmio do {pos}º ({alvo.nome})
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <Historico dados={historico} />
          </>
        )}
      </div>

      {aba === 'externo' && (
        <p className="text-[11px] text-texto-fraco flex items-center gap-1.5">
          <ClipboardList size={12} className="shrink-0" />
          Os pontos saem dos mapeamentos técnicos entregues veja e valide em{' '}
          {/* O nome do MENU, e não o do arquivo: a tela foi renomeada para
              "Relatórios" e esta frase ficou mandando o técnico procurar um
              item que não existe mais na barra lateral. */}
          <strong className="text-texto-suave">Relatórios</strong>
        </p>
      )}
    </div>
  );
}
