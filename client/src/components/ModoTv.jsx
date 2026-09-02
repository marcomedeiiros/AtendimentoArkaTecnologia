/**
 * MODO TV -- o painel de parede, aberto por cima da Central.
 *
 * Antes isto era uma ROTA (`/painel`, "Painel da Equipe") mais um Modo TV
 * separado que so projetava a fila. Eram duas paredes para a mesma parede: a
 * rota tinha os numeros da equipe, o Modo TV tinha a fila em cartoes grandes, e
 * quem pendurava a TV precisava escolher qual das duas. Agora ha uma: o botao
 * da TV, no cabecalho da Central, abre ESTA tela em cima de tudo -- os numeros
 * da equipe de um lado, a fila do outro.
 *
 * ── AS TRES REGRAS QUE DECIDEM ESTE ARQUIVO ────────────────────────────────
 *
 *  1. NINGUEM CLICA. A tela fica numa TV, sem teclado e sem mouse. Nao ha
 *     filtro, aba, tooltip nem ordenacao: tudo que importa esta visivel ao
 *     mesmo tempo, porque nao existe segundo passo. O UNICO controle e o Sair
 *     (e o ESC), que existe para quem abriu o painel num computador.
 *
 *  2. LE-SE A TRES METROS. Numero e o que salta; rotulo e apoio. Por isso os
 *     valores usam tamanhos que pareceriam exagerados num relatorio
 *     (`text-6xl`, `text-7xl`) e os rotulos ficam pequenos e em caixa alta.
 *
 *  3. A TELA SE ATUALIZA SOZINHA. Uma TV que mostra dado de ontem e pior do que
 *     uma TV apagada, porque parece atual. O relogio bate a cada segundo (e o
 *     que prova, de longe, que a tela nao travou), os numeros recarregam a cada
 *     30 s, e a fila nao espera nada: vem da lista da Central, que o SSE mantem
 *     viva.
 *
 * ── DUAS FONTES, DE PROPOSITO ──────────────────────────────────────────────
 *
 * Os indicadores vem de `/dashboard/painel` (agregados que so o servidor sabe
 * calcular). A FILA vem por prop, montada pela Central em `filaModoTv`: e la
 * que vivem `chipDoCliente` e companhia, que produzem as badges a partir do
 * cadastro vivo de parceiros. Buscar a fila na API custava exatamente o que
 * faltava nesta tela -- foto, telefone e badges, que aquele payload nao tem.
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
import { Trophy, Star, Clock, Users, Inbox, Target, WifiOff, X, AlertCircle, UserCheck } from 'lucide-react';
import Portal from './Portal';
import Avatar from './Avatar';
import { DashboardAPI } from '../services/api';

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

// Espera SEMPRE relativa, recontada a cada tique do relogio. A funcao da lista
// (`tempoDesde`) passa a data absoluta depois de uma semana, e na parede isso
// viraria "esperando 09/08/2026 21:49" -- que nao responde a pergunta que a
// parede existe para responder: faz quanto tempo?
function tempoEspera(iso, agora) {
  if (!iso) return 'sem registro';
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return 'sem registro';
  const s = Math.max(0, Math.floor((agora - ms) / 1000));
  if (s < 60) return 'agora';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

// Data por extenso: "1, setembro de 2026".
//
// Nao e `toLocaleDateString` com `month: 'long'` porque o pt-BR devolve "1 de
// setembro de 2026", e o formato pedido troca o primeiro "de" por virgula. O mes
// ainda vem do locale (nao ha lista de meses escrita a mao aqui) -- so a
// montagem e nossa.
//
// Numa parede, mes escrito ganha do numerico: "1, setembro" nao tem como ser
// lido como 9 de janeiro por quem esta acostumado ao formato americano.
function dataPorExtenso(d) {
  const mes = d.toLocaleDateString('pt-BR', { month: 'long' });
  return `${d.getDate()}, ${mes} de ${d.getFullYear()}`;
}

// Espera longa = vermelho. E o dado que importa numa parede: quem esta
// esperando demais precisa saltar aos olhos.
function urgencia(iso, agora) {
  if (!iso) return { linha: 'border-linha bg-grafite-700/50', tempo: 'text-slate-300' };
  const min = (agora - new Date(iso).getTime()) / 60000;
  if (min >= 15) return { linha: 'border-falha/40 bg-falha/10', tempo: 'text-falha-400' };
  if (min >= 5) return { linha: 'border-espera/40 bg-espera/10', tempo: 'text-espera-400' };
  return { linha: 'border-linha bg-grafite-700/50', tempo: 'text-ativo-400' };
}

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

export default function ModoTv({ onFechar, fila = [] }) {
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
      //
      // Se ainda NAO ha quadro nenhum, o corpo mostra o aviso: sem isto a tela
      // ficaria em "Carregando…" para sempre -- o caso de quem tem a Central
      // mas nao o modulo `dashboard`, que a API barra com 403.
      setErro(true);
    }
  }, []);

  useEffect(() => {
    carregar();
    const id = setInterval(carregar, ATUALIZAR_MS);
    return () => clearInterval(id);
  }, [carregar]);

  // RELOGIO DE 1 SEGUNDO -- porque o mostrador tem segundos.
  //
  // Era 20 s, o suficiente para o relogio de horas e minutos e para os minutos
  // de espera da fila ANDAREM entre duas recargas (a conta usa `esperaDesde`, o
  // instante que veio do servidor). Com segundos no mostrador, 20 s viraria um
  // relogio que pula de 12 em 12 -- e um relogio que salta parece tela travada,
  // que e exatamente o oposto do que ele existe para provar numa parede.
  //
  // O custo e um render por segundo desta tela. Barato: a fila chega pronta por
  // prop (memoizada na Central) e os numeros vem do estado, entao o segundo nao
  // recalcula nada -- so redesenha.
  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // ESC fecha, como em qualquer camada por cima da tela. Quem esta na frente da
  // TV nao usa; quem abriu no computador espera que funcione.
  useEffect(() => {
    const onTecla = (e) => { if (e.key === 'Escape') onFechar(); };
    window.addEventListener('keydown', onTecla);
    return () => window.removeEventListener('keydown', onTecla);
  }, [onFechar]);

  const ranking = dados?.ranking;
  const metaPct = dados?.hoje?.meta
    ? Math.min(100, Math.round((dados.hoje.fechados / dados.hoje.meta) * 100))
    : null;
  const emAtendimento = dados ? dados.equipe.reduce((s, m) => s + m.abertas, 0) : 0;

  return (
    <Portal>
      <div className="fixed inset-0 z-[70] bg-grafite-900 flex flex-col gap-4 p-5 xl:p-7 overflow-hidden">
        {/* Cabecalho enxuto: identidade, relogio, aviso de conexao e a saida. */}
        <header className="flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 xl:gap-4 min-w-0">
            {/* A marca ao lado do titulo: esta tela fica pendurada numa parede
                que qualquer visitante ve, e ali ela representa a empresa, nao
                so a equipe. A classe `arka-logo` cuida do tema claro (inverte
                o logo, que e desenhado para fundo escuro). */}
            <img
              src="/arka_tecnologia_logo-removebg-preview.png"
              alt="Logo Arka Tecnologia"
              className="arka-logo h-10 xl:h-12 w-auto shrink-0 object-contain"
            />
            <div className="min-w-0">
              <h1 className="font-display font-bold text-white text-2xl xl:text-3xl leading-none truncate">
                Painel da Equipe
              </h1>
              <p className="text-xs text-slate-400 mt-1 truncate">
                {dados
                  ? `Ranking do ${dados.periodo.rotulo} · atualiza sozinho a cada 30 segundos`
                  : 'atualiza sozinho a cada 30 segundos'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            {erro && dados && (
              <span className="flex items-center gap-1.5 text-xs text-espera-400" title="Mostrando o último quadro recebido">
                <WifiOff size={14} /> sem conexão
              </span>
            )}
            {/* Hora grande, data pequena embaixo: a hora e o que se confere de
                longe (e o que prova que a tela nao travou); a data responde a
                outra pergunta, mais rara, e nao precisa competir por atencao.
                `tabular-nums` nos dois evita o numero "dancar" a cada tique. */}
            <div className="text-right leading-none">
              <div className="font-display font-bold text-white text-3xl xl:text-4xl tabular-nums whitespace-nowrap">
                {agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </div>
              <div className="text-xs xl:text-sm text-slate-400 mt-1.5 whitespace-nowrap">
                {dataPorExtenso(agora)}
              </div>
            </div>
            {/* O UNICO CONTROLE DA TELA. A TV nao tem mouse, entao ele nunca
                sera usado la -- existe para quem abriu o painel num computador
                e precisa voltar para a Central. */}
            <button
              type="button"
              onClick={onFechar}
              title="Sair do modo TV (ESC)"
              className="px-3 sm:px-4 py-2 rounded-xl bg-grafite-600 hover:bg-grafite-500 text-texto text-sm font-bold flex items-center gap-2 transition-colors shrink-0"
            >
              <X size={18} /> <span className="hidden sm:inline">Sair</span>
            </button>
          </div>
        </header>

        {/* AS DUAS METADES. Em telas estreitas empilham; numa TV ficam lado a
            lado, cada uma rolando por dentro se precisar -- a tela em si nunca
            rola, porque ninguem vai rolar uma TV.
            
            AS DUAS FALHAM SEPARADO, de proposito: os numeros vem da API de
            indicadores e a fila vem da lista da Central. Antes um erro na API
            apagava a tela inteira -- inclusive a fila, que nao depende dela e e
            a metade que exige acao. */}
        <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* ── METADE 1: A EQUIPE ─────────────────────────────────────────── */}
          {!dados ? (
            <section className="min-h-0 glass-panel border border-linha rounded-2xl grid place-items-center text-center p-6">
              {erro ? (
                <div className="max-w-md space-y-2">
                  <AlertCircle size={32} className="text-espera-400 mx-auto" />
                  <p className="font-display text-lg text-white">Não foi possível carregar os indicadores</p>
                  <p className="text-sm text-slate-400">
                    Tentando de novo a cada 30 segundos. Se não voltar, seu perfil pode não ter
                    acesso ao módulo de indicadores. A fila ao lado continua valendo.
                  </p>
                </div>
              ) : (
                <p className="font-display text-lg text-slate-500">Carregando os indicadores…</p>
              )}
            </section>
          ) : (
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
                  valor={dados.csat.media != null ? dados.csat.media.toFixed(1).replace('.', ',') : '—'}
                  apoio={dados.csat.total
                    ? `${dados.csat.total} ${dados.csat.total === 1 ? 'avaliação' : 'avaliações'}`
                    : 'sem avaliações ainda'}
                  cor="text-ativo-400"
                />
                <Kpi
                  icon={Target}
                  rotulo="Fechados hoje"
                  valor={dados.hoje.fechados}
                  apoio={dados.hoje.meta ? `meta do dia: ${dados.hoje.meta}` : 'sem meta definida'}
                  cor="text-acao-400"
                />
              </div>

              {/* A barra so aparece quando ha meta. Sem meta, uma barra vazia
                  numa TV sugere que a equipe esta a zero de alguma coisa. */}
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
                  valor={duracao(dados.tempos.assumirMedioSeg)}
                  apoio={`média de ${dados.tempos.assumirAmostra} atendimento(s) no mês`}
                />
                <Kpi
                  icon={Clock}
                  rotulo="Tempo até resolver"
                  valor={duracao(dados.tempos.resolverMedioSeg)}
                  apoio={`média de ${dados.tempos.resolverAmostra} atendimento(s) no mês`}
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
                {dados.equipe.length === 0 ? (
                  <p className="text-sm text-slate-500 py-2">Ninguém online no momento.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {dados.equipe.map((m) => (
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
          )}

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
              <ul className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2.5 pr-1">
                {fila.map((c) => {
                  const u = urgencia(c.esperaDesde, agora);
                  return (
                    <li key={c.id} className={`border rounded-xl p-3 xl:p-3.5 flex flex-col gap-2 ${u.linha}`}>
                      {/* Foto, nome e telefone: e por eles que quem olha a TV
                          reconhece o cliente antes de abrir a conversa. */}
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar nome={c.cliente} size="md" fotoUrl={c.fotoUrl} />
                        <div className="min-w-0 flex-1">
                          <p className="font-display font-semibold text-white text-lg xl:text-xl truncate">
                            {c.cliente}
                          </p>
                          <p className="text-xs xl:text-sm text-slate-400 font-mono truncate">{c.telefone}</p>
                        </div>
                        {c.naoLidas > 0 && (
                          <span className="shrink-0 min-w-[26px] h-[26px] px-2 rounded-full bg-espera text-grafite-900 text-sm font-extrabold flex items-center justify-center tabular-nums">
                            {c.naoLidas > 99 ? '99+' : c.naoLidas}
                          </span>
                        )}
                        <span className={`shrink-0 font-display font-bold text-xl xl:text-2xl tabular-nums ${u.tempo}`}>
                          {tempoEspera(c.esperaDesde, agora)}
                        </span>
                      </div>

                      {/* As mesmas badges do cartao da lista: quem olha a TV
                          decide para quem vai a conversa, e saber a empresa (ou
                          que ela ainda nao foi identificada) e o setor pedido e
                          o que muda essa decisao. O numero do CNPJ nunca vai
                          para a parede. */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {c.ticket && (
                          <span className="inline-flex items-center text-[10px] xl:text-xs font-mono font-bold px-1.5 py-0.5 rounded-md border border-linha-forte text-acao-200/90">
                            {c.ticket}
                          </span>
                        )}
                        <span className={`inline-flex items-center max-w-full truncate text-[10px] xl:text-xs font-bold px-2 py-0.5 rounded-md border ${c.chip.classe}`}
                          title={c.chip.titulo}>
                          {c.chip.label}
                        </span>
                        {c.setor && (
                          <span className={`inline-flex items-center text-[10px] xl:text-xs font-bold px-2 py-0.5 rounded-md border ${c.setor.classe}`}
                            title={c.setor.id === 'geral'
                              ? 'Ainda sem triagem: o cliente nao escolheu setor no menu'
                              : `Setor escolhido pelo cliente: ${c.setor.setor}`}>
                            {c.setor.label}
                          </span>
                        )}
                        {/* Numa fila de pendentes isto quase sempre esta vazio
                            (conversa sem responsavel), mas quando aparece evita
                            duas pessoas pegarem a mesma conversa. */}
                        {c.atendente?.nome && (
                          <span className="inline-flex items-center gap-1 text-[10px] xl:text-xs font-bold px-2 py-0.5 rounded-md border bg-purple-500/15 text-purple-300 border-purple-500/30"
                            title={`Atendendo: ${c.atendente.nome}${c.atendente.cargo ? ' (' + c.atendente.cargo + ')' : ''}`}>
                            <UserCheck size={12} className="shrink-0" /> {c.atendente.nome}
                          </span>
                        )}
                      </div>

                      <p className="text-xs xl:text-sm text-slate-400 line-clamp-2 leading-snug">
                        {c.previa}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </Portal>
  );
}
