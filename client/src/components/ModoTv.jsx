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
 * ── A HIERARQUIA: O PODIO E O HEROI DA TELA ────────────────────────────────
 *
 * A primeira versao desta tela dividia o espaco meio a meio entre os numeros e
 * a fila, e dentro dos numeros o Top 3 era um cartao do mesmo tamanho dos
 * outros seis. O efeito na parede era o oposto do pretendido: o que mais
 * ocupava a tela era a fila (que quase sempre esta vazia) e o ranking passava
 * despercebido.
 *
 * Agora o podio ocupa TRES QUARTOS da altura da coluna da equipe, com degraus,
 * medalhas e o numero do lider no maior corpo da tela. A fila desceu para um
 * trilho estreito na direita. A troca e deliberada: a fila continua sendo a
 * metade que exige acao, mas ela se resolve com um numero e um tempo -- nao
 * precisa de meia tela para dizer "seis esperando, o mais antigo ha 22 min".
 *
 * A previa da mensagem saiu dos cartoes da fila junto com essa reducao. Era a
 * unica informacao ali que exigia LER, e nao apenas reconhecer -- e ninguem le
 * duas linhas de texto de tres metros. Foto, nome, telefone e as badges ficam:
 * sao o que faz alguem reconhecer o cliente e decidir quem pega a conversa.
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
import { Trophy, Star, Clock, Users, Inbox, Target, WifiOff, X, AlertCircle, UserCheck, Crown } from 'lucide-react';
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

