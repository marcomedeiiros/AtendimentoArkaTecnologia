/**
 * Agenda — o calendário é a tela, e não um seletor de dia.
 *
 * ── O QUE MUDOU, E POR QUÊ ──────────────────────────────────────────────────
 *
 * A versão anterior tinha um mini-calendário de bolinhas que servia só para
 * escolher uma data, e a lista mostrava UM dia por vez. Para responder "como
 * está a semana?" era preciso clicar dia a dia e guardar de cabeça — o
 * calendário sabia que havia algo naquele dia, mas não dizia o quê.
 *
 * Agora a grade do mês mostra os compromissos dentro dos dias, e o mês inteiro
 * se lê de uma vez. As duas visões respondem perguntas diferentes:
 *
 *   Calendário  "como está o mês?"   — distribuição, buracos, dias cheios
 *   Lista       "o que vem agora?"   — ordem, agrupada por dia, com o de hoje no topo
 *
 * O detalhe abre num painel lateral e não num modal que cobre tudo: quem está
 * conferindo uma agenda precisa continuar vendo a agenda enquanto lê um item.
 *
 * ── AS DUAS COISAS QUE VÊM DO SERVIDOR ──────────────────────────────────────
 *
 * O responsável (quem TEM DE FAZER) é campo do banco, diferente de quem criou.
 * E remarcar arrastando usa uma rota estreita (`PATCH /:id/data`), que não tem
 * como sobrescrever o resto do compromisso com o que a tela tinha em mãos.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  CalendarDays, Plus, Trash2, Save, X, Clock, List, LayoutGrid,
  CheckCircle2, Circle, ChevronLeft, ChevronRight, Search, Loader2, Users,
} from 'lucide-react';
import Portal from '../Portal';
// O avatar da equipe, com as regras que o painel inteiro já usa: iniciais do
// primeiro e do último nome, e cor escolhida por hash -- a mesma pessoa tem a
// mesma cor em toda a Central, e é isso que deixa reconhecê-la de relance.
import Avatar, { hexDoNome, iniciais } from '../Avatar';
import { AgendaAPI } from '../../services/api';
import { hojeISO, anoMesHoje, somarDias, FUSO_BR } from '../../utils/data';
import { avisar, confirmar } from '../../utils/dialogo';
import { useAuth } from '../../context/AuthContext';

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
               'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const DIAS_SEMANA = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

// `chip` é a classe do selo na Lista; `hex` é a cor sólida da pílula do
// calendário. O hex existe separado porque a pílula pinta com `style`: classe
// montada em tempo de execução não sobrevive à varredura do Tailwind, que só vê
// o que está escrito literalmente no arquivo.
const TIPOS = {
  reuniao:  { label: 'Reunião',   chip: 'bg-blue-500/20 text-blue-300 border-blue-500/30',       hex: '#93C5FD' },
  ligacao:  { label: 'Ligação',   chip: 'bg-ativo/20 text-ativo-400 border-ativo/30',            hex: '#4FE0BC' },
  tarefa:   { label: 'Tarefa',    chip: 'bg-espera/20 text-espera-400 border-espera/30',         hex: '#FFC24D' },
  followup: { label: 'Follow-up', chip: 'bg-purple-500/20 text-purple-300 border-purple-500/30', hex: '#D8B4FE' },
  lembrete: { label: 'Lembrete',  chip: 'bg-falha/20 text-falha-400 border-falha/30',            hex: '#F58A96' },
};

const PRIORIDADES = {
  alta:  { label: 'Alta',  dot: 'bg-falha-400',  hex: '#F58A96' },
  media: { label: 'Média', dot: 'bg-espera-400', hex: '#FFC24D' },
  baixa: { label: 'Baixa', dot: 'bg-slate-400',  hex: '#94A3B8' },
};

// As duas visões. Campos com nome, e não uma tupla posicional: `[id, Icone,
// texto]` obriga quem lê a contar posições para saber o que é o quê.
const VISOES = [
  { id: 'calendario', Icone: LayoutGrid, texto: 'Calendário' },
  { id: 'lista', Icone: List, texto: 'Lista' },
];

const tipoDe = (c) => TIPOS[c.tipo] || TIPOS.tarefa;
const prioridadeDe = (c) => PRIORIDADES[c.prioridade] || PRIORIDADES.media;

const iso = (ano, mes, dia) =>
  `${ano}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;

/**
 * As 6 semanas da grade — incluindo as sobras do mês vizinho.
 *
 * O calendário antigo deixava as sobras em branco, e a primeira semana ficava
 * com buracos à esquerda. Mostrar os dias vizinhos apagados dá a continuidade
 * que um mês real tem: a segunda-feira que fecha o mês anterior e a que abre o
 * próximo continuam sendo dias em que há compromisso.
 *
 * Sempre 6 linhas, mesmo que a última sobre: altura fixa faz a grade parar de
 * pular de tamanho quando se troca de mês.
 */
function gradeDoMes(ano, mes) {
  const primeiroDS = new Date(ano, mes, 1).getDay();
  const totalDias = new Date(ano, mes + 1, 0).getDate();
  const inicio = iso(ano, mes, 1);
  const celulas = [];
  for (let i = 0; i < 42; i++) {
    const deslocamento = i - primeiroDS;
    const dia = somarDias(inicio, deslocamento);
    celulas.push({
      iso: dia,
      numero: Number(dia.slice(8, 10)),
      doMes: deslocamento >= 0 && deslocamento < totalDias,
    });
  }
  return celulas;
}

/** "Hoje", "Amanhã", "Ontem" ou "sex, 19 de set" — o rótulo do grupo na Lista. */
function rotuloDoDia(diaISO) {
  const hoje = hojeISO();
  if (diaISO === hoje) return 'Hoje';
  if (diaISO === somarDias(hoje, 1)) return 'Amanhã';
  if (diaISO === somarDias(hoje, -1)) return 'Ontem';
  return new Date(`${diaISO}T12:00:00Z`).toLocaleDateString('pt-BR', {
    weekday: 'short', day: '2-digit', month: 'short', timeZone: FUSO_BR,
  });
}

// ───────────────────────────────────────────────────────── pílula do calendário

/**
 * DE ONDE VEM A COR DA PÍLULA.
 *
 * O calendário inteiro é recolorido por um critério escolhido na barra, como o
 * menu "Color:" do Asana. Nenhum destes exige coluna nova: os três campos já
 * existem no compromisso.
 *
 *   tipo         o que é (reunião, ligação, tarefa...)
 *   prioridade   o que é urgente -- o mês inteiro fica legível de longe
 *   responsavel  de quem é, com a MESMA cor que o avatar da pessoa usa
 *   fixa         sem código de cor; só a agenda, sem semáforo
 */
/**
 * A PALETA DA COR ESCOLHIDA À MÃO.
 *
 * O banco guarda o NOME ("azul"), e é aqui que ele vira cor. Foi essa separação
 * que permitiu retocar a paleta sem deixar hex velho preso no banco.
 *
 * São tons claros de propósito: a pílula é preenchida e o texto dela é escuro
 * (`text-grafite-900`), então a cor precisa ser o fundo claro do par. Um tom
 * escuro aqui devolveria texto escuro sobre fundo escuro.
 */
