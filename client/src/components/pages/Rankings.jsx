/**
 * 🏆 RANKINGS -- duas competicoes separadas, e nunca uma tabela so.
 *
 * ── POR QUE ABAS, E NAO UMA LISTA COM UMA COLUNA "EQUIPE" ──────────────────
 *
 * Nao e organizacao visual: os totais nem sao comparaveis. Na sede a pontuacao
 * ACUMULA e nao tem teto (cada atendimento avaliado soma, cada estrela soma);
 * no externo o teto e 100, fechado. Numa tabela unica a equipe externa
 * apareceria sempre atras por causa da escala, e nao do trabalho -- e a primeira
 * pessoa a perceber isso pararia de confiar no ranking inteiro.
 *
 * A diferenca de escala entre os dois ficou MAIOR com a sede perdendo o teto, e
 * por isso vale repetir: eles nunca se somam nem se comparam.
 *
 * Por isso nao existe nem endpoint que devolva os dois juntos: a separacao
 * mora no servidor, e a tela nao teria como misturar mesmo que quisesse.
 *
 * ── E POR ISSO A COLUNA DO OUTRO LADO MOSTRA DOIS NUMEROS, NAO UMA MEDIA ───
 *
 * Havia aqui uma coluna "Geral": a media das duas notas, ponderada pelo
 * trabalho de cada lado, para quem acumula as duas funcoes. Ela fazia sentido
 * enquanto as duas iam de 0 a 100 -- e virou aritmetica sem significado quando
 * a sede perdeu o teto (250 na sede com 80 fora da sede dava "165", e aquele
 * numero ainda desempatava o ranking externo).
 *
 * Agora a coluna mostra o outro lado COMO ELE E, na escala dele, ao lado dos
 * pontos daqui. A pergunta que a geral respondia -- "essa pessoa tambem
 * trabalha na rua?" -- continua respondida; o que saiu foi a media que ninguem
 * conseguia conferir. Ver `ranking.service`.
 *
 * ── NAO HA MAIS "LIMPAR DADOS" AQUI ────────────────────────────────────────
 *
 * Esta tela tinha dois botoes de limpar (um por ranking) e um de restaurar. Eles
 * gravavam um instante e todas as telas passavam a contar dali -- sem apagar
 * nada, mas cortando a contagem da equipe inteira com um clique.
 *
 * Sairam em 11/09/2026: o ciclo configuravel ja da o recomeco a cada virada, e
 * o corte manual era redundante e caro -- quem clicava sem entender ficava
 * achando que havia perdido a pontuacao. Ver o topo de `painel.service`.
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
  TrendingUp, TrendingDown, Minus, Sparkles, Gift, ClipboardList, Calendar,
  RotateCcw, SlidersHorizontal, Save,
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

/*
 * NÃO EXISTE MAIS UM `competenciaAtual()` AQUI, e isso é o conserto.
 *
 * ── O DEFEITO (auditoria-ranking-zerado-10-09.md) ──────────────────────────
 *
 * Havia um `competenciaAtual()` que devolvia o mês do CALENDÁRIO, e ele era o
 * valor inicial do seletor. Com o ciclo do ranking fechando no dia 28, "que mês
 * está corrente" deixa de ser uma pergunta de calendário: no dia 10/09, o ciclo
 * corrente é o que abriu antes -- e a competência `2026-09` significa 28/09 a
 * 28/10, ou seja, uma janela que ainda não começou.
 *
 * O resultado em produção, em 10/09/2026: a tela abriu em "setembro/2026" e
 * mostrou a equipe inteira com 0 pontos e 0 avaliados, enquanto o painel de
 * parede mostrava 84 na mesma sala. Foi lido como "o ranking zerou os pontos" --
 * mas zero era a resposta CORRETA para a pergunta errada.
 *
 * ── QUEM SABE A RESPOSTA É O SERVIDOR ──────────────────────────────────────
 *
 * `ranking.service` já resolve a competência corrente com `ciclo.competenciaDe`
 * quando o pedido chega SEM competência, e devolve qual usou no campo
 * `competencia`. A tela mandava sempre um valor -- e assim substituía a resposta
 * certa por um palpite de calendário.
 *
 * Agora `competencia` nasce `null` (= "a corrente, seja qual for"), e a lista de
 * meses é construída de trás para frente a partir do que o servidor respondeu.
 */

function rotuloCompetencia(comp) {
  const [ano, mes] = String(comp || '').split('-').map(Number);
  if (!ano || !mes) return comp;
  return `${MES_NOME[mes - 1]}/${ano}`;
}

/**
 * O PRIMEIRO MÊS QUE EXISTE PARA ESTE RANKING.
 *
 * A lista dos últimos 18 meses oferecia até abril/2025 -- meses em que este
 * ranking não existia e a tabela abre vazia. Escolher um deles não é um erro
 * que a tela avise: parece que os dados sumiram.
 *
 * É uma constante porque a data de início é um fato da operação, e não algo
 * que dê para deduzir do banco: atendimento antigo existe (a Central é mais
 * velha que o ranking), então a primeira linha do banco responderia a pergunta
 * errada.
 */
const PRIMEIRA_COMPETENCIA = '2026-09';

