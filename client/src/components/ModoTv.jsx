/**
 * MODO TV -- o painel de parede, aberto por cima da Central.
 *
 * ── AS TRES REGRAS QUE DECIDEM ESTE ARQUIVO ────────────────────────────────
 *
 *  1. NINGUEM CLICA. A tela fica numa TV, sem teclado e sem mouse. Nao ha
 *     filtro, aba, tooltip nem ordenacao: tudo que importa esta visivel ao
 *     mesmo tempo, porque nao existe segundo passo. O UNICO controle e o Sair
 *     (e o ESC), que existe para quem abriu o painel num computador.
 *
 *  2. LE-SE A TRES METROS. Numero e o que salta; rotulo e apoio.
 *
 *  3. A TELA SE ATUALIZA SOZINHA. Uma TV que mostra dado de ontem e pior do que
 *     uma TV apagada, porque parece atual. O relogio bate a cada segundo (e o
 *     que prova, de longe, que a tela nao travou), os numeros recarregam a cada
 *     30 s, e a fila nao espera nada: vem da lista da Central, que o SSE mantem
 *     viva.
 *
 * ── O TAMANHO DA LETRA SEGUE A ALTURA, E NAO A LARGURA ─────────────────────
 *
 * Esta tela ja quebrou numa TV de verdade, e vale registrar como: os tamanhos
 * grandes estavam todos atras do `xl:`, e os breakpoints do Tailwind sao de
 * LARGURA. Uma TV de 1366x768 e larga o bastante para ligar as fontes de TV
 * (avatar de 128px, numero de 84px) numa tela que so tem 768px de ALTURA. O
 * resultado na parede: rotulo sobrepondo titulo, nome truncado, o numero
 * cavalgando o nome ao lado e a faixa de indicadores cortada pela borda de
 * baixo. A 1920x1080 nada disso aparecia.
 *
 * O que aperta um painel de parede e a ALTURA. Por isso todo corpo grande daqui
 * usa `clamp(min, Nvh, max)`: a letra acompanha a altura real da tela e o painel
 * serve 720p, 768p, 1080p e 4K sem ninguem precisar saber qual e a TV. O
 * `tailwind.config.js` ja tinha um breakpoint `baixa` (max-height) criado para
 * este mesmo buraco -- aqui a resposta e continua, em vez de em degraus.
 *
 * ── UM DESTAQUE, E NAO DOIS PODIOS ─────────────────────────────────────────
 *
 * Havia aqui dois podios lado a lado (mais atendimentos / melhores notas),
 * exatamente para nao arbitrar um peso entre volume e nota. Viraram um card so.
 * A condicao que torna isso honesto vive no servidor e esta explicada la
 * (`painel.service._ranking`): as parcelas chegam SEPARADAS e a tela mostra a
 * soma -- "38 + 39 + 15 = 92". Quem discorda do peso discorda de uma conta
 * visivel. Se algum dia a soma sumir da tela, a objecao antiga volta a valer.
 *
 * ── DUAS FONTES, DE PROPOSITO ──────────────────────────────────────────────
 *
 * Os indicadores vem de `/dashboard/painel` (agregados que so o servidor sabe
 * calcular). A FILA vem por prop, montada pela Central em `filaModoTv`: e la
 * que vivem `chipDoCliente` e companhia, que produzem as badges a partir do
 * cadastro vivo de parceiros.
 *
 * ── E A REGRA QUE DECIDE O QUE *NAO* ENTRA ─────────────────────────────────
 *
 * Esta tela e vista pela equipe inteira, o tempo todo. Entao ela mostra quem
 * esta indo bem e nao mostra quem esta indo mal: ha podio, e nao lanterna. Quem
 * fez zero ponto nao vira linha na parede, a lista de "quem esta online" nao e
 * placar de ausencia, e a parcela de nota exige um minimo de avaliacoes para
 * ninguem liderar por causa de uma unica estrela solta.
 */
