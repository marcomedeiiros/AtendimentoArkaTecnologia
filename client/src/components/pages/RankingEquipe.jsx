/**
 * RANKING DO TIME -- a lista inteira, na Visao Geral.
 *
 * ── A CONTA E A MESMA DA PAREDE ────────────────────────────────────────────
 *
 * Os pontos vem de `/dashboard/ranking-equipe`, que usa a MESMA funcao que
 * alimenta o Modo TV. Nao e reaproveitamento por preguica: duas contas
 * parecidas, escritas em lugares diferentes, divergem no dia em que alguem
 * ajusta uma delas -- e a equipe veria ouro para uma pessoa na parede e para
 * outra aqui, no mesmo minuto.
 *
 * O que muda em relacao a TV sao duas coisas, e so essas: aqui entra TODO
 * MUNDO (a parede corta no top 3, que e o que se le de longe) e cada linha traz
 * o ULTIMO ATENDIMENTO da pessoa.
 *
 * ── DUAS JANELAS DE TEMPO NA MESMA LINHA, DE PROPOSITO ─────────────────────
 *
 * Os pontos e os atendimentos sao do MES CORRENTE. O ultimo atendimento e o
 * mais recente que existir, de qualquer data. Sao perguntas diferentes -- "como
 * foi este mes" e "quando esta pessoa atendeu pela ultima vez" -- e a segunda
 * so e util justamente quando a resposta e antiga. O cabecalho da coluna diz
 * qual e qual, porque juntas sem legenda pareceriam contradicao.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Trophy, Medal, Building2, Clock, RefreshCw, AlertCircle, Loader2, Star, Timer,
} from 'lucide-react';
import { DashboardAPI } from '../../services/api';
import { FUSO_BR } from '../../utils/data';

// Ouro, prata e bronze vem do tema (`--medalha-*`), e nao de hex fixo: no tema
// claro a prata #B8C4CC sobre branco fica invisivel. Mesma fonte de cor do
// Modo TV -- se o metal mudar la, muda aqui junto.
const MEDALHAS = ['--medalha-1', '--medalha-2', '--medalha-3'];
const medalha = (v, o = 1) => `rgb(var(${v}) / ${o})`;

// Iniciais so para o circulo colorido da posicao. E gente da EQUIPE: nomes
// salvos, poucos, e a inicial colorida e o que deixa reconhecer quem e num
// relance -- por isso aqui nao entra o boneco cinza do cliente.
function iniciais(completo) {
  const partes = String(completo || '').trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

const nota1 = (n) => (typeof n === 'number' ? n.toFixed(1).replace('.', ',') : null);

function duracaoCurta(seg) {
  if (seg == null) return null;
  if (seg < 60) return `${seg}s`;
  const min = Math.round(seg / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${String(min % 60).padStart(2, '0')}`;
}

// Dia e horario no fuso de Brasilia. O servidor manda ISO em UTC; sem o
// `timeZone`, quem abrir o painel de outro fuso leria um horario que nao foi o
// que aconteceu aqui.
function diaEHora(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const dia = d.toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: FUSO_BR,
  });
  const hora = d.toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', timeZone: FUSO_BR,
  });
  return { dia, hora };
}

function LinhaRanking({ p, minimo }) {
  const temMedalha = p.posicao <= MEDALHAS.length;
  const cor = MEDALHAS[p.posicao - 1] || '--quieto';
  const quando = diaEHora(p.ultimo?.quando);
  const nota = nota1(p.nota?.valor);
  const agilidade = duracaoCurta(p.agilidade?.medioSeg);

  return (
    <li
      className="flex flex-col lg:flex-row lg:items-center gap-3 p-3 rounded-xl border"
      style={{
        borderColor: temMedalha ? medalha(cor, 0.38) : 'rgb(var(--linha))',
        background: temMedalha
          ? `linear-gradient(90deg, ${medalha(cor, 0.12)}, ${medalha(cor, 0.02)})`
          : 'transparent',
      }}
    >
      {/* POSICAO + PESSOA */}
      <div className="flex items-center gap-3 min-w-0 lg:w-[19rem] shrink-0">
        <span
          className="shrink-0 font-display font-extrabold tabular-nums text-center text-lg"
          style={{ color: temMedalha ? medalha(cor) : 'rgb(var(--texto-suave))', minWidth: '2.4ch' }}
        >
          {p.posicao}º
        </span>

        {/* O `relative` so pendura a medalha na base do circulo: o tamanho
            continua sendo o do avatar, entao a linha nao muda de altura. */}
        <span className="relative shrink-0 w-10 h-10">
          <span
            className="w-full h-full rounded-full border grid place-items-center font-display font-bold text-xs"
            style={{
              borderColor: temMedalha ? medalha(cor, 0.5) : 'rgb(var(--linha-forte))',
              background: temMedalha ? medalha(cor, 0.15) : 'rgb(var(--grafite-600))',
              color: temMedalha ? medalha(cor) : 'rgb(var(--texto-suave))',
            }}
            title={p.nome}
          >
            {iniciais(p.nome)}
          </span>
          {/* SO DO 1o AO 3o. Uma medalha em toda posicao viraria enfeite e
              pararia de significar metal nenhum. Mesmo icone e mesmas
              proporcoes do Modo TV (0.48 de largura, -0.28 de base): la os
              numeros foram medidos para a medalha ficar pendurada no avatar sem
              cobrir as iniciais nem sair da linha. */}
          {temMedalha && (
            <Medal
              className="absolute left-1/2"
              style={{
                width: 'calc(2.5rem * 0.48)',
                height: 'calc(2.5rem * 0.48)',
                bottom: 'calc(2.5rem * -0.28)',
                transform: 'translateX(-50%)',
                color: medalha(cor),
                fill: medalha(cor, 0.22),
                filter: 'drop-shadow(0 0 0.14em rgb(var(--grafite-800))) drop-shadow(0 0 0.14em rgb(var(--grafite-800)))',
              }}
              aria-hidden="true"
            />
          )}
        </span>

        <div className="min-w-0">
          <p className="font-bold text-sm text-texto truncate">{p.nome}</p>
          <p className="text-[11px] text-texto-fraco">
            {p.pontos} pts no mês
          </p>
        </div>
      </div>

      {/* NUMEROS DO MES */}
      <div className="flex items-center gap-4 shrink-0 lg:w-[15rem]">
        <div>
          <p className="font-display font-extrabold text-xl text-texto tabular-nums leading-none">
            {p.atendimentos.valor}
          </p>
          <p className="text-[10px] text-texto-fraco mt-0.5">
            {p.atendimentos.valor === 1 ? 'atendimento' : 'atendimentos'}
          </p>
        </div>
        <div className="flex flex-col gap-1 text-[11px]">
          <span className="flex items-center gap-1 text-texto-suave">
            <Star size={11} className="text-espera-400 shrink-0" />
            {/* "1 de 3" e nao "0,0": quem ainda nao tem o minimo de notas nao e
                uma pessoa mal avaliada -- e uma amostra pequena demais para
                dizer qualquer coisa. Ver `minimoAvaliacoes` no servidor. */}
            {p.nota.conta
              ? <>{nota} <span className="text-texto-fraco">({p.nota.amostra} notas)</span></>
              : <span className="text-texto-fraco">{p.nota.amostra} de {minimo} notas</span>}
          </span>
          <span className="flex items-center gap-1 text-texto-suave">
            <Timer size={11} className="text-acao-200 shrink-0" />
            {agilidade
              ? <>{agilidade} <span className="text-texto-fraco">até assumir</span></>
              : <span className="text-texto-fraco">sem dado de tempo</span>}
          </span>
        </div>
      </div>

      {/* ULTIMO ATENDIMENTO */}
      <div className="min-w-0 flex-1 lg:border-l lg:border-linha lg:pl-4">
        {!p.ultimo ? (
          <p className="text-[11px] text-texto-fraco italic">Nenhum atendimento registrado.</p>
        ) : (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <Building2 size={12} className="text-texto-fraco shrink-0" />
              <span className="text-xs font-semibold text-texto truncate">
                {/* Sem empresa vinculada mostramos o CLIENTE, e dizemos que e
                    ele: escrever "-" esconderia que houve atendimento sim, e o
                    nome de uma pessoa no lugar de uma empresa, sem aviso, seria
                    lido como razao social. */}
                {p.ultimo.empresa || p.ultimo.cliente || 'Cliente sem nome'}
              </span>
              {!p.ultimo.empresa && p.ultimo.cliente && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-linha text-texto-fraco">
                  sem empresa vinculada
                </span>
              )}
              {p.ultimo.os && (
                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-full bg-grafite-700 border border-linha text-acao-200">
                  {p.ultimo.os}
                </span>
              )}
            </div>
            <p className="flex items-center gap-1.5 text-[11px] text-texto-suave mt-1">
              <Clock size={11} className="text-texto-fraco shrink-0" />
              {quando ? (
                <>
                  {p.ultimo.encerrado ? 'Fechado em' : 'Em andamento desde'}{' '}
                  <span className="font-semibold text-texto">{quando.dia}</span>
                  {' às '}
                  <span className="font-semibold text-texto tabular-nums">{quando.hora}</span>
                </>
              ) : (
                'sem data registrada'
              )}
            </p>
          </>
        )}
      </div>
    </li>
  );
}