const PALETA = {
  azul:     { hex: '#93C5FD', rotulo: 'Azul' },
  verde:    { hex: '#4FE0BC', rotulo: 'Verde' },
  ambar:    { hex: '#FFC24D', rotulo: 'Âmbar' },
  roxo:     { hex: '#D8B4FE', rotulo: 'Roxo' },
  vermelho: { hex: '#F58A96', rotulo: 'Vermelho' },
  rosa:     { hex: '#F9A8D4', rotulo: 'Rosa' },
  ciano:    { hex: '#67E8F9', rotulo: 'Ciano' },
  cinza:    { hex: '#94A3B8', rotulo: 'Cinza' },
};

const POR_CRITERIO = {
  tipo: (c) => (TIPOS[c.tipo] || TIPOS.tarefa).hex,
  prioridade: (c) => (PRIORIDADES[c.prioridade] || PRIORIDADES.media).hex,
  responsavel: (c) => (c.responsavelNome ? hexDoNome(c.responsavelNome) : '#94A3B8'),
  fixa: () => '#00A884',
};

/**
 * ── A COR ESCOLHIDA À MÃO VENCE O CRITÉRIO ────────────────────────────────
 *
 * Primeiro eu fiz dela um critério a mais: a cor só aparecia com o calendário
 * em "cor escolhida à mão". O argumento era preservar a leitura do mês -- com
 * metade dos itens dizendo "urgência" e a outra metade dizendo "gostei de
 * roxo", nenhuma das duas leituras funciona.
 *
 * Só que na prática isso quebra a expectativa mais básica que existe: escolher
 * uma cor e o bloco não mudar. Quem escolhe está dizendo "este aqui é
 * diferente", e o sistema respondia "só se você mudar outra coisa antes".
 *
 * Então a regra é a simples: quem escolheu, mandou. O critério continua valendo
 * para todo o resto -- que é a maioria, porque escolher cor é a exceção.
 */
function corDoCompromisso(comp, criterio) {
  if (comp.cor && PALETA[comp.cor]) return PALETA[comp.cor].hex;
  return (POR_CRITERIO[criterio] || POR_CRITERIO.tipo)(comp);
}

const CRITERIOS_COR = [
  { id: 'tipo', rotulo: 'Cor por tipo' },
  { id: 'prioridade', rotulo: 'Cor por prioridade' },
  { id: 'responsavel', rotulo: 'Cor por responsável' },
  { id: 'fixa', rotulo: 'Uma cor só' },
];

/**
 * A legenda do critério ativo.
 *
 * Existe porque a pergunta "como eu mudo a cor?" foi feita -- e uma tela que
 * pinta as coisas sem dizer o que a cor significa obriga a perguntar. Some no
 * "uma cor só" (não há código a explicar) e no "por responsável" (a legenda
 * seria a lista da equipe inteira, que é longa e já está no próprio avatar).
 */
function LegendaDaCor({ criterio }) {
  const itens =
    criterio === 'tipo'
      ? Object.values(TIPOS).map((t) => ({ hex: t.hex, rotulo: t.label }))
      : criterio === 'prioridade'
        ? Object.values(PRIORIDADES).map((p) => ({ hex: p.hex, rotulo: p.label }))
        : null;

  if (!itens) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-1">
      {itens.map((i) => (
        <span key={i.rotulo} className="flex items-center gap-1.5 text-[10px] text-slate-400">
          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: i.hex }} />
          {i.rotulo}
        </span>
      ))}
      {/* Dito na própria legenda: sem isso, quem escolheu uma cor à mão olharia
          a chave, não acharia o seu roxo ali, e concluiria que a legenda está
          errada -- quando o que há é uma exceção legítima. */}
      <span className="text-[10px] text-slate-600">· cor escolhida à mão vence este critério</span>
    </div>
  );
}

/**
 * O compromisso dentro da célula do dia.
 *
 * ── A ORDEM DOS TRÊS PEDAÇOS NÃO É ESTÉTICA ───────────────────────────────
 *
 * Avatar, hora, título: as duas colunas de largura FIXA primeiro e o texto
 * variável por último. Assim as iniciais e o horário ficam alinhados de uma
 * linha para a outra, e dá para varrer a coluna do dia de cima a baixo
 * procurando "o que é meu" sem ler nada. Com o avatar à direita ele mudava de
 * posição conforme o tamanho do título, e a varredura se perdia.
 *
 * Arrastável: soltar em outro dia remarca. `draggable` só no ponteiro fino --
 * no toque o gesto compete com a rolagem, e um arraste acidental remarcaria o
 * compromisso de alguém sem querer.
 */