import { useEffect, useState, useCallback } from 'react';
import { Trophy, Star, Clock, Users, Inbox, Target, WifiOff, X, AlertCircle, UserCheck, Crown, Medal } from 'lucide-react';
import Portal from './Portal';
import Avatar from './Avatar';
import { DashboardAPI } from '../services/api';

const ATUALIZAR_MS = 30_000;

// ── tipografia fluida ──────────────────────────────────────────────────────

// `clamp(min, Nvh, max)`: o piso protege o notebook, o teto impede que uma TV
// de 4K vire um cartaz de duas palavras, e o meio faz o trabalho. Ver o bloco
// "O TAMANHO DA LETRA SEGUE A ALTURA" no cabecalho.
const corpo = (min, vh, max) => ({ fontSize: `clamp(${min}, ${vh}vh, ${max})` });

const T = {
  titulo: corpo('1.15rem', 3.1, '2.1rem'),
  relogio: corpo('1.5rem', 4.2, '2.9rem'),
  rotulo: corpo('0.6rem', 1.35, '0.9rem'),
  apoio: corpo('0.65rem', 1.45, '0.95rem'),
  destaqueNome: corpo('1.25rem', 3.4, '2.5rem'),
  destaquePontos: corpo('2.25rem', 7.8, '5.5rem'),
  indicador: corpo('0.95rem', 2.4, '1.7rem'),
  posicaoNome: corpo('0.95rem', 2.5, '1.8rem'),
  posicaoPontos: corpo('1.25rem', 3.4, '2.4rem'),
  kpi: corpo('1.6rem', 4.8, '3.5rem'),
  filaNumero: corpo('1.75rem', 4.8, '3.1rem'),
  filaNome: corpo('0.85rem', 2, '1.2rem'),
  filaTempo: corpo('1rem', 2.4, '1.5rem'),
  onlineNome: corpo('0.9rem', 2.1, '1.3rem'),
};

// Avatares tambem em vh -- eram eles que empurravam o resto para fora da tela.
const AVATAR_DESTAQUE = 'clamp(3rem, 9.5vh, 6.5rem)';
const AVATAR_POSICAO = 'clamp(1.9rem, 4.6vh, 3rem)';

// ── formatadores ───────────────────────────────────────────────────────────