// Do mês CORRENTE para trás, parando no primeiro mês do ranking. O teto de 18
// continua: é curto o bastante para caber num select sem virar rolagem.
//
// `corrente` VEM DO SERVIDOR (o campo `competencia` da resposta). Antes esta
// função partia de `new Date()`, e com o ciclo fora do dia 1 isso produzia dois
// erros de uma vez: oferecia um mês que ainda não começou e, quando o ciclo
// corrente era o anterior, NÃO OFERECIA ele -- `PRIMEIRA_COMPETENCIA` cortava
// justamente o mês que a pessoa precisava escolher. Não havia como chegar aos
// próprios pontos pela tela.
function mesesDisponiveis(corrente) {
  if (!corrente) return [];
  const [ano, mes] = String(corrente).split('-').map(Number);
  if (!ano || !mes) return [];
  const out = [];
  const d = new Date(ano, mes - 1, 1);
  for (let i = 0; i < 18; i += 1) {
    const comp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (comp < PRIMEIRA_COMPETENCIA) break;
    out.push(comp);
    d.setMonth(d.getMonth() - 1);
  }
  // O CORRENTE ENTRA SEMPRE, mesmo que seja anterior a `PRIMEIRA_COMPETENCIA`:
  // a competência que o servidor está calculando agora não pode ficar de fora
  // do seletor. Era exatamente esse o beco -- a tela mostrava um mês vazio e não
  // oferecia o mês com os dados.
  return out.length ? out : [corrente];
}

/**
 * "01/09 a 28/10" -- o intervalo do ciclo, escrito por extenso.
 *
 * O `fim` que o servidor manda é EXCLUSIVO (é o instante em que o ciclo
 * seguinte começa), e escrever esse instante como se fosse o último dia do
 * ciclo é errar por um dia inteiro: "01/09 a 28/10" com fim exclusivo em 28/10
 * significa que 28/10 já é do ciclo novo. Mostramos o dia anterior ao fim, que
 * é o último dia que de fato pertence a este ciclo.
 *
 * DEPENDE DO FUSO DO SERVIDOR, e não tem como não depender: `ciclo.janela` monta
 * a data com o relógio LOCAL do contêiner (`new Date(ano, mes - 1, dia)`) e a
 * manda em ISO. O `docker-compose.prod.yml` fixa `TZ: America/Sao_Paulo` na api,
 * igual ao `FUSO_BR` usado aqui, então os dois concordam. Se aquele TZ virar
 * UTC, este rótulo passa a errar por um dia (01/09 apareceria como 31/08) -- e a
 * janela do ranking inteiro mudaria junto, então o rótulo seria o menor dos
 * problemas.
 */
function intervaloCiclo(janela) {
  if (!janela?.inicio || !janela?.fim) return '';
  const dia = (iso, recuar = false) => {
    const d = new Date(iso);
    if (recuar) d.setDate(d.getDate() - 1);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: FUSO_BR });
  };
  return `${dia(janela.inicio)} a ${dia(janela.fim, true)}`;
}

// "18:00" -- a hora do ciclo, escrita por extenso. Num lugar só porque agora
// ela aparece em três frases diferentes da explicação do fechamento.
const horaDoCiclo = (ciclo) =>
  `${String(ciclo?.hora ?? 0).padStart(2, '0')}:${String(ciclo?.minuto ?? 0).padStart(2, '0')}`;

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
    // O MINIMO VEM DO SERVIDOR, sempre. Havia um `?? 3` aqui, e ele entrava em
    // TODAS as parcelas do ranking externo -- que não mandavam o campo. Com o
    // mínimo de relatórios configurado em 5, a tela escrevia "4 de 3", que se
    // lê como "bati o mínimo e o sistema não está contando".
    //
    // Sem o campo, escreve só a amostra: "4 registros" é verdade sempre. Um
    // número inventado no lugar do mínimo é pior do que não ter mínimo escrito.
    return {
      texto: c.minimo ? `${c.amostra ?? 0} de ${c.minimo}` : `${c.amostra ?? 0}`,
      fraco: true,
    };
  }
  if (c.valor == null) return { texto: '-', fraco: true };
  if (c.chave === 'nota') return { texto: c.valor.toFixed(1).replace('.', ','), fraco: false };
  if (c.chave === 'agilidade') return { texto: duracao(c.valor) || '-', fraco: false };
  return { texto: `${c.valor}${c.sufixo || ''}`, fraco: false };
}

/**
 * OS RÓTULOS DAS PARCELAS DO ATENDIMENTO FORA DA SEDE.
 *
 * Só os NOMES moram aqui -- eles são texto de tela. Os NÚMEROS vêm do servidor
 * (`dados.pesos.parcelas`), e é essa a correção: o rodapé desta aba trazia
 * "aprovados (25), completo (25), prazo (20), evidências (15), sem retorno
 * (15)" e "a partir de 3 relatórios" cravados no cliente. Os cinco pesos e o
 * mínimo são configuráveis em Relatórios → Configuração, então o texto passou a
 * explicar uma conta que não roda mais no dia em que alguém os ajustou -- e
 * ainda mandava o técnico buscar uma "aprovação" que deixou de existir.
 *
 * A LISTA É PERCORRIDA A PARTIR DA RESPOSTA DO SERVIDOR, e não desta chave: uma
 * parcela criada lá aparece no rodapé com a própria chave como nome -- feio, e
 * visível -- em vez de desaparecer do texto sem ninguém notar.
 */