// Iniciais para o avatar do podio.
//
// O `Avatar` da Central nao serve aqui por dois motivos: o maior tamanho que
// ele conhece e 48px (some numa parede), e a cor dele vem do hash do nome --
// no podio a cor precisa ser a da MEDALHA, senao o ouro do primeiro lugar
// briga com um circulo rosa. O ranking tambem nao traz foto: `_ranking` agrupa
// por `atendenteNome` e devolve so nome e valor.
function iniciais(completo) {
  const partes = String(completo || '').trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

// Ouro, prata e bronze vem do tema (ver `--medalha-*` em index.css), e nao de
// hex fixo: a TV do setor roda no tema CLARO, e a prata #B8C4CC sobre branco
// deixava o segundo lugar praticamente invisivel -- justo o contrario do que um
// podio existe para fazer.
const MEDALHAS = ['--medalha-1', '--medalha-2', '--medalha-3'];

const medalha = (variavel, opacidade = 1) => `rgb(var(${variavel}) / ${opacidade})`;

// ── o podio ────────────────────────────────────────────────────────────────

// A ORDEM VISUAL NAO E A ORDEM DA LISTA: 2o, 1o, 3o.
//
// O degrau mais alto fica no meio porque e ali que o olho cai primeiro numa
// tela grande, e porque e assim que um podio se parece com um podio. Renderizar
// 1-2-3 da esquerda para a direita transformaria os degraus numa escada
// descendente -- que se le como um grafico caindo, nao como uma disputa.
const ORDEM_PODIO = [1, 0, 2];

// Altura de cada degrau, em porcentagem da area do podio.
//
// Porcentagem, e nao pixel, porque esta tela abre em duas alturas muito
// diferentes: a TV de 1080p da parede e o notebook de quem esta conferindo.
// Com altura fixa, o degrau do lider ou sobra na TV ou estoura no notebook.
const ALTURA_DEGRAU = ['42%', '31%', '24%'];

function Degrau({ posicao, item, formatar, apoio, rotuloLider }) {
  const lider = posicao === 0;
  const cor = MEDALHAS[posicao] || '--quieto';

  return (
    <div className="h-full min-w-0 flex flex-col items-center justify-end gap-1.5 xl:gap-2.5">
      {lider && (
        <span
          className="flex items-center gap-1.5 text-[9px] xl:text-xs font-bold uppercase tracking-[0.14em] whitespace-nowrap"
          style={{ color: medalha(cor) }}
        >
          <Crown size={14} className="shrink-0" /> {rotuloLider}
        </span>
      )}

      <div
        className={`shrink-0 rounded-full border-[3px] grid place-items-center font-display font-bold ${
          lider ? 'w-16 h-16 xl:w-32 xl:h-32 text-lg xl:text-[2.6rem]' : 'w-12 h-12 xl:w-24 xl:h-24 text-sm xl:text-3xl'
        }`}
        style={{
          borderColor: medalha(cor),
          background: medalha(cor, 0.16),
          color: medalha(cor),
          boxShadow: lider ? `0 0 0 9px ${medalha(cor, 0.07)}` : undefined,
        }}
        title={item.nome}
      >
        {iniciais(item.nome)}
      </div>

      <p
        className={`w-full text-center truncate font-display font-semibold leading-tight ${
          lider ? 'text-white text-base xl:text-3xl' : 'text-texto text-sm xl:text-2xl'
        }`}
        title={item.nome}
      >
        {nomeCurto(item.nome)}
      </p>

      <p
        className={`font-display font-extrabold leading-none tabular-nums ${
          lider ? 'text-white text-3xl xl:text-[5.25rem]' : 'text-texto text-2xl xl:text-[3.6rem]'
        }`}
      >
        {formatar(item)}
      </p>

      {apoio && (
        <p className="text-[9px] xl:text-sm text-slate-400 leading-none truncate w-full text-center">
          {apoio(item)}
        </p>
      )}

      {/* O DEGRAU. Encosta no fundo do painel (por isso o `pb-0` no pai): um
          podio que flutua a 20px do chao nao se le como podio. */}
      <div
        className={`w-full shrink-0 rounded-t-xl border border-b-0 flex justify-center font-display font-extrabold tabular-nums pt-1.5 xl:pt-4 ${
          lider ? 'text-2xl xl:text-7xl' : 'text-xl xl:text-[3.5rem]'
        }`}
        style={{
          height: ALTURA_DEGRAU[posicao],
          borderColor: medalha(cor, 0.36),
          background: `linear-gradient(180deg, ${medalha(cor, 0.24)}, ${medalha(cor, 0.04)})`,
          color: medalha(cor, 0.85),
        }}
      >
        {posicao + 1}
      </div>
    </div>
  );
}

// O PODIO VAZIO AINDA E UM PODIO.
//
// Sem isto, um mes que ainda nao tem vencedor virava um painel enorme com uma
// frase solta no meio -- e o painel VAZIO e o que a parede mostra todo dia 1o,
// e no dia em que a operacao comeca. Desenhar os tres degraus apagados diz duas
// coisas de longe que a frase sozinha nao dizia: que aquele espaco e um podio, e
// que ele esta esperando alguem.
function DegrauVazio({ posicao }) {
  return (
    <div
      className="w-full self-end rounded-t-xl border border-b-0 border-dashed border-linha-forte flex justify-center pt-1.5 xl:pt-4 font-display font-extrabold tabular-nums text-slate-700 text-xl xl:text-[3.5rem]"
      style={{ height: ALTURA_DEGRAU[posicao] }}
    >
      {posicao + 1}
    </div>
  );
}

function Podio({ icon: Icon, corIcone, estiloIcone, titulo, nota, itens, formatar, apoio, rotuloLider, vazio, aCaminho, minimo }) {
  // Buracos viram celula vazia, e nao coluna faltando: com duas pessoas no
  // ranking, `filter(Boolean)` jogaria o lider para a esquerda e o segundo
  // lugar ficaria no meio, mais alto. Uma celula vazia mantem o ouro no centro.
  const colunas = ORDEM_PODIO.map((indice) => itens[indice] || null);

  return (
    <section className="min-h-0 glass-panel border border-linha rounded-2xl px-4 xl:px-6 pt-4 xl:pt-6 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2.5 shrink-0">
        <Icon size={20} className={corIcone} style={estiloIcone} />
        <span className="text-[11px] xl:text-[15px] font-bold uppercase tracking-[0.12em] text-slate-400 truncate">
          {titulo}
        </span>
        <span className="ml-auto text-[11px] xl:text-[13px] text-slate-500 shrink-0">{nota}</span>
      </div>

      {itens.length === 0 ? (
        <div className="flex-1 min-h-0 relative grid grid-cols-3 gap-2 xl:gap-3.5 items-end mt-3 xl:mt-4">
          {ORDEM_PODIO.map((posicao) => (
            <DegrauVazio key={posicao} posicao={posicao} />
          ))}
          <div className="absolute inset-x-0 top-[18%] px-6 flex flex-col items-center gap-3">
            <p className="text-center text-sm xl:text-lg text-slate-500 leading-snug">{vazio}</p>
            {/* QUEM ESTA A CAMINHO. So a contagem, nunca a nota -- mostrar a
                media de quem ainda nao entrou seria abolir o minimo pela porta
                dos fundos, porque o numero e o que a equipe compara. */}
            {aCaminho?.length > 0 && (
              <div className="flex flex-wrap justify-center gap-2">
                {aCaminho.map((p) => (
                  <span
                    key={p.nome}
                    className="inline-flex items-baseline gap-1.5 rounded-full border border-linha-forte bg-grafite-600/50 px-3 py-1 text-xs xl:text-base text-slate-300"
                  >
                    <span className="font-display font-semibold text-texto">{nomeCurto(p.nome)}</span>
                    <span className="tabular-nums text-slate-400">{p.amostra} de {minimo}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 grid grid-cols-3 gap-2 xl:gap-3.5 items-end mt-3 xl:mt-4">
          {/* Posicao ainda sem dono vira DEGRAU APAGADO, e nao celula em branco.
              Com uma pessoa so no ranking -- o comeco de qualquer mes -- a
              celula vazia deixava um degrau dourado solto no meio da tela, que
              nao se le como podio. O degrau apagado completa a forma e diz que
              o segundo e o terceiro lugar estao em aberto. */}
          {colunas.map((item, coluna) =>
            item ? (
              <Degrau
                key={item.nome}
                posicao={ORDEM_PODIO[coluna]}
                item={item}
                formatar={formatar}
                apoio={apoio}
                rotuloLider={rotuloLider}
              />
            ) : (
              <DegrauVazio key={`vago-${coluna}`} posicao={ORDEM_PODIO[coluna]} />
            )
          )}
        </div>
      )}
    </section>
  );
}

// ── pecas menores ──────────────────────────────────────────────────────────

function Kpi({ icon: Icon, rotulo, valor, sufixo, apoio, cor = 'text-white', barra = null }) {
  return (
    <div className="min-h-0 glass-panel border border-linha rounded-2xl p-4 xl:p-5 flex flex-col justify-between gap-2">
      <div className="flex items-center gap-2 text-slate-400">
        <Icon size={16} className="shrink-0" />
        <span className="text-[10px] xl:text-xs font-bold uppercase tracking-[0.12em] truncate">{rotulo}</span>
      </div>

      <div className="flex items-baseline gap-2.5 min-w-0">
        <span className={`font-display font-bold leading-none tabular-nums ${cor} text-4xl xl:text-6xl`}>
          {valor}
        </span>
        {sufixo && (
          <span className="font-display font-semibold text-slate-500 tabular-nums text-lg xl:text-3xl">
            {sufixo}
          </span>
        )}
      </div>

      {/* A BARRA SO EXISTE QUANDO HA META. Antes ela era um painel proprio, e
          sem meta definida uma barra vazia numa TV sugeria que a equipe estava
          a zero de alguma coisa. Dentro do cartao de "fechados hoje" ela nao
          consegue mais ser lida sozinha: ou aparece junto do numero, ou nao
          aparece. */}
      {barra != null && (
        <div className="h-2 rounded-full bg-grafite-700 overflow-hidden shrink-0">
          <div
            className="h-full rounded-full bg-acao transition-[width] duration-700"
            style={{ width: `${barra}%` }}
          />
        </div>
      )}

      <div className="text-[11px] xl:text-sm text-slate-400 leading-tight truncate">{apoio}</div>
    </div>
  );
}

function CartaoDaFila({ conversa, agora }) {
  const u = urgencia(conversa.esperaDesde, agora);

  return (
    <li className={`shrink-0 border rounded-xl p-2 xl:p-2.5 flex items-center gap-2.5 ${u.linha}`}>
      <Avatar nome={conversa.cliente} size="md" fotoUrl={conversa.fotoUrl} />

      <div className="min-w-0 flex-1 flex flex-col gap-1">
        <div className="min-w-0">
          <p className="font-display font-semibold text-white text-base xl:text-lg leading-tight truncate">
            {conversa.cliente}
          </p>
          <p className="text-[10px] xl:text-[11px] text-slate-400 font-mono leading-tight truncate">{conversa.telefone}</p>
        </div>

        {/* As mesmas badges do cartao da lista: quem olha a TV decide para quem
            vai a conversa, e saber a empresa (ou que ela ainda nao foi
            identificada) e o setor pedido e o que muda essa decisao. O numero do
            CNPJ nunca vai para a parede. */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {conversa.ticket && (
            <span className="inline-flex items-center text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-md border border-linha-forte text-acao-200/90">
              {conversa.ticket}
            </span>
          )}
          <span
            className={`inline-flex items-center max-w-full truncate text-[10px] font-bold px-2 py-0.5 rounded-md border ${conversa.chip.classe}`}
            title={conversa.chip.titulo}
          >
            {conversa.chip.label}
          </span>
          {conversa.setor && (
            <span
              className={`inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-md border ${conversa.setor.classe}`}
              title={
                conversa.setor.id === 'geral'
                  ? 'Ainda sem triagem: o cliente nao escolheu setor no menu'
                  : `Setor escolhido pelo cliente: ${conversa.setor.setor}`
              }
            >
              {conversa.setor.label}
            </span>
          )}
          {/* Numa fila de pendentes isto quase sempre esta vazio (conversa sem
              responsavel), mas quando aparece evita duas pessoas pegarem a
              mesma conversa. */}
          {conversa.atendente?.nome && (
            <span
              className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md border bg-purple-500/15 text-purple-300 border-purple-500/30"
              title={`Atendendo: ${conversa.atendente.nome}${conversa.atendente.cargo ? ' (' + conversa.atendente.cargo + ')' : ''}`}
            >
              <UserCheck size={11} className="shrink-0" /> {conversa.atendente.nome}
            </span>
          )}
        </div>
      </div>

      <div className="shrink-0 flex flex-col items-end gap-1.5">
        <span className={`font-display font-bold text-lg xl:text-2xl tabular-nums leading-none ${u.tempo}`}>
          {tempoEspera(conversa.esperaDesde, agora)}
        </span>
        {conversa.naoLidas > 0 && (
          <span className="min-w-[24px] h-[24px] px-1.5 rounded-full bg-espera text-grafite-900 text-xs font-extrabold flex items-center justify-center tabular-nums">
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

        {/* A EQUIPE OCUPA A TELA; A FILA OCUPA UM TRILHO. Em telas estreitas
            empilham; numa TV a coluna da equipe fica com tudo que sobrar e a
            fila com 470px fixos.

            AS DUAS FALHAM SEPARADO, de proposito: os numeros vem da API de
            indicadores e a fila vem da lista da Central. Antes um erro na API
            apagava a tela inteira -- inclusive a fila, que nao depende dela e e
            a metade que exige acao. */}
        <div className="flex-1 min-h-0 flex flex-col xl:flex-row gap-4">
          {/* ── A EQUIPE ───────────────────────────────────────────────────── */}
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
            <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-4">
              {/* OS PODIOS -- tres quartos da coluna. A proporcao e o assunto
                  desta tela: quem esta ganhando o mes precisa ser a primeira
                  coisa que alguem ve ao entrar na sala. */}
              <div className="flex-[3] min-h-0 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Podio
                  icon={Trophy}
                  estiloIcone={{ color: medalha(MEDALHAS[0]) }}
                  titulo="Mais atendimentos"
                  nota="mês corrente"
                  itens={ranking.porVolume}
                  formatar={(it) => it.valor}
                  apoio={() => 'atendimentos'}
                  rotuloLider="Líder do mês"
                  vazio="Nenhum atendimento fechado ainda neste mês."
                />
                <Podio
                  icon={Star}
                  corIcone="text-ativo-400"
                  titulo="Melhores notas"
                  nota={`mín. ${ranking.minimoAvaliacoes} avaliações`}
                  itens={ranking.porNota}
                  formatar={(it) => it.valor.toFixed(1).replace('.', ',')}
                  apoio={(it) => `${it.amostra} ${it.amostra === 1 ? 'avaliação' : 'avaliações'}`}
                  rotuloLider="Melhor nota"
                  aCaminho={ranking.aCaminho}
                  minimo={ranking.minimoAvaliacoes}
                  vazio={`Ninguém tem ${ranking.minimoAvaliacoes} avaliações ainda.`}
                />
              </div>

              {/* A FAIXA DE INDICADORES -- o quarto restante. Quatro numeros
                  lado a lado, todos do mesmo tamanho: nenhum deles e mais
                  importante que o podio, e entre si nao ha hierarquia. */}
              <div className="flex-1 min-h-0 grid grid-cols-2 xl:grid-cols-4 gap-4">
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

          {/* ── O TRILHO: FILA E QUEM ESTA ONLINE ──────────────────────────── */}
          <aside className="xl:w-[470px] shrink-0 min-h-0 flex flex-col gap-4">
            <section className="flex-1 min-h-0 glass-panel border border-linha rounded-2xl p-4 xl:p-5 flex flex-col gap-3">
              <div className="flex items-center justify-between shrink-0">
                <span className="flex items-center gap-2 text-slate-400">
                  <Inbox size={18} />
                  <span className="text-[11px] xl:text-[13px] font-bold uppercase tracking-[0.12em]">
                    Aguardando atendimento
                  </span>
                </span>
                <span
                  className={`font-display font-extrabold text-4xl xl:text-5xl leading-none tabular-nums ${
                    fila.length ? 'text-espera-400' : 'text-slate-600'
                  }`}
                >
                  {fila.length}
                </span>
              </div>

              {fila.length === 0 ? (
                <div className="flex-1 grid place-items-center text-center">
                  <div>
                    <p className="font-display font-bold text-ativo-400 text-2xl xl:text-3xl">Fila vazia</p>
                    <p className="text-sm text-slate-400 mt-1">Nenhum cliente esperando.</p>
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

            {/* QUEM ESTA ONLINE -- sem altura fixa, com teto.
                Ele cresce com a equipe, mas nunca passa de 40% do trilho: numa
                equipe grande, uma lista de nomes empurraria a fila para fora da
                tela, e a fila e a metade que exige acao. */}
            {dados && (
              <section className="shrink-0 max-h-[40%] glass-panel border border-linha rounded-2xl p-4 xl:p-5 flex flex-col gap-2.5 overflow-hidden">
                <div className="flex items-center justify-between text-slate-400 shrink-0">
                  <span className="flex items-center gap-2">
                    <Users size={18} />
                    <span className="text-[11px] xl:text-[13px] font-bold uppercase tracking-[0.12em]">Online agora</span>
                  </span>
                  <span className="text-xs">{emAtendimento} em atendimento</span>
                </div>
                {dados.equipe.length === 0 ? (
                  <p className="text-sm text-slate-500 py-2">Ninguém online no momento.</p>
                ) : (
                  <ul className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 pr-1">
                    {dados.equipe.map((m) => (
                      <li key={m.id} className="flex items-center gap-3 shrink-0">
                        <span className="w-2 h-2 rounded-full bg-ativo shrink-0" />
                        <span className="flex-1 min-w-0 truncate text-white font-display font-semibold text-base xl:text-xl leading-none">
                          {nomeCurto(m.nome)}
                        </span>
                        <span className="text-[11px] xl:text-xs text-slate-400 shrink-0">{m.cargo}</span>
                        <span className="shrink-0 font-display font-bold text-white text-lg xl:text-xl tabular-nums w-7 text-right leading-none">
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