function PilulaCompromisso({ comp, cor, onAbrir, onArrastar, podeArrastar }) {
  return (
    // ── A ALCINHA VALE PARA QUALQUER COMPROMISSO, e não só para os longos ──
    //
    // Antes ela só existia na barra de vários dias. Para esticar um
    // compromisso normal era preciso abrir o painel e preencher "Termina em"
    // antes -- ou seja, para transformá-lo em barra era preciso que ele já
    // fosse uma. Puxar a borda direita de qualquer item agora estende o fim,
    // que é o gesto que a pessoa tenta primeiro.
    <div className="relative">
    <button
      draggable={podeArrastar}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        // `setData` é o que faz o Firefox aceitar o arraste; o id real vai pelo
        // estado do pai, porque o dataTransfer só se lê no drop.
        e.dataTransfer.setData('text/plain', comp.id);
        // SEMPRE `{ comp, modo }` -- nunca o compromisso cru. Quando as barras
        // de vários dias entraram, o drop passou a precisar saber se a pessoa
        // pegou o item ou a alcinha do fim, e esta chamada ficou para trás
        // mandando só o `comp`: `alvo.comp` virava undefined e o drop estourava
        // em silêncio. Arrastar parou de funcionar e nada apareceu na tela.
        onArrastar({ comp, modo: 'mover' });
      }}
      onClick={() => onAbrir(comp)}
      title={`${comp.hora} · ${comp.titulo}${comp.responsavelNome ? ` · ${comp.responsavelNome}` : ' · sem responsável'}`}
      style={{ backgroundColor: cor }}
      className={`w-full flex items-center gap-1.5 px-1.5 py-1 rounded-md text-left text-[10px] font-semibold leading-tight text-grafite-900 transition-opacity ${
        comp.concluido ? 'opacity-50' : 'hover:opacity-90'
      } ${podeArrastar ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      {/* ── O CÍRCULO AQUI É NEUTRO, e não o `<Avatar>` colorido ──────────────
          As iniciais são as mesmas (`iniciais` vem do próprio Avatar, para a
          regra de qual letra aparece ter uma casa só). O que muda é a cor: numa
          pílula já preenchida, o avatar com a cor da PESSOA coloca dois códigos
          de cor no mesmo objeto de 18px, e quem colore por responsável veria a
          mesma cor duas vezes. Aqui o círculo é um vazado escuro sobre a cor da
          pílula -- ele diz QUEM, e a pílula diz O QUÊ.

          ── E "SEM RESPONSÁVEL" NÃO VIRA UM PONTO MUDO ─────────────────────

          Era um círculo tracejado com um "·". Tecnicamente correto (ninguém foi
          atribuído), e inútil: quem acabou de criar o compromisso olha para o
          próprio item e não se reconhece nele. Um compromisso SEMPRE tem alguém
          por trás -- se não há responsável, há quem criou.

          Então o círculo cai para as iniciais de quem criou, com o contorno
          TRACEJADO mantido. É a diferença que importa: preenchido = alguém tem
          de fazer; tracejado = ninguém assumiu, e estas são as iniciais de quem
          marcou. O `title` diz a frase inteira, sem abreviação. */}
      <span
        title={
          comp.responsavelNome
            ? `Responsável: ${comp.responsavelNome}`
            : comp.usuarioNome
              ? `Sem responsável — criado por ${comp.usuarioNome}`
              : 'Sem responsável (do time)'
        }
        className={`shrink-0 w-[18px] h-[18px] rounded-full grid place-items-center leading-none font-bold ${
          comp.responsavelNome
            ? 'bg-black/15 border border-black/10 text-[8.5px]'
            : comp.usuarioNome
              ? 'border border-dashed border-black/35 text-black/50 text-[8.5px]'
              : 'border border-dashed border-black/30 text-black/40 text-[10px]'
        }`}>
        {comp.responsavelNome
          ? iniciais(comp.responsavelNome)
          : comp.usuarioNome
            ? iniciais(comp.usuarioNome)
            : '·'}
      </span>
      <span className="font-mono opacity-70 shrink-0">{comp.hora}</span>
      <span className={`truncate ${comp.concluido ? 'line-through' : ''}`}>{comp.titulo}</span>
    </button>

    {podeArrastar && (
      <span
        draggable
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', comp.id);
          onArrastar({ comp, modo: 'esticar' });
        }}
        onClick={() => onAbrir(comp)}
        title="Puxe para o compromisso durar mais dias"
        className="absolute right-0 top-0 h-full w-2.5 cursor-ew-resize rounded-r-md bg-black/0 hover:bg-black/25"
      />
    )}
    </div>
  );
}

/**
 * A barra do compromisso que atravessa dias.
 *
 * Diferente da pílula em duas coisas, e as duas de propósito:
 *
 *   sem hora     numa barra de quatro dias, "08:00" responde a pergunta errada
 *                -- o que importa é o intervalo, e ele está no próprio desenho
 *   com alcinha  a borda direita é uma área própria de arraste, que estica o
 *                fim sem mover o início
 *
 * O corte da virada de semana não arredonda: a ponta cortada fica reta, e é
 * isso que diz "continua na linha de baixo" em vez de "acabou aqui".
 */
function BarraCompromisso({ faixa, cor, podeArrastar, onAbrir, onArrastar }) {
  const { comp, coluna, largura, comecaAqui, terminaAqui } = faixa;

  return (
    <div
      className="pointer-events-auto mt-9 self-start px-0.5"
      style={{ gridColumn: `${coluna + 1} / span ${largura}` }}
    >
      <div className="relative">
        <button
          draggable={podeArrastar}
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', comp.id);
            onArrastar({ comp, modo: 'mover' });
          }}
          onClick={() => onAbrir(comp)}
          title={`${comp.titulo} · de ${comp.data} a ${comp.dataFim}`}
          style={{ backgroundColor: cor }}
          className={`w-full flex items-center gap-1.5 px-1.5 py-1 text-left text-[10px] font-semibold leading-tight text-grafite-900 transition-opacity ${
            comp.concluido ? 'opacity-50' : 'hover:opacity-90'
          } ${comecaAqui ? 'rounded-l-md' : ''} ${terminaAqui ? 'rounded-r-md' : ''} ${
            podeArrastar ? 'cursor-grab active:cursor-grabbing' : ''
          }`}
        >
          {comecaAqui && (
            <span
              title={comp.responsavelNome || (comp.usuarioNome ? `Sem responsável — criado por ${comp.usuarioNome}` : 'Sem responsável')}
              className={`shrink-0 w-[18px] h-[18px] rounded-full grid place-items-center leading-none font-bold text-[8.5px] ${
                comp.responsavelNome ? 'bg-black/15 border border-black/10' : 'border border-dashed border-black/35 text-black/50'
              }`}>
              {comp.responsavelNome
                ? iniciais(comp.responsavelNome)
                : comp.usuarioNome ? iniciais(comp.usuarioNome) : '·'}
            </span>
          )}
          <span className={`truncate ${comp.concluido ? 'line-through' : ''}`}>{comp.titulo}</span>
        </button>

        {/* A alcinha só existe na ponta que é o FIM de verdade: numa barra
            cortada pela virada da semana, puxar a borda do corte seria puxar um
            fim que não está ali. */}
        {terminaAqui && podeArrastar && (
          <span
            draggable
            onDragStart={(e) => {
              e.stopPropagation();
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', comp.id);
              onArrastar({ comp, modo: 'esticar' });
            }}
            onClick={() => onAbrir(comp)}
            title="Puxe para mudar o dia em que termina"
            className="absolute right-0 top-0 h-full w-2.5 cursor-ew-resize rounded-r-md bg-black/0 hover:bg-black/25"
          />
        )}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────── calendário

/** Semana ISO-8601 -- a que a operação chama de "semana 38". */
function numeroDaSemana(diaISO) {
  const d = new Date(`${diaISO}T12:00:00Z`);
  const alvo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  alvo.setUTCDate(alvo.getUTCDate() + 4 - (alvo.getUTCDay() || 7));
  const inicioAno = new Date(Date.UTC(alvo.getUTCFullYear(), 0, 1));
  return Math.ceil(((alvo - inicioAno) / 86400000 + 1) / 7);
}

function VisaoCalendario({
  ano, mes, compromissos, corDaPilula, comFimDeSemana, comNumeroDaSemana,
  onAbrir, onCriarEm, onRemarcar, onEsticar,
}) {
  const [arrastando, setArrastando] = useState(null);
  const [diaAlvo, setDiaAlvo] = useState(null);
  const hoje = hojeISO();

  // ── OS LONGOS SAEM DAS CÉLULAS E VIRAM BARRA ─────────────────────────────
  //
  // Um compromisso de 20 a 23 não é "um item no dia 20": ele ocupa quatro dias,
  // e é isso que a tela tem de mostrar. Desenhá-lo dentro da célula do dia 20
  // diria a coisa errada -- quem olhasse o dia 22 não veria nada acontecendo.
  //
  // Então a lista se divide em dois: os de um dia viram pílula dentro da
  // célula, e os longos viram uma faixa por cima da semana, atravessando as
  // colunas. Um compromisso que cruza a virada da semana aparece como duas
  // faixas (uma em cada linha), que é como todo calendário resolve isso.
  const { porDia, longos } = useMemo(() => {
    const mapa = new Map();
    const barras = [];
    for (const c of compromissos) {
      if (c.dataFim && c.dataFim > c.data) { barras.push(c); continue; }
      if (!mapa.has(c.data)) mapa.set(c.data, []);
      mapa.get(c.data).push(c);
    }
    for (const lista of mapa.values()) lista.sort((a, b) => a.hora.localeCompare(b.hora));
    return { porDia: mapa, longos: barras };
  }, [compromissos]);

  const celulas = useMemo(() => gradeDoMes(ano, mes), [ano, mes]);
  const podeArrastar = typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches;

  // Sábado e domingo fora: as 5 colunas restantes ganham ~40% de largura cada.
  // É o ajuste que mais melhora a leitura de quem não marca nada no fim de
  // semana -- e o mês continua inteiro, só sem as duas colunas vazias.
  const diasVisiveis = comFimDeSemana ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];
  const colunas = comFimDeSemana ? 'grid-cols-7' : 'grid-cols-5';
  const semanas = [0, 1, 2, 3, 4, 5];

  /**
   * O drop faz uma de DUAS coisas, conforme o que começou a ser arrastado.
   *
   *   mover     a barra inteira anda, mantendo a duração (o servidor desloca o
   *             fim junto -- ver `remarcar`)
   *   esticar   o início fica e o fim vai para o dia solto
   *
   * `arrastando` guarda o modo junto com o item, e não só o item: sem isso, o
   * drop não teria como saber se a pessoa pegou a barra ou a alcinha da borda.
   */
  function soltar(diaISO) {
    setDiaAlvo(null);
    const alvo = arrastando;
    setArrastando(null);
    if (!alvo) return;
    if (alvo.modo === 'esticar') {
      // Esticar para trás do início não existe: a alcinha é a do FIM.
      if (diaISO < alvo.comp.data) return;
      onEsticar(alvo.comp, diaISO);
      return;
    }
    if (alvo.comp.data === diaISO) return;
    onRemarcar(alvo.comp, diaISO);
  }

  /**
   * Os pedaços de uma barra dentro de UMA semana.
   *
   * Um compromisso de quinta a terça cruza a virada da semana, e vira dois
   * pedaços -- um em cada linha. `continua`/`continuaDepois` dizem qual das
   * pontas é o corte, para arredondar só a borda que é fim de verdade: uma
   * barra cortada com os dois cantos redondos pareceria dois compromissos.
   */
  function faixasDaSemana(semana) {
    const diasDaLinha = diasVisiveis.map((dow) => celulas[semana * 7 + dow].iso);
    const primeiro = diasDaLinha[0];
    const ultimo = diasDaLinha[diasDaLinha.length - 1];

    return longos
      .filter((c) => c.data <= ultimo && c.dataFim >= primeiro)
      .map((c) => {
        const inicioCol = diasDaLinha.findIndex((d) => d >= c.data);
        const fimCol = diasDaLinha.reduce((ultimoDentro, d, i) => (d <= c.dataFim ? i : ultimoDentro), 0);
        return {
          comp: c,
          coluna: Math.max(0, inicioCol),
          largura: Math.max(1, fimCol - Math.max(0, inicioCol) + 1),
          comecaAqui: c.data >= primeiro,
          terminaAqui: c.dataFim <= ultimo,
        };
      });
  }

  // ── AS COLUNAS NÃO QUEBRAM, MAS TAMBÉM NÃO ESPREMEM ─────────────────────
  //
  // Uma semana tem sete dias: virar duas colunas no celular não seria um
  // calendário, seria outra coisa. Mas sete colunas num telefone de 320px dão
  // 45px cada, e num chip de 45px não cabe "14:00 Reunião". Então a grade tem
  // largura mínima e o container rola de lado -- medido: 87px por célula, e a
  // página em si não rola na horizontal.
  //
  // A coluna do número da semana fica FORA da grade, numa faixa própria, para o
  // `grid-cols-7` continuar existindo como classe: é por ela que a verificação
  // de responsividade reconhece (e libera, com motivo escrito) esta grade.
  return (
    <div className="glass-panel rounded-2xl border border-linha overflow-hidden">
      <div className="overflow-x-auto">
      <div className="min-w-[38rem]">
        <div className="flex border-b border-linha bg-grafite-700/40">
          {comNumeroDaSemana && <div className="w-9 shrink-0 border-r border-linha/60" />}
          <div className={`flex-1 grid ${colunas}`}>
            {diasVisiveis.map((i) => (
              <div key={i} className="text-center text-[10px] font-bold text-slate-500 py-2">{DIAS_SEMANA[i]}</div>
            ))}
          </div>
        </div>

        {semanas.map((semana) => (
          <div key={semana} className="flex">
            {comNumeroDaSemana && (
              <div className="w-9 shrink-0 border-r border-b border-linha/60 pt-2 text-center text-[10px] font-mono text-slate-600">
                {numeroDaSemana(celulas[semana * 7].iso)}
              </div>
            )}
            <div className={`flex-1 grid ${colunas} auto-rows-fr relative`}>
              {/* ── AS BARRAS, POR CIMA DAS CÉLULAS ─────────────────────────
                  Uma grade sobreposta com as mesmas colunas: assim a faixa se
                  alinha exatamente com os dias que ela cobre, sem depender de
                  medir pixel. `pointer-events-none` na camada e `auto` na
                  barra -- senão a camada inteira roubaria o clique e o drop das
                  células que ela cobre. `mt-9` desce abaixo da linha do número
                  do dia. */}
              <div className={`absolute inset-0 grid ${colunas} pointer-events-none`}>
                {faixasDaSemana(semana).map((f) => (
                  <BarraCompromisso
                    key={f.comp.id + '-' + semana}
                    faixa={f}
                    cor={corDaPilula(f.comp)}
                    podeArrastar={podeArrastar}
                    onAbrir={onAbrir}
                    onArrastar={setArrastando}
                  />
                ))}
              </div>

              {diasVisiveis.map((dow) => {
                const cel = celulas[semana * 7 + dow];
                const doDia = porDia.get(cel.iso) || [];
                const ehHoje = cel.iso === hoje;
                const alvo = diaAlvo === cel.iso;
                // Três cabem sem a célula crescer; o resto vira "+N", que abre o
                // primeiro escondido em vez de espremer mais texto ilegível.
                const visiveis = doDia.slice(0, 3);
                const sobra = doDia.length - visiveis.length;

                return (
                  <div
                    key={cel.iso}
                    onDragOver={(e) => { if (arrastando) { e.preventDefault(); setDiaAlvo(cel.iso); } }}
                    onDragLeave={() => setDiaAlvo((d) => (d === cel.iso ? null : d))}
                    onDrop={(e) => { e.preventDefault(); soltar(cel.iso); }}
                    className={`min-h-[104px] border-b border-r border-linha/60 p-1.5 flex flex-col gap-1 transition-colors ${
                      cel.doMes ? '' : 'bg-grafite-800/40'
                    } ${alvo ? 'bg-acao/15 ring-1 ring-inset ring-acao/50' : ''}`}
                  >
                    <div className="flex items-center justify-between">
                      <button
                        onClick={() => onCriarEm(cel.iso)}
                        title="Novo compromisso neste dia"
                        className={`w-6 h-6 rounded-lg text-[11px] font-bold flex items-center justify-center transition-colors ${
                          ehHoje
                            ? 'bg-acao text-slate-950'
                            : cel.doMes
                              ? 'text-slate-300 hover:bg-grafite-600'
                              : 'text-slate-600 hover:bg-grafite-600'
                        }`}
                      >
                        {cel.numero}
                      </button>
                      {doDia.length > 0 && (
                        <span className="text-[9px] text-slate-600 font-mono pr-0.5">{doDia.length}</span>
                      )}
                    </div>

                    <div className="flex flex-col gap-0.5 min-h-0">
                      {visiveis.map((c) => (
                        <PilulaCompromisso
                          key={c.id}
                          comp={c}
                          cor={corDaPilula(c)}
                          onAbrir={onAbrir}
                          onArrastar={setArrastando}
                          podeArrastar={podeArrastar}
                        />
                      ))}
                      {sobra > 0 && (
                        <button
                          onClick={() => onAbrir(doDia[visiveis.length])}
                          className="text-[10px] text-slate-500 hover:text-acao-200 text-left px-1.5 font-semibold">
                          +{sobra} {sobra > 1 ? 'outros' : 'outro'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────── lista

function VisaoLista({ compromissos, onAbrir, onToggleConcluido }) {
  // Agrupa por dia preservando a ordem (a lista já chega ordenada).
  const grupos = useMemo(() => {
    const mapa = new Map();
    for (const c of compromissos) {
      if (!mapa.has(c.data)) mapa.set(c.data, []);
      mapa.get(c.data).push(c);
    }
    return [...mapa.entries()];
  }, [compromissos]);

  if (grupos.length === 0) return null;

  return (
    <div className="space-y-4">
      {grupos.map(([dia, itens]) => (
        <div key={dia} className="glass-panel rounded-2xl border border-linha overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 bg-grafite-700/40 border-b border-linha">
            <span className="text-xs font-bold text-white">
              {rotuloDoDia(dia)}
              <span className="ml-2 text-[10px] font-mono font-normal text-slate-500">{dia}</span>
            </span>
            <span className="text-[10px] text-slate-500">{itens.length}</span>
          </div>

          <div>
            {itens.map((c) => {
              const t = tipoDe(c);
              const p = prioridadeDe(c);
              return (
                <div key={c.id}
                  className="flex items-center gap-3 px-4 py-2.5 border-b border-linha/40 last:border-b-0 hover:bg-grafite-600/40 transition-colors">
                  <button onClick={() => onToggleConcluido(c.id)} className="shrink-0" title={c.concluido ? 'Reabrir' : 'Concluir'}>
                    {c.concluido
                      ? <CheckCircle2 size={15} className="text-ativo-400" />
                      : <Circle size={15} className="text-slate-500 hover:text-acao-200 transition-colors" />}
                  </button>

                  <button onClick={() => onAbrir(c)} className="flex-1 min-w-0 text-left">
                    <span className={`text-xs font-semibold ${c.concluido ? 'line-through text-slate-500' : 'text-white'}`}>
                      {c.titulo}
                    </span>
                    {c.contato && <span className="text-[10px] text-slate-500 ml-2">· {c.contato}</span>}
                  </button>

                  <span className={`hidden sm:inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold border shrink-0 ${t.chip}`}>
                    {t.label}
                  </span>
                  <span className="hidden md:flex items-center gap-1 text-[10px] text-slate-400 shrink-0" title={`Prioridade ${p.label}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${p.dot}`} /> {p.label}
                  </span>
                  <span className="flex items-center gap-1 text-[10px] text-slate-400 shrink-0 font-mono">
                    <Clock size={10} /> {c.hora}
                  </span>
                  {/* Sem responsável definido é um estado legítimo (lembrete do
                      time), e a tela diz isso em vez de um traço mudo. */}
                  {/* Aqui o avatar COLORIDO faz sentido: a linha da Lista não é
                      uma pílula pintada, então a cor da pessoa é a única cor do
                      elemento -- e é a mesma que ela tem em toda a Central. */}
                  <span className="hidden lg:flex items-center gap-1.5 text-[10px] shrink-0 w-32 truncate"
                    title={
                      c.responsavelNome
                        ? `Responsável: ${c.responsavelNome}`
                        : c.usuarioNome
                          ? `Sem responsável — criado por ${c.usuarioNome}`
                          : 'Sem responsável (do time)'
                    }>
                    {c.responsavelNome
                      ? <><Avatar nome={c.responsavelNome} size="xs" /> <span className="text-slate-300 truncate">{c.responsavelNome}</span></>
                      : <><Users size={10} className="text-slate-600 shrink-0" /> <span className="text-slate-600">do time</span></>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ───────────────────────────────────────────────────────────── painel lateral

/**
 * Detalhe e edição, numa gaveta à direita.
 *
 * Era um modal centralizado que cobria a agenda inteira. Num painel lateral, a
 * grade continua visível ao lado: dá para conferir "esse dia já tem três
 * coisas" enquanto se marca a quarta, que era justamente o que o modal
 * escondia. No celular ele ocupa a largura toda, porque ali não há "ao lado".
 */
function PainelCompromisso({ compromisso, pessoas, onSalvar, onRemover, onFechar, salvando }) {
  const novo = !compromisso?.id;
  const [titulo, setTitulo] = useState(compromisso?.titulo || '');
  const [data, setData] = useState(compromisso?.data || hojeISO());
  const [hora, setHora] = useState(compromisso?.hora || '09:00');
  const [tipo, setTipo] = useState(compromisso?.tipo || 'reuniao');
  const [prioridade, setPrioridade] = useState(compromisso?.prioridade || 'media');
  const [responsavelId, setResponsavelId] = useState(compromisso?.responsavelId || '');
  const [cor, setCor] = useState(compromisso?.cor || '');
  const [dataFim, setDataFim] = useState(compromisso?.dataFim || '');
  const [descricao, setDescricao] = useState(compromisso?.descricao || '');
  const [contato, setContato] = useState(compromisso?.contato || '');

  // Esc fecha: é a saída que todo painel tem de ter, e sem ela a única forma de
  // sair é acertar o X.
  useEffect(() => {
    const aoTeclar = (e) => { if (e.key === 'Escape' && !salvando) onFechar(); };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [onFechar, salvando]);

  function salvar() {
    if (!titulo.trim() || !data) return;
    onSalvar({
      titulo: titulo.trim(),
      data,
      hora,
      tipo,
      prioridade,
      // Vazio no seletor = sem responsável, e isso vai como `null` explícito:
      // string vazia não passaria na validação de uuid do servidor.
      responsavelId: responsavelId || null,
      // Vazio = automática. Vai como `null` explícito: string vazia não passa
      // na lista fechada do servidor.
      cor: cor || null,
      // Vazio = de um dia só. Vai como `null`, e não string vazia: o servidor
      // normaliza fim igual ao início para null pela mesma razão.
      dataFim: dataFim || null,
      descricao: descricao.trim(),
      contato: contato.trim(),
      concluido: compromisso?.concluido || false,
    });
  }

  const campo = 'w-full bg-grafite-700 border border-linha rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-acao/50';
  const rotulo = 'text-xs text-slate-400 font-medium block mb-1.5';

  return (
    // ── PORTAL: O `space-y-4` DA TELA ESTAVA EMPURRANDO O MODAL ──────────────
    //
    // A raiz da Agenda é `<div className="fade-in space-y-4">`, e `space-y-4` é
    // a regra `.space-y-4 > :not([hidden]) ~ :not([hidden]) { margin-top: 1rem }`.
    // O modal, sendo filho dali, levava esse `margin-top: 16px` -- e a regra tem
    // especificidade (0,3,0) contra (0,1,0) do `sm:m-auto`, então ela VENCE e a
    // margem automática que centraliza na vertical é descartada.
    //
    // O resultado, medido: `margin-top: 16px` e `margin-bottom: 0`, com o cartão
    // colado no topo e a sobra inteira embaixo. O véu pegava a mesma margem e
    // começava 16px abaixo, deixando uma faixa da tela sem escurecer.
    //
    // Renderizar no `<body>` tira o modal de dentro do `space-y` e devolve a
    // margem automática: medido depois, `margin-top: 324.5px` calculado sozinho,
    // folga igual em cima e embaixo, e o véu cobrindo a janela inteira.
    //
    // (Não era o `transform` do `.fade-in` virando bloco de contenção, que é a
    // suspeita óbvia: `getComputedStyle` devolve `transform: none` ali, e um
    // `fixed` inserido em cada nível acima mediu a janela inteira -- só dentro
    // do `space-y-4` é que a medida mudava.)
    //
    // O invólucro do Portal ainda carrega `data-portal-modal`, que os atalhos
    // globais de teclado consultam para não agir por baixo de um modal aberto.
    <Portal>
      {/* ── CENTRALIZADO, E NÃO ENCOSTADO NA DIREITA ─────────────────────────
          Ele nasceu lateral para a agenda continuar visível ao lado enquanto se
          lê um item. Na prática a preferência foi outra: pop-up no meio da
          tela. Então o véu passa a valer em TODA largura -- um cartão flutuando
          no centro sobre a agenda acesa não se destaca de nada, e o escurecido
          é o que diz "resolva isto antes de voltar".

          A altura continua sendo a do conteúdo (`h-fit` com teto), que foi o
          conserto do vazio de ~350px entre a última pergunta e os botões. No
          celular segue a gaveta de tela cheia: ali margem só roubaria espaço de
          digitação. */}
      <div onClick={() => !salvando && onFechar()}
        className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-40" />

      <aside className="fixed z-50 glass-panel shadow-2xl flex flex-col
                        inset-0 w-full h-dvh border-l border-linha
                        sm:inset-0 sm:m-auto sm:h-fit sm:max-h-[calc(100dvh-2rem)]
                        sm:w-[26rem] sm:rounded-2xl sm:border sm:border-linha">
        <div className="p-4 bg-grafite-600 border-b border-linha flex items-center justify-between shrink-0 sm:rounded-t-2xl">
          <div className="flex items-center gap-2 font-bold text-sm text-white min-w-0">
            <CalendarDays size={16} className="text-acao-200 shrink-0" />
            <span className="truncate">{novo ? 'Novo compromisso' : 'Compromisso'}</span>
          </div>
          <button onClick={onFechar} className="text-slate-400 hover:text-white transition-colors shrink-0 ml-2">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-4 flex-1 overflow-y-auto min-h-0">
          <div>
            <label className={rotulo}>Título *</label>
            <input value={titulo} onChange={(e) => setTitulo(e.target.value)} autoFocus
              placeholder="Ex: Reunião com cliente Arka..." className={campo} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={rotulo}>Data *</label>
              <input type="date" value={data} onChange={(e) => setData(e.target.value)} className={campo} />
            </div>
            <div>
              <label className={rotulo}>Horário</label>
              <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} className={campo} />
            </div>
          </div>

          {/* ── QUANDO TERMINA ───────────────────────────────────────────────
              Vazio = de um dia só, que é a esmagadora maioria -- por isso o
              campo não vem preenchido com a data de início: preenchido, ele
              diria que todo compromisso é longo.

              `min` no próprio input impede escolher um fim antes do começo sem
              precisar de mensagem de erro. O servidor recusa igual, porque a
              tela não é a barreira. */}
          <div>
            <label className={rotulo}>Termina em <span className="text-slate-600 font-normal">· opcional</span></label>
            <div className="flex items-center gap-2">
              <input type="date" value={dataFim} min={data}
                onChange={(e) => setDataFim(e.target.value)} className={campo} />
              {dataFim && (
                <button type="button" onClick={() => setDataFim('')}
                  title="Voltar a ser de um dia só"
                  className="shrink-0 px-2.5 py-2.5 rounded-xl bg-grafite-700 border border-linha text-slate-400 hover:text-white text-[11px] font-semibold transition-colors">
                  Um dia
                </button>
              )}
            </div>
            <p className="text-[10px] text-slate-500 mt-1">
              Atravessa dias no calendário — e dá para puxar a borda da barra para mudar.
            </p>
          </div>

          <div>
            <label className={rotulo}>Responsável</label>
            <select value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)} className={campo}>
              <option value="">Sem responsável (do time)</option>
              {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
            <p className="text-[10px] text-slate-500 mt-1">Quem tem de fazer — diferente de quem criou.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={rotulo}>Tipo</label>
              <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={campo}>
                {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label className={rotulo}>Prioridade</label>
              <select value={prioridade} onChange={(e) => setPrioridade(e.target.value)} className={campo}>
                {Object.entries(PRIORIDADES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
          </div>

          {/* ── COR À MÃO ────────────────────────────────────────────────────
              Amostras, e não um seletor de cor livre: são as oito cores que já
              foram medidas contra o texto escuro da pílula e contra os dois
              temas. O servidor recusa qualquer outra, então um campo livre aqui
              só criaria a chance de escolher algo que seria rejeitado.

              "Automática" é o padrão, e não uma opção escondida no fim: a cor
              derivada do tipo ou da prioridade é o que faz o mês ser legível de
              longe, e escolher à mão é a exceção. */}
          <div>
            <label className={rotulo}>Cor</label>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setCor('')}
                title="Usar a cor que o calendário definir (tipo, prioridade ou responsável)"
                className={`h-7 px-2.5 rounded-lg text-[10px] font-semibold border transition-colors ${
                  cor === ''
                    ? 'bg-acao/15 border-acao/40 text-acao-200'
                    : 'bg-grafite-700 border-linha text-slate-400 hover:text-slate-200'
                }`}>
                Automática
              </button>
              {Object.entries(PALETA).map(([id, p]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setCor(id)}
                  title={p.rotulo}
                  aria-label={p.rotulo}
                  aria-pressed={cor === id}
                  style={{ backgroundColor: p.hex }}
                  className={`w-7 h-7 rounded-lg border-2 transition-transform ${
                    cor === id ? 'border-white scale-105' : 'border-transparent hover:scale-105'
                  }`}
                />
              ))}
            </div>
            <p className="text-[10px] text-slate-500 mt-1.5">
              Vence o critério de cor do calendário. <strong className="font-semibold text-slate-400">Automática</strong> devolve a cor ao critério.
            </p>
          </div>

          <div>
            <label className={rotulo}>Contato / Cliente</label>
            <input value={contato} onChange={(e) => setContato(e.target.value)}
              placeholder="Nome do cliente..." className={campo} />
          </div>

          <div>
            <label className={rotulo}>Descrição</label>
            <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={4}
              placeholder="Detalhes do compromisso..." className={`${campo} resize-none`} />
          </div>

          {!novo && compromisso?.usuarioNome && (
            <p className="text-[10px] text-slate-500 pt-1">Criado por {compromisso.usuarioNome}.</p>
          )}
        </div>

        <div className="p-4 bg-grafite-600 border-t border-linha flex items-center gap-2 shrink-0 sm:rounded-b-2xl">
          {!novo && (
            <button onClick={() => onRemover(compromisso.id)}
              title="Remover compromisso"
              className="p-2 rounded-lg bg-slate-800 text-falha-400 hover:bg-slate-700 transition-colors shrink-0">
              <Trash2 size={14} />
            </button>
          )}
          <button onClick={onFechar}
            className="flex-1 px-3 py-2 rounded-lg bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700 transition-colors">
            Cancelar
          </button>
          <button onClick={salvar} disabled={!titulo.trim() || !data || salvando}
            className="flex-1 px-4 py-2 rounded-lg bg-acao hover:bg-acao-200 text-slate-950 text-xs font-bold flex items-center justify-center gap-1.5 shadow-md shadow-acao/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
            {salvando ? <><Loader2 size={13} className="animate-spin" /> Salvando...</> : <><Save size={13} /> Salvar</>}
          </button>
        </div>
      </aside>
    </Portal>
  );
}

// ────────────────────────────────────────────────────────────────────── tela

const ordenar = (lista) =>
  [...lista].sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora));

export default function Agenda() {
  const { usuario } = useAuth();
  const [compromissos, setCompromissos] = useState([]);
  const [pessoas, setPessoas] = useState([]);
  const [visao, setVisao] = useState('calendario'); // 'calendario' | 'lista'
  const [{ ano, mes }, setMesAtual] = useState(() => anoMesHoje());
  const [aberto, setAberto] = useState(null); // compromisso no painel (ou rascunho)
  const [busca, setBusca] = useState('');
  const [filtroResponsavel, setFiltroResponsavel] = useState(''); // '' | 'meus' | 'sem' | id
  const [filtroTipo, setFiltroTipo] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('pendentes'); // '' | 'pendentes' | 'concluidos'
  // Como o mês é PINTADO e o que ele mostra. Não são filtros -- não escondem
  // nada; mudam a leitura do mesmo conjunto.
  const [criterioCor, setCriterioCor] = useState('tipo');
  const [comFimDeSemana, setComFimDeSemana] = useState(true);
  const [comNumeroDaSemana, setComNumeroDaSemana] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  const carregarLista = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      setCompromissos(ordenar(await AgendaAPI.listar()));
    } catch (e) {
      setErro(e.message || 'Não foi possível carregar a agenda.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregarLista(); }, [carregarLista]);

  // Quem pode ser responsável. Falha em silêncio de propósito: sem a lista, o
  // seletor fica só com "sem responsável" e o resto da tela continua inteiro --
  // não é motivo para bloquear a agenda.
  useEffect(() => {
    let vivo = true;
    AgendaAPI.pessoas()
      .then((lista) => { if (vivo && Array.isArray(lista)) setPessoas(lista); })
      .catch(() => {});
    return () => { vivo = false; };
  }, []);

  function navMes(delta) {
    setMesAtual(({ ano: a, mes: m }) => {
      const nm = m + delta;
      if (nm > 11) return { ano: a + 1, mes: 0 };
      if (nm < 0) return { ano: a - 1, mes: 11 };
      return { ano: a, mes: nm };
    });
  }

  async function salvarCompromisso(payload) {
    setSalvando(true);
    try {
      if (aberto?.id) {
        const atualizado = await AgendaAPI.atualizar(aberto.id, payload);
        setCompromissos((prev) => ordenar(prev.map((c) => (c.id === atualizado.id ? atualizado : c))));
      } else {
        const criado = await AgendaAPI.criar(payload);
        setCompromissos((prev) => ordenar([...prev, criado]));
      }
      setAberto(null);
    } catch (e) {
      avisar('Não foi possível salvar: ' + (e.message || 'erro desconhecido'));
    } finally {
      setSalvando(false);
    }
  }

  async function removerCompromisso(id) {
    if (!(await confirmar('Remover este compromisso? Isso vale para toda a equipe.', {
      titulo: 'Remover compromisso', rotuloConfirmar: 'Remover', perigo: true,
    }))) return;
    const anterior = compromissos;
    setCompromissos((prev) => prev.filter((c) => c.id !== id)); // otimista
    setAberto(null);
    try {
      await AgendaAPI.remover(id);
    } catch (e) {
      setCompromissos(anterior); // desfaz
      avisar('Não foi possível remover: ' + (e.message || 'erro desconhecido'));
    }
  }

  async function toggleConcluido(id) {
    const alvo = compromissos.find((c) => c.id === id);
    if (!alvo) return;
    const novo = !alvo.concluido;
    setCompromissos((prev) => prev.map((c) => (c.id === id ? { ...c, concluido: novo } : c)));
    try {
      await AgendaAPI.definirConcluido(id, novo);
    } catch {
      setCompromissos((prev) => prev.map((c) => (c.id === id ? { ...c, concluido: !novo } : c)));
    }
  }

  /**
   * Arrastar para outro dia.
   *
   * Otimista, porque o gesto tem de parecer instantâneo -- e com desfazer, que
   * é o que o otimismo cobra: se o servidor recusar, o item volta para o dia de
   * onde saiu e a pessoa fica sabendo, em vez de continuar vendo uma data que
   * não existe no banco.
   */
  /**
   * Esticar a barra puxando a alcinha da borda.
   *
   * Otimista como o remarcar, e com o mesmo desfazer. Soltar no próprio dia de
   * início encurta para um dia só -- o servidor normaliza `dataFim === data`
   * para `null`, e é por isso que a tela manda a data solta sem tratar o caso.
   */
  async function esticar(comp, novoFim) {
    const anterior = comp.dataFim;
    setCompromissos((prev) => prev.map((c) => (c.id === comp.id ? { ...c, dataFim: novoFim } : c)));
    try {
      const atualizado = await AgendaAPI.esticar(comp.id, novoFim);
      setCompromissos((prev) => ordenar(prev.map((c) => (c.id === atualizado.id ? atualizado : c))));
    } catch (e) {
      setCompromissos((prev) => prev.map((c) => (c.id === comp.id ? { ...c, dataFim: anterior } : c)));
      avisar('Não foi possível mudar o fim: ' + (e.message || 'erro desconhecido'));
    }
  }

  async function remarcar(comp, novaData) {
    const anterior = comp.data;
    setCompromissos((prev) => ordenar(prev.map((c) => (c.id === comp.id ? { ...c, data: novaData } : c))));
    try {
      const atualizado = await AgendaAPI.remarcar(comp.id, novaData);
      setCompromissos((prev) => ordenar(prev.map((c) => (c.id === atualizado.id ? atualizado : c))));
    } catch (e) {
      setCompromissos((prev) => ordenar(prev.map((c) => (c.id === comp.id ? { ...c, data: anterior } : c))));
      avisar('Não foi possível remarcar: ' + (e.message || 'erro desconhecido'));
    }
  }

  // Filtros valem para as DUAS visões: o que se vê no calendário é o mesmo
  // conjunto que se vê na lista, senão trocar de visão mudaria a resposta.
  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return compromissos.filter((c) => {
      if (filtroTipo && c.tipo !== filtroTipo) return false;
      if (filtroStatus === 'pendentes' && c.concluido) return false;
      if (filtroStatus === 'concluidos' && !c.concluido) return false;
      if (filtroResponsavel === 'meus' && c.responsavelId !== usuario?.id) return false;
      if (filtroResponsavel === 'sem' && c.responsavelId) return false;
      if (filtroResponsavel && !['meus', 'sem'].includes(filtroResponsavel)
          && c.responsavelId !== filtroResponsavel) return false;
      if (termo) {
        const alvo = `${c.titulo} ${c.contato || ''} ${c.descricao || ''} ${c.responsavelNome || ''}`.toLowerCase();
        if (!alvo.includes(termo)) return false;
      }
      return true;
    });
  }, [compromissos, busca, filtroTipo, filtroStatus, filtroResponsavel, usuario]);

  // O calendário mostra o mês navegado; a lista mostra de hoje em diante, que é
  // a pergunta dela ("o que vem agora?"). Uma lista do mês inteiro traria
  // dezenas de linhas já passadas antes da primeira que importa.
  const doMes = useMemo(() => {
    const prefixo = `${ano}-${String(mes + 1).padStart(2, '0')}`;
    return filtrados.filter((c) => c.data.startsWith(prefixo));
  }, [filtrados, ano, mes]);

  const daLista = useMemo(() => {
    const hoje = hojeISO();
    return filtrados.filter((c) => c.data >= hoje);
  }, [filtrados]);

  const pendentes = compromissos.filter((c) => !c.concluido && c.data >= hojeISO()).length;
  const selecao = 'bg-grafite-700 border border-linha rounded-xl px-2.5 py-1.5 text-[11px] text-white focus:outline-none focus:border-acao/50';

  return (
    <div className="fade-in space-y-4">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight font-display">Agenda</h1>
          <p className="text-slate-400 text-xs mt-0.5">
            Compromissos, follow-ups e tarefas da equipe
            {pendentes > 0 && <span className="ml-2 text-acao-200 font-semibold">{pendentes} pendente{pendentes > 1 ? 's' : ''}</span>}
          </p>
        </div>
        <button onClick={() => setAberto({ data: hojeISO() })}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-acao hover:bg-acao-200 text-slate-950 text-xs font-bold shadow-md shadow-acao/20 transition-all shrink-0">
          <Plus size={14} /> Novo compromisso
        </button>
      </div>

      {/* Barra: visão, mês e filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-xl bg-grafite-700 border border-linha p-0.5 shrink-0">
          {VISOES.map(({ id, Icone, texto }) => (
            <button key={id} onClick={() => setVisao(id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                visao === id ? 'bg-acao text-slate-950' : 'text-slate-400 hover:text-white'
              }`}>
              <Icone size={12} /> {texto}
            </button>
          ))}
        </div>

        {visao === 'calendario' && (
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => navMes(-1)} className="p-1.5 rounded-lg hover:bg-grafite-600 text-slate-400 hover:text-white transition-colors"><ChevronLeft size={14} /></button>
            <span className="text-xs font-bold text-white w-32 text-center">{MESES[mes]} {ano}</span>
            <button onClick={() => navMes(1)} className="p-1.5 rounded-lg hover:bg-grafite-600 text-slate-400 hover:text-white transition-colors"><ChevronRight size={14} /></button>
            <button onClick={() => setMesAtual(anoMesHoje())}
              className="ml-1 px-2.5 py-1 rounded-lg bg-grafite-700 border border-linha text-[11px] font-semibold text-slate-300 hover:text-white transition-colors">
              Hoje
            </button>
          </div>
        )}

        <div className="relative flex-1 min-w-[10rem]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar compromisso..."
            className="w-full bg-grafite-700 border border-linha rounded-xl pl-8 pr-3 py-1.5 text-[11px] text-white placeholder-slate-500 focus:outline-none focus:border-acao/50" />
        </div>

        <select value={filtroResponsavel} onChange={(e) => setFiltroResponsavel(e.target.value)} className={selecao}>
          <option value="">Todos os responsáveis</option>
          <option value="meus">Só os meus</option>
          <option value="sem">Sem responsável</option>
          {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>

        <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} className={selecao}>
          <option value="">Todos os tipos</option>
          {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>

        <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)} className={selecao}>
          <option value="pendentes">Pendentes</option>
          <option value="concluidos">Concluídos</option>
          <option value="">Todos</option>
        </select>

        {/* Só no calendário: a Lista não é pintada por critério nem tem colunas
            de dia da semana, então estes três controles não teriam o que fazer
            lá -- e um controle que não faz nada é pior que um controle a menos. */}
        {visao === 'calendario' && (
          <>
            <select value={criterioCor} onChange={(e) => setCriterioCor(e.target.value)}
              title="Por qual campo o mês é colorido" className={selecao}>
              {CRITERIOS_COR.map((c) => <option key={c.id} value={c.id}>{c.rotulo}</option>)}
            </select>

            <button
              onClick={() => setComFimDeSemana((v) => !v)}
              aria-pressed={comFimDeSemana}
              title="Mostrar ou esconder sábado e domingo"
              className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold transition-colors ${
                comFimDeSemana
                  ? 'bg-grafite-700 border-linha text-slate-300 hover:text-white'
                  : 'bg-acao/15 border-acao/30 text-acao-200'
              }`}>
              {comFimDeSemana ? 'Fim de semana' : 'Só dias úteis'}
            </button>

            <button
              onClick={() => setComNumeroDaSemana((v) => !v)}
              aria-pressed={comNumeroDaSemana}
              title="Coluna com o número da semana do ano"
              className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold transition-colors ${
                comNumeroDaSemana
                  ? 'bg-acao/15 border-acao/30 text-acao-200'
                  : 'bg-grafite-700 border-linha text-slate-300 hover:text-white'
              }`}>
              Nº da semana
            </button>
          </>
        )}
      </div>

      {visao === 'calendario' && <LegendaDaCor criterio={criterioCor} />}

      {erro && (
        <div className="rounded-xl border border-falha/30 bg-falha/15 p-3 text-xs font-semibold text-falha-400">
          {erro}
        </div>
      )}

      {carregando ? (
        <div className="flex items-center justify-center gap-2 py-16 text-slate-400 text-xs">
          <Loader2 size={16} className="animate-spin" /> Carregando agenda...
        </div>
      ) : visao === 'calendario' ? (
        <VisaoCalendario
          ano={ano} mes={mes} compromissos={doMes}
          corDaPilula={(c) => corDoCompromisso(c, criterioCor)}
          comFimDeSemana={comFimDeSemana}
          comNumeroDaSemana={comNumeroDaSemana}
          onAbrir={setAberto}
          onCriarEm={(dia) => setAberto({ data: dia })}
          onRemarcar={remarcar}
          onEsticar={esticar}
        />
      ) : daLista.length > 0 ? (
        <VisaoLista compromissos={daLista} onAbrir={setAberto} onToggleConcluido={toggleConcluido} />
      ) : (
        <div className="text-center text-slate-400 text-xs py-16 glass-panel rounded-2xl border border-linha">
          <CalendarDays size={28} className="text-slate-600 mx-auto mb-2" />
          Nenhum compromisso de hoje em diante para estes filtros.
        </div>
      )}

      {aberto && (
        <PainelCompromisso
          // A `key` força o painel a renascer ao trocar de compromisso: sem ela,
          // os campos ficariam com o estado do item anterior (o useState só lê o
          // valor inicial na primeira montagem).
          key={aberto.id || `novo-${aberto.data}`}
          compromisso={aberto}
          pessoas={pessoas}
          onSalvar={salvarCompromisso}
          onRemover={removerCompromisso}
          salvando={salvando}
          onFechar={() => { if (!salvando) setAberto(null); }}
        />
      )}
    </div>
  );
}
