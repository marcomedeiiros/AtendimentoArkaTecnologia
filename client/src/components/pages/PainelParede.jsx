/**
 * PAINEL DE PAREDE -- feito para ser lido de longe, o dia inteiro.
 *
 * ── AS TRES REGRAS QUE DECIDEM ESTE ARQUIVO ────────────────────────────────
 *
 *  1. NINGUEM CLICA. A tela fica numa TV, sem teclado e sem mouse. Nao ha
 *     filtro, aba, tooltip nem ordenacao: tudo que importa esta visivel ao
 *     mesmo tempo, porque nao existe segundo passo.
 *
 *  2. LE-SE A TRES METROS. Numero e o que salta; rotulo e apoio. Por isso os
 *     valores usam tamanhos que pareceriam exagerados num relatorio
 *     (`text-6xl`, `text-7xl`) e os rotulos ficam pequenos e em caixa alta.
 *
 *  3. A TELA SE ATUALIZA SOZINHA a cada 30 s. Uma TV que mostra dado de ontem
 *     e pior do que uma TV apagada, porque parece atual.
 *
 * ── E A REGRA QUE DECIDE O QUE *NAO* ENTRA ─────────────────────────────────
 *
 * Esta tela e vista pela equipe inteira, o tempo todo. Entao ela mostra quem
 * esta indo bem e nao mostra quem esta indo mal: ha podio, e nao lanterna. A
 * lista de "quem esta online" nao vira placar de ausencia (o servidor so manda
 * quem esta online), e o ranking por nota exige um minimo de avaliacoes para
 * ninguem liderar por causa de uma unica estrela solta.
 */
import { useEffect, useState, useCallback } from 'react';
import { Trophy, Star, Clock, Users, Inbox, Target, Maximize2, WifiOff } from 'lucide-react';
import { DashboardAPI } from '../../services/api';

const ATUALIZAR_MS = 30_000;

// ── formatadores ───────────────────────────────────────────────────────────

