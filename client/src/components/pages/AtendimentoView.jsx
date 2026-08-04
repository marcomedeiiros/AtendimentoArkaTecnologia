import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  MessageSquare, Send, Eye, Trash2, UserCheck, Check, X,
  CheckCircle2, Clock, Inbox, Play, Search, Zap,
  CheckCheck, WifiOff, Wifi, Bell, Pin, ChevronLeft,
  ArrowRightLeft, AlertCircle, Users, RotateCcw, Layers, ArrowDown, Tv,
  FileText, MapPin, Contact, Paperclip, Smile, Image as Loader2,
  SlidersHorizontal, Star, Archive, EyeOff, MoreVertical,
  ZoomIn, ZoomOut, Maximize2, Download, CornerUpLeft, Share2, Pencil, MoreHorizontal
} from 'lucide-react';
import { EmojiIcon, FormattedMessage } from './EmojiIcon';
import { useMensagensRapidas } from './MensagensRapidas';
import Avatar from '../Avatar';
import Portal from '../Portal';
import { useAppContext } from '../../context/AppContext';
import { ConversasAPI } from '../../services/api';
import { usePreferencia } from '../../hooks/usePreferencia';
import { wallpaperStyle as WHATSAPP_BG } from '../../utils/wallpaper';

// Atendente responsavel por cada conversa. Fica no localStorage (e nao no
// back-end) porque a coluna atendenteId da conversa aponta para Usuario, nao
// para a Equipe cadastrada nesta tela -- e persistir no servidor exigiria
// migracao. Guardado por id de conversa, sobrevive ao polling de 8s e ao F5.
const ATEND_KEY = 'arka_conversa_atendentes';
function lerAtendentes() {
  try { return JSON.parse(localStorage.getItem(ATEND_KEY)) || {}; } catch { return {}; }
}
function salvarAtendentes(map) {
  try { localStorage.setItem(ATEND_KEY, JSON.stringify(map)); } catch {}
}