export default function RankingEquipe() {
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      setDados(await DashboardAPI.rankingEquipe());
    } catch (e) {
      setErro(e?.message || 'Não foi possível carregar o ranking.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const lista = dados?.classificacao || [];

  return (
    <div className="glass-panel border border-linha rounded-2xl p-4 sm:p-5 fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-bold text-sm text-texto">
            <Trophy size={15} className="text-espera-400 shrink-0" />
            Ranking do time
          </h3>
          <p className="text-[11px] text-texto-fraco mt-0.5">
            Pontos e atendimentos do <strong className="text-texto-suave">mês corrente</strong>
            {' · '}o último atendimento é o mais recente de cada pessoa, de qualquer data
          </p>
        </div>
        <button
          onClick={carregar}
          disabled={carregando}
          className="px-3 py-1.5 rounded-xl bg-grafite-700 border border-linha text-texto-suave hover:text-texto hover:border-linha-forte text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
        >
          {carregando ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          Atualizar
        </button>
      </div>

      {erro && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-falha/10 border border-falha/30 text-falha-400 text-xs mb-3">
          <AlertCircle size={14} className="shrink-0" /> {erro}
        </div>
      )}

      {carregando && !dados ? (
        <div className="py-12 grid place-items-center text-texto-fraco">
          <Loader2 size={22} className="animate-spin text-acao" />
        </div>
      ) : lista.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm font-semibold text-texto-suave">Ninguém atendeu neste mês ainda.</p>
          <p className="text-[11px] text-texto-fraco mt-1">
            A lista se preenche conforme os atendimentos forem assumidos.
          </p>
        </div>
      ) : (
        <ol className="space-y-2">
          {lista.map((p) => (
            <LinhaRanking key={p.nome} p={p} minimo={dados?.minimoAvaliacoes ?? 3} />
          ))}
        </ol>
      )}

      {lista.length > 0 && (
        <p className="text-[10px] text-texto-fraco mt-4 leading-relaxed">
          Pontuação: 1 ponto por atendimento fechado, nota média × {dados?.pesos?.nota ?? 8}
          {' '}(a partir de {dados?.minimoAvaliacoes ?? 3} notas) e uma faixa fixa por agilidade até
          assumir é a mesma conta do painel de parede
        </p>
      )}
    </div>
  );
}
