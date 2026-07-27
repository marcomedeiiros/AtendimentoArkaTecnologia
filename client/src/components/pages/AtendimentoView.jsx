import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  MessageSquare, Send, Eye, Trash2, UserCheck, Check, X,
  CheckCircle2, Clock, Inbox, Play, Search, Zap,
  CheckCheck, WifiOff, Wifi, Bell, Pin, ChevronLeft,
  ArrowRightLeft, AlertCircle, Users
} from 'lucide-react';
import { EmojiIcon, FormattedMessage } from './EmojiIcon';
import { useMensagensRapidas } from './MensagensRapidas';
import Avatar from '../Avatar';
import Portal from '../Portal';
import { useAppContext } from '../../context/AppContext';
import { ConversasAPI } from '../../services/api';
import { wallpaperStyle as WHATSAPP_BG, COR_FUNDO_CHAT } from '../../utils/wallpaper';

const PINOS_KEY = 'arka_conversas_fixadas';
function lerFixados() {
  try { return JSON.parse(localStorage.getItem(PINOS_KEY)) || []; } catch { return []; }
}
function salvarFixados(ids) {
  try { localStorage.setItem(PINOS_KEY, JSON.stringify(ids)); } catch {}
}

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

// "ha 5 min" para o painel de notificacoes do sino.
function tempoRelativo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'agora';
  const m = Math.floor(s / 60);
  if (m < 60) return `ha ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `ha ${h}h`;
  return `ha ${Math.floor(h / 24)}d`;
}

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
  { id: 'abertos',   label: 'Abertos',   icon: Inbox,        statusMatch: c => c.statusAtendimento === 'aguardando' || c.statusAtendimento === 'em_atendimento' },
  { id: 'pendentes', label: 'Pendentes', icon: Clock,        statusMatch: c => c.statusAtendimento === 'aguardando' },
  { id: 'fechados',  label: 'Fechados',  icon: CheckCircle2, statusMatch: c => c.statusAtendimento === 'finalizado' || c.statusAtendimento === 'resolvido' },
];

function PainelMensagensRapidas({ onSelecionar, onFechar }) {
  const mensagens = useMensagensRapidas();
  const [busca, setBusca] = useState('');

  const filtradas = mensagens.filter(m =>
    m.titulo.toLowerCase().includes(busca.toLowerCase()) ||
    m.texto.toLowerCase().includes(busca.toLowerCase())
  );

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 glass-panel border border-[#2A3040] rounded-2xl shadow-2xl z-30 overflow-hidden">
      <div className="p-3 bg-[#1E2330] border-b border-[#2A3040] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Zap size={13} className="text-orange-400" />
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
              className="w-full bg-[#161922] border border-[#2A3040] rounded-lg pl-7 pr-2 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50"
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
            className="w-full text-left p-2.5 rounded-xl hover:bg-[#1E2330] border border-transparent hover:border-orange-500/30 transition-all group"
          >
            <div className="font-semibold text-xs text-white group-hover:text-orange-400 transition-colors">{m.titulo}</div>
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

const CardConversa = React.memo(function CardConversa({
  c, selecionada, parceiros, onSelecionar, onAtender, onResolver, onEspiar, onFixar, fixado
}) {
  const ehAtivo   = selecionada === c.id && c.statusAtendimento === 'em_atendimento';
  const ultimaMsg = c.mensagens?.[c.mensagens.length - 1];
  const naoLido   = !c.lido && c.statusAtendimento !== 'finalizado' && c.statusAtendimento !== 'resolvido';
  const encerrado = c.statusAtendimento === 'finalizado' || c.statusAtendimento === 'resolvido';

  return (
    <div
      onClick={() => { if (c.statusAtendimento === 'em_atendimento') onSelecionar(c.id); }}
      className={`p-3.5 rounded-xl border transition-all duration-200 cursor-pointer flex flex-col gap-2 ${
        ehAtivo
          ? 'bg-gradient-to-r from-orange-500/10 to-transparent border-orange-500/50 shadow-sm'
          : fixado
            ? 'bg-[#1E2330]/60 border-orange-500/25 hover:border-orange-500/40'
            : 'bg-[#1E2330]/40 border-[#2A3040]/60 hover:border-slate-600/60'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Avatar nome={c.cliente} size="sm" />
          <div className="flex items-center gap-1.5 min-w-0">
            {naoLido && <span className="w-2 h-2 rounded-full bg-orange-400 shrink-0" />}
            <span className={`font-bold text-xs truncate ${naoLido ? 'text-white' : 'text-slate-300'}`}>
              {c.cliente}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={e => { e.stopPropagation(); onFixar(c.id); }} title={fixado ? 'Desafixar conversa' : 'Fixar no topo'}
            className={`p-1.5 rounded-lg transition-colors ${fixado ? 'bg-orange-500/20 text-orange-400' : 'bg-slate-800/80 hover:bg-slate-700 text-slate-400'}`}>
            <Pin size={12} className={fixado ? 'fill-current' : ''} />
          </button>
          <button onClick={e => { e.stopPropagation(); onEspiar(c); }} title="Espiar conversa"
            className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-blue-400 transition-colors">
            <Eye size={12} />
          </button>
          {!encerrado && (
            <button onClick={e => { e.stopPropagation(); onResolver(c.id); }} title="Resolver problema"
              className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-emerald-500/20 text-emerald-400 transition-colors">
              <CheckCircle2 size={12} />
            </button>
          )}
        </div>
      </div>

      <div className="text-[11px] text-slate-400 font-mono">
        {c.telefone || '+55 11 99999-0000'}
      </div>

      <div>
        {c.cnpjVerificado
          ? c.cnpj && parceiros.some(p => p.cnpj === limparCnpj(c.cnpj) && p.status === 'ativo')
            ? <EmojiIcon name="shield"   label={`Parceiro: ${mascararCnpj(c.cnpj)}`} size="sm" />
            : <EmojiIcon name="warning"  label={`Avulso (${mascararCnpj(c.cnpj)})`}  size="sm" />
          : <EmojiIcon name="question" label="CNPJ Pendente" size="sm" />
        }
      </div>

      <div className="text-[11px] text-slate-300 truncate bg-[#161922] p-2 rounded-lg border border-slate-800">
        {ultimaMsg ? ultimaMsg.texto : 'Sem mensagens'}
      </div>

      {c.statusAtendimento === 'aguardando' && (
        <button
          onClick={e => { e.stopPropagation(); onAtender(c.id, e); }}
          className="w-full mt-1 py-2 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-emerald-500/20 transition-all"
        >
          <UserCheck size={13} /> ATENDER CONVERSA
        </button>
      )}
    </div>
  );
});