// "ha 5 min" para o painel de notificacoes do sino (recebe timestamp em ms).
function tempoRelativo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'agora';
  const m = Math.floor(s / 60);
  if (m < 60) return `ha ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `ha ${h}h`;
  return `ha ${Math.floor(h / 24)}d`;
}

// "há 2 min / há 1 h / ontem / 12/03" a partir de um ISO (ultima mensagem).
function tempoDesde(iso) {
  if (!iso) return '';
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return 'agora';
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'ontem';
  if (d < 7) return `há ${d} d`;
  return new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

// Metadados visuais dos 3 status (🟢 Aberta / 🟡 Pendente / 🔴 Fechada).
const STATUS_META = {
  pendente: { label: 'Pendente', dot: 'bg-espera-400',   chip: 'bg-espera/20 text-espera-400 border-espera/30' },
  aberta:   { label: 'Aberta',   dot: 'bg-ativo-400', chip: 'bg-ativo/20 text-ativo-400 border-ativo/30' },
  // Fechada NAO e erro: e trabalho concluido. Cor neutra, que recua na lista.
  // O vermelho fica reservado para falha de verdade (envio, conexao).
  fechada:  { label: 'Fechada',  dot: 'bg-quieto',       chip: 'bg-quieto/20 text-quieto-400 border-quieto/30' }
};

function limparCnpj(v) { return String(v || '').replace(/\D/g, ''); }
function mascararCnpj(v) {
  const c = limparCnpj(v).slice(0, 14);
  return c
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}
function cnpjValido(v) {
  const c = limparCnpj(v);
  if (c.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(c)) return false;
  const calc = (base, pesos) => {
    const soma = pesos.reduce((acc, p, i) => acc + Number(base[i]) * p, 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const p1 = [5,4,3,2,9,8,7,6,5,4,3,2], p2 = [6,5,4,3,2,9,8,7,6,5,4,3,2];
  const d1 = calc(c.slice(0,12), p1);
  const d2 = calc(c.slice(0,12)+d1, p2);
  return c === c.slice(0,12)+String(d1)+String(d2);
}
function horaAgora() {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

const ABAS = [
  { id: 'todas',     label: 'Todas',     icon: Layers,       statusMatch: () => true },
  { id: 'abertas',   label: 'Abertas',   icon: Inbox,        statusMatch: c => c.statusAtendimento === 'aberta' },
  { id: 'pendentes', label: 'Pendentes', icon: Clock,        statusMatch: c => c.statusAtendimento === 'pendente' },
  { id: 'fechadas',  label: 'Fechadas',  icon: CheckCircle2, statusMatch: c => c.statusAtendimento === 'fechada' },
];

function PainelMensagensRapidas({ onSelecionar, onFechar }) {
  const mensagens = useMensagensRapidas();
  const [busca, setBusca] = useState('');

  const filtradas = mensagens.filter(m =>
    m.titulo.toLowerCase().includes(busca.toLowerCase()) ||
    m.texto.toLowerCase().includes(busca.toLowerCase())
  );

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 glass-panel border border-linha rounded-2xl shadow-2xl z-30 overflow-hidden">
      <div className="p-3 bg-grafite-600 border-b border-linha flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Zap size={13} className="text-acao-200" />
          <span className="text-xs font-bold text-white">Mensagens Rápidas</span>
        </div>
        <div className="flex items-center gap-2 flex-1 max-w-xs">
          <div className="relative flex-1">
            <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar..."
              autoFocus
              className="w-full bg-grafite-700 border border-linha rounded-lg pl-7 pr-2 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-acao/50"
            />
          </div>
          <button onClick={onFechar} className="text-slate-400 hover:text-white transition-colors p-1">
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="max-h-64 overflow-y-auto p-2 space-y-1">
        {filtradas.map(m => (
          <button
            key={m.id}
            onClick={() => onSelecionar(m.texto)}
            className="w-full text-left p-2.5 rounded-xl hover:bg-grafite-600 border border-transparent hover:border-acao/30 transition-all group"
          >
            <div className="font-semibold text-xs text-white group-hover:text-acao-200 transition-colors">{m.titulo}</div>
            <div className="text-[10px] text-slate-400 truncate mt-0.5">{m.texto}</div>
          </button>
        ))}
        {filtradas.length === 0 && (
          <div className="text-xs text-slate-500 text-center py-4">Nenhuma mensagem encontrada.</div>
        )}
      </div>
    </div>
  );
}

// Filtros extras (combinam com a aba de status). Cada um e um "toggle".
const FILTROS_EXTRA = [
  { id: 'naoLidas',    label: 'Não Lidas',    testa: c => (c.naoLidas || 0) > 0 },
  { id: 'favoritas',   label: 'Favoritas',    testa: c => !!c.favorita },
  { id: 'semOperador', label: 'Sem Operador', testa: c => !c.atendenteId },
  { id: 'comAnexo',    label: 'Com Anexo',    testa: c => (c.mensagens || []).some(m => m.tipo && m.tipo !== 'texto') },
  { id: 'hoje',        label: 'Hoje',         testa: c => dentroDe(c.ultimaMensagemEm, 1) },
  { id: 'semana',      label: 'Esta Semana',  testa: c => dentroDe(c.ultimaMensagemEm, 7) },
];

// True se o ISO cai dentro dos ultimos N dias (contando a partir de hoje 00h).
function dentroDe(iso, dias) {
  if (!iso) return false;
  const inicio = new Date();
  inicio.setHours(0, 0, 0, 0);
  inicio.setDate(inicio.getDate() - (dias - 1));
  return new Date(iso).getTime() >= inicio.getTime();
}

// `todas` e `fechadas` controlam a ABA correspondente: desmarcar esconde a aba
// inteira (e as conversas daquele status somem da lista). `arquivadas`/`ocultas`
// so filtram as conversas. Nada e apagado do banco em nenhum caso.
const VISIBILIDADE_PADRAO = { todas: true, fechadas: true, arquivadas: false, ocultas: false };

// Abas que podem ser escondidas pelos checkboxes.
const ABA_POR_VISIBILIDADE = { todas: 'todas', fechadas: 'fechadas' };

function PainelFiltros({ extras, setExtras, visib, setVisib, onLimpar, totalAtivos }) {
  const alternarExtra = (id) =>
    setExtras(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  return (
    <div className="absolute right-0 top-full mt-2 w-[min(90vw,300px)] glass-panel border border-linha rounded-2xl shadow-2xl shadow-black/50 z-40 overflow-hidden fade-in">
      <div className="p-3 bg-grafite-600 border-b border-linha flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-bold text-white">
          <SlidersHorizontal size={13} className="text-acao-200" /> Filtros
        </div>
        {totalAtivos > 0 && (
          <button onClick={onLimpar} className="text-[11px] text-slate-400 hover:text-falha-400 font-semibold transition-colors">
            Limpar
          </button>
        )}
      </div>

      <div className="p-3 space-y-3">
        <div>
          <div className="text-[10px] uppercase text-slate-500 font-bold mb-1.5">Refinar</div>
          <div className="flex flex-wrap gap-1.5">
            {FILTROS_EXTRA.map(f => {
              const ativo = extras.includes(f.id);
              return (
                <button key={f.id} onClick={() => alternarExtra(f.id)}
                  className={`text-[11px] px-2.5 py-1 rounded-full border font-semibold transition-all ${
                    ativo
                      ? 'bg-acao/20 border-acao/50 text-acao-200'
                      : 'bg-grafite-700 border-linha text-slate-400 hover:text-slate-200 hover:border-linha-forte'
                  }`}>
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="pt-2 border-t border-linha">
          <div className="text-[10px] uppercase text-slate-500 font-bold mb-1.5">Exibir na lista</div>
          {[
            { id: 'todas',      label: 'Mostrar Todas as Conversas' },
            { id: 'fechadas',   label: 'Mostrar Conversas Fechadas' },
            { id: 'arquivadas', label: 'Mostrar Conversas Arquivadas' },
            { id: 'ocultas',    label: 'Mostrar Conversas Ocultas' },
          ].map(op => (
            <label key={op.id} className="flex items-center gap-2 py-1.5 cursor-pointer group">
              <input
                type="checkbox"
                checked={!!visib[op.id]}
                onChange={e => setVisib(v => ({ ...v, [op.id]: e.target.checked }))}
                className="w-3.5 h-3.5 rounded accent-acao cursor-pointer"
              />
              <span className="text-[11px] text-slate-300 group-hover:text-white transition-colors">{op.label}</span>
            </label>
          ))}
          <p className="text-[10px] text-slate-500 mt-1.5 leading-relaxed">
            Desmarcar "Todas" ou "Fechadas" esconde a aba correspondente. Nada é
            apagado do banco.
          </p>
        </div>
      </div>
    </div>
  );
}

// Painel de parede: a fila numa TV, lida a varios metros. Tudo aqui e
// dimensionado para distancia -- tipografia grande, poucos itens por tela e
// nenhum controle pequeno. Atualiza sozinho pelo SSE, como a lista.
//
// Duas colunas, porque sao duas perguntas diferentes: a esquerda mostra quem
// ainda nao foi atendido, a direita quem ja esta com alguem. Sem a segunda, uma
// conversa assumida e esquecida some da parede e ninguem percebe.
function PainelTv({ pendentes, abertas, onFechar }) {
  const [agora, setAgora] = useState(Date.now());

  // 1s: o relogio da parede mostra segundos, entao precisa bater a cada tique.
  // O mesmo estado recalcula o tempo de espera dos cartoes.
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onTecla = (e) => { if (e.key === 'Escape') onFechar(); };
    window.addEventListener('keydown', onTecla);
    return () => window.removeEventListener('keydown', onTecla);
  }, [onFechar]);

  // Espera longa = vermelho. E o dado que importa numa parede: quem esta
  // esperando demais precisa saltar aos olhos.
  const urgencia = (iso) => {
    if (!iso) return { cor: 'text-quieto', borda: 'border-linha' };
    const min = (agora - new Date(iso).getTime()) / 60000;
    if (min >= 15) return { cor: 'text-falha-400', borda: 'border-falha/60' };
    if (min >= 5)  return { cor: 'text-espera',    borda: 'border-espera/50' };
    return { cor: 'text-ativo-400', borda: 'border-linha' };
  };

  // Numa conversa ja assumida, "esperando ha 20 min" seria mentira -- alguem
  // esta com ela. O que importa e outra coisa: a ultima mensagem e do cliente?
  // Entao ela esta devendo resposta, e vale o mesmo alerta da fila. Se a ultima
  // foi nossa, a bola esta com o cliente e o cartao fica calmo.
  const devendoResposta = (c) => c.mensagens?.[c.mensagens.length - 1]?.de === 'cliente';

  const Cartao = ({ c, aberta }) => {
    const cobrando = aberta ? devendoResposta(c) : true;
    const u = cobrando
      ? urgencia(c.ultimaMensagemEm)
      : { cor: 'text-quieto', borda: 'border-linha' };
    const ultima = c.mensagens?.[c.mensagens.length - 1];
    const tempo = tempoDesde(c.ultimaMensagemEm).replace('há ', '');

    return (
      <div className={`bg-grafite-700 rounded-3xl border-2 ${u.borda} p-7 flex flex-col gap-4`}>
        <div className="flex items-center gap-5 min-w-0">
          <Avatar nome={c.cliente} size="lg" fotoUrl={c.fotoUrl} className="scale-150 ml-2 mr-3" />
          <div className="min-w-0 flex-1">
            <div className="text-3xl font-bold text-white truncate">{c.cliente}</div>
            <div className="text-xl text-texto-suave font-mono truncate">{c.telefone}</div>
          </div>
          {c.naoLidas > 0 && (
            <span className="shrink-0 min-w-[52px] h-[52px] px-3 rounded-full bg-espera text-grafite-900 text-2xl font-extrabold flex items-center justify-center tabular-nums">
              {c.naoLidas > 99 ? '99+' : c.naoLidas}
            </span>
          )}
        </div>

        <p className="text-xl text-texto-suave line-clamp-2 leading-snug">
          {ultima ? ultima.texto : 'Sem mensagens'}
        </p>

        <div className={`flex items-center gap-2 text-2xl font-bold ${u.cor}`}>
          <Clock size={24} />
          {!aberta && `esperando ${tempo}`}
          {aberta && cobrando && `sem resposta ${tempo}`}
          {aberta && !cobrando && `respondido ${tempo}`}
        </div>
      </div>
    );
  };

  const Coluna = ({ titulo, itens, cor, aberta, vazio }) => (
    <section className="flex min-h-0 flex-col gap-5">
      <header className="flex shrink-0 items-center gap-4">
        <span className={`h-3 w-3 rounded-full ${cor}`} />
        <h2 className="text-2xl font-bold uppercase tracking-wider text-texto-suave">{titulo}</h2>
        <span className="text-2xl font-extrabold tabular-nums text-white">{itens.length}</span>
      </header>
      {itens.length === 0 ? (
        <p className="rounded-3xl border-2 border-dashed border-linha p-8 text-center text-2xl text-texto-fraco">
          {vazio}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-6 2xl:grid-cols-2">
          {itens.map(c => <Cartao key={c.id} c={c} aberta={aberta} />)}
        </div>
      )}
    </section>
  );

  const d = new Date(agora);
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  // "quinta-feira" -> "Quinta-feira"
  const diaSemana = d.toLocaleDateString('pt-BR', { weekday: 'long' }).replace(/^./, l => l.toUpperCase());
  const data = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

  return (
    <Portal>
      <div className="fixed inset-0 z-[70] bg-grafite-900 flex flex-col">
        <div className="shrink-0 flex items-center justify-between gap-6 px-10 py-6 border-b border-linha bg-grafite-800">
          <div className="flex items-center gap-5">
            {/* O ponto pulsa so quando ha alguem sem atendimento. Piscando o
                tempo todo, ele deixaria de significar qualquer coisa. */}
            <span className="relative flex h-4 w-4">
              {pendentes.length > 0 && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-espera opacity-60" />
              )}
              <span className={`relative inline-flex rounded-full h-4 w-4 ${pendentes.length > 0 ? 'bg-espera' : 'bg-ativo'}`} />
            </span>
            <h1 className="text-4xl font-bold text-white tracking-tight font-display">
              Fila de atendimento
            </h1>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-right leading-tight">
              {/* tabular-nums evita o relogio "dancar" a cada segundo */}
              <div className="text-4xl font-bold text-texto tabular-nums">{hora}</div>
              <div className="text-lg text-texto-suave">{diaSemana} · {data}</div>
            </div>
            <button onClick={onFechar}
              className="px-5 py-3 rounded-xl bg-grafite-600 hover:bg-grafite-500 text-texto text-lg font-bold flex items-center gap-2 transition-colors">
              <X size={22} /> Sair
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-8">
          {pendentes.length === 0 && abertas.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-6 text-center">
              <div className="p-10 rounded-full bg-ativo/10 border-4 border-ativo/30 text-ativo">
                <CheckCircle2 size={90} />
              </div>
              <p className="text-5xl font-bold text-white font-display">Fila vazia</p>
              <p className="text-2xl text-texto-suave">Nenhum cliente aguardando atendimento.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-10 xl:grid-cols-2">
              <Coluna
                titulo="Aguardando" cor="bg-espera" itens={pendentes}
                vazio="Ninguém na fila."
              />
              <Coluna
                titulo="Em atendimento" cor="bg-ativo" itens={abertas} aberta
                vazio="Nenhuma conversa assumida."
              />
            </div>
          )}
        </div>
      </div>
    </Portal>
  );
}

// Tela exibida quando nenhuma conversa esta aberta.
//
// Usa o mesmo papel de parede da area de conversas, para o painel nao piscar de
// aparencia quando uma conversa abre. Sobre o wallpaper, o texto vive dentro de
// um cartao opaco: ele agrupa titulo, subtitulo e icone num bloco so, em vez de
// deixar tres elementos soltos boiando no meio dos doodles.
function TelaSemConversa() {
  return (
    <div className="flex-1 flex items-center justify-center relative overflow-hidden" style={WHATSAPP_BG}>

      {/* Baloezinhos de conversa ao fundo, nas cores do WhatsApp escuro */}
      <div className="absolute top-8 left-8 w-32 h-10 rounded-2xl rounded-tl-sm bg-grafite-600 opacity-60" />
      <div className="absolute top-20 right-10 w-40 h-10 rounded-2xl rounded-tr-sm bg-bolha opacity-50" />
      <div className="absolute top-36 left-14 w-24 h-10 rounded-2xl rounded-tl-sm bg-grafite-600 opacity-60" />
      <div className="absolute bottom-24 right-8 w-36 h-10 rounded-2xl rounded-tr-sm bg-bolha opacity-50" />
      <div className="absolute bottom-12 left-10 w-28 h-10 rounded-2xl rounded-tl-sm bg-grafite-600 opacity-60" />
      <div className="absolute bottom-36 right-20 w-20 h-10 rounded-2xl rounded-tr-sm bg-bolha opacity-40" />

      <div className="relative z-10 text-center px-8 py-9 max-w-sm rounded-2xl bg-grafite-800/95 border border-linha shadow-2xl">
        <div className="inline-flex p-5 rounded-2xl bg-grafite-700 border border-linha mb-5 text-acao shadow-xl shadow-grafite-900/60">
          <MessageSquare size={38} />
        </div>
        <h3 className="text-base font-bold text-texto font-display mb-2 [text-shadow:0_2px_10px_rgba(0,0,0,0.85)]">
          Nenhum Atendimento Selecionado
        </h3>
        <p className="text-xs text-texto-suave leading-relaxed [text-shadow:0_1px_8px_rgba(0,0,0,0.85)]">
          Selecione uma conversa ou clique em{' '}
          <strong className="text-acao">"ATENDER CONVERSA"</strong> para iniciar o chat.
        </p>
      </div>
    </div>
  );
}

// Skeleton (sem spinner) enquanto a lista carrega pela primeira vez.
function SkeletonCard() {
  return (
    <div className="p-3.5 rounded-xl border border-linha/60 bg-grafite-600/40 flex flex-col gap-2 animate-pulse">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-slate-700/50" />
        <div className="h-3 w-28 rounded bg-slate-700/50" />
        <div className="ml-auto h-2.5 w-10 rounded bg-slate-700/40" />
      </div>
      <div className="h-2.5 w-24 rounded bg-slate-700/40" />
      <div className="h-8 rounded-lg bg-grafite-700 border border-linha" />
    </div>
  );
}

// Risquinhos de entrega, como no WhatsApp:
//   relogio = saindo | 1 risco = enviada | 2 riscos = entregue | 2 azuis = lida
function StatusMensagem({ status, escuro }) {
  if (!status) return null;
  const base = escuro ? 'text-slate-400' : 'text-slate-900/70';

  if (status === 'enviando') return <Clock size={12} className={base} title="Enviando" />;
  if (status === 'erro') return <AlertCircle size={12} className="text-falha-400" title="Falha no envio" />;
  if (status === 'enviada') return <Check size={13} className={base} title="Enviada" />;
  if (status === 'entregue') return <CheckCheck size={13} className={base} title="Entregue" />;
  if (status === 'lida') return <CheckCheck size={13} className="text-lida-400" title="Lida" />;
  return null;
}

// Menu de tres pontinhos da bolha: responder, encaminhar, editar.
function MenuMensagem({ m, ehPropria, onResponder, onEncaminhar, onEditar }) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e) => { if (ref.current && !ref.current.contains(e.target)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);

  const item = 'w-full text-left px-3 py-2 text-[11px] font-semibold text-slate-300 hover:bg-grafite-600 hover:text-white transition-colors flex items-center gap-2';

  return (
    <div className="relative shrink-0 self-center" ref={ref}>
      <button
        onClick={() => setAberto(v => !v)}
        title="Mais ações"
        className={`p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-grafite-600 transition-all ${
          aberto ? 'opacity-100 bg-grafite-600 text-white' : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        <MoreHorizontal size={15} />
      </button>

      {aberto && (
        <div className={`absolute top-full mt-1 w-40 glass-panel border border-linha rounded-xl shadow-2xl shadow-black/50 z-50 overflow-hidden py-1 ${
          ehPropria ? 'left-0' : 'right-0'
        }`}>
          <button className={item} onClick={() => { onResponder(m); setAberto(false); }}>
            <CornerUpLeft size={12} className="text-slate-500" /> Responder
          </button>
          <button className={item} onClick={() => { onEncaminhar(m); setAberto(false); }}>
            <Share2 size={12} className="text-slate-500" /> Encaminhar
          </button>
          {ehPropria && m.tipo === 'texto' && (
            <button className={item} onClick={() => { onEditar(m); setAberto(false); }}>
              <Pencil size={12} className="text-slate-500" /> Editar
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Visualizador de imagem em tela cheia, com zoom e arraste.
// Substitui o antigo window.open(): os navegadores bloqueiam navegacao para
// data: URLs (que e o formato em que a midia chega da Evolution), entao o
// clique simplesmente nao fazia nada.
function VisualizadorImagem({ url, legenda, nomeArquivo, onFechar }) {
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const arrastando = useRef(null);

  const ajustarZoom = useCallback((delta) => {
    setZoom(z => {
      const novo = Math.min(Math.max(z + delta, 1), 6);
      if (novo === 1) setPos({ x: 0, y: 0 });
      return novo;
    });
  }, []);

  useEffect(() => {
    const onTecla = (e) => {
      if (e.key === 'Escape') onFechar();
      if (e.key === '+' || e.key === '=') ajustarZoom(0.4);
      if (e.key === '-') ajustarZoom(-0.4);
      if (e.key === '0') { setZoom(1); setPos({ x: 0, y: 0 }); }
    };
    window.addEventListener('keydown', onTecla);
    return () => window.removeEventListener('keydown', onTecla);
  }, [onFechar, ajustarZoom]);

  const aoRolar = (e) => { e.preventDefault(); ajustarZoom(e.deltaY < 0 ? 0.3 : -0.3); };

  const iniciarArraste = (e) => {
    if (zoom <= 1) return;
    arrastando.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
  };
  const moverArraste = (e) => {
    if (!arrastando.current) return;
    setPos({ x: e.clientX - arrastando.current.x, y: e.clientY - arrastando.current.y });
  };
  const pararArraste = () => { arrastando.current = null; };

  const btn = 'p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-200 transition-colors disabled:opacity-40';

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[60] bg-slate-950/95 backdrop-blur-sm flex flex-col"
        onMouseMove={moverArraste}
        onMouseUp={pararArraste}
        onMouseLeave={pararArraste}
      >
        <div className="shrink-0 flex items-center justify-between gap-3 p-3 bg-grafite-800/90 border-b border-linha">
          <span className="text-xs text-slate-300 font-semibold truncate min-w-0">
            {nomeArquivo || legenda || 'Imagem'}
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={() => ajustarZoom(-0.4)} disabled={zoom <= 1} className={btn} title="Diminuir (-)">
              <ZoomOut size={16} />
            </button>
            <span className="text-[11px] text-slate-400 font-mono w-12 text-center">{Math.round(zoom * 100)}%</span>
            <button onClick={() => ajustarZoom(0.4)} disabled={zoom >= 6} className={btn} title="Aumentar (+)">
              <ZoomIn size={16} />
            </button>
            <button onClick={() => { setZoom(1); setPos({ x: 0, y: 0 }); }} className={btn} title="Tamanho original (0)">
              <Maximize2 size={16} />
            </button>
            <a href={url} download={nomeArquivo || 'imagem.jpg'} className={btn} title="Baixar">
              <Download size={16} />
            </a>
            <button onClick={onFechar} className={btn} title="Fechar (Esc)">
              <X size={16} />
            </button>
          </div>
        </div>

        <div
          className="flex-1 overflow-hidden flex items-center justify-center p-4"
          onWheel={aoRolar}
          onClick={e => { if (e.target === e.currentTarget) onFechar(); }}
        >
          <img
            src={url}
            alt={legenda || 'imagem'}
            draggable={false}
            onMouseDown={iniciarArraste}
            onDoubleClick={() => (zoom > 1 ? (setZoom(1), setPos({ x: 0, y: 0 })) : ajustarZoom(1))}
            style={{
              transform: `translate(${pos.x}px, ${pos.y}px) scale(${zoom})`,
              cursor: zoom > 1 ? (arrastando.current ? 'grabbing' : 'grab') : 'zoom-in',
              transition: arrastando.current ? 'none' : 'transform 0.15s ease-out'
            }}
            className="max-w-full max-h-full object-contain select-none"
          />
        </div>

        {legenda && (
          <div className="shrink-0 p-3 bg-grafite-800/90 border-t border-linha text-xs text-slate-300 text-center">
            {legenda}
          </div>
        )}
      </div>
    </Portal>
  );
}

// Renderiza a bolha de acordo com o tipo de mídia. `escuro` = bolha do cliente
// (fundo escuro); senão é a bolha da equipe (fundo laranja).
function MensagemMidia({ m, escuro, onAbrirImagem }) {
  const md = m.midia || {};
  const semArquivo = !md.url && m.tipo !== 'localizacao' && m.tipo !== 'contato';

  if (semArquivo) {
    return (
      <div className={`text-[11px] italic ${escuro ? 'text-slate-400' : 'text-slate-900/70'}`}>
        {m.texto || '[Mídia indisponível]'}
      </div>
    );
  }

  if (m.tipo === 'imagem') {
    return (
      <img
        src={md.url}
        alt={md.caption || 'imagem'}
        title="Clique para ampliar"
        className="rounded-lg max-w-full max-h-72 object-contain cursor-zoom-in hover:opacity-90 transition-opacity"
        onClick={() => onAbrirImagem?.({ url: md.url, legenda: md.caption, nomeArquivo: md.fileName })}
      />
    );
  }
  if (m.tipo === 'video') {
    return <video src={md.url} controls className="rounded-lg max-w-full max-h-72" />;
  }
  if (m.tipo === 'audio') {
    return <audio src={md.url} controls className="w-full min-w-[220px]" />;
  }
  if (m.tipo === 'documento') {
    return (
      <a href={md.url} download={md.fileName || 'documento'} target="_blank" rel="noreferrer"
        className={`flex items-center gap-2 p-2 rounded-lg ${escuro ? 'bg-grafite-700 border border-linha' : 'bg-slate-900/10'}`}>
        <FileText size={20} className={escuro ? 'text-acao-200' : 'text-slate-900'} />
        <div className="min-w-0">
          <div className={`text-[11px] font-semibold truncate ${escuro ? 'text-slate-100' : 'text-slate-900'}`}>{md.fileName || 'Documento'}</div>
          <div className={`text-[9px] ${escuro ? 'text-slate-400' : 'text-slate-900/60'}`}>Baixar</div>
        </div>
      </a>
    );
  }
  if (m.tipo === 'localizacao') {
    const link = `https://www.google.com/maps?q=${md.latitude},${md.longitude}`;
    return (
      <a href={link} target="_blank" rel="noreferrer"
        className={`flex items-center gap-2 p-2 rounded-lg ${escuro ? 'bg-grafite-700 border border-linha text-slate-100' : 'bg-slate-900/10 text-slate-900'}`}>
        <MapPin size={18} /> <span className="text-[11px] font-semibold">{md.name || 'Ver localização'}</span>
      </a>
    );
  }
  if (m.tipo === 'contato') {
    return (
      <div className={`flex items-center gap-2 p-2 rounded-lg ${escuro ? 'bg-grafite-700 border border-linha text-slate-100' : 'bg-slate-900/10 text-slate-900'}`}>
        <Contact size={18} /> <span className="text-[11px] font-semibold">{md.displayName || 'Contato'}</span>
      </div>
    );
  }
  return null;
}

const CardConversa = React.memo(function CardConversa({
  c, selecionada, parceiros, whatsAppConectado,
  onSelecionar, onAtender, onFechar, onReabrir, onEspiar, onFixar, fixado, onFlag
}) {
  const [menuAberto, setMenuAberto] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuAberto) return;
    const fora = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [menuAberto]);

  const meta      = STATUS_META[c.statusAtendimento] || STATUS_META.pendente;
  const ehAtivo   = selecionada === c.id && (c.statusAtendimento === 'aberta' || c.statusAtendimento === 'fechada');
  const ultimaMsg = c.mensagens?.[c.mensagens.length - 1];
  const naoLidas  = c.naoLidas || 0;
  const encerrado = c.statusAtendimento === 'fechada';
  // Qualquer conversa abre para leitura -- inclusive pendente, que antes so
  // era acessivel depois de clicar em ATENDER.
  const clicavel  = true;

  return (
    <div
      onClick={() => { if (clicavel) onSelecionar(c.id); }}
      className={`p-3.5 rounded-xl border transition-all duration-200 flex flex-col gap-2 ${clicavel ? 'cursor-pointer' : ''} ${
        ehAtivo
          ? 'bg-gradient-to-r from-acao/10 to-transparent border-acao/50 shadow-sm'
          : naoLidas > 0
            ? 'bg-acao/[0.06] border-acao/30 hover:border-acao/50'
            : fixado
              ? 'bg-grafite-600/60 border-acao/25 hover:border-acao/40'
              : 'bg-grafite-600/40 border-linha/60 hover:border-linha-forte'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Avatar nome={c.cliente} size="sm" fotoUrl={c.fotoUrl} online={whatsAppConectado} />
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={`w-2 h-2 rounded-full shrink-0 ${meta.dot}`} title={meta.label} />
            {c.favorita && <Star size={11} className="text-espera-400 fill-current shrink-0" title="Favorita" />}
            {c.arquivada && <Archive size={11} className="text-slate-500 shrink-0" title="Arquivada" />}
            {c.oculta && <EyeOff size={11} className="text-slate-500 shrink-0" title="Oculta" />}
            <span className={`text-xs truncate ${naoLidas > 0 ? 'font-extrabold text-white' : 'font-bold text-slate-300'}`}>
              {c.cliente}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] text-slate-500" title="Última mensagem">
            {tempoDesde(c.ultimaMensagemEm)}
          </span>
          {naoLidas > 0 && (
            <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-espera text-grafite-900 text-[10px] font-extrabold flex items-center justify-center" title={`${naoLidas} não lida(s)`}>
              {naoLidas > 99 ? '99+' : naoLidas}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-slate-400 font-mono truncate">
          {c.telefone || '-'}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={e => { e.stopPropagation(); onFixar(c.id); }} title={fixado ? 'Desafixar conversa' : 'Fixar no topo'}
            className={`p-1.5 rounded-lg transition-colors ${fixado ? 'bg-acao/20 text-acao-200' : 'bg-slate-800/80 hover:bg-slate-700 text-slate-400'}`}>
            <Pin size={12} className={fixado ? 'fill-current' : ''} />
          </button>
          <button onClick={e => { e.stopPropagation(); onEspiar(c); }} title="Espiar conversa"
            className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-blue-400 transition-colors">
            <Eye size={12} />
          </button>
          {encerrado ? (
            <button onClick={e => { e.stopPropagation(); onReabrir(c.id); }} title="Reabrir atendimento"
              className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-ativo/20 text-ativo-400 transition-colors">
              <RotateCcw size={12} />
            </button>
          ) : (
            <button onClick={e => { e.stopPropagation(); onFechar(c.id); }} title="Fechar atendimento"
              className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-falha/20 text-falha-400 transition-colors">
              <CheckCircle2 size={12} />
            </button>
          )}

          <div className="relative" ref={menuRef}>
            <button onClick={e => { e.stopPropagation(); setMenuAberto(v => !v); }} title="Mais ações"
              className={`p-1.5 rounded-lg transition-colors ${menuAberto ? 'bg-slate-700 text-white' : 'bg-slate-800/80 hover:bg-slate-700 text-slate-400'}`}>
              <MoreVertical size={12} />
            </button>
            {menuAberto && (
              <div className="absolute right-0 top-full mt-1 w-44 glass-panel border border-linha rounded-xl shadow-2xl shadow-black/50 z-50 overflow-hidden py-1">
                {[
                  { id: 'favorita',  ativo: c.favorita,  on: 'Desfavoritar',  off: 'Favoritar',        Icon: Star },
                  { id: 'arquivada', ativo: c.arquivada, on: 'Desarquivar',   off: 'Arquivar conversa', Icon: Archive },
                  { id: 'oculta',    ativo: c.oculta,    on: 'Reexibir',      off: 'Ocultar conversa',  Icon: EyeOff },
                ].map(({ id, ativo, on, off, Icon }) => (
                  <button key={id}
                    onClick={e => { e.stopPropagation(); onFlag(c.id, { [id]: !ativo }); setMenuAberto(false); }}
                    className="w-full text-left px-3 py-2 text-[11px] font-semibold text-slate-300 hover:bg-grafite-600 hover:text-white transition-colors flex items-center gap-2">
                    <Icon size={12} className={ativo ? 'text-acao-200' : 'text-slate-500'} />
                    {ativo ? on : off}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div>
        {c.cnpjVerificado
          ? c.cnpj && parceiros.some(p => p.cnpj === limparCnpj(c.cnpj) && p.status === 'ativo')
            ? <EmojiIcon name="shield"   label={`Parceiro: ${mascararCnpj(c.cnpj)}`} size="sm" />
            : <EmojiIcon name="warning"  label={`Avulso (${mascararCnpj(c.cnpj)})`}  size="sm" />
          : <EmojiIcon name="question" label="CNPJ Pendente" size="sm" />
        }
      </div>

      <div className={`text-[11px] truncate bg-grafite-700 p-2 rounded-lg border border-linha ${naoLidas > 0 ? 'text-slate-100' : 'text-slate-300'}`}>
        {ultimaMsg ? ultimaMsg.texto : 'Sem mensagens'}
      </div>

      {c.statusAtendimento === 'pendente' && (
        <button
          onClick={e => { e.stopPropagation(); onAtender(c.id, e); }}
          className="w-full mt-1 py-2 px-3 rounded-lg bg-ativo hover:bg-ativo-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-ativo/20 transition-all"
        >
          <UserCheck size={13} /> ATENDER CONVERSA
        </button>
      )}
    </div>
  );
});

const EMOJIS = ['😀','😁','😂','🥰','😅','😉','👍','🙏','🎉','✅','❌','🔥','💰','📄','📎','⚠️','🤝','👏','🚀','📌'];

function tipoDoArquivo(file) {
  if (file.type.startsWith('image/')) return 'imagem';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return 'documento';
}

function PainelChat({
  conversa, parceiros,
  texto, setTexto, scrollRef, onEnviar, onEnviarMidia, onFechar, onPendente, onReabrir,
  onMarcarLido, onApagarChat, onSolicitarCnpj, onValidarCnpjModal,
  onExecutarFluxo, fluxoSugerido, onVoltar, atendente, onTransferir,
  onEditar, onEncaminharPara, conversas, onAtender
}) {
  const [showMsgRapidas, setShowMsgRapidas] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [imagemAmpliada, setImagemAmpliada] = useState(null);
  const [respondendoA, setRespondendoA] = useState(null);   // mensagem citada
  const [encaminhando, setEncaminhando] = useState(null);   // mensagem a encaminhar
  const [editando, setEditando] = useState(null);           // { id, textoOriginal }

  const iniciarEdicao = useCallback((m) => {
    setEditando({ id: m.id, textoOriginal: m.texto });
    setRespondendoA(null);
    setTexto(m.texto);
  }, [setTexto]);

  const cancelarEdicao = useCallback(() => {
    setEditando(null);
    setTexto('');
  }, [setTexto]);
  const [anexo, setAnexo] = useState(null); // { dataUrl, tipo, mimetype, fileName, progresso }
  const [enviandoMidia, setEnviandoMidia] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const fileInputRef = useRef(null);
  const cancelarRef = useRef(null);
  // Scroll inteligente: so gruda no fim se o usuario ja estava perto do fim.
  const [temNovas, setTemNovas] = useState(false);
  const pertoDoFimRef = useRef(true);
  const totalMsgRef = useRef(conversa.mensagens.length);
  const meta = STATUS_META[conversa.statusAtendimento] || STATUS_META.pendente;
  const encerrada = conversa.statusAtendimento === 'fechada';

  // Le o arquivo como data URL (base64) para preview e envio.
  const selecionarArquivo = useCallback((file) => {
    if (!file) return;
    const MAX = 25 * 1024 * 1024; // 25MB
    if (file.size > MAX) { window.alert('Arquivo muito grande (máx. 25MB).'); return; }
    const reader = new FileReader();
    reader.onload = () => setAnexo({
      dataUrl: reader.result,
      tipo: tipoDoArquivo(file),
      mimetype: file.type || 'application/octet-stream',
      fileName: file.name,
      progresso: 0
    });
    reader.readAsDataURL(file);
  }, []);

  const cancelarAnexo = useCallback(() => {
    if (cancelarRef.current) cancelarRef.current();
    cancelarRef.current = null;
    setAnexo(null);
    setEnviandoMidia(false);
  }, []);

  const enviarAnexo = useCallback(async () => {
    if (!anexo || enviandoMidia) return;
    setEnviandoMidia(true);
    const payload = {
      tipo: anexo.tipo,
      media: anexo.dataUrl,
      mimetype: anexo.mimetype,
      fileName: anexo.fileName,
      ...(texto.trim() ? { caption: texto.trim() } : {})
    };
    const { promise, cancel } = onEnviarMidia(payload, (p) =>
      setAnexo((a) => (a ? { ...a, progresso: p } : a))
    );
    cancelarRef.current = cancel;
    try {
      await promise;
      setAnexo(null);
      setTexto('');
      setTimeout(() => irParaFim(true), 0);
    } catch (e) {
      if (String(e.message) !== 'cancelado') window.alert('Falha ao enviar mídia: ' + e.message);
    } finally {
      setEnviandoMidia(false);
      cancelarRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anexo, enviandoMidia, texto, onEnviarMidia, setTexto]);

  const aoRolar = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const perto = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    pertoDoFimRef.current = perto;
    if (perto) setTemNovas(false);
  }, [scrollRef]);

  const irParaFim = useCallback((suave = true) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: suave ? 'smooth' : 'auto' });
    pertoDoFimRef.current = true;
    setTemNovas(false);
  }, [scrollRef]);

  // Ao trocar de conversa: vai direto pro fim (sem animacao).
  useEffect(() => { irParaFim(false); /* eslint-disable-next-line */ }, [conversa.id]);

  // Chegou mensagem nova: desce se o usuario estava lendo o fim; senao sinaliza.
  useEffect(() => {
    const total = conversa.mensagens.length;
    if (total > totalMsgRef.current) {
      if (pertoDoFimRef.current) irParaFim(true);
      else setTemNovas(true);
    }
    totalMsgRef.current = total;
  }, [conversa.mensagens.length, irParaFim]);

  const enviar = useCallback(() => {
    if (anexo) { enviarAnexo(); return; }
    if (!texto.trim()) return;

    if (editando) {
      onEditar(editando.id, texto.trim());
      setEditando(null);
      setTexto('');
      return;
    }

    onEnviar(texto, respondendoA?.id || null);
    setRespondendoA(null);
    // Envio do operador sempre desce a conversa.
    setTimeout(() => irParaFim(true), 0);
  }, [anexo, enviarAnexo, onEnviar, onEditar, texto, irParaFim, respondendoA, editando, setTexto]);

  const ehParceiro = conversa.cnpjVerificado &&
    parceiros.some(p => p.cnpj === limparCnpj(conversa.cnpj) && p.status === 'ativo');
  const parceiroCadastrado = conversa.cnpjVerificado
    ? parceiros.find(p => p.cnpj === limparCnpj(conversa.cnpj))
    : null;

  return (
    <>
      <div className="p-4 bg-grafite-600/80 border-b border-linha flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 sm:gap-3">
          <button onClick={onVoltar} title="Voltar para a lista"
            className="lg:hidden p-1.5 -ml-1 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors">
            <ChevronLeft size={18} />
          </button>
          <Avatar nome={conversa.cliente} size="md" fotoUrl={conversa.fotoUrl} />
          <div>
          <div className="font-bold text-sm text-white flex items-center gap-2 flex-wrap">
            {conversa.cliente}
            <span className="text-xs font-normal text-slate-400 font-mono">({conversa.telefone})</span>
         
            <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-bold border ${meta.chip}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
              {meta.label}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            {!conversa.cnpjVerificado
              ? <EmojiIcon name="question" label="CNPJ Pendente" size="sm" />
              : ehParceiro
                ? <EmojiIcon name="shield" label={`${parceiroCadastrado?.razaoSocial} (${mascararCnpj(conversa.cnpj)})`} size="sm" />
                : <EmojiIcon name="warning" label={`CNPJ ${mascararCnpj(conversa.cnpj)} (Sem Contrato)`} size="sm" />
            }
            {atendente && (
              <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/30 font-semibold"
                title={`Conversa atribuida a ${atendente.nome}`}>
                <UserCheck size={11} /> {atendente.nome}
              </span>
            )}
          </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {!conversa.cnpjVerificado && (
            <>
              <button onClick={onSolicitarCnpj}
                className="px-2.5 py-1.5 rounded-lg bg-acao/15 hover:bg-acao/25 text-acao-200 text-xs font-semibold border border-acao/30 transition-all">
                🤖 Pedir CNPJ
              </button>
              <button onClick={onValidarCnpjModal}
                className="px-2.5 py-1.5 rounded-lg bg-blue-500/15 hover:bg-blue-500/25 text-blue-400 text-xs font-semibold border border-blue-500/30 transition-all">
                🔎 Validar CNPJ
              </button>
            </>
          )}

          {conversa.naoLidas > 0 && (
            <button onClick={() => onMarcarLido(conversa.id)}
              title="Marcar como lido"
              className="px-2.5 py-1.5 rounded-lg bg-slate-700/50 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-linha transition-all flex items-center gap-1">
              <CheckCheck size={13} /> Lido
            </button>
          )}

          {encerrada ? (
            <button onClick={() => onReabrir(conversa.id)}
              title="Reabrir atendimento"
              className="px-2.5 py-1.5 rounded-lg bg-ativo/15 hover:bg-ativo/25 text-ativo-400 text-xs font-semibold border border-ativo/30 transition-all flex items-center gap-1">
              <RotateCcw size={13} /> Reabrir
            </button>
          ) : (
            <>
              {conversa.statusAtendimento === 'pendente' ? (
                // Sem esta acao aqui, uma conversa pendente aberta vira beco sem
                // saida: nao da para responder nem para assumir sem fechar o
                // painel e voltar para a lista.
                <button onClick={() => onAtender(conversa.id)}
                  title="Assumir o atendimento (libera a resposta)"
                  className="px-2.5 py-1.5 rounded-lg bg-ativo/15 hover:bg-ativo/25 text-ativo-400 text-xs font-semibold border border-ativo/30 transition-all flex items-center gap-1">
                  <UserCheck size={13} /> Atender
                </button>
              ) : (
                <button onClick={() => onPendente(conversa.id)}
                  title="Devolver para a fila (Pendente)"
                  className="px-2.5 py-1.5 rounded-lg bg-espera/15 hover:bg-espera/25 text-espera-400 text-xs font-semibold border border-espera/30 transition-all flex items-center gap-1">
                  <Clock size={13} /> Pendente
                </button>
              )}
              <button onClick={() => onFechar(conversa.id)}
                title="Fechar atendimento"
                className="px-2.5 py-1.5 rounded-lg bg-falha/15 hover:bg-falha/25 text-falha-400 text-xs font-semibold border border-falha/30 transition-all flex items-center gap-1">
                <CheckCircle2 size={13} /> Fechar
              </button>
            </>
          )}

          <button onClick={onTransferir}
            title="Transferir conversa para outro atendente"
            className="px-2.5 py-1.5 rounded-lg bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 text-xs font-semibold border border-purple-500/30 transition-all flex items-center gap-1">
            <ArrowRightLeft size={13} /> Transferir
          </button>

          <button onClick={() => onApagarChat(conversa.id)}
            className="p-1.5 rounded-lg bg-falha/15 hover:bg-falha/25 text-falha-400 border border-falha/30 transition-all">
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <div ref={scrollRef} onScroll={aoRolar}
        onDragOver={(e) => { e.preventDefault(); if (!arrastando) setArrastando(true); }}
        onDragLeave={(e) => { e.preventDefault(); setArrastando(false); }}
        onDrop={(e) => { e.preventDefault(); setArrastando(false); const f = e.dataTransfer.files?.[0]; if (f) selecionarArquivo(f); }}
        style={WHATSAPP_BG} className="flex-1 overflow-y-auto p-4 space-y-3 relative">
        {arrastando && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/70 border-2 border-dashed border-acao rounded-xl pointer-events-none">
            <div className="text-acao-200 font-bold text-sm flex items-center gap-2">
              <Paperclip size={18} /> Solte o arquivo para anexar
            </div>
          </div>
        )}
        {conversa.mensagens.map((m, i) => (
          <div key={i} className={`group flex items-center gap-1 ${m.de === 'cliente' ? 'justify-start' : m.de === 'sistema' ? 'justify-center' : 'justify-end'}`}>
            {/* Nas mensagens enviadas por nos (direita), o menu fica a ESQUERDA da bolha */}
            {m.de !== 'cliente' && m.de !== 'sistema' && (
              <MenuMensagem
                m={m}
                ehPropria
                onResponder={setRespondendoA}
                onEncaminhar={setEncaminhando}
                onEditar={iniciarEdicao}
              />
            )}
            {m.de === 'sistema' ? (
              <div className="text-[10px] text-texto-suave bg-grafite-700/90 border border-linha px-3 py-1.5 rounded-full">
                {m.texto}
              </div>
            ) : (
              <div className={`max-w-[80%] p-3.5 rounded-2xl text-xs shadow-md space-y-1 ${
                /* O papel de parede em uso e a arte ESCURA do WhatsApp, entao as
                   bolhas seguem o tema escuro: recebida em #202C33, enviada em
                   #005C4B, texto claro. Bolha branca aqui brilharia demais. */
                m.de === 'cliente'
                  ? 'bg-grafite-600 text-texto rounded-tl-sm'
                  : 'bg-bolha text-texto rounded-tr-sm'
              }`}>
                <div className="text-[10px] font-semibold text-texto-suave">
                  {m.de === 'cliente' ? conversa.cliente : 'Arka Tecnologia'}
                </div>

                {/* Trecho citado (recurso "responder") */}
                {m.respondendoAId && (() => {
                  const orig = conversa.mensagens.find(x => x.id === m.respondendoAId);
                  if (!orig) return null;
                  return (
                    <div className={`text-[10px] px-2 py-1 rounded-lg border-l-2 mb-1 truncate ${
                      m.de === 'cliente'
                        ? 'bg-grafite-800/70 border-acao/60 text-texto-suave'
                        : 'bg-grafite-900/30 border-acao-200/70 text-texto-suave'
                    }`}>
                      {orig.texto}
                    </div>
                  );
                })()}

                {m.tipo && m.tipo !== 'texto' ? (
                  <>
                    <MensagemMidia m={m} escuro onAbrirImagem={setImagemAmpliada} />
                    {m.midia?.caption && <FormattedMessage text={m.midia.caption} />}
                  </>
                ) : (
                  <FormattedMessage text={m.texto} />
                )}

                <div className="text-[9px] flex items-center justify-end gap-1 text-texto-suave">
                  {m.editada && <span className="italic">editada</span>}
                  <span>{m.hora}</span>
                  <StatusMensagem status={m.status} escuro />
                </div>
              </div>
            )}

            {/* Nas mensagens do cliente (esquerda), o menu fica a DIREITA da bolha */}
            {m.de === 'cliente' && (
              <MenuMensagem
                m={m}
                ehPropria={false}
                onResponder={setRespondendoA}
                onEncaminhar={setEncaminhando}
                onEditar={iniciarEdicao}
              />
            )}
          </div>
        ))}
      </div>

      {temNovas && (
        <div className="relative">
          <button
            onClick={() => irParaFim(true)}
            className="absolute -top-10 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 rounded-full bg-acao text-slate-950 text-[11px] font-bold shadow-lg shadow-black/30 flex items-center gap-1 hover:bg-acao-200 transition-colors"
          >
            Novas mensagens <ArrowDown size={13} />
          </button>
        </div>
      )}

      {fluxoSugerido && (
        <div className="mx-4 mb-2 p-3 rounded-xl bg-acao/10 border border-acao/30 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <EmojiIcon name="lightning" label="" size="sm" />
            <div>
              <div className="text-xs font-bold text-white">Executar: {fluxoSugerido.nome}</div>
              <div className="text-[11px] text-slate-400">Gatilho "{fluxoSugerido.gatilho}" identificado.</div>
            </div>
          </div>
          <button onClick={() => onExecutarFluxo(fluxoSugerido)}
            className="px-3 py-1.5 rounded-lg bg-acao text-slate-950 text-xs font-bold flex items-center gap-1 hover:bg-acao-200 transition-colors shadow-sm">
            <Play size={12} /> Disparar
          </button>
        </div>
      )}

      {/* Respondendo a uma mensagem (citação) */}
      {respondendoA && (
        <div className="mx-3 mb-2 p-2.5 rounded-xl bg-grafite-700 border border-linha border-l-4 border-l-acao flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-bold text-acao-200 mb-0.5 flex items-center gap-1">
              <CornerUpLeft size={11} /> Respondendo {respondendoA.de === 'cliente' ? conversa.cliente : 'você'}
            </div>
            <div className="text-[11px] text-slate-400 truncate">{respondendoA.texto}</div>
          </div>
          <button onClick={() => setRespondendoA(null)} className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 shrink-0">
            <X size={13} />
          </button>
        </div>
      )}

      {/* Editando uma mensagem já enviada */}
      {editando && (
        <div className="mx-3 mb-2 p-2.5 rounded-xl bg-grafite-700 border border-linha border-l-4 border-l-lida flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-bold text-lida-400 mb-0.5 flex items-center gap-1">
              <Pencil size={11} /> Editando mensagem
            </div>
            <div className="text-[11px] text-slate-400 truncate">{editando.textoOriginal}</div>
          </div>
          <button onClick={cancelarEdicao} className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 shrink-0">
            <X size={13} />
          </button>
        </div>
      )}

      {/* Escolher a conversa de destino ao encaminhar */}
      {encaminhando && (
        <Portal>
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-[55] p-4">
            <div className="glass-panel border border-linha rounded-2xl w-full max-w-md shadow-2xl flex flex-col max-h-[80vh]">
              <div className="p-4 bg-grafite-600 border-b border-linha flex items-center justify-between rounded-t-2xl">
                <div className="flex items-center gap-2 text-sm font-bold text-white">
                  <Share2 size={16} className="text-acao-200" /> Encaminhar para
                </div>
                <button onClick={() => setEncaminhando(null)} className="text-slate-400 hover:text-white"><X size={16} /></button>
              </div>
              <div className="p-3 text-[11px] text-slate-400 border-b border-linha truncate">
                “{encaminhando.texto}”
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {(conversas || []).filter(c => c.id !== conversa.id).map(c => (
                  <button key={c.id}
                    onClick={() => { onEncaminharPara(encaminhando.id, c.id); setEncaminhando(null); }}
                    className="w-full text-left p-3 rounded-xl bg-grafite-700 border border-linha hover:border-acao/40 hover:bg-grafite-600 transition-all flex items-center gap-3">
                    <Avatar nome={c.cliente} size="sm" fotoUrl={c.fotoUrl} />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white truncate">{c.cliente}</div>
                      <div className="text-[10px] text-slate-500 font-mono">{c.telefone}</div>
                    </div>
                  </button>
                ))}
                {(conversas || []).filter(c => c.id !== conversa.id).length === 0 && (
                  <div className="text-center text-xs text-slate-500 py-8">Nenhuma outra conversa disponível.</div>
                )}
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* Preview do anexo + barra de progresso */}
      {anexo && (
        <div className="mx-3 mb-2 p-2.5 rounded-xl bg-grafite-700 border border-linha flex items-center gap-3">
          {anexo.tipo === 'imagem' ? (
            <img src={anexo.dataUrl} alt="preview" className="w-12 h-12 rounded-lg object-cover shrink-0" />
          ) : (
            <div className="w-12 h-12 rounded-lg bg-grafite-600 border border-linha flex items-center justify-center shrink-0 text-acao-200">
              {anexo.tipo === 'video' ? <Play size={18} /> : anexo.tipo === 'audio' ? <Zap size={18} /> : <FileText size={18} />}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold text-white truncate">{anexo.fileName}</div>
            <div className="text-[10px] text-slate-500 uppercase">{anexo.tipo}</div>
            {enviandoMidia && (
              <div className="mt-1 h-1.5 rounded-full bg-slate-700 overflow-hidden">
                <div className="h-full bg-acao transition-all" style={{ width: `${anexo.progresso || 0}%` }} />
              </div>
            )}
          </div>
          <button onClick={cancelarAnexo} title={enviandoMidia ? 'Cancelar envio' : 'Remover anexo'}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-falha/20 text-falha-400 shrink-0">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Responder exige a conversa ABERTA. Fora disso a barra some inteira, sem
          aviso no lugar: o cabecalho ja mostra o status e o botao que destrava
          (Atender ou Reabrir). */}
      {conversa.statusAtendimento === 'aberta' && (
      // Em telas estreitas os quatro botoes comiam a barra e sobravam ~136px de
      // 334 para escrever. Com `flex-wrap` e o campo em `order-first w-full`, o
      // texto ganha uma linha inteira so dele e os botoes descem para a de
      // baixo. A partir de `sm` volta tudo para uma linha unica.
      <div className="p-3 bg-grafite-600/80 border-t border-linha flex flex-wrap items-center gap-2 relative">
        {showMsgRapidas && (
          <PainelMensagensRapidas
            onSelecionar={txt => { setTexto(txt); setShowMsgRapidas(false); }}
            onFechar={() => setShowMsgRapidas(false)}
          />
        )}

        {showEmoji && (
          <div className="absolute bottom-full left-2 mb-2 p-2 glass-panel border border-linha rounded-2xl shadow-2xl z-30 grid grid-cols-5 gap-1 w-56">
            {EMOJIS.map(e => (
              <button key={e} onClick={() => { setTexto(t => t + e); setShowEmoji(false); }}
                className="text-lg rounded-lg hover:bg-grafite-600 p-1 transition-colors">{e}</button>
            ))}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) selecionarArquivo(f); e.target.value = ''; }}
        />

        <button
          onClick={() => fileInputRef.current?.click()}
          title="Anexar arquivo"
          className="p-2.5 rounded-xl border bg-grafite-700 border-linha text-slate-400 hover:text-acao-200 hover:border-acao/30 transition-all"
        >
          <Paperclip size={15} />
        </button>

        <button
          onClick={() => setShowEmoji(v => !v)}
          title="Emoji"
          className={`p-2.5 rounded-xl border transition-all ${
            showEmoji ? 'bg-acao/20 border-acao/40 text-acao-200' : 'bg-grafite-700 border-linha text-slate-400 hover:text-acao-200 hover:border-acao/30'
          }`}
        >
          <Smile size={15} />
        </button>

        <button
          onClick={() => setShowMsgRapidas(v => !v)}
          title="Mensagens rápidas"
          className={`p-2.5 rounded-xl border transition-all ${
            showMsgRapidas
              ? 'bg-acao/20 border-acao/40 text-acao-200'
              : 'bg-grafite-700 border-linha text-slate-400 hover:text-acao-200 hover:border-acao/30'
          }`}
        >
          <Zap size={15} />
        </button>

        <textarea
          value={texto}
          rows={1}
          onChange={e => setTexto(e.target.value)}
          onKeyDown={e => {
            // Enter envia; Ctrl/Cmd+Enter envia; Shift+Enter quebra linha.
            if (e.key === 'Enter' && (!e.shiftKey || e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              enviar();
            }
          }}
          placeholder={anexo ? 'Legenda (opcional)...' : 'Digite sua mensagem ou CNPJ...  (Enter envia · Shift+Enter quebra linha)'}
          className="order-first w-full sm:order-none sm:w-auto sm:flex-1 min-w-0 resize-none max-h-32 bg-grafite-700 border border-linha rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-acao/50 transition-colors"
        />
        <button
          onClick={enviar}
          disabled={enviandoMidia}
          className="ml-auto sm:ml-0 p-2.5 rounded-xl bg-acao hover:bg-acao-200 disabled:opacity-50 text-slate-950 transition-colors shadow-md shadow-acao/20 self-end"
        >
          {enviandoMidia ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
        </button>
      </div>
      )}

      {imagemAmpliada && (
        <VisualizadorImagem
          url={imagemAmpliada.url}
          legenda={imagemAmpliada.legenda}
          nomeArquivo={imagemAmpliada.nomeArquivo}
          onFechar={() => setImagemAmpliada(null)}
        />
      )}
    </>
  );
}

export default function AtendimentoView({ conversas, setConversas, fluxos, parceiros, equipe = [] }) {
  const { whatsAppConectado, carregando, historico = [], marcarNotificacoesLidas, limparHistorico } = useAppContext();
  const [abaAtual,      setAbaAtual]     = usePreferencia('central.aba', 'todas');
  const [selecionada,   setSelecionada]  = useState(null);
  const [texto,         setTexto]        = useState('');
  const [espiandoChat,  setEspiandoChat] = useState(null);
  const [modalCnpj,     setModalCnpj]    = useState(false);
  const [inputCnpj,     setInputCnpj]    = useState('');
  // Semente vinda de "Iniciar chat" nos Contatos (/atendimento?busca=5511...).
  const [busca,         setBusca]        = useState(
    () => new URLSearchParams(window.location.search).get('busca') || ''
  );
  // Persistidos por operador: sobrevivem ao F5 e acompanham a reconexao.
  const [filtrosExtra,  setFiltrosExtra] = usePreferencia('central.filtrosExtra', []);
  const [visibilidade,  setVisibilidade] = usePreferencia('central.visibilidade', VISIBILIDADE_PADRAO);
  const [showFiltros,   setShowFiltros]  = useState(false);
  const [modoTv, setModoTv] = useState(false);
  const filtrosRef = useRef(null);

  // Pede tela cheia de verdade ao navegador: numa TV, a barra do sistema e o
  // cabecalho do Windows roubam espaco util. Se o navegador recusar, o painel
  // ainda abre por cima de tudo.
  const abrirModoTv = useCallback(async () => {
    setModoTv(true);
    try { await document.documentElement.requestFullscreen?.(); } catch { /* permissao negada */ }
  }, []);

  const fecharModoTv = useCallback(async () => {
    setModoTv(false);
    try { if (document.fullscreenElement) await document.exitFullscreen?.(); } catch { /* ignora */ }
  }, []);

  // Sair da tela cheia pelo F11/Esc do navegador tambem fecha o painel.
  useEffect(() => {
    const onFs = () => { if (!document.fullscreenElement) setModoTv(false); };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);
  const [sinoTocando,   setSinoTocando]  = useState(false);
  const [showNotif,     setShowNotif]    = useState(false);
  const [atendentes,    setAtendentes]   = useState(lerAtendentes);
  const [transferindo,  setTransferindo] = useState(null); // conversa alvo do modal de transferencia
  const scrollRef = useRef(null);
  const totalMsgClienteRef = useRef(null);
  const sinoRef = useRef(null);

  const conversa = conversas.find(c => c.id === selecionada);

  // Notificacoes ainda nao lidas do historico (sino).
  const naoLidasSino = historico.filter(n => !n.lida).length;

  // Abre/fecha o painel do sino. Ao abrir, marca tudo como lido (zera o badge).
  const alternarNotif = useCallback(() => {
    setShowNotif(prev => {
      const abrindo = !prev;
      if (abrindo && marcarNotificacoesLidas) marcarNotificacoesLidas();
      return abrindo;
    });
  }, [marcarNotificacoesLidas]);

  // Clicar fora fecha o painel do sino.
  useEffect(() => {
    if (!showNotif) return;
    const onDoc = (e) => {
      if (sinoRef.current && !sinoRef.current.contains(e.target)) setShowNotif(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [showNotif]);

  // Clicar fora fecha o painel de filtros.
  useEffect(() => {
    if (!showFiltros) return;
    const onDoc = (e) => {
      if (filtrosRef.current && !filtrosRef.current.contains(e.target)) setShowFiltros(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [showFiltros]);

  // Transfere a conversa para um membro da equipe (persistido em localStorage).
  const transferirConversa = useCallback((conv, membro) => {
    setAtendentes(prev => {
      const novo = { ...prev, [conv.id]: { nome: membro.nome, cargo: membro.cargo || '', em: Date.now() } };
      salvarAtendentes(novo);
      return novo;
    });
    setTransferindo(null);
  }, []);

  // Flags agora vivem no banco (antes: localStorage). Otimista + confirma na API.
  const atualizarFlag = useCallback(async (id, flags) => {
    setConversas(prev => prev.map(c => c.id === id ? { ...c, ...flags } : c));
    try {
      const atualizada = await ConversasAPI.atualizarFlags(id, flags);
      if (atualizada?.id) setConversas(prev => prev.map(c => c.id === atualizada.id ? atualizada : c));
    } catch {
      // Falhou: desfaz o otimismo invertendo as flags aplicadas.
      setConversas(prev => prev.map(c =>
        c.id === id ? { ...c, ...Object.fromEntries(Object.entries(flags).map(([k, v]) => [k, !v])) } : c
      ));
    }
  }, [setConversas]);

  const alternarFixado = useCallback((id) => {
    const atual = conversas.find(c => c.id === id);
    atualizarFlag(id, { fixada: !atual?.fixada });
  }, [conversas, atualizarFlag]);

  // Sino + som: dispara quando o total de mensagens de clientes aumenta
  // (nova mensagem recebida via polling do AppContext).
  const totalMsgCliente = conversas.reduce(
    (acc, c) => acc + (c.mensagens || []).filter(m => m.de === 'cliente').length, 0
  );
  useEffect(() => {
    if (totalMsgClienteRef.current === null) {
      totalMsgClienteRef.current = totalMsgCliente;
      return;
    }
    if (totalMsgCliente > totalMsgClienteRef.current) {
      // O som toca globalmente (AppContext); aqui só animamos o sino.
      setSinoTocando(true);
      const t = setTimeout(() => setSinoTocando(false), 1600);
      totalMsgClienteRef.current = totalMsgCliente;
      return () => clearTimeout(t);
    }
    totalMsgClienteRef.current = totalMsgCliente;
  }, [totalMsgCliente]);

  // Ao abrir uma conversa com nao-lidas, marca como lida (zera o badge).
  useEffect(() => {
    if (!conversa) return;
    if ((conversa.statusAtendimento === 'aberta' || conversa.statusAtendimento === 'fechada') && conversa.naoLidas > 0) {
      marcarComoLido(conversa.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selecionada]);

  useEffect(() => {
    if (!selecionada) return;
    const conv = conversas.find(c => c.id === selecionada);
    if (!conv) { setSelecionada(null); return; }
    const aba = ABAS.find(a => a.id === abaAtual);
    if (aba && !aba.statusMatch(conv)) setSelecionada(null);
  }, [abaAtual, conversas]);

  // Tudo que filtra a lista MENOS a aba: visibilidade, filtros extras e busca.
  // Separado de proposito -- os contadores das abas reusam exatamente este
  // criterio, so trocando o status. Enquanto contador e lista usavam regras
  // diferentes, a aba anunciava "Abertas (1)" com a lista vazia embaixo, e nada
  // na tela explicava a contradicao.
  const passaFiltros = (c) => {
    // Visibilidade: esconde da lista sem apagar nada do banco.
    if (c.arquivada && !visibilidade.arquivadas) return false;
    if (c.oculta && !visibilidade.ocultas) return false;
    // Sem excecao por aba: desmarcado significa escondido em qualquer lugar.
    if (c.statusAtendimento === 'fechada' && !visibilidade.fechadas) return false;

    // Filtros extras: todos os marcados precisam bater (AND).
    for (const id of filtrosExtra) {
      const f = FILTROS_EXTRA.find(x => x.id === id);
      if (f && !f.testa(c)) return false;
    }

    if (!busca.trim()) return true;
    const q = busca.toLowerCase();
    const qDigitos = q.replace(/\D/g, '');
    return c.cliente.toLowerCase().includes(q) ||
           (c.telefone || '').includes(q) ||
           (qDigitos && limparCnpj(c.cnpj).includes(qDigitos)) ||
           (c.cnpj && mascararCnpj(c.cnpj).toLowerCase().includes(q)) ||
           c.mensagens.some(m => m.texto.toLowerCase().includes(q));
  };

  const visiveis = conversas.filter(passaFiltros);

  const conversasFiltradas = visiveis
    .filter(c => ABAS.find(a => a.id === abaAtual)?.statusMatch(c))
    .sort((a, b) => (b.fixada ? 1 : 0) - (a.fixada ? 1 : 0));

  // Abas realmente exibidas: os checkboxes escondem "Todas" e "Fechadas".
  const abasVisiveis = ABAS.filter(a => {
    const chave = Object.keys(ABA_POR_VISIBILIDADE).find(k => ABA_POR_VISIBILIDADE[k] === a.id);
    return chave ? visibilidade[chave] : true;
  });

  // Se a aba atual foi escondida, cai para a primeira disponivel.
  useEffect(() => {
    if (!abasVisiveis.some(a => a.id === abaAtual) && abasVisiveis.length > 0) {
      setAbaAtual(abasVisiveis[0].id);
    }
  }, [abasVisiveis, abaAtual]);

  // Badge do botao: quantos filtros fogem do padrao.
  const totalFiltrosAtivos =
    filtrosExtra.length +
    Object.keys(VISIBILIDADE_PADRAO).filter(k => visibilidade[k] !== VISIBILIDADE_PADRAO[k]).length;

  const contadores = ABAS.reduce((acc, aba) => {
    acc[aba.id] = visiveis.filter(aba.statusMatch).length;
    return acc;
  }, {});

  // Atualiza uma conversa no estado global a partir da resposta do back-end.
  const aplicarConversa = useCallback((atualizada) => {
    if (!atualizada?.id) return;
    setConversas(prev => prev.map(c => c.id === atualizada.id ? atualizada : c));
  }, [setConversas]);

  const atenderConversa = useCallback(async (id, e) => {
    if (e) e.stopPropagation();
    setAbaAtual('abertas');
    setSelecionada(id);
    setConversas(prev => prev.map(c =>
      c.id === id ? { ...c, statusAtendimento: 'aberta', lido: true, naoLidas: 0 } : c
    ));
    try { aplicarConversa(await ConversasAPI.atender(id)); } catch {}
  }, [setConversas, aplicarConversa]);

  const fecharConversa = useCallback(async (id) => {
    setSelecionada(null);
    setAbaAtual('fechadas');
    setConversas(prev => prev.map(c =>
      c.id === id ? { ...c, statusAtendimento: 'fechada', lido: true, naoLidas: 0 } : c
    ));
    try { aplicarConversa(await ConversasAPI.fechar(id)); } catch {}
  }, [setConversas, aplicarConversa]);

  const moverPendente = useCallback(async (id) => {
    setConversas(prev => prev.map(c =>
      c.id === id ? { ...c, statusAtendimento: 'pendente' } : c
    ));
    try { aplicarConversa(await ConversasAPI.pendente(id)); } catch {}
  }, [setConversas, aplicarConversa]);

  const reabrirConversa = useCallback(async (id) => {
    setAbaAtual('abertas');
    setSelecionada(id);
    setConversas(prev => prev.map(c =>
      c.id === id ? { ...c, statusAtendimento: 'aberta', fechadoEm: null } : c
    ));
    try { aplicarConversa(await ConversasAPI.reabrir(id)); } catch {}
  }, [setConversas, aplicarConversa]);

  const marcarComoLido = useCallback(async (id) => {
    setConversas(prev => prev.map(c => c.id === id ? { ...c, lido: true, naoLidas: 0 } : c));
    try { aplicarConversa(await ConversasAPI.marcarLido(id)); } catch {}
  }, [setConversas, aplicarConversa]);

  // Remove da tela SO depois que o servidor confirma. Antes era otimista com
  // `catch {}`: se o DELETE falhasse, o proximo polling (8s) trazia a conversa
  // de volta sozinha -- e no F5 ela estava la de novo
  const apagarChat = useCallback(async (id, e) => {
    if (e) e.stopPropagation();
    if (!window.confirm('Deseja realmente apagar este atendimento?')) return;
    try {
      await ConversasAPI.remover(id);
      setConversas(prev => prev.filter(c => c.id !== id));
      if (selecionada === id) setSelecionada(null);
    } catch (err) {
      window.alert(
        `Nao foi possivel apagar o atendimento: ${err.message}\n\n` +
        'Verifique se o back-end esta rodando (cd server && npm run dev).'
      );
    }
  }, [setConversas, selecionada]);

  const editarMensagem = useCallback(async (mensagemId, texto) => {
    try {
      aplicarConversa(await ConversasAPI.editarMensagem(mensagemId, texto));
    } catch (e) {
      window.alert('Não foi possível editar: ' + e.message);
    }
  }, [aplicarConversa]);

  const encaminharMensagem = useCallback(async (mensagemId, conversaDestinoId) => {
    try {
      aplicarConversa(await ConversasAPI.encaminharMensagem(mensagemId, conversaDestinoId));
    } catch (e) {
      window.alert('Não foi possível encaminhar: ' + e.message);
    }
  }, [aplicarConversa]);

  const enviarResposta = useCallback(async (txt, respondendoAId = null) => {
    if (!txt.trim() || !conversa) return;
    const id = conversa.id;
    // Otimista: mostra a mensagem da equipe na hora.
    setConversas(prev => prev.map(c =>
      c.id === id ? { ...c, mensagens: [...c.mensagens, { de: 'equipe', texto: txt.trim(), hora: horaAgora() }] } : c
    ));
    setTexto('');
    // O back-end persiste, detecta CNPJ e devolve a conversa completa.
    try { aplicarConversa(await ConversasAPI.enviarMensagem(id, txt.trim(), respondendoAId)); } catch {}
  }, [conversa, setConversas, aplicarConversa]);

  // Envio de mídia com progresso/cancelamento. Devolve { promise, cancel } para
  // o PainelChat controlar a barra e o botão de cancelar. A conversa atualizada
  // volta pela resposta (e também via SSE).
  const enviarMidia = useCallback((payload, onProgress) => {
    if (!conversa) return { promise: Promise.reject(new Error('sem conversa')), cancel: () => {} };
    const { promise, cancel } = ConversasAPI.enviarMidia(conversa.id, payload, onProgress);
    promise.then(atualizada => { if (atualizada) aplicarConversa(atualizada); }).catch(() => {});
    return { promise, cancel };
  }, [conversa, aplicarConversa]);

  const solicitarCnpjBot = useCallback(async () => {
    if (!conversa) return;
    try { aplicarConversa(await ConversasAPI.solicitarCnpj(conversa.id)); }
    catch {
      const msg = '[🤖 Arka Tecnologia]: Para prosseguirmos e verificar benefícios de parceiro, informe o CNPJ da sua empresa:';
      setConversas(prev => prev.map(c =>
        c.id === conversa.id ? { ...c, mensagens: [...c.mensagens, { de: 'equipe', texto: msg, hora: horaAgora() }] } : c
      ));
    }
  }, [conversa, setConversas, aplicarConversa]);

  const validarCnpjManual = useCallback(async () => {
    const c = limparCnpj(inputCnpj);
    if (!cnpjValido(c)) { alert('CNPJ inválido!'); return; }
    const id = conversa.id;
    setInputCnpj('');
    setModalCnpj(false);
    try { aplicarConversa(await ConversasAPI.validarCnpj(id, c)); }
    catch {
      const parceiroEncontrado = parceiros.find(p => p.cnpj === c && p.status === 'ativo');
      const msgBot = parceiroEncontrado
        ? `✅ CNPJ ${mascararCnpj(c)} identificado! Razão Social: ${parceiroEncontrado.razaoSocial} (Parceiro Cadastrado).`
        : `⚠️ CNPJ ${mascararCnpj(c)} não consta como parceiro cadastrado.`;
      setConversas(prev => prev.map(item =>
        item.id === id
          ? { ...item, cnpj: c, cnpjVerificado: true,
              mensagens: [...item.mensagens, { de: 'equipe', texto: `[🤖 Validação de CNPJ]: ${msgBot}`, hora: horaAgora() }] }
          : item
      ));
    }
  }, [inputCnpj, conversa, parceiros, setConversas, aplicarConversa]);

  const executarFluxo = useCallback(async (fluxo) => {
    if (!conversa || !fluxo) return;
    const id = conversa.id;
    const textos = fluxo.passos
      .filter(p => p.tipo === 'mensagem' || p.tipo === 'acao')
      .map(p => `[🤖 ${p.titulo}]: ${p.desc || p.texto || ''}`);
    try {
      let atualizada = null;
      for (const t of textos) atualizada = await ConversasAPI.enviarMensagem(id, t);
      if (atualizada) aplicarConversa(atualizada);
    } catch {
      const msgsBot = textos.map(t => ({ de: 'equipe', texto: t, hora: horaAgora() }));
      setConversas(prev => prev.map(c => c.id === id ? { ...c, mensagens: [...c.mensagens, ...msgsBot] } : c));
    }
  }, [conversa, setConversas, aplicarConversa]);

  const fluxoSugerido = conversa
    ? fluxos.find(f => f.ativo && conversa.mensagens.some(m =>
        m.de === 'cliente' && m.texto.toLowerCase().includes(f.gatilho)
      ))
    : null;

  const chatAberto = !!conversa;

  return (
    <div className="fade-in space-y-4 h-full flex flex-col">
  
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-linha">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight font-display">
            Central de Atendimentos
          </h1>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">
            Assuma conversas, consulte CNPJ e automatize respostas.
          </p>
        </div>

        {/* Sino + status do WhatsApp lado a lado, no canto direito. */}
        <div className="self-start sm:self-auto flex items-center gap-2">
          {/* Sino de notificacoes: abre o painel; NAO toca som ao clicar
              (o som so dispara quando chega mensagem, via AppContext). */}
          {/* Modo TV: so na aba Pendentes, que e a fila projetada na parede. */}
          {abaAtual === 'pendentes' && (
            <button
              onClick={abrirModoTv}
              title="Exibir a fila em tela cheia (TV)"
              className="flex items-center justify-center w-9 h-9 rounded-full border bg-grafite-700 border-linha text-texto-suave hover:text-white hover:border-acao/50 transition-colors"
            >
              <Tv size={16} />
            </button>
          )}

          <div className="relative" ref={sinoRef}>
            <button
              onClick={alternarNotif}
              title="Notificacoes"
              className={`relative flex items-center justify-center w-9 h-9 rounded-full border transition-colors ${
                naoLidasSino > 0
                  ? 'bg-acao/15 border-acao/40 text-acao-200'
                  : 'bg-slate-800/60 border-linha text-slate-400 hover:text-white'
              } ${sinoTocando ? 'animate-bounce' : ''}`}
            >
              <Bell size={15} className={sinoTocando ? 'fill-current' : ''} />
              {naoLidasSino > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-acao text-slate-950 text-[9px] font-extrabold flex items-center justify-center">
                  {naoLidasSino}
                </span>
              )}
            </button>

            {showNotif && (
              <div className="absolute right-0 top-full mt-2 w-[min(88vw,340px)] glass-panel border border-linha rounded-2xl shadow-2xl shadow-black/50 z-50 overflow-hidden fade-in">
                <div className="p-3 bg-grafite-600 border-b border-linha flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-white">
                    <Bell size={13} className="text-acao-200" /> Notificacoes
                  </div>
                  {historico.length > 0 && (
                    <button onClick={() => limparHistorico && limparHistorico()}
                      className="text-[11px] text-slate-400 hover:text-falha-400 transition-colors font-semibold">
                      Limpar
                    </button>
                  )}
                </div>
                <div className="max-h-80 overflow-y-auto divide-y divide-linha/60">
                  {historico.length === 0 && (
                    <div className="text-center text-slate-500 text-xs py-10">
                      <Bell size={26} className="text-slate-600 mx-auto mb-2" />
                      Nenhuma notificacao ainda.
                    </div>
                  )}
                  {historico.map(n => {
                    const ehAlerta = n.tipo === 'alerta';
                    return (
                      <button
                        key={n.id}
                        onClick={() => {
                          if (n.convId) { setAbaAtual('todas'); setSelecionada(n.convId); }
                          setShowNotif(false);
                        }}
                        className="w-full text-left p-3 flex items-start gap-2.5 hover:bg-grafite-600/70 transition-colors"
                      >
                        <span className={`mt-0.5 shrink-0 ${ehAlerta ? 'text-espera-400' : 'text-acao-200'}`}>
                          {ehAlerta ? <AlertCircle size={15} /> : <MessageSquare size={15} />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-bold text-white truncate">{n.cliente}</span>
                            <span className="text-[10px] text-slate-500 shrink-0">{tempoRelativo(n.em)}</span>
                          </div>
                          <p className="text-[11px] text-slate-400 truncate mt-0.5">{n.texto}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div
            title={whatsAppConectado ? 'WhatsApp conectado' : 'WhatsApp desconectado configure em Integração WhatsApp'}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold transition-colors ${
              whatsAppConectado
                ? 'bg-ativo/15 border-ativo/40 text-ativo-400'
                : 'bg-falha/15 border-falha/40 text-falha-400'
            }`}
          >
            {whatsAppConectado ? <Wifi size={14} /> : <WifiOff size={14} />}
            <span>WhatsApp {whatsAppConectado ? 'Online' : 'Offline'}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 min-h-0 lg:min-h-[550px]">

        <div className={`${chatAberto ? 'hidden lg:flex' : 'flex'} lg:col-span-4 glass-panel rounded-2xl flex-col overflow-hidden border border-linha min-h-[420px] lg:min-h-0`}>
       
          <div className="grid bg-grafite-600/80 border-b border-linha"
            style={{ gridTemplateColumns: `repeat(${Math.max(abasVisiveis.length, 1)}, minmax(0, 1fr))` }}>
            {abasVisiveis.map(aba => {
              const Icon  = aba.icon;
              const count = contadores[aba.id];
              const ativo = abaAtual === aba.id;
              return (
                <button key={aba.id} onClick={() => setAbaAtual(aba.id)}
                  className={`py-3 px-2 text-[11px] font-bold transition-all border-b-2 flex flex-col items-center justify-center gap-0.5 ${
                    ativo
                      ? 'border-acao text-acao-200 bg-grafite-700'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-1">
                    <Icon size={12} />
                    <span>{aba.label}</span>
                  </div>
                  <span className={`text-[10px] font-semibold ${ativo ? 'text-acao-200' : 'text-slate-500'}`}>
                    ({count})
                  </span>
                </button>
              );
            })}
          </div>

          <div className="p-2 border-b border-linha flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                value={busca}
                onChange={e => setBusca(e.target.value)}
                placeholder="Buscar conversa..."
                className="w-full bg-grafite-700 border border-linha rounded-xl pl-8 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-acao/50"
              />
            </div>

            <div className="relative shrink-0" ref={filtrosRef}>
              <button
                onClick={() => setShowFiltros(v => !v)}
                title="Filtros da lista"
                className={`relative p-2 rounded-xl border transition-all ${
                  showFiltros || totalFiltrosAtivos > 0
                    ? 'bg-acao/20 border-acao/40 text-acao-200'
                    : 'bg-grafite-700 border-linha text-slate-400 hover:text-acao-200 hover:border-acao/30'
                }`}
              >
                <SlidersHorizontal size={14} />
                {totalFiltrosAtivos > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-0.5 rounded-full bg-acao text-slate-950 text-[9px] font-extrabold flex items-center justify-center">
                    {totalFiltrosAtivos}
                  </span>
                )}
              </button>

              {showFiltros && (
                <PainelFiltros
                  extras={filtrosExtra}
                  setExtras={setFiltrosExtra}
                  visib={visibilidade}
                  setVisib={setVisibilidade}
                  totalAtivos={totalFiltrosAtivos}
                  onLimpar={() => { setFiltrosExtra([]); setVisibilidade(VISIBILIDADE_PADRAO); }}
                />
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {carregando && conversas.length === 0
              ? Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
              : conversasFiltradas.map(c => (
                <CardConversa
                  key={c.id}
                  c={c}
                  selecionada={selecionada}
                  parceiros={parceiros}
                  whatsAppConectado={whatsAppConectado}
                  onSelecionar={setSelecionada}
                  onAtender={atenderConversa}
                  onFechar={fecharConversa}
                  onReabrir={reabrirConversa}
                  onEspiar={setEspiandoChat}
                  onFixar={alternarFixado}
                  onFlag={atualizarFlag}
                  fixado={!!c.fixada}
                />
              ))}
            {!carregando && conversasFiltradas.length === 0 && (
              <div className="flex flex-col items-center justify-center text-center py-14 px-6 text-slate-400">
                <div className="inline-flex p-4 rounded-2xl bg-grafite-600 border border-linha mb-3 text-slate-500">
                  <Inbox size={30} />
                </div>
                <p className="text-xs font-semibold text-slate-300">Nenhuma conversa encontrada.</p>
                <p className="text-[11px] text-slate-500 mt-1">
                  {busca.trim() ? 'Ajuste a busca ou os filtros.' : 'As novas conversas aparecem aqui automaticamente.'}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className={`${chatAberto ? 'flex' : 'hidden lg:flex'} lg:col-span-8 glass-panel rounded-2xl flex-col overflow-hidden border border-linha min-h-[70vh] lg:min-h-0`}>
          {!conversa ? (
            <TelaSemConversa />
          ) : (
            <PainelChat
              conversa={conversa}
              parceiros={parceiros}
              texto={texto}
              setTexto={setTexto}
              scrollRef={scrollRef}
              onEnviar={enviarResposta}
              onEnviarMidia={enviarMidia}
              onFechar={fecharConversa}
              onPendente={moverPendente}
              onReabrir={reabrirConversa}
              onMarcarLido={marcarComoLido}
              onApagarChat={apagarChat}
              onSolicitarCnpj={solicitarCnpjBot}
              onValidarCnpjModal={() => setModalCnpj(true)}
              onExecutarFluxo={executarFluxo}
              fluxoSugerido={fluxoSugerido}
              onVoltar={() => setSelecionada(null)}
              atendente={atendentes[conversa.id]}
              onTransferir={() => setTransferindo(conversa)}
              onEditar={editarMensagem}
              onEncaminharPara={encaminharMensagem}
              onAtender={atenderConversa}
              conversas={conversas}
            />
          )}
        </div>
      </div>

      {espiandoChat && (
        <Portal>
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-start sm:items-center justify-center z-50 p-3 sm:p-4 overflow-y-auto">
          <div className="glass-panel border border-linha rounded-2xl w-full max-w-lg shadow-2xl fade-in my-auto flex flex-col max-h-[calc(100dvh-1.5rem)] sm:max-h-[90vh]">
            <div className="p-4 bg-grafite-600 border-b border-linha flex items-center justify-between shrink-0 rounded-t-2xl">
              <div className="flex items-center gap-2 font-bold text-sm text-white min-w-0">
                <Eye className="text-blue-400 shrink-0" size={16} />
                <span className="truncate">Espiando: {espiandoChat.cliente}</span>
              </div>
              <button onClick={() => setEspiandoChat(null)} className="text-slate-400 hover:text-white shrink-0 ml-2"><X size={16}/></button>
            </div>
            <div className="p-4 flex-1 overflow-y-auto min-h-0 space-y-2 text-xs">
              {espiandoChat.mensagens.map((m, idx) => (
                <div key={idx} className={`p-2.5 rounded-xl ${
                  m.de === 'cliente' ? 'bg-grafite-600 text-slate-200' : 'bg-acao/10 text-acao-200 border border-acao/20'
                }`}>
                  <div className="text-[10px] text-slate-400 mb-1">
                    {m.de === 'cliente' ? espiandoChat.cliente : 'Arka'} • {m.hora}
                  </div>
                  {m.texto}
                </div>
              ))}
            </div>
            <div className="p-4 bg-grafite-600 border-t border-linha flex justify-end shrink-0 rounded-b-2xl">
              <button onClick={() => setEspiandoChat(null)} className="px-3 py-2 sm:py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs font-semibold">Fechar</button>
            </div>
          </div>
        </div>
        </Portal>
      )}

      {modalCnpj && (
        <Portal>
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-start sm:items-center justify-center z-50 p-3 sm:p-4 overflow-y-auto">
          <div className="glass-panel border border-linha rounded-2xl w-full max-w-md p-5 sm:p-6 space-y-4 shadow-2xl fade-in my-auto">
            <h3 className="text-base font-bold text-white font-display">Validar CNPJ do Cliente</h3>
            <p className="text-xs text-slate-400">Insira o CNPJ para pesquisar o status do parceiro.</p>
            <input
              value={inputCnpj}
              onChange={e => setInputCnpj(mascararCnpj(e.target.value))}
              placeholder="00.000.000/0000-00"
              className="w-full bg-grafite-700 border border-linha rounded-xl px-3.5 py-2.5 text-xs text-white font-mono placeholder-slate-500 focus:outline-none focus:border-acao/50"
            />
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
              <button onClick={() => setModalCnpj(false)} className="px-3 py-2 sm:py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs font-semibold">Cancelar</button>
              <button onClick={validarCnpjManual} className="px-4 py-2 sm:py-1.5 rounded-lg bg-acao text-slate-950 text-xs font-bold">Validar</button>
            </div>
          </div>
        </div>
        </Portal>
      )}

      {modoTv && (
        <PainelTv
          // Mais antiga primeiro nas duas colunas: na fila e quem espera ha
          // mais tempo, no atendimento e quem esta parado ha mais tempo.
          pendentes={conversas
            .filter(c => c.statusAtendimento === 'pendente' && !c.arquivada && !c.oculta)
            .sort((a, b) => new Date(a.ultimaMensagemEm || 0) - new Date(b.ultimaMensagemEm || 0))}
          abertas={conversas
            .filter(c => c.statusAtendimento === 'aberta' && !c.arquivada && !c.oculta)
            .sort((a, b) => new Date(a.ultimaMensagemEm || 0) - new Date(b.ultimaMensagemEm || 0))}
          onFechar={fecharModoTv}
        />
      )}

      {transferindo && (
        <Portal>
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-start sm:items-center justify-center z-50 p-3 sm:p-4 overflow-y-auto">
          <div className="glass-panel border border-linha rounded-2xl w-full max-w-md shadow-2xl fade-in my-auto flex flex-col max-h-[calc(100dvh-1.5rem)] sm:max-h-[90vh]">
            <div className="p-4 bg-grafite-600 border-b border-linha flex items-center justify-between shrink-0 rounded-t-2xl">
              <div className="flex items-center gap-2 font-bold text-sm text-white min-w-0">
                <ArrowRightLeft size={16} className="text-purple-400 shrink-0" />
                <span className="truncate">Transferir: {transferindo.cliente}</span>
              </div>
              <button onClick={() => setTransferindo(null)} className="text-slate-400 hover:text-white shrink-0 ml-2"><X size={16} /></button>
            </div>

            <div className="p-4 flex-1 overflow-y-auto min-h-0 space-y-2">
              <p className="text-xs text-slate-400 mb-1">Escolha o atendente que vai assumir esta conversa:</p>
              {equipe.length === 0 && (
                <div className="text-center text-slate-400 text-xs py-8 space-y-2">
                  <Users size={26} className="text-slate-600 mx-auto" />
                  <p>Nenhum atendente cadastrado.</p>
                  <p className="text-slate-500">Adicione membros em <strong className="text-slate-300">Gestao da Equipe</strong>.</p>
                </div>
              )}
              {equipe.map(m => {
                const atual = atendentes[transferindo.id]?.nome === m.nome;
                return (
                  <button
                    key={m.id}
                    onClick={() => transferirConversa(transferindo, m)}
                    disabled={atual}
                    className={`w-full text-left p-3 rounded-xl border flex items-center gap-3 transition-all ${
                      atual
                        ? 'bg-purple-500/15 border-purple-500/40 cursor-default'
                        : 'bg-grafite-700 border-linha hover:border-purple-500/40 hover:bg-grafite-600'
                    }`}
                  >
                    <div className="w-9 h-9 rounded-xl bg-purple-500/15 text-purple-300 font-bold text-sm flex items-center justify-center border border-purple-500/30 shrink-0">
                      {m.nome.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-white truncate">{m.nome}</div>
                      <div className="text-[11px] text-slate-400 truncate">{m.cargo || 'Atendimento'}</div>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold shrink-0 ${
                      m.status === 'online'
                        ? 'bg-ativo/15 text-ativo-400 border-ativo/30'
                        : 'bg-slate-700/40 text-slate-400 border-linha'
                    }`}>
                      {m.status === 'online' ? 'Online' : 'Offline'}
                    </span>
                    {atual && <Check size={15} className="text-purple-400 shrink-0" />}
                  </button>
                );
              })}
            </div>

            <div className="p-4 bg-grafite-600 border-t border-linha flex justify-between items-center gap-2 shrink-0 rounded-b-2xl">
              {atendentes[transferindo.id] ? (
                <button
                  onClick={() => {
                    setAtendentes(prev => {
                      const novo = { ...prev };
                      delete novo[transferindo.id];
                      salvarAtendentes(novo);
                      return novo;
                    });
                    setTransferindo(null);
                  }}
                  className="text-[11px] text-slate-400 hover:text-falha-400 font-semibold transition-colors">
                  Remover atribuicao
                </button>
              ) : <span />}
              <button onClick={() => setTransferindo(null)} className="px-3 py-2 sm:py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700 transition-colors">Fechar</button>
            </div>
          </div>
        </div>
        </Portal>
      )}
    </div>
  );
}