// Duracao curta e legivel de longe: "4 min", "2 h 10", "18 s".
function duracao(segundos) {
  if (!segundos || segundos < 1) return '—';
  if (segundos < 60) return `${Math.round(segundos)} s`;
  const min = Math.round(segundos / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return resto ? `${h} h ${String(resto).padStart(2, '0')}` : `${h} h`;
}

const espera = (min) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`);

// Primeiro nome + inicial: nome completo nao cabe no podio, e "Ana S." e o que
// a equipe usa para se chamar.
function nomeCurto(completo) {
  const partes = String(completo || '').trim().split(/\s+/);
  if (partes.length === 1) return partes[0];
  return `${partes[0]} ${partes[partes.length - 1][0]}.`;
}

const MEDALHAS = ['#F5B301', '#B8C4CC', '#C97B3C'];

// ── pecas ──────────────────────────────────────────────────────────────────

function Kpi({ icon: Icon, rotulo, valor, apoio, cor = 'text-white' }) {
  return (
    <div className="glass-panel border border-linha rounded-2xl p-5 flex flex-col justify-between min-h-[8.5rem]">
      <div className="flex items-center gap-2 text-slate-400">
        <Icon size={16} />
        <span className="text-[11px] font-bold uppercase tracking-[0.12em]">{rotulo}</span>
      </div>
      <div className={`font-display font-bold leading-none tabular-nums ${cor} text-5xl xl:text-6xl`}>
        {valor}
      </div>
      <div className="text-xs text-slate-400 leading-tight">{apoio}</div>
    </div>
  );
}

function Podio({ icon: Icon, titulo, itens, formatar, vazio }) {
  return (
    <div className="glass-panel border border-linha rounded-2xl p-5 flex flex-col gap-3">
      <div className="flex items-center gap-2 text-slate-400">
        <Icon size={16} />
        <span className="text-[11px] font-bold uppercase tracking-[0.12em]">{titulo}</span>
      </div>

      {itens.length === 0 ? (
        <p className="text-sm text-slate-500 py-4">{vazio}</p>
      ) : (
        <ol className="flex flex-col gap-2.5">
          {itens.map((it, i) => (
            <li key={it.nome} className="flex items-center gap-3">
              <span
                className="shrink-0 w-8 h-8 rounded-full grid place-items-center font-display font-bold text-sm text-grafite-900 tabular-nums"
                style={{ background: MEDALHAS[i] || '#54636B' }}
              >
                {i + 1}
              </span>
              <span className="flex-1 min-w-0 truncate font-display font-semibold text-white text-xl xl:text-2xl">
                {nomeCurto(it.nome)}
              </span>
              <span className="shrink-0 font-display font-bold text-white text-2xl xl:text-3xl tabular-nums">
                {formatar(it)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ── tela ───────────────────────────────────────────────────────────────────

export default function PainelParede() {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(false);
  const [agora, setAgora] = useState(new Date());

  const carregar = useCallback(async () => {
    try {
      setDados(await DashboardAPI.painel());
      setErro(false);
    } catch {
      // MANTEM O ULTIMO QUADRO NA TELA. Numa TV, trocar os numeros por uma
      // mensagem de erro apaga a informacao de quem esta olhando de longe --
      // e a queda costuma durar segundos. O aviso vai num canto, discreto,
      // e os numeros ficam ate voltarem a ser verdade.
      setErro(true);
    }
  }, []);

  useEffect(() => {
    carregar();
    const id = setInterval(carregar, ATUALIZAR_MS);
    return () => clearInterval(id);
  }, [carregar]);

  // Relogio proprio, mais rapido que a recarga: e ele que faz a espera da fila
  // ANDAR entre uma atualizacao e outra (a conta usa `esperaDesde`, o instante
  // que veio do servidor). Sem isso os minutos ficariam parados por 30 s numa
  // tela cuja unica promessa e mostrar o agora.
  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), 20_000);
    return () => clearInterval(id);
  }, []);

  if (!dados) {
    return (
      <div className="h-full grid place-items-center text-slate-500">
        <p className="font-display text-lg">Carregando o painel…</p>
      </div>
    );
  }

  const { ranking, csat, tempos, hoje, equipe, fila } = dados;
  const metaPct = hoje.meta ? Math.min(100, Math.round((hoje.fechados / hoje.meta) * 100)) : null;
  const emAtendimento = equipe.reduce((s, m) => s + m.abertas, 0);

  return (
    <div className="h-full flex flex-col gap-4">
      {/* Cabecalho enxuto: identidade, relogio e o aviso de conexao. */}
      <header className="flex items-center justify-between gap-4 shrink-0">
        <div>
          <h1 className="font-display font-bold text-white text-2xl xl:text-3xl leading-none">
            Painel da Equipe
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Ranking do {dados.periodo.rotulo} · atualiza sozinho a cada 30 segundos
          </p>
        </div>
        <div className="flex items-center gap-4">
          {erro && (
            <span className="flex items-center gap-1.5 text-xs text-espera-400" title="Mostrando o último quadro recebido">
              <WifiOff size={14} /> sem conexão
            </span>
          )}
          <span className="font-display font-bold text-white text-3xl xl:text-4xl tabular-nums leading-none">
            {agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </span>
          <button
            type="button"
            onClick={() => document.documentElement.requestFullscreen?.()}
            title="Tela cheia"
            className="p-2 rounded-xl border border-linha text-slate-400 hover:text-white hover:border-linha-forte transition-colors"
          >
            <Maximize2 size={16} />
          </button>
        </div>
      </header>

      {/* AS DUAS METADES. Em telas estreitas empilham; numa TV ficam lado a
          lado, cada uma rolando por dentro se precisar -- a pagina em si nunca
          rola, porque ninguem vai rolar uma TV. */}
      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* ── METADE 1: A EQUIPE ─────────────────────────────────────────── */}
        <section className="min-h-0 flex flex-col gap-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-4">
            <Podio
              icon={Trophy}
              titulo="Top 3 · mais atendimentos"
              itens={ranking.porVolume}
              formatar={(it) => it.valor}
              vazio="Nenhum atendimento fechado ainda neste mês."
            />
            <Podio
              icon={Star}
              titulo="Top 3 · melhores notas"
              itens={ranking.porNota}
              formatar={(it) => it.valor.toFixed(1).replace('.', ',')}
              vazio={`Ninguém tem ${ranking.minimoAvaliacoes} avaliações ainda.`}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Kpi
              icon={Star}
              rotulo="Satisfação do mês"
              valor={csat.media != null ? csat.media.toFixed(1).replace('.', ',') : '—'}
              apoio={csat.total ? `${csat.total} ${csat.total === 1 ? 'avaliação' : 'avaliações'}` : 'sem avaliações ainda'}
              cor="text-ativo-400"
            />
            <Kpi
              icon={Target}
              rotulo="Fechados hoje"
              valor={hoje.fechados}
              apoio={hoje.meta ? `meta do dia: ${hoje.meta}` : 'sem meta definida'}
              cor="text-acao-400"
            />
          </div>

          {/* A barra so aparece quando ha meta. Sem meta, uma barra vazia numa
              TV sugere que a equipe esta a zero de alguma coisa. */}
          {metaPct != null && (
            <div className="glass-panel border border-linha rounded-2xl p-4">
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
                  Progresso da meta
                </span>
                <span className="font-display font-bold text-white text-lg tabular-nums">{metaPct}%</span>
              </div>
              <div className="h-3 rounded-full bg-grafite-700 overflow-hidden">
                <div
                  className="h-full rounded-full bg-acao transition-[width] duration-700"
                  style={{ width: `${metaPct}%` }}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Kpi
              icon={Clock}
              rotulo="Tempo até assumir"
              valor={duracao(tempos.assumirMedioSeg)}
              apoio={`média de ${tempos.assumirAmostra} atendimento(s) no mês`}
            />
            <Kpi
              icon={Clock}
              rotulo="Tempo até resolver"
              valor={duracao(tempos.resolverMedioSeg)}
              apoio={`média de ${tempos.resolverAmostra} atendimento(s) no mês`}
            />
          </div>

          <div className="glass-panel border border-linha rounded-2xl p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between text-slate-400">
              <span className="flex items-center gap-2">
                <Users size={16} />
                <span className="text-[11px] font-bold uppercase tracking-[0.12em]">Online agora</span>
              </span>
              <span className="text-xs">{emAtendimento} em atendimento</span>
            </div>
            {equipe.length === 0 ? (
              <p className="text-sm text-slate-500 py-2">Ninguém online no momento.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {equipe.map((m) => (
                  <li key={m.id} className="flex items-center gap-3">
                    <span className="w-2 h-2 rounded-full bg-ativo shrink-0" />
                    <span className="flex-1 min-w-0 truncate text-white font-display font-semibold text-lg">
                      {nomeCurto(m.nome)}
                    </span>
                    <span className="text-xs text-slate-400 shrink-0">{m.cargo}</span>
                    <span className="shrink-0 font-display font-bold text-white text-xl tabular-nums w-8 text-right">
                      {m.abertas}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* ── METADE 2: A FILA ───────────────────────────────────────────── */}
        <section className="min-h-0 glass-panel border border-linha rounded-2xl p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between shrink-0">
            <span className="flex items-center gap-2 text-slate-400">
              <Inbox size={16} />
              <span className="text-[11px] font-bold uppercase tracking-[0.12em]">Aguardando atendimento</span>
            </span>
            <span className="font-display font-bold text-white text-4xl xl:text-5xl leading-none tabular-nums">
              {fila.length}
            </span>
          </div>

          {fila.length === 0 ? (
            <div className="flex-1 grid place-items-center text-center">
              <div>
                <p className="font-display font-bold text-ativo-400 text-3xl">Fila vazia</p>
                <p className="text-sm text-slate-400 mt-1">Nenhum cliente esperando.</p>
              </div>
            </div>
          ) : (
            <ul className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 pr-1">
              {fila.map((c) => {
                const esperaMin = c.esperaDesde
                  ? Math.max(0, Math.round((agora - new Date(c.esperaDesde)) / 60000))
                  : c.esperaMin;
                // Espera longa muda a cor da linha inteira: e o unico alarme
                // desta tela, e precisa ser visto sem ninguem procurar.
                const cor =
                  esperaMin >= 30
                    ? 'border-falha/40 bg-falha/10'
                    : esperaMin >= 15
                      ? 'border-espera/40 bg-espera/10'
                      : 'border-linha bg-grafite-700/50';
                const corTempo =
                  esperaMin >= 30 ? 'text-falha-400' : esperaMin >= 15 ? 'text-espera-400' : 'text-slate-300';
                return (
                  <li key={c.id} className={`border rounded-xl px-4 py-3 flex items-center gap-4 ${cor}`}>
                    <div className="flex-1 min-w-0">
                      <p className="font-display font-semibold text-white text-lg xl:text-xl truncate">
                        {c.cliente}
                      </p>
                      <p className="text-xs text-slate-400 truncate">
                        {c.ticket ? `AK${String(c.ticket).padStart(5, '0')} · ` : ''}
                        {c.setor}
                      </p>
                    </div>
                    <span className={`shrink-0 font-display font-bold text-2xl xl:text-3xl tabular-nums ${corTempo}`}>
                      {espera(esperaMin)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