const PARCELAS_EXTERNO = {
  volume: 'relatórios entregues',
  completude: 'relatório completo',
  prazo: 'entrega no prazo',
  evidencias: 'evidências por visita',
  retrabalho: 'sem retorno para correção',
};

const reguaExterna = (parcelas) =>
  Object.entries(parcelas || {})
    .map(([chave, pontos]) => `${PARCELAS_EXTERNO[chave] || chave} (${pontos})`)
    .join(', ');

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

/**
 * O pódio -- com o número de lugares que o SERVIDOR decidiu.
 *
 * Eram três, sempre. Na equipe externa, que tem três pessoas, isso premiava o
 * time inteiro: o "3º lugar" era o último colocado recebendo medalha. Pódio que
 * inclui todo mundo não premia ninguém.
 *
 * A conta é do servidor (`rankings/premiados`) porque ela também decide quem
 * PODE receber prêmio registrado -- e uma regra dessas em dois lugares vira
 * duas regras. O `?? 1` cobre só a resposta antiga em cache, e 1 é o padrão.
 */
function Podio({ classificacao, premiacoes, premiados }) {
  const vagas = Math.max(0, Number(premiados ?? 1));
  const top = classificacao.slice(0, vagas);
  if (!top.length) return null;
  // Ordem visual 2 - 1 - 3, como num pódio de verdade: o primeiro no meio e
  // mais alto. Numa lista 1-2-3 o olho lê ordem de leitura, não hierarquia.
  // Com um lugar só não há o que reordenar, e com dois o primeiro fica à
  // direita -- que é onde o degrau alto do pódio está nos outros casos.
  const ordem = vagas >= 3 ? [top[1], top[0], top[2]].filter(Boolean) : [top[1], top[0]].filter(Boolean);

  return (
    <div className={`grid grid-cols-1 gap-3 mb-5 ${ordem.length >= 3 ? 'sm:grid-cols-3' : ordem.length === 2 ? 'sm:grid-cols-2' : ''}`}>
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

/**
 * MEDALHA É POSIÇÃO; PRÊMIO É OUTRA COISA.
 *
 * Por um tempo a medalha aqui seguiu o número de premiados -- o raciocínio era
 * não pintar de bronze um terceiro lugar que não ganha nada. Estava errado por
 * confundir duas coisas: ouro, prata e bronze dizem ONDE a pessoa chegou, e é
 * disso que uma tabela de classificação trata. Quem leva prêmio é o pódio, logo
 * acima, e o botão de registrar -- os dois seguem `premiados` e continuam
 * seguindo.
 *
 * Vale para os dois rankings: esta linha desenha a sede e o fora da sede.
 */
const MEDALHAS_NA_LISTA = 3;

function LinhaTabela({ p, aberta, onAlternar, temOutroLado = false, rotuloOutroLado = '' }) {
  const temMedalha = p.posicao <= MEDALHAS_NA_LISTA;
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
            {/* A MEDALHA PENDURADA NO AVATAR, como no Modo TV.

                `relative` no invólucro e a medalha em `absolute`: pendurá-la
                dentro do círculo empurraria as iniciais, e ao lado ela roubaria
                largura de uma coluna que já é estreita no celular.

                A sombra na cor do fundo é o que separa o contorno da medalha do
                contorno do avatar -- sem ela os dois se encostam e viram uma
                mancha só. Mesma solução da parede, mesmo motivo. */}
            <span className="relative shrink-0">
              <span className="w-7 h-7 rounded-full border grid place-items-center text-[10px] font-bold"
                style={{
                  borderColor: temMedalha ? medalha(cor, 0.5) : 'rgb(var(--linha-forte))',
                  background: temMedalha ? medalha(cor, 0.15) : 'rgb(var(--grafite-600))',
                  color: temMedalha ? medalha(cor) : 'rgb(var(--texto-suave))',
                }}>
                {iniciais(p.nome)}
              </span>
              {temMedalha && (
                <Medal
                  size={13}
                  className="absolute left-1/2 -bottom-1 -translate-x-1/2 pointer-events-none"
                  style={{
                    color: medalha(cor),
                    fill: medalha(cor, 0.22),
                    filter: 'drop-shadow(0 0 2px rgb(var(--grafite-800))) drop-shadow(0 0 2px rgb(var(--grafite-800)))',
                  }}
                  aria-label={`${p.posicao}º lugar`}
                />
              )}
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
        {/* O OUTRO LADO, só para quem acumula as duas funções.

            É a pontuação daquela competição, na escala DELA -- e nunca uma
            média com a desta coluna: uma vai de 0 a 100 e a outra não tem teto.
            O traço diz "esta pessoa não tem os dois lados" sem gastar uma
            frase. */}
        {temOutroLado && (
          <td className="py-2.5 px-3 text-right tabular-nums text-xs hidden sm:table-cell"
            title={
              p.outroLado
                ? `${rotuloOutroLado}: ${p.outroLado.pontos} pts em ${p.outroLado.registros} ${p.outroLado.registros === 1 ? 'registro' : 'registros'} -- outra régua, não se soma com os ${p.pontos} desta coluna`
                : undefined
            }>
            {p.outroLado ? (
              <span className="font-display font-extrabold text-acao-200">
                {p.outroLado.pontos}
                <span className="font-sans font-semibold text-texto-fraco text-[10px] ml-0.5">
                  /{p.outroLado.registros}
                </span>
              </span>
            ) : (
              <span className="text-texto-fraco">-</span>
            )}
          </td>
)}
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
                {p.ultimo.empresa || p.ultimo.cliente || '-'}
              </span>
              <span className="text-texto-fraco shrink-0">
                {p.ultimo.quando
                  ? new Date(p.ultimo.quando).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: FUSO_BR })
                  : ''}
              </span>
            </div>
          ) : (
            <span className="text-texto-fraco">-</span>
          )}
        </td>
        <td className="py-2.5 px-3 hidden sm:table-cell"><Evolucao estado={p.evolucao} anterior={p.anterior} /></td>
        <td className="py-2.5 px-3 text-right text-texto-fraco">
          {aberta ? <ChevronDown size={14} className="inline" /> : <ChevronRight size={14} className="inline" />}
        </td>
      </tr>
      {aberta && (
        <tr className="bg-grafite-800/60">
          <td colSpan={7 + (temOutroLado ? 1 : 0)} className="px-3 pb-3">
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
                        <span className="text-texto-fraco">-</span>
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
  // `null` = "a competência corrente, seja qual for" -- quem decide é o
  // servidor. Só passa a ter valor quando alguém escolhe um mês no seletor.
  const [competencia, setCompetencia] = useState(null);
  const [dados, setDados] = useState(null);
  const [historico, setHistorico] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [abertas, setAbertas] = useState(() => new Set());

  const ehAdmin = usuario?.cargo === 'Administrador';

  // A COMPETÊNCIA QUE ESTÁ NA TELA. Enquanto ninguém escolheu nada, é a que o
  // servidor resolveu e devolveu -- e é ela que rotula os títulos, a premiação e
  // o próprio seletor. Derivar em vez de guardar num estado evita a segunda
  // busca que "salvar a resposta no estado" provocaria.
  const compAtiva = competencia || dados?.competencia || '';
  const meses = useMemo(() => mesesDisponiveis(compAtiva), [compAtiva]);

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
      `O que o ${posicao}º lugar de ${rotuloCompetencia(compAtiva)} recebeu?`,
      { titulo: 'Registrar premiação', placeholder: 'Ex.: Vale-presente, folga, bônus' }
    );
    if (!premio) return;
    const valor = await pedirTexto('Valor ou descrição (opcional)', {
      titulo: 'Registrar premiação', placeholder: 'Ex.: R$ 200,00',
    });
    try {
      await RankingsAPI.registrarPremiacao({
        ranking: aba, competencia: compAtiva, posicao, premio, valor: valor || null,
      });
      await carregar();
    } catch (e) {
      avisar(e?.message || 'Não foi possível registrar.', { titulo: 'Premiação não registrada' });
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

  /**
   * CONFIGURAÇÃO DO ATENDIMENTO NA SEDE.
   *
   * Mesma forma da configuração dos relatórios (em Relatórios → Configuração):
   * tetos que somam 100 e um mínimo de amostra. As duas telas pedem a mesma
   * coisa, e dar formas diferentes para a mesma ideia seria duas telas para
   * aprender em vez de uma.
   *
   * As FAIXAS (quantos atendimentos valem quanto, que tempo cai em qual degrau)
   * não entram: elas escalam com o teto no servidor. Editar degrau a degrau
   * numa tela é dar corda para uma escada que não soma -- e "por que 6
   * atendimentos valem menos que 4?" é uma pergunta que ninguém quer responder.
   */
  const [config, setConfig] = useState(null);
  const [rascunho, setRascunho] = useState(null);
  const [salvandoCfg, setSalvandoCfg] = useState(false);
  const [erroCfg, setErroCfg] = useState('');

  // O TETO DO PÓDIO VEM DO SERVIDOR (`premiadosMaximo`).
  //
  // O campo oferecia até 50, e o resto do sistema aceita 3: o registro de
  // prêmio recusava a posição 4 e o pódio tem três medalhas. Configurar 5
  // rendia cinco botões de prêmio, dois deles falhando sempre. O número mora
  // em `rankings/premiados` (MAXIMO) e chega aqui pela configuração -- cravá-lo
  // na tela seria recriar a divergência que causou o defeito. O `?? 3` cobre
  // só a resposta antiga em cache.
  const maxPremiados = Number(config?.premiadosMaximo) || 3;

  const abrirConfig = async () => {
    setErroCfg('');
    try {
      const d = await DashboardAPI.regrasSede();
      setConfig(d);
      // O ciclo entra no MESMO rascunho: um formulário, um botão de salvar.
      setRascunho({ ...d.regras, ciclo: d.ciclo || d.cicloPadrao, premiados: d.premiados || d.premiadosPadrao });
    } catch (e) {
      avisar(e?.message || 'Não foi possível abrir a configuração.', { titulo: 'Configuração' });
    }
  };


  const salvarConfig = async () => {
    setSalvandoCfg(true);
    setErroCfg('');
    try {
      const salvo = await DashboardAPI.salvarRegrasSede(rascunho);
      setRascunho(salvo);
      setConfig((c) => ({ ...c, regras: salvo }));
      // Recarrega a tabela: os pontos mudam AGORA, e mostrar o quadro antigo ao
      // lado das regras novas faria a pessoa achar que não valeu.
      await carregar();
      // A RESSALVA IMPORTA: a régua recalcula o passado, o ciclo não.
      // Dizer "vale para os meses anteriores" sem distinguir faria alguém
      // esperar que o dia de fechamento novo reescrevesse janeiro -- e ele
      // não reescreve, de propósito.
      avisar(
        'O valor por atendimento, o valor por estrela e o mínimo de avaliações já valem, inclusive para os meses anteriores.\n\n' +
        'O dia de fechamento vale só a partir deste ciclo: os meses já passados continuam como foram vividos.',
        { titulo: 'Configuração salva', tipo: 'info' }
      );
    } catch (e) {
      setErroCfg(e?.message || 'Não foi possível salvar.');
    } finally {
      setSalvandoCfg(false);
    }
  };

  const lista = dados?.classificacao || [];
  // Alguem acumula as duas funcoes neste mes? E o servidor quem sabe: ele
  // manda `outroLado` em quem esta nas duas equipes -- com os numeros daquela
  // competicao, na escala daquela competicao, e nunca uma media com estes.
  const temOutroLado = lista.some((p) => p.outroLado);
  // O nome curto da OUTRA competicao, para rotular a coluna. Sai da mesma lista
  // de abas -- a tela nao inventa nome de ranking em lugar nenhum.
  const rotuloOutroLado = aba === 'sede' ? 'Fora da sede' : 'Na sede';
  const rotuloAba = ABAS.find((a) => a.id === aba)?.rotulo || '';

  return (
    // Sem padding nem título próprios: isto é o CONTEÚDO de uma aba da Visão
    // Geral, que já tem cabeçalho. Um segundo "Rankings" logo abaixo do título
    // da tela faria a aba parecer outra página dentro da página.
    <div className="space-y-4 fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-xs text-texto-fraco min-w-0">
          Duas competições separadas as atividades e os indicadores são diferentes.
        </p>

        {/* OS CONTROLES FICAM JUNTOS, no alto e à direita -- o seletor de mês,
            o intervalo do ciclo e a Configuração são controles do QUADRO, e
            não da lista. (Aqui também ficava o botão de limpar dados, que saiu
            em 11/09/2026 com o recurso inteiro.) */}
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <div className="flex items-center gap-2">
            <label htmlFor="ranking-mes" className="text-[11px] font-semibold text-texto-suave shrink-0">Mês</label>
            <select
              id="ranking-mes"
              value={compAtiva}
              onChange={(e) => setCompetencia(e.target.value)}
              className="bg-grafite-700 border border-linha rounded-xl px-3 py-2 text-xs text-texto focus:outline-none focus:border-acao/50"
            >
              {meses.map((m) => (
                <option key={m} value={m}>{rotuloCompetencia(m)}</option>
              ))}
            </select>
          </div>

          {/* DE QUANDO A QUANDO, e não só o nome do mês.
              Com o ciclo fora do dia 1, "setembro/2026" e o mês de setembro
              deixam de ser a mesma coisa -- e a competência de TRANSIÇÃO é mais
              longa que as outras, uma vez só, porque absorve os dias entre onde
              o calendário parou e a virada nova. Sem esta linha a tela mostra um
              mês com 57 dias e nada explica por quê. */}
          {dados?.janela?.personalizada && (
            <span
              className="text-[10px] text-texto-fraco leading-tight max-w-[16rem]"
              title={dados.janela.transicao
                ? 'Este é o ciclo em que o dia de fechamento mudou: ele começa onde o ciclo anterior terminou, então fica mais longo (dia adiado) ou mais curto (dia antecipado). Acontece uma vez por mudança, e nenhum ciclo anterior é afetado.'
                : 'Intervalo deste ciclo, conforme o dia de fechamento configurado.'}
            >
              {intervaloCiclo(dados.janela)}
              {dados.janela.transicao && (
                <span className="text-espera-400"> · ciclo de transição</span>
              )}
            </span>
          )}

          {/* CONFIGURAÇÃO -- só na aba da sede, e só para administrador.
              A do Fora da Sede já existe, dentro de Relatórios: ela configura
              prazo e leitura de PDF, que não têm equivalente aqui. */}
          {ehAdmin && aba === 'sede' && (
            <button
              onClick={() => (config ? setConfig(null) : abrirConfig())}
              className={`px-3 py-2 rounded-xl border text-[11px] font-bold flex items-center gap-1.5 transition-colors ${
                config
                  ? 'bg-espera/15 border-espera/40 text-espera-400'
                  : 'bg-grafite-700 border-linha text-texto-suave hover:text-texto hover:border-linha-forte'
              }`}
            >
              <SlidersHorizontal size={12} /> Configuração
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

      {config && rascunho && aba === 'sede' && (
        <div className="glass-panel border border-espera/30 rounded-2xl p-4 sm:p-5 space-y-4">
          <p className="text-[11px] font-bold text-espera-400 flex items-center gap-1.5">
            <SlidersHorizontal size={13} /> Pontuação do atendimento na sede
          </p>

          {erroCfg && (
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-falha/10 border border-falha/30 text-falha-400 text-[11px]">
              <AlertCircle size={13} className="shrink-0" /> {erroCfg}
            </div>
          )}

          {/* O AVISO QUE PRECISA ESTAR AQUI: o ranking é recalculado a cada
              consulta, então mudar a régua muda também os ciclos passados -- e a
              premiação já registrada continua apontando para a posição antiga. */}
          <p className="text-[10px] text-espera-400 leading-relaxed border border-espera/30 bg-espera/10 rounded-xl p-2.5">
            O ranking é recalculado a cada consulta, então mudar a régua muda também os
            <strong> meses já passados</strong> premiações já registradas continuam como estão
            {' '}Esta é a mesma conta do <strong>Modo TV</strong>
          </p>

          {/* QUANTO VALE CADA UNIDADE -- e não mais "quanto vale a parcela cheia".
              A pontuação deixou de ter teto: cada atendimento avaliado soma, e
              cada estrela soma. Não há mais soma que precise fechar em 100, nem
              alvo de saturação -- os dois campos saíram junto com a escada. */}
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(rascunho.unidades || {}).map(([chave, valor]) => (
              <div key={chave}>
                <label className="text-[11px] font-semibold text-texto-suave block mb-1">
                  {{ atendimento: 'Por atendimento avaliado', estrela: 'Por estrela recebida' }[chave] || chave}
                </label>
                <input
                  type="number" min={0} max={1000} value={valor}
                  onChange={(e) => {
                    setErroCfg('');
                    setRascunho((r) => ({ ...r, unidades: { ...r.unidades, [chave]: Math.max(0, Math.min(1000, Number(e.target.value) || 0)) } }));
                  }}
                  className="w-full bg-grafite-700 border border-linha rounded-xl px-3 py-2 text-xs text-texto focus:outline-none focus:border-acao/50"
                />
                <p className="text-[10px] text-texto-fraco mt-1 leading-relaxed">
                  {chave === 'atendimento'
                    ? 'Somado uma vez por atendimento fechado E avaliado.'
                    : 'Multiplicado pela soma das estrelas: uma nota 5 vale cinco vezes isto.'}
                </p>
              </div>
            ))}
          </div>

          {/* A CONTA DE EXEMPLO, porque "10 e 2" não diz quanto é um mês.
              Sem ela, mexer nos números é apostar. */}
          <div className="rounded-xl border border-linha bg-grafite-700/60 p-2.5">
            <p className="text-[10px] uppercase tracking-wider text-texto-fraco font-bold mb-1">
              Com esta régua
            </p>
            <p className="text-[11px] text-texto-suave leading-relaxed">
              Um atendimento avaliado com <strong>5 estrelas</strong> e assumido em poucos
              minutos vale{' '}
              <strong className="text-acao-200">
                {(rascunho.unidades?.atendimento ?? 0) + 5 * (rascunho.unidades?.estrela ?? 0) + 5} pontos
              </strong>
              {' '}({rascunho.unidades?.atendimento ?? 0} do atendimento +{' '}
              {5 * (rascunho.unidades?.estrela ?? 0)} das estrelas + até 5 de rapidez).
              Dez deles, {10 * ((rascunho.unidades?.atendimento ?? 0) + 5 * (rascunho.unidades?.estrela ?? 0) + 5)}.
              <strong> Não há teto</strong> o próximo atendimento sempre soma.
            </p>
          </div>

          <div>
            <label className="text-[11px] font-semibold text-texto-suave block mb-1">Mínimo de avaliações</label>
            <input
              type="number" min={1} max={20} value={rascunho.minimoAvaliacoes}
              onChange={(e) => { setErroCfg(''); setRascunho((r) => ({ ...r, minimoAvaliacoes: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })); }}
              className="w-full sm:w-48 bg-grafite-700 border border-linha rounded-xl px-3 py-2 text-xs text-texto focus:outline-none focus:border-acao/50"
            />
            <p className="text-[10px] text-texto-fraco mt-1 leading-relaxed">
              Abaixo disso a parcela da nota não conta e a tela escreve “1 de 3”. Impede que
              uma única nota 5 lidere o mês inteiro.
            </p>
          </div>

          {/* QUANDO O CICLO VIRA.

              Existe para quem fecha folha no dia 25 e precisa que o ranking
              feche junto. O padrão -- dia 1, meia-noite -- é o mês do
              calendário de sempre.

              O intervalo é escrito por extenso porque "dia 25" é ambíguo: pode
              ser onde o ciclo começa ou onde ele acaba. Aqui é onde começa. */}
          <div className="border-t border-linha pt-3 space-y-2">
            <p className="text-[11px] font-semibold text-texto-suave">Fechamento do ciclo</p>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="text-[10px] text-texto-fraco block mb-1">Dia do mês</label>
                <input
                  type="number" min={1} max={31} value={rascunho.ciclo?.dia ?? 1}
                  onChange={(e) => { setErroCfg(''); setRascunho((r) => ({ ...r, ciclo: { ...r.ciclo, dia: Math.max(1, Math.min(31, Number(e.target.value) || 1)) } })); }}
                  className="w-24 bg-grafite-700 border border-linha rounded-xl px-3 py-2 text-xs text-texto focus:outline-none focus:border-acao/50"
                />
              </div>
              <div>
                <label className="text-[10px] text-texto-fraco block mb-1">Hora</label>
                <input
                  type="time"
                  value={`${String(rascunho.ciclo?.hora ?? 0).padStart(2, '0')}:${String(rascunho.ciclo?.minuto ?? 0).padStart(2, '0')}`}
                  onChange={(e) => {
                    const [h, m] = String(e.target.value || '00:00').split(':').map(Number);
                    setErroCfg('');
                    setRascunho((r) => ({ ...r, ciclo: { ...r.ciclo, hora: h || 0, minuto: m || 0 } }));
                  }}
                  className="w-32 bg-grafite-700 border border-linha rounded-xl px-3 py-2 text-xs text-texto focus:outline-none focus:border-acao/50"
                />
              </div>
            </div>
            <p className="text-[10px] text-texto-fraco leading-relaxed">
              {(rascunho.ciclo?.dia ?? 1) === 1 && !(rascunho.ciclo?.hora || rascunho.ciclo?.minuto)
                ? 'Mês do calendário: do dia 1 ao último dia, como sempre foi.'
                : (rascunho.ciclo?.dia ?? 1) === 31
                  ? `Sempre no ÚLTIMO DIA DO MÊS, às ${horaDoCiclo(rascunho.ciclo)} 31 em janeiro, 30 em abril, 28 ou 29 em fevereiro.`
                  : `Cada ciclo vai do dia ${rascunho.ciclo?.dia} de um mês até o dia ${rascunho.ciclo?.dia} do mês seguinte, ` +
                    `às ${horaDoCiclo(rascunho.ciclo)}. ` +
                    ((rascunho.ciclo?.dia ?? 1) >= 29
                      ? `No mês que não tiver dia ${rascunho.ciclo?.dia}, fecha no último dia dele fevereiro fecha em 28 (ou 29, em ano bissexto).`
                      : 'Escolha 31 para fechar sempre no último dia do mês.')}
            </p>
            <p className="text-[10px] text-espera-400 leading-relaxed border border-espera/30 bg-espera/10 rounded-xl p-2.5">
              Diferente da régua de pontos, o dia de fechamento <strong>não mexe no passado</strong> cada
              mudança fica registrada com o ciclo a partir do qual ela vale, e os ciclos anteriores
              continuam exatamente como foram vividos incluindo os de uma configuração anterior a
              esta. É o que mantém as premiações já registradas apontando para o ranking que existia
              quando foram dadas.
            </p>
          </div>
          {/* QUANTOS SOBEM AO PÓDIO.

              Eram três, sempre. Numa equipe de três isso premiava o time
              inteiro -- o "3º lugar" era o último colocado com medalha.

              Agora é um campeão em cada competição. Em branco volta a 1. */}
          <div className="border-t border-linha pt-3 space-y-2">
            <p className="text-[11px] font-semibold text-texto-suave">Premiados no pódio</p>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="text-[10px] text-texto-fraco block mb-1">Atendimento na sede</label>
                <input
                  type="number" min={1} max={maxPremiados} placeholder="1"
                  value={rascunho.premiados?.sede ?? ''}
                  onChange={(e) => {
                    setErroCfg('');
                    const v = e.target.value === '' ? null : Math.max(1, Math.min(maxPremiados, Number(e.target.value) || 1));
                    setRascunho((r) => ({ ...r, premiados: { ...r.premiados, sede: v } }));
                  }}
                  className="w-32 bg-grafite-700 border border-linha rounded-xl px-3 py-2 text-xs text-texto focus:outline-none focus:border-acao/50"
                />
              </div>
              <div>
                <label className="text-[10px] text-texto-fraco block mb-1">Fora da sede</label>
                <input
                  type="number" min={1} max={maxPremiados} placeholder="1"
                  value={rascunho.premiados?.externo ?? ''}
                  onChange={(e) => {
                    setErroCfg('');
                    const v = e.target.value === '' ? null : Math.max(1, Math.min(maxPremiados, Number(e.target.value) || 1));
                    setRascunho((r) => ({ ...r, premiados: { ...r.premiados, externo: v } }));
                  }}
                  className="w-32 bg-grafite-700 border border-linha rounded-xl px-3 py-2 text-xs text-texto focus:outline-none focus:border-acao/50"
                />
              </div>
            </div>
            <p className="text-[10px] text-texto-fraco leading-relaxed">
              <strong>Um campeão em cada competição</strong> é o padrão o prêmio é do primeiro
              lugar. Aumente aqui se um pódio maior fizer sentido nunca mais do que existe no
              ranking, e no máximo {maxPremiados} (as medalhas são ouro, prata e bronze; um
              4º lugar não tem medalha de quê). Em branco volta a 1.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button onClick={() => setRascunho({ ...config.padrao, ciclo: config.cicloPadrao, premiados: config.premiadosPadrao })} disabled={salvandoCfg}
              className="px-3 py-2 rounded-xl bg-grafite-700 border border-linha text-texto-suave text-[11px] font-bold hover:border-linha-forte disabled:opacity-50 flex items-center gap-1.5">
              <RotateCcw size={12} /> Restaurar o padrão
            </button>
            <button onClick={salvarConfig} disabled={salvandoCfg}
              className="px-4 py-2 rounded-xl bg-acao hover:bg-acao-200 text-slate-950 text-xs font-bold disabled:opacity-50 flex items-center gap-1.5">
              {salvandoCfg ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Salvar regras
            </button>
          </div>
        </div>
      )}

      <div className="glass-panel border border-linha rounded-2xl p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h3 className="text-sm font-bold text-texto">
            {dados?.rotulo || ''}  {rotuloCompetencia(compAtiva)}
          </h3>
          {/* QUEM VALIDA -- e a frase parou de dizer "não concorre".
              Ela era verdade enquanto havia uma marca de supervisor que excluía
              a pessoa da lista. Com a supervisão passando a ser do cargo de
              Administrador, quem valida TAMBÉM concorre se estiver marcado numa
              equipe -- e o nome dele aparece na tabela logo abaixo. A frase
              antiga se contradizia na mesma tela.

              A LINHA SAIU. Ela anunciava quem "valida os relatórios", e não há
              mais validação: entregar virou o fim do caminho e o administrador
              só devolve o que tem problema. Anunciar um validador aqui faria a
              equipe esperar um aval que ninguém dá -- e o ranking já conta o
              relatório assim que ele é entregue. */}
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
            <Podio classificacao={lista} premiacoes={dados?.premiacoes} premiados={dados?.premiados} />

            <div className="overflow-x-auto rounded-xl border border-linha">
              <table className="w-full text-xs">
                <thead className="bg-grafite-700">
                  <tr>
                    <th className="text-left py-2 px-3 font-bold text-texto-suave w-14">Pos.</th>
                    <th className="text-left py-2 px-3 font-bold text-texto-suave">Funcionário</th>
                    <th className="text-right py-2 px-3 font-bold text-texto-suave w-20">Pontos</th>
                    {/* O OUTRO LADO: só aparece quando há alguém nos dois
                        times. Numa operação em que ninguém acumula as duas
                        funções, a coluna seria uma fileira de traços. */}
                    {temOutroLado && (
                      <th className="text-right py-2 px-3 font-bold text-texto-suave w-24 hidden sm:table-cell"
                        title={`Pontos e registros de quem também concorre em "${rotuloOutroLado}" -- outra régua, e por isso os dois números nunca se somam`}>
                        {rotuloOutroLado}
                      </th>
                    )}
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
                      temOutroLado={temOutroLado}
                      rotuloOutroLado={rotuloOutroLado}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-[10px] text-texto-fraco mt-3 leading-relaxed">
              {aba === 'sede' ? (
                <>
                  {/* As unidades vêm do SERVIDOR, e não escritas aqui: um texto
                      com os números copiados envelhece calado no dia em que
                      alguém mexe na régua, e passa a explicar outra conta.
                      "Pontuação de 0 a 100" saiu daqui porque virou mentira --
                      a pontuação não tem mais teto. */}
                  <strong className="text-texto-suave">Sem teto</strong> cada atendimento soma:
                  {' '}{dados?.pesos?.unidades?.atendimento ?? 10} por atendimento avaliado,
                  {' '}{dados?.pesos?.unidades?.estrela ?? 2} por estrela recebida (a partir
                  de {dados?.minimoAmostra ?? 3} notas) e até
                  {' '}{dados?.pesos?.bonusAgilidade?.[0]?.pontos ?? 5} de bônus por assumir rápido
                  {' '}<strong className="text-texto-suave">só pontua atendimento fechado que o cliente
                  avaliou</strong> as três parcelas saem da mesma base
                  {' '}quem fecha o dobro de atendimentos avaliados soma o dobro, e o próximo
                  sempre vale
                  {' '}é exatamente a mesma conta do painel de parede.
                </>
              ) : (
                <>
                  {/* MESMA REGRA DA ABA VIZINHA: os números vêm do servidor.
                      O carimbo de aprovação também saiu do texto: ele deixou
                      de existir, o ranking conta o que foi ENTREGUE, e a frase
                      antiga mandava o técnico esperar um aval que ninguém dá.
                      (A verificação procura a palavra antiga neste arquivo --
                      então ela não pode ser citada nem em comentário.) */}
                  <strong className="text-texto-suave">
                    Pontuação de 0 a {dados?.pesos?.teto ?? 100}
                  </strong>: {reguaExterna(dados?.pesos?.parcelas) || 'as cinco parcelas do relatório'}
                  {dados?.pesos?.custoPorDevolucao
                    ? ` cada retorno para correção desconta ${dados.pesos.custoPorDevolucao}`
                    : ''}
                  {' '}completo, prazo e evidências só contam a partir de
                  {' '}{dados?.minimoAmostra ?? 3} relatórios entregues
                  {' '}os pesos e o mínimo saem de <strong className="text-texto-suave">Relatórios
                  {' '}Configuração</strong>.
                </>
              )}
            </p>

            {ehAdmin && (
              <div className="mt-4 pt-4 border-t border-linha">
                <p className="text-[11px] font-bold text-texto-suave mb-2 flex items-center gap-1.5">
                  <Gift size={12} className="text-espera-400" /> Premiação de {rotuloCompetencia(compAtiva)}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {/* AS MESMAS VAGAS DO PÓDIO.

                      Ficou `[1, 2, 3]` cravado quando o pódio virou variável, e
                      o resultado era a tela se contradizendo: pódio de um lugar
                      só e, logo abaixo, três botões oferecendo prêmio para 1º,
                      2º e 3º. Pior que feio -- registrar um prêmio para alguém
                      que a regra não premia é um erro que ninguém desfaz. */}
                  {Array.from({ length: dados?.premiados ?? 1 }, (_, i) => i + 1).map((pos) => {
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