function PainelChat({
  conversa, parceiros, conversas, setConversas, fluxos,
  texto, setTexto, scrollRef, onEnviar, onFinalizar, onResolver,
  onMarcarLido, onApagarChat, onSolicitarCnpj, onValidarCnpjModal,
  onExecutarFluxo, fluxoSugerido, onVoltar, atendente, onTransferir
}) {
  const [showMsgRapidas, setShowMsgRapidas] = useState(false);

  const ehParceiro = conversa.cnpjVerificado &&
    parceiros.some(p => p.cnpj === limparCnpj(conversa.cnpj) && p.status === 'ativo');
  const parceiroCadastrado = conversa.cnpjVerificado
    ? parceiros.find(p => p.cnpj === limparCnpj(conversa.cnpj))
    : null;

  return (
    <>
      <div className="p-4 bg-[#1E2330]/80 border-b border-[#2A3040] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 sm:gap-3">
          <button onClick={onVoltar} title="Voltar para a lista"
            className="lg:hidden p-1.5 -ml-1 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors">
            <ChevronLeft size={18} />
          </button>
          <Avatar nome={conversa.cliente} size="md" />
          <div>
          <div className="font-bold text-sm text-white flex items-center gap-2 flex-wrap">
            {conversa.cliente}
            <span className="text-xs font-normal text-slate-400 font-mono">({conversa.telefone})</span>
         
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
              conversa.statusAtendimento === 'resolvido'
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'bg-blue-500/20 text-blue-400'
            }`}>
              {conversa.statusAtendimento === 'resolvido' ? 'Resolvido' : 'Em atendimento'}
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
                className="px-2.5 py-1.5 rounded-lg bg-orange-500/15 hover:bg-orange-500/25 text-orange-400 text-xs font-semibold border border-orange-500/30 transition-all">
                🤖 Pedir CNPJ
              </button>
              <button onClick={onValidarCnpjModal}
                className="px-2.5 py-1.5 rounded-lg bg-blue-500/15 hover:bg-blue-500/25 text-blue-400 text-xs font-semibold border border-blue-500/30 transition-all">
                🔎 Validar CNPJ
              </button>
            </>
          )}

          {!conversa.lido && (
            <button onClick={() => onMarcarLido(conversa.id)}
              title="Marcar como lido"
              className="px-2.5 py-1.5 rounded-lg bg-slate-700/50 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-600/40 transition-all flex items-center gap-1">
              <CheckCheck size={13} /> Lido
            </button>
          )}

          {conversa.statusAtendimento !== 'resolvido' && (
            <button onClick={() => onResolver(conversa.id)}
              title="Marcar como resolvido"
              className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 text-xs font-semibold border border-emerald-500/30 transition-all flex items-center gap-1">
              <CheckCircle2 size={13} /> Resolver
            </button>
          )}

          <button onClick={onTransferir}
            title="Transferir conversa para outro atendente"
            className="px-2.5 py-1.5 rounded-lg bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 text-xs font-semibold border border-purple-500/30 transition-all flex items-center gap-1">
            <ArrowRightLeft size={13} /> Transferir
          </button>

          <button onClick={() => onFinalizar(conversa.id)}
            className="px-2.5 py-1.5 rounded-lg bg-slate-500/15 hover:bg-slate-500/25 text-slate-300 text-xs font-semibold border border-slate-500/30 transition-all flex items-center gap-1">
            <Check size={13} /> Concluir
          </button>

          <button onClick={() => onApagarChat(conversa.id)}
            className="p-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 border border-rose-500/30 transition-all">
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <div ref={scrollRef} style={WHATSAPP_BG} className="flex-1 overflow-y-auto p-4 space-y-3">
        {conversa.mensagens.map((m, i) => (
          <div key={i} className={`flex ${m.de === 'cliente' ? 'justify-start' : m.de === 'sistema' ? 'justify-center' : 'justify-end'}`}>
            {m.de === 'sistema' ? (
              <div className="text-[10px] text-slate-500 bg-[#1E2330] border border-[#2A3040] px-3 py-1.5 rounded-full">
                {m.texto}
              </div>
            ) : (
              <div className={`max-w-[80%] p-3.5 rounded-2xl text-xs shadow-md space-y-1 ${
                m.de === 'cliente'
                  ? 'bg-[#1E2330] text-slate-100 border border-[#2A3040] rounded-tl-sm'
                  : 'bg-gradient-to-r from-orange-500 to-amber-500 text-slate-950 font-medium rounded-tr-sm'
              }`}>
                <div className={`text-[10px] font-semibold ${m.de === 'cliente' ? 'text-slate-400' : 'text-slate-900/80'}`}>
                  {m.de === 'cliente' ? conversa.cliente : 'Arka Tecnologia'}
                </div>
                <FormattedMessage text={m.texto} />
                <div className={`text-[9px] text-right ${m.de === 'cliente' ? 'text-slate-400' : 'text-slate-900/70'}`}>
                  {m.hora}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {fluxoSugerido && (
        <div className="mx-4 mb-2 p-3 rounded-xl bg-orange-500/10 border border-orange-500/30 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <EmojiIcon name="lightning" label="" size="sm" />
            <div>
              <div className="text-xs font-bold text-white">Executar: {fluxoSugerido.nome}</div>
              <div className="text-[11px] text-slate-400">Gatilho "{fluxoSugerido.gatilho}" identificado.</div>
            </div>
          </div>
          <button onClick={() => onExecutarFluxo(fluxoSugerido)}
            className="px-3 py-1.5 rounded-lg bg-orange-500 text-slate-950 text-xs font-bold flex items-center gap-1 hover:bg-orange-400 transition-colors shadow-sm">
            <Play size={12} /> Disparar
          </button>
        </div>
      )}

      <div className="p-3 bg-[#1E2330]/80 border-t border-[#2A3040] flex items-center gap-2 relative">
        {showMsgRapidas && (
          <PainelMensagensRapidas
            onSelecionar={txt => { setTexto(txt); setShowMsgRapidas(false); }}
            onFechar={() => setShowMsgRapidas(false)}
          />
        )}

        <button
          onClick={() => setShowMsgRapidas(v => !v)}
          title="Mensagens rápidas"
          className={`p-2.5 rounded-xl border transition-all ${
            showMsgRapidas
              ? 'bg-orange-500/20 border-orange-500/40 text-orange-400'
              : 'bg-[#161922] border-[#2A3040] text-slate-400 hover:text-orange-400 hover:border-orange-500/30'
          }`}
        >
          <Zap size={15} />
        </button>

        <input
          value={texto}
          onChange={e => setTexto(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && onEnviar(texto)}
          placeholder="Digite sua mensagem ou CNPJ para consultar..."
          className="flex-1 bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50 transition-colors"
        />
        <button
          onClick={() => onEnviar(texto)}
          className="p-2.5 rounded-xl bg-orange-500 hover:bg-orange-400 text-slate-950 transition-colors shadow-md shadow-orange-500/20"
        >
          <Send size={15} />
        </button>
      </div>
    </>
  );
}

export default function AtendimentoView({ conversas, setConversas, fluxos, parceiros, equipe = [] }) {
  const { whatsAppConectado, historico = [], marcarNotificacoesLidas, limparHistorico } = useAppContext();
  const [abaAtual,      setAbaAtual]     = useState('abertos');
  const [selecionada,   setSelecionada]  = useState(null);
  const [texto,         setTexto]        = useState('');
  const [espiandoChat,  setEspiandoChat] = useState(null);
  const [modalCnpj,     setModalCnpj]    = useState(false);
  const [inputCnpj,     setInputCnpj]    = useState('');
  const [busca,         setBusca]        = useState('');
  const [fixados,       setFixados]      = useState(lerFixados);
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

  // Transfere a conversa para um membro da equipe (persistido em localStorage).
  const transferirConversa = useCallback((conv, membro) => {
    setAtendentes(prev => {
      const novo = { ...prev, [conv.id]: { nome: membro.nome, cargo: membro.cargo || '', em: Date.now() } };
      salvarAtendentes(novo);
      return novo;
    });
    setTransferindo(null);
  }, []);

  const alternarFixado = useCallback((id) => {
    setFixados(prev => {
      const novo = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      salvarFixados(novo);
      return novo;
    });
  }, []);

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

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [conversa?.mensagens?.length, selecionada]);

  useEffect(() => {
    if (!selecionada) return;
    const conv = conversas.find(c => c.id === selecionada);
    if (!conv) { setSelecionada(null); return; }
    const aba = ABAS.find(a => a.id === abaAtual);
    if (aba && !aba.statusMatch(conv)) setSelecionada(null);
  }, [abaAtual, conversas]);

  const conversasFiltradas = conversas.filter(c => {
    const aba = ABAS.find(a => a.id === abaAtual);
    if (!aba?.statusMatch(c)) return false;
    if (!busca.trim()) return true;
    const q = busca.toLowerCase();
    return c.cliente.toLowerCase().includes(q) ||
           (c.telefone || '').includes(q) ||
           c.mensagens.some(m => m.texto.toLowerCase().includes(q));
  }).sort((a, b) => (fixados.includes(b.id) ? 1 : 0) - (fixados.includes(a.id) ? 1 : 0));

  const contadores = ABAS.reduce((acc, aba) => {
    acc[aba.id] = conversas.filter(aba.statusMatch).length;
    return acc;
  }, {});

  // Atualiza uma conversa no estado global a partir da resposta do back-end.
  const aplicarConversa = useCallback((atualizada) => {
    if (!atualizada?.id) return;
    setConversas(prev => prev.map(c => c.id === atualizada.id ? atualizada : c));
  }, [setConversas]);

  const atenderConversa = useCallback(async (id, e) => {
    if (e) e.stopPropagation();
    setAbaAtual('abertos');
    setSelecionada(id);
    setConversas(prev => prev.map(c =>
      c.id === id ? { ...c, statusAtendimento: 'em_atendimento', lido: true } : c
    ));
    try { aplicarConversa(await ConversasAPI.atender(id)); } catch {}
  }, [setConversas, aplicarConversa]);

  const finalizarAtendimento = useCallback(async (id) => {
    if (!window.confirm('Deseja concluir e finalizar este atendimento?')) return;
    setSelecionada(null);
    setConversas(prev => prev.map(c =>
      c.id === id ? { ...c, statusAtendimento: 'finalizado' } : c
    ));
    try { aplicarConversa(await ConversasAPI.atualizarStatus(id, 'finalizado')); } catch {}
  }, [setConversas, aplicarConversa]);

  const resolverAtendimento = useCallback(async (id) => {
    setSelecionada(null);
    setAbaAtual('fechados');
    setConversas(prev => prev.map(c =>
      c.id === id ? { ...c, statusAtendimento: 'resolvido', lido: true } : c
    ));
    try { aplicarConversa(await ConversasAPI.atualizarStatus(id, 'resolvido')); } catch {}
  }, [setConversas, aplicarConversa]);

  const marcarComoLido = useCallback(async (id) => {
    setConversas(prev => prev.map(c => c.id === id ? { ...c, lido: true } : c));
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

  const enviarResposta = useCallback(async (txt) => {
    if (!txt.trim() || !conversa) return;
    const id = conversa.id;
    // Otimista: mostra a mensagem da equipe na hora.
    setConversas(prev => prev.map(c =>
      c.id === id ? { ...c, mensagens: [...c.mensagens, { de: 'equipe', texto: txt.trim(), hora: horaAgora() }] } : c
    ));
    setTexto('');
    // O back-end persiste, detecta CNPJ e devolve a conversa completa.
    try { aplicarConversa(await ConversasAPI.enviarMensagem(id, txt.trim())); } catch {}
  }, [conversa, setConversas, aplicarConversa]);

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

  const chatAberto = !!conversa &&
    (conversa.statusAtendimento === 'em_atendimento' || conversa.statusAtendimento === 'resolvido');

  return (
    <div className="fade-in space-y-4 h-full flex flex-col">
  
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
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
          <div className="relative" ref={sinoRef}>
            <button
              onClick={alternarNotif}
              title="Notificacoes"
              className={`relative flex items-center justify-center w-9 h-9 rounded-full border transition-colors ${
                naoLidasSino > 0
                  ? 'bg-orange-500/15 border-orange-500/40 text-orange-400'
                  : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-white'
              } ${sinoTocando ? 'animate-bounce' : ''}`}
            >
              <Bell size={15} className={sinoTocando ? 'fill-current' : ''} />
              {naoLidasSino > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-orange-500 text-slate-950 text-[9px] font-extrabold flex items-center justify-center">
                  {naoLidasSino}
                </span>
              )}
            </button>

            {showNotif && (
              <div className="absolute right-0 top-full mt-2 w-[min(88vw,340px)] glass-panel border border-[#2A3040] rounded-2xl shadow-2xl shadow-black/50 z-50 overflow-hidden fade-in">
                <div className="p-3 bg-[#1E2330] border-b border-[#2A3040] flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-white">
                    <Bell size={13} className="text-orange-400" /> Notificacoes
                  </div>
                  {historico.length > 0 && (
                    <button onClick={() => limparHistorico && limparHistorico()}
                      className="text-[11px] text-slate-400 hover:text-rose-400 transition-colors font-semibold">
                      Limpar
                    </button>
                  )}
                </div>
                <div className="max-h-80 overflow-y-auto divide-y divide-[#2A3040]/60">
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
                          if (n.convId) { setAbaAtual('abertos'); setSelecionada(n.convId); }
                          setShowNotif(false);
                        }}
                        className="w-full text-left p-3 flex items-start gap-2.5 hover:bg-[#1E2330]/70 transition-colors"
                      >
                        <span className={`mt-0.5 shrink-0 ${ehAlerta ? 'text-amber-400' : 'text-orange-400'}`}>
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
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                : 'bg-rose-500/15 border-rose-500/40 text-rose-400'
            }`}
          >
            {whatsAppConectado ? <Wifi size={14} /> : <WifiOff size={14} />}
            <span>WhatsApp {whatsAppConectado ? 'Online' : 'Offline'}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 min-h-0 lg:min-h-[550px]">

        <div className={`${chatAberto ? 'hidden lg:flex' : 'flex'} lg:col-span-4 glass-panel rounded-2xl flex-col overflow-hidden border border-[#2A3040] min-h-[420px] lg:min-h-0`}>
       
          <div className="grid grid-cols-3 bg-[#1E2330]/80 border-b border-[#2A3040]">
            {ABAS.map(aba => {
              const Icon  = aba.icon;
              const count = contadores[aba.id];
              const ativo = abaAtual === aba.id;
              return (
                <button key={aba.id} onClick={() => setAbaAtual(aba.id)}
                  className={`py-3 px-2 text-[11px] font-bold transition-all border-b-2 flex flex-col items-center justify-center gap-0.5 ${
                    ativo
                      ? 'border-orange-500 text-orange-400 bg-[#161922]'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-1">
                    <Icon size={12} />
                    <span>{aba.label}</span>
                  </div>
                  <span className={`text-[10px] font-semibold ${ativo ? 'text-orange-300' : 'text-slate-500'}`}>
                    ({count})
                  </span>
                </button>
              );
            })}
          </div>

          <div className="p-2 border-b border-[#2A3040]">
            <div className="relative">
              <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                value={busca}
                onChange={e => setBusca(e.target.value)}
                placeholder="Buscar conversa..."
                className="w-full bg-[#161922] border border-[#2A3040] rounded-xl pl-8 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {conversasFiltradas.map(c => (
              <CardConversa
                key={c.id}
                c={c}
                selecionada={selecionada}
                parceiros={parceiros}
                onSelecionar={setSelecionada}
                onAtender={atenderConversa}
                onResolver={resolverAtendimento}
                onEspiar={setEspiandoChat}
                onFixar={alternarFixado}
                fixado={fixados.includes(c.id)}
              />
            ))}
            {conversasFiltradas.length === 0 && (
              <div className="p-8 text-center text-slate-400 text-xs">
                {abaAtual === 'abertos'   && 'Nenhuma conversa aberta.'}
                {abaAtual === 'pendentes' && 'Nenhuma conversa pendente na fila.'}
                {abaAtual === 'fechados'  && 'Nenhum atendimento finalizado.'}
              </div>
            )}
          </div>
        </div>

        <div className={`${chatAberto ? 'flex' : 'hidden lg:flex'} lg:col-span-8 glass-panel rounded-2xl flex-col overflow-hidden border border-[#2A3040] min-h-[70vh] lg:min-h-0`}>
          {!conversa || (conversa.statusAtendimento !== 'em_atendimento' && conversa.statusAtendimento !== 'resolvido') ? (
            <div
              className="flex-1 flex items-center justify-center relative overflow-hidden"
              style={WHATSAPP_BG}
            >
              {/* Gradient overlay */}
              <div
                className="absolute inset-0 opacity-60 pointer-events-none"
                style={{
                  backgroundImage: `linear-gradient(to bottom right, ${COR_FUNDO_CHAT}, transparent, ${COR_FUNDO_CHAT})`,
                }}
              />

              {/* Bolhas decorativas de chat ao fundo */}
              <div className="absolute top-8 left-8 w-32 h-10 rounded-2xl rounded-tl-sm bg-[#1F2C34] opacity-20" />
              <div className="absolute top-20 right-10 w-40 h-10 rounded-2xl rounded-tr-sm bg-[#005C4B] opacity-15" />
              <div className="absolute top-36 left-14 w-24 h-10 rounded-2xl rounded-tl-sm bg-[#1F2C34] opacity-20" />
              <div className="absolute bottom-24 right-8 w-36 h-10 rounded-2xl rounded-tr-sm bg-[#005C4B] opacity-15" />
              <div className="absolute bottom-12 left-10 w-28 h-10 rounded-2xl rounded-tl-sm bg-[#1F2C34] opacity-20" />
              <div className="absolute bottom-36 right-20 w-20 h-10 rounded-2xl rounded-tr-sm bg-[#005C4B] opacity-10" />

              {/* Conteúdo central */}
              <div className="relative z-10 text-center p-8 max-w-sm">
                <div className="inline-flex p-5 rounded-2xl bg-[#1F2C34]/80 border border-[#2A3B45]/60 mb-5 text-[#25D366] shadow-lg shadow-black/30">
                  <MessageSquare size={38} />
                </div>
                <h3 className="text-base font-bold text-[#E9Edef] font-display mb-2">
                  Nenhum Atendimento Selecionado
                </h3>
                <p className="text-xs text-[#8696A0] leading-relaxed">
                  Selecione uma conversa ou clique em{' '}
                  <strong className="text-[#25D366]">"ATENDER CONVERSA"</strong> para iniciar o chat.
                </p>
              </div>
            </div>
          ) : (
            <PainelChat
              conversa={conversa}
              parceiros={parceiros}
              conversas={conversas}
              setConversas={setConversas}
              fluxos={fluxos}
              texto={texto}
              setTexto={setTexto}
              scrollRef={scrollRef}
              onEnviar={enviarResposta}
              onFinalizar={finalizarAtendimento}
              onResolver={resolverAtendimento}
              onMarcarLido={marcarComoLido}
              onApagarChat={apagarChat}
              onSolicitarCnpj={solicitarCnpjBot}
              onValidarCnpjModal={() => setModalCnpj(true)}
              onExecutarFluxo={executarFluxo}
              fluxoSugerido={fluxoSugerido}
              onVoltar={() => setSelecionada(null)}
              atendente={atendentes[conversa.id]}
              onTransferir={() => setTransferindo(conversa)}
            />
          )}
        </div>
      </div>

      {espiandoChat && (
        <Portal>
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-start sm:items-center justify-center z-50 p-3 sm:p-4 overflow-y-auto">
          <div className="glass-panel border border-[#2A3040] rounded-2xl w-full max-w-lg shadow-2xl fade-in my-auto flex flex-col max-h-[calc(100dvh-1.5rem)] sm:max-h-[90vh]">
            <div className="p-4 bg-[#1E2330] border-b border-[#2A3040] flex items-center justify-between shrink-0 rounded-t-2xl">
              <div className="flex items-center gap-2 font-bold text-sm text-white min-w-0">
                <Eye className="text-blue-400 shrink-0" size={16} />
                <span className="truncate">Espiando: {espiandoChat.cliente}</span>
              </div>
              <button onClick={() => setEspiandoChat(null)} className="text-slate-400 hover:text-white shrink-0 ml-2"><X size={16}/></button>
            </div>
            <div className="p-4 flex-1 overflow-y-auto min-h-0 space-y-2 text-xs">
              {espiandoChat.mensagens.map((m, idx) => (
                <div key={idx} className={`p-2.5 rounded-xl ${
                  m.de === 'cliente' ? 'bg-[#1E2330] text-slate-200' : 'bg-orange-500/10 text-orange-200 border border-orange-500/20'
                }`}>
                  <div className="text-[10px] text-slate-400 mb-1">
                    {m.de === 'cliente' ? espiandoChat.cliente : 'Arka'} • {m.hora}
                  </div>
                  {m.texto}
                </div>
              ))}
            </div>
            <div className="p-4 bg-[#1E2330] border-t border-[#2A3040] flex justify-end shrink-0 rounded-b-2xl">
              <button onClick={() => setEspiandoChat(null)} className="px-3 py-2 sm:py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs font-semibold">Fechar</button>
            </div>
          </div>
        </div>
        </Portal>
      )}

      {modalCnpj && (
        <Portal>
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-start sm:items-center justify-center z-50 p-3 sm:p-4 overflow-y-auto">
          <div className="glass-panel border border-[#2A3040] rounded-2xl w-full max-w-md p-5 sm:p-6 space-y-4 shadow-2xl fade-in my-auto">
            <h3 className="text-base font-bold text-white font-display">Validar CNPJ do Cliente</h3>
            <p className="text-xs text-slate-400">Insira o CNPJ para pesquisar o status do parceiro.</p>
            <input
              value={inputCnpj}
              onChange={e => setInputCnpj(mascararCnpj(e.target.value))}
              placeholder="00.000.000/0000-00"
              className="w-full bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2.5 text-xs text-white font-mono placeholder-slate-500 focus:outline-none focus:border-orange-500/50"
            />
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
              <button onClick={() => setModalCnpj(false)} className="px-3 py-2 sm:py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs font-semibold">Cancelar</button>
              <button onClick={validarCnpjManual} className="px-4 py-2 sm:py-1.5 rounded-lg bg-orange-500 text-slate-950 text-xs font-bold">Validar</button>
            </div>
          </div>
        </div>
        </Portal>
      )}

      {transferindo && (
        <Portal>
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-start sm:items-center justify-center z-50 p-3 sm:p-4 overflow-y-auto">
          <div className="glass-panel border border-[#2A3040] rounded-2xl w-full max-w-md shadow-2xl fade-in my-auto flex flex-col max-h-[calc(100dvh-1.5rem)] sm:max-h-[90vh]">
            <div className="p-4 bg-[#1E2330] border-b border-[#2A3040] flex items-center justify-between shrink-0 rounded-t-2xl">
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
                        : 'bg-[#161922] border-[#2A3040] hover:border-purple-500/40 hover:bg-[#1E2330]'
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
                        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                        : 'bg-slate-700/40 text-slate-400 border-slate-600/40'
                    }`}>
                      {m.status === 'online' ? 'Online' : 'Offline'}
                    </span>
                    {atual && <Check size={15} className="text-purple-400 shrink-0" />}
                  </button>
                );
              })}
            </div>

            <div className="p-4 bg-[#1E2330] border-t border-[#2A3040] flex justify-between items-center gap-2 shrink-0 rounded-b-2xl">
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
                  className="text-[11px] text-slate-400 hover:text-rose-400 font-semibold transition-colors">
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