// Duracao curta e legivel de longe: "4 min", "2 h 10", "18 s".
function duracao(segundos) {
  if (segundos == null || segundos < 1) return '—';
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

// Data por extenso: "1, setembro de 2026". Numa parede, mes escrito ganha do
// numerico: "1, setembro" nao tem como ser lido como 9 de janeiro.
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

// Primeiro nome + inicial: nome completo nao cabe, e "Ana S." e o que a equipe
// usa para se chamar.
function nomeCurto(completo) {
  const partes = String(completo || '').trim().split(/\s+/);
  if (partes.length === 1) return partes[0];
  return `${partes[0]} ${partes[partes.length - 1][0]}.`;
}

// O `Avatar` da Central nao serve no destaque: o maior tamanho que ele conhece
// e 48px (some numa parede) e a cor dele vem do hash do nome -- aqui a cor
// precisa ser a da MEDALHA. O ranking tambem nao traz foto: `_ranking` agrupa
// por `atendenteNome` e devolve so nome e numeros.
function iniciais(completo) {
  const partes = String(completo || '').trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

const nota1 = (n) => n.toFixed(1).replace('.', ',');

// Ouro, prata e bronze vem do tema (ver `--medalha-*` em index.css), e nao de
// hex fixo: a TV do setor roda no tema CLARO, e a prata #B8C4CC sobre branco
// deixava o segundo lugar praticamente invisivel.
const MEDALHAS = ['--medalha-1', '--medalha-2', '--medalha-3'];
const medalha = (variavel, opacidade = 1) => `rgb(var(${variavel}) / ${opacidade})`;

// ── pecas ──────────────────────────────────────────────────────────────────

function Rotulo({ icon: Icon, children, cor }) {
  return (
    <span className="flex items-center gap-2 min-w-0 text-slate-400">
      {Icon && <Icon size={18} className="shrink-0" style={cor ? { color: cor } : undefined} />}
      <span className="font-bold uppercase tracking-[0.12em] truncate" style={T.rotulo}>
        {children}
      </span>
    </span>
  );
}

// Uma linha da tabela de indicadores do destaque. Os pontos a direita sao o que
// torna a soma conferivel -- ver o cabecalho.
function LinhaIndicador({ rotulo, valor, detalhe, pontos, esmaecido }) {
  return (
    <div className="flex items-baseline gap-3 py-1.5 xl:py-2 border-t border-linha min-w-0">
      <span className="shrink-0 text-slate-400 truncate" style={T.apoio}>{rotulo}</span>
      <span className="ml-auto flex items-baseline gap-1.5 min-w-0 justify-end">
        <span
          className={`font-display font-bold tabular-nums truncate ${esmaecido ? 'text-slate-500' : 'text-white'}`}
          style={T.indicador}
        >
          {valor}
        </span>
        {detalhe && <span className="shrink-0 text-slate-500" style={T.apoio}>{detalhe}</span>}
      </span>
      <span
        className={`shrink-0 text-right font-display font-bold tabular-nums ${pontos > 0 ? 'text-acao-200' : 'text-slate-600'}`}
        style={{ ...T.apoio, minWidth: '3.2ch' }}
      >
        +{pontos}
      </span>
    </div>
  );
}

function DestaqueDoMes({ item, minimo }) {
  const ouro = MEDALHAS[0];

  return (
    <section className="min-h-0 glass-panel border border-linha rounded-2xl p-4 xl:p-5 flex flex-col gap-3 overflow-hidden">
      <div className="flex items-center justify-between gap-3 shrink-0">
        <Rotulo icon={Trophy} cor={medalha(ouro)}>Destaque do mês</Rotulo>
        <span className="shrink-0 text-slate-500 truncate" style={T.apoio}>mês corrente</span>
      </div>

      {!item ? (
        <p className="flex-1 grid place-items-center text-center text-slate-500 px-4" style={T.indicador}>
          Ninguém pontuou ainda neste mês.
        </p>
      ) : (
        <>
          <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-1.5 xl:gap-2">
            <span
              className="flex items-center gap-1.5 font-bold uppercase tracking-[0.14em] whitespace-nowrap"
              style={{ ...T.rotulo, color: medalha(ouro) }}
            >
              <Crown size={16} className="shrink-0" /> Líder do mês
            </span>

            <div
              className="shrink-0 rounded-full border-[3px] grid place-items-center font-display font-bold"
              style={{
                width: AVATAR_DESTAQUE,
                height: AVATAR_DESTAQUE,
                fontSize: `calc(${AVATAR_DESTAQUE} * 0.33)`,
                borderColor: medalha(ouro),
                background: medalha(ouro, 0.16),
                color: medalha(ouro),
                boxShadow: `0 0 0 8px ${medalha(ouro, 0.07)}`,
              }}
              title={item.nome}
            >
              {iniciais(item.nome)}
            </div>

            <p
              className="w-full text-center truncate font-display font-bold text-white leading-tight"
              style={T.destaqueNome}
              title={item.nome}
            >
              {nomeCurto(item.nome)}
            </p>

            <p className="flex items-baseline gap-2 leading-none">
              <span className="font-display font-extrabold text-white tabular-nums" style={T.destaquePontos}>
                {item.pontos}
              </span>
              <span className="font-display font-semibold text-slate-400" style={T.indicador}>pts</span>
            </p>
          </div>

          <div className="shrink-0">
            <LinhaIndicador
              rotulo="Atendimentos"
              valor={item.atendimentos.valor}
              pontos={item.atendimentos.pontos}
            />
            <LinhaIndicador
              rotulo="Avaliação média"
              valor={item.nota.conta ? nota1(item.nota.valor) : `${item.nota.amostra} de ${minimo}`}
              detalhe={item.nota.conta ? `${item.nota.amostra} notas` : 'avaliações'}
              pontos={item.nota.pontos}
              esmaecido={!item.nota.conta}
            />
            <LinhaIndicador
              rotulo="Tempo até assumir"
              valor={duracao(item.agilidade.medioSeg)}
              pontos={item.agilidade.pontos}
            />

            {/* A SOMA, ESCRITA. E o que sustenta o card unico: quem discorda do
                peso discorda de uma conta visivel, e nao de um oraculo. */}
            <div className="border-t border-linha pt-2 mt-1 text-center text-slate-500 tabular-nums" style={T.apoio}>
              {item.atendimentos.pontos} + {item.nota.pontos} + {item.agilidade.pontos} ={' '}
              <span className="font-bold text-slate-300">{item.pontos} pts</span>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function LinhaPosicao({ posicao, item, minimo }) {
  const cor = MEDALHAS[posicao - 1] || '--quieto';
  const vago = !item;
  // Ouro, prata e bronze existem; do 4o em diante nao ha metal a mostrar.
  const temMedalha = posicao <= MEDALHAS.length;

  return (
    <li
      className="flex-1 min-h-0 flex items-center gap-3 px-3 rounded-xl border"
      style={{
        borderColor: vago ? 'rgb(var(--linha))' : medalha(cor, 0.38),
        background: vago ? 'transparent' : `linear-gradient(90deg, ${medalha(cor, 0.14)}, ${medalha(cor, 0.02)})`,
        borderStyle: vago ? 'dashed' : 'solid',
      }}
    >
      <span
        className="shrink-0 font-display font-extrabold tabular-nums text-center"
        style={{ ...T.posicaoPontos, color: vago ? 'rgb(var(--slate-700))' : medalha(cor), minWidth: '2.2ch' }}
      >
        {posicao}º
      </span>

      {vago ? (
        <span className="flex-1 text-slate-600" style={T.apoio}>em aberto</span>
      ) : (
        <>
          {/* AVATAR + MEDALHA.
              O `relative` existe so para pendurar o disco na base do circulo;
              o `AVATAR_POSICAO` continua definindo o tamanho, entao a linha nao
              muda de altura por causa da medalha. */}
          <span className="relative shrink-0" style={{ width: AVATAR_POSICAO, height: AVATAR_POSICAO }}>
            <span
              className="w-full h-full rounded-full border grid place-items-center font-display font-bold"
              style={{
                fontSize: `calc(${AVATAR_POSICAO} * 0.36)`,
                borderColor: medalha(cor, 0.5),
                background: medalha(cor, 0.15),
                color: medalha(cor),
              }}
              title={item.nome}
            >
              {iniciais(item.nome)}
            </span>

            {/* SO DO 1o AO 3o: e o que faz a medalha significar alguma coisa.
                Um disco em toda posicao viraria enfeite, e a lista mostra mais
                de tres lugares quando a equipe cresce.

                DISCO SOLIDO, e nao um icone de medalha: esta e uma tela de
                PAREDE, lida a metros de distancia. O desenho de uma fita e de
                um pingente some nesse tamanho; um circulo cheio na cor do metal
                continua legivel do outro lado da sala.

                O degrade claro-para-escuro e o que faz o olho ler METAL em vez
                de "bolinha colorida" -- e a mesma leitura de brilho que uma
                medalha de verdade tem sob luz. */}
            {temMedalha && (
              <span
                className="absolute left-1/2 grid place-items-center rounded-full font-display font-extrabold tabular-nums"
                style={{
                  width: `calc(${AVATAR_POSICAO} * 0.46)`,
                  height: `calc(${AVATAR_POSICAO} * 0.46)`,
                  bottom: `calc(${AVATAR_POSICAO} * -0.12)`,
                  transform: 'translateX(-50%)',
                  fontSize: `calc(${AVATAR_POSICAO} * 0.26)`,
                  background: `linear-gradient(145deg, ${medalha(cor)}, ${medalha(cor, 0.72)})`,
                  // Anel na cor do fundo do painel: e ele que descola a medalha
                  // do avatar em vez de deixar os dois virarem uma mancha so.
                  boxShadow: '0 0 0 0.14em rgb(var(--grafite-900))',
                  color: 'rgb(var(--grafite-900))',
                }}
                title={`${posicao}º lugar`}
              >
                {posicao}
              </span>
            )}
          </span>

          <span className="flex-1 min-w-0">
            <span
              className="block truncate font-display font-semibold text-white leading-tight"
              style={T.posicaoNome}
              title={item.nome}
            >
              {nomeCurto(item.nome)}
            </span>
            <span className="block truncate text-slate-400 tabular-nums" style={T.apoio}>
              {item.atendimentos.valor} atend. ·{' '}
              {item.nota.conta ? `${nota1(item.nota.valor)} ★` : `${item.nota.amostra} de ${minimo} ★`} ·{' '}
              {duracao(item.agilidade.medioSeg)}
            </span>
          </span>

          <span className="shrink-0 flex items-baseline gap-1">
            <span className="font-display font-extrabold text-white tabular-nums" style={T.posicaoPontos}>
              {item.pontos}
            </span>
            <span className="text-slate-500" style={T.apoio}>pts</span>
          </span>
        </>
      )}
    </li>
  );
}

function Classificacao({ itens, aCaminho, minimo }) {
  // Posicao sem dono vira linha tracejada "em aberto", e nao some: com uma
  // pessoa so no ranking -- o comeco de qualquer mes -- uma lista de um item
  // nao se le como classificacao.
  const linhas = [0, 1, 2].map((i) => itens[i] || null);

  return (
    <section className="min-h-0 glass-panel border border-linha rounded-2xl p-4 xl:p-5 flex flex-col gap-3 overflow-hidden">
      <div className="flex items-center justify-between gap-3 shrink-0">
        <Rotulo icon={Medal}>Classificação do mês</Rotulo>
        <span className="shrink-0 text-slate-500 truncate" style={T.apoio}>
          atend. + nota×8 + agilidade
        </span>
      </div>

      <ol className="flex-1 min-h-0 flex flex-col gap-2">
        {linhas.map((item, i) => (
          <LinhaPosicao key={item?.nome || `vago-${i}`} posicao={i + 1} item={item} minimo={minimo} />
        ))}
      </ol>

      {/* QUEM ESTA A CAMINHO. So a contagem, nunca a nota -- mostrar a media de
          quem ainda nao entrou seria abolir o minimo pela porta dos fundos,
          porque o numero e o que a equipe compara. */}
      {aCaminho?.length > 0 && (
        <div className="shrink-0 flex items-center gap-2 flex-wrap border-t border-linha pt-2.5">
          <span className="text-slate-500" style={T.apoio}>A caminho da nota:</span>
          {aCaminho.map((p) => (
            <span
              key={p.nome}
              className="inline-flex items-baseline gap-1.5 rounded-full border border-linha-forte bg-grafite-600/50 px-2.5 py-0.5 text-slate-300"
              style={T.apoio}
            >
              <span className="font-display font-semibold text-texto">{nomeCurto(p.nome)}</span>
              <span className="tabular-nums text-slate-400">{p.amostra} de {minimo}</span>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function Kpi({ icon: Icon, rotulo, valor, sufixo, apoio, cor = 'text-white', barra = null }) {
  return (
    <div className="min-h-0 glass-panel border border-linha rounded-2xl p-3 xl:p-4 flex flex-col justify-between gap-1.5">
      <Rotulo icon={Icon}>{rotulo}</Rotulo>

      <div className="flex items-baseline gap-2 min-w-0">
        <span className={`font-display font-bold leading-none tabular-nums ${cor}`} style={T.kpi}>
          {valor}
        </span>
        {sufixo && (
          <span className="font-display font-semibold text-slate-500 tabular-nums" style={T.indicador}>
            {sufixo}
          </span>
        )}
      </div>

      {/* A barra so existe quando ha meta: sem meta definida, uma barra vazia
          numa TV sugere que a equipe esta a zero de alguma coisa. */}
      {barra != null && (
        <div className="h-1.5 xl:h-2 rounded-full bg-grafite-700 overflow-hidden shrink-0">
          <div
            className="h-full rounded-full bg-acao transition-[width] duration-700"
            style={{ width: `${barra}%` }}
          />
        </div>
      )}

      <div className="text-slate-400 leading-tight truncate" style={T.apoio}>{apoio}</div>
    </div>
  );
}

function CartaoDaFila({ conversa, agora }) {
  const u = urgencia(conversa.esperaDesde, agora);

  return (
    <li className={`shrink-0 border rounded-xl p-2 xl:p-2.5 flex items-center gap-2.5 ${u.linha}`}>
      <Avatar nome={conversa.cliente} size="md" fotoUrl={conversa.fotoUrl} />

      <div className="min-w-0 flex-1 flex flex-col gap-1">
        {/* SO O NOME, como na lista da Central.
            O telefone tinha uma linha propria aqui, e ela nao pagava o espaco
            que ocupava: para quem ja tem nome salvo, era um dado repetido logo
            abaixo do nome; para quem ainda nao tem, `cliente` JA cai no proprio
            numero -- e a linha virava o mesmo numero escrito duas vezes.
            E esta e uma tela de PAREDE: o numero do cliente ficava exposto a
            qualquer pessoa que passasse pelo escritorio, inclusive visitante. */}
        <div className="min-w-0">
          <p className="font-display font-semibold text-white leading-tight truncate" style={T.filaNome}>
            {conversa.cliente}
          </p>
        </div>

        {/* As mesmas badges do cartao da lista: quem olha a TV decide para quem
            vai a conversa, e saber a empresa (ou que ela ainda nao foi
            identificada) e o setor pedido e o que muda essa decisao. O numero do
            documento nunca vai para a parede. */}
        <div className="flex items-center gap-1.5 flex-wrap" style={T.rotulo}>
          {conversa.ticket && (
            <span className="inline-flex items-center font-mono font-bold px-1.5 py-0.5 rounded-md border border-linha-forte text-acao-200/90">
              {conversa.ticket}
            </span>
          )}
          <span
            className={`inline-flex items-center max-w-full truncate font-bold px-2 py-0.5 rounded-md border ${conversa.chip.classe}`}
            title={conversa.chip.titulo}
          >
            {conversa.chip.label}
          </span>
          {conversa.setor && (
            <span
              className={`inline-flex items-center font-bold px-2 py-0.5 rounded-md border ${conversa.setor.classe}`}
              title={
                conversa.setor.id === 'geral'
                  ? 'Ainda sem triagem: o cliente nao escolheu setor no menu'
                  : `Setor escolhido pelo cliente: ${conversa.setor.setor}`
              }
            >
              {conversa.setor.label}
            </span>
          )}
          {/* Numa fila de pendentes isto quase sempre esta vazio, mas quando
              aparece evita duas pessoas pegarem a mesma conversa. */}
          {conversa.atendente?.nome && (
            <span
              className="inline-flex items-center gap-1 font-bold px-2 py-0.5 rounded-md border bg-purple-500/15 text-purple-300 border-purple-500/30"
              title={`Atendendo: ${conversa.atendente.nome}${conversa.atendente.cargo ? ' (' + conversa.atendente.cargo + ')' : ''}`}
            >
              <UserCheck size={11} className="shrink-0" /> {conversa.atendente.nome}
            </span>
          )}
        </div>
      </div>

      <div className="shrink-0 flex flex-col items-end gap-1">
        <span className={`font-display font-bold tabular-nums leading-none ${u.tempo}`} style={T.filaTempo}>
          {tempoEspera(conversa.esperaDesde, agora)}
        </span>
        {conversa.naoLidas > 0 && (
          <span
            className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-espera text-grafite-900 font-extrabold flex items-center justify-center tabular-nums"
            style={T.rotulo}
          >
            {conversa.naoLidas > 99 ? '99+' : conversa.naoLidas}
          </span>
        )}
      </div>
    </li>
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
      setErro(true);
    }
  }, []);

  useEffect(() => {
    carregar();
    const id = setInterval(carregar, ATUALIZAR_MS);
    return () => clearInterval(id);
  }, [carregar]);

  // RELOGIO DE 1 SEGUNDO -- porque o mostrador tem segundos, e um relogio que
  // salta parece tela travada. O custo e um render por segundo: barato, porque
  // a fila chega pronta por prop e os numeros vem do estado.
  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // ESC fecha. Quem esta na frente da TV nao usa; quem abriu no computador
  // espera que funcione.
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
      <div className="fixed inset-0 z-[70] bg-grafite-900 flex flex-col gap-3 xl:gap-4 p-4 xl:p-6 overflow-hidden">
        <header className="flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 xl:gap-4 min-w-0">
            {/* A marca ao lado do titulo: esta tela fica pendurada numa parede
                que qualquer visitante ve, e ali ela representa a empresa. */}
            <img
              src="/arka_tecnologia_logo-removebg-preview.png"
              alt="Logo Arka Tecnologia"
              className="arka-logo w-auto shrink-0 object-contain"
              style={{ height: 'clamp(2rem, 5vh, 3.25rem)' }}
            />
            <div className="min-w-0">
              <h1 className="font-display font-bold text-white leading-none truncate" style={T.titulo}>
                Painel da Equipe
              </h1>
              <p className="text-slate-400 mt-1 truncate" style={T.apoio}>
                {dados
                  ? `Ranking do ${dados.periodo.rotulo} · atualiza sozinho a cada 30 segundos`
                  : 'atualiza sozinho a cada 30 segundos'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 xl:gap-4 shrink-0">
            {erro && dados && (
              <span className="flex items-center gap-1.5 text-espera-400" style={T.apoio} title="Mostrando o último quadro recebido">
                <WifiOff size={14} /> sem conexão
              </span>
            )}
            <div className="text-right leading-none">
              <div className="font-display font-bold text-white tabular-nums whitespace-nowrap" style={T.relogio}>
                {agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </div>
              <div className="text-slate-400 mt-1.5 whitespace-nowrap" style={T.apoio}>
                {dataPorExtenso(agora)}
              </div>
            </div>
            {/* O UNICO CONTROLE DA TELA -- existe para quem abriu no computador. */}
            <button
              type="button"
              onClick={onFechar}
              title="Sair do modo TV (ESC)"
              className="px-3 py-2 rounded-xl bg-grafite-600 hover:bg-grafite-500 text-texto font-bold flex items-center gap-2 transition-colors shrink-0"
              style={T.apoio}
            >
              <X size={16} /> <span className="hidden sm:inline">Sair</span>
            </button>
          </div>
        </header>

        {/* A EQUIPE OCUPA A TELA; A FILA OCUPA UM TRILHO.
            As duas metades FALHAM SEPARADO, de proposito: os numeros vem da API
            de indicadores e a fila vem da lista da Central. Um erro na API nao
            pode apagar a fila, que e a metade que exige acao. */}
        <div className="flex-1 min-h-0 flex flex-col xl:flex-row gap-3 xl:gap-4">
          {!dados ? (
            <section className="flex-1 min-h-0 glass-panel border border-linha rounded-2xl grid place-items-center text-center p-6">
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
            <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-3 xl:gap-4">
              <div className="flex-[3] min-h-0 grid grid-cols-1 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] gap-3 xl:gap-4">
                <DestaqueDoMes item={ranking.classificacao[0]} minimo={ranking.minimoAvaliacoes} />
                <Classificacao
                  itens={ranking.classificacao}
                  aCaminho={ranking.aCaminho}
                  minimo={ranking.minimoAvaliacoes}
                />
              </div>

              <div className="flex-1 min-h-0 grid grid-cols-2 xl:grid-cols-4 gap-3 xl:gap-4">
                <Kpi
                  icon={Star}
                  rotulo="Satisfação do mês"
                  valor={dados.csat.media != null ? nota1(dados.csat.media) : '—'}
                  apoio={dados.csat.total
                    ? `${dados.csat.total} ${dados.csat.total === 1 ? 'avaliação' : 'avaliações'}`
                    : 'sem avaliações ainda'}
                  cor="text-ativo-400"
                />
                <Kpi
                  icon={Target}
                  rotulo="Fechados hoje"
                  valor={dados.hoje.fechados}
                  sufixo={dados.hoje.meta ? `/ ${dados.hoje.meta}` : null}
                  barra={metaPct}
                  apoio={metaPct != null ? `${metaPct}% da meta do dia` : 'sem meta definida'}
                  cor="text-acao-400"
                />
                <Kpi
                  icon={Clock}
                  rotulo="Tempo até assumir"
                  valor={duracao(dados.tempos.assumirMedioSeg)}
                  apoio={`média de ${dados.tempos.assumirAmostra} no mês`}
                />
                <Kpi
                  icon={Clock}
                  rotulo="Tempo até resolver"
                  valor={duracao(dados.tempos.resolverMedioSeg)}
                  apoio={`média de ${dados.tempos.resolverAmostra} no mês`}
                />
              </div>
            </div>
          )}

          <aside className="shrink-0 min-h-0 flex flex-col gap-3 xl:gap-4 xl:w-[25%] xl:min-w-[330px] xl:max-w-[460px]">
            <section className="flex-1 min-h-0 glass-panel border border-linha rounded-2xl p-3 xl:p-4 flex flex-col gap-2.5">
              <div className="flex items-center justify-between gap-2 shrink-0">
                <Rotulo icon={Inbox}>Aguardando atendimento</Rotulo>
                <span
                  className={`font-display font-extrabold leading-none tabular-nums shrink-0 ${
                    fila.length ? 'text-espera-400' : 'text-slate-600'
                  }`}
                  style={T.filaNumero}
                >
                  {fila.length}
                </span>
              </div>

              {fila.length === 0 ? (
                <div className="flex-1 grid place-items-center text-center">
                  <div>
                    <p className="font-display font-bold text-ativo-400" style={T.destaqueNome}>Fila vazia</p>
                    <p className="text-slate-400 mt-1" style={T.apoio}>Nenhum cliente esperando.</p>
                  </div>
                </div>
              ) : (
                <ul className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5 pr-1">
                  {fila.map((c) => (
                    <CartaoDaFila key={c.id} conversa={c} agora={agora} />
                  ))}
                </ul>
              )}
            </section>

            {/* QUEM ESTA ONLINE -- sem altura fixa, com teto. Ele cresce com a
                equipe, mas nunca passa de 38% do trilho: numa equipe grande, uma
                lista de nomes empurraria a fila para fora da tela, e a fila e a
                metade que exige acao. */}
            {dados && (
              <section className="shrink-0 max-h-[38%] glass-panel border border-linha rounded-2xl p-3 xl:p-4 flex flex-col gap-2 overflow-hidden">
                <div className="flex items-center justify-between gap-2 shrink-0">
                  <Rotulo icon={Users}>Online agora</Rotulo>
                  <span className="text-slate-400 shrink-0" style={T.apoio}>{emAtendimento} em atendimento</span>
                </div>
                {dados.equipe.length === 0 ? (
                  <p className="text-slate-500 py-2" style={T.apoio}>Ninguém online no momento.</p>
                ) : (
                  <ul className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5 pr-1">
                    {dados.equipe.map((m) => (
                      <li key={m.id} className="flex items-center gap-2.5 shrink-0">
                        <span className="w-2 h-2 rounded-full bg-ativo shrink-0" />
                        <span
                          className="flex-1 min-w-0 truncate text-white font-display font-semibold leading-none"
                          style={T.onlineNome}
                        >
                          {nomeCurto(m.nome)}
                        </span>
                        <span className="text-slate-400 shrink-0 truncate" style={T.rotulo}>{m.cargo}</span>
                        <span
                          className="shrink-0 font-display font-bold text-white tabular-nums text-right leading-none"
                          style={{ ...T.onlineNome, minWidth: '2ch' }}
                        >
                          {m.abertas}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </aside>
        </div>
      </div>
    </Portal>
  );
}
