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
  CheckCircle2, Circle, ChevronLeft, ChevronRight, Search, Loader2, User, Users,
} from 'lucide-react';
import { AgendaAPI } from '../../services/api';
import { hojeISO, anoMesHoje, somarDias, FUSO_BR } from '../../utils/data';
import { avisar, confirmar } from '../../utils/dialogo';
import { useAuth } from '../../context/AuthContext';

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
               'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const DIAS_SEMANA = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

const TIPOS = {
  reuniao:  { label: 'Reunião',   chip: 'bg-blue-500/20 text-blue-300 border-blue-500/30',       barra: 'bg-blue-400' },
  ligacao:  { label: 'Ligação',   chip: 'bg-ativo/20 text-ativo-400 border-ativo/30',            barra: 'bg-ativo-400' },
  tarefa:   { label: 'Tarefa',    chip: 'bg-espera/20 text-espera-400 border-espera/30',         barra: 'bg-espera-400' },
  followup: { label: 'Follow-up', chip: 'bg-purple-500/20 text-purple-300 border-purple-500/30', barra: 'bg-purple-400' },
  lembrete: { label: 'Lembrete',  chip: 'bg-falha/20 text-falha-400 border-falha/30',            barra: 'bg-falha-400' },
};

const PRIORIDADES = {
  alta:  { label: 'Alta',  dot: 'bg-falha-400' },
  media: { label: 'Média', dot: 'bg-espera-400' },
  baixa: { label: 'Baixa', dot: 'bg-slate-400' },
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

// ─────────────────────────────────────────────────────────── chip do calendário

/**
 * O compromisso dentro da célula do dia.
 *
 * Arrastável: soltar em outro dia remarca. `draggable` só no desktop — no
 * toque, o gesto de arrastar compete com a rolagem da página, e um arraste
 * acidental remarcaria o compromisso de alguém sem querer.
 */
function ChipCompromisso({ comp, onAbrir, onArrastar, podeArrastar }) {
  const t = tipoDe(comp);
  return (
    <button
      draggable={podeArrastar}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        // `setData` é o que faz o Firefox aceitar o arraste; o id real vai pelo
        // estado do pai, porque o dataTransfer só se lê no drop.
        e.dataTransfer.setData('text/plain', comp.id);
        onArrastar(comp);
      }}
      onClick={() => onAbrir(comp)}
      title={`${comp.hora} · ${comp.titulo}${comp.responsavelNome ? ` · ${comp.responsavelNome}` : ''}`}
      className={`group w-full flex items-center gap-1 px-1.5 py-1 rounded-md text-left text-[10px] leading-tight transition-colors ${
        comp.concluido ? 'opacity-50' : ''
      } hover:bg-grafite-600/80 ${podeArrastar ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      <span className={`w-1 h-3 rounded-full shrink-0 ${t.barra}`} />
      <span className="text-slate-500 font-mono shrink-0">{comp.hora}</span>
      <span className={`truncate text-slate-200 ${comp.concluido ? 'line-through' : ''}`}>
        {comp.titulo}
      </span>
    </button>
  );
}

// ───────────────────────────────────────────────────────────────── calendário

function VisaoCalendario({ ano, mes, compromissos, onAbrir, onCriarEm, onRemarcar }) {
  const [arrastando, setArrastando] = useState(null);
  const [diaAlvo, setDiaAlvo] = useState(null);
  const hoje = hojeISO();

  // Índice por dia: sem ele, cada uma das 42 células varreria a lista inteira.
  const porDia = useMemo(() => {
    const mapa = new Map();
    for (const c of compromissos) {
      if (!mapa.has(c.data)) mapa.set(c.data, []);
      mapa.get(c.data).push(c);
    }
    for (const lista of mapa.values()) lista.sort((a, b) => a.hora.localeCompare(b.hora));
    return mapa;
  }, [compromissos]);

  const celulas = useMemo(() => gradeDoMes(ano, mes), [ano, mes]);
  const podeArrastar = typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches;

  function soltar(diaISO) {
    setDiaAlvo(null);
    const comp = arrastando;
    setArrastando(null);
    if (!comp || comp.data === diaISO) return;
    onRemarcar(comp, diaISO);
  }

  return (
    // ── AS 7 COLUNAS NÃO QUEBRAM, MAS TAMBÉM NÃO ESPREMEM ───────────────────
    //
    // Uma semana tem sete dias: virar duas colunas no celular não seria um
    // calendário, seria outra coisa. Mas sete colunas num telefone de 320px dão
    // 45px cada, e num chip de 45px não cabe "14:00 Reunião" -- a grade ficaria
    // bonita e ilegível.
    //
    // Então a grade tem largura MÍNIMA e o container rola de lado. Ninguém
    // perde informação: desliza-se a semana como se desliza uma tabela larga,
    // que é o gesto que o resto do painel já usa. A partir de `sm` a largura da
    // tela já passa do mínimo e não há rolagem nenhuma.
    <div className="glass-panel rounded-2xl border border-linha overflow-hidden">
      <div className="overflow-x-auto">
      <div className="min-w-[38rem]">
      <div className="grid grid-cols-7 border-b border-linha bg-grafite-700/40">
        {DIAS_SEMANA.map((d) => (
          <div key={d} className="text-center text-[10px] font-bold text-slate-500 py-2">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 auto-rows-fr">
        {celulas.map((cel) => {
          const doDia = porDia.get(cel.iso) || [];
          const ehHoje = cel.iso === hoje;
          const alvo = diaAlvo === cel.iso;
          // Três cabem sem a célula crescer; o resto vira "+N", que leva para a
          // Lista daquele dia em vez de espremer mais texto ilegível.
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
                  <ChipCompromisso
                    key={c.id}
                    comp={c}
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
                  <span className="hidden lg:flex items-center gap-1 text-[10px] shrink-0 w-28 truncate"
                    title={c.responsavelNome || 'Sem responsável'}>
                    {c.responsavelNome
                      ? <><User size={10} className="text-purple-300 shrink-0" /> <span className="text-slate-300 truncate">{c.responsavelNome}</span></>
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
      descricao: descricao.trim(),
      contato: contato.trim(),
      concluido: compromisso?.concluido || false,
    });
  }

  const campo = 'w-full bg-grafite-700 border border-linha rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-acao/50';
  const rotulo = 'text-xs text-slate-400 font-medium block mb-1.5';

  return (
    <>
      {/* Véu só no celular: no desktop o painel divide a tela com a agenda, e
          escurecer o resto anularia a razão de ele ser lateral. */}
      <div onClick={() => !salvando && onFechar()}
        className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-40 lg:hidden" />

      <aside className="fixed top-0 right-0 h-dvh w-full sm:w-[26rem] z-50 glass-panel border-l border-linha shadow-2xl flex flex-col">
        <div className="p-4 bg-grafite-600 border-b border-linha flex items-center justify-between shrink-0">
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

        <div className="p-4 bg-grafite-600 border-t border-linha flex items-center gap-2 shrink-0">
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
    </>
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
      </div>

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
          onAbrir={setAberto}
          onCriarEm={(dia) => setAberto({ data: dia })}
          onRemarcar={remarcar}
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
