import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  MessageSquare, Send, Eye, Trash2, UserCheck, Check, X,
  CheckCircle2, Clock, Inbox, Play, Search, Zap,
  CheckCheck, WifiOff
} from 'lucide-react';
import { EmojiIcon, FormattedMessage } from './EmojiIcon';
import { useMensagensRapidas } from './MensagensRapidas';

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
  c, selecionada, parceiros, onSelecionar, onAtender, onApagar, onEspiar
}) {
  const ehAtivo   = selecionada === c.id && c.statusAtendimento === 'em_atendimento';
  const ultimaMsg = c.mensagens?.[c.mensagens.length - 1];
  const naoLido   = !c.lido && c.statusAtendimento !== 'finalizado' && c.statusAtendimento !== 'resolvido';

  return (
    <div
      onClick={() => { if (c.statusAtendimento === 'em_atendimento') onSelecionar(c.id); }}
      className={`p-3.5 rounded-xl border transition-all duration-200 cursor-pointer flex flex-col gap-2 ${
        ehAtivo
          ? 'bg-gradient-to-r from-orange-500/10 to-transparent border-orange-500/50 shadow-sm'
          : 'bg-[#1E2330]/40 border-[#2A3040]/60 hover:border-slate-600/60'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {naoLido && <span className="w-2 h-2 rounded-full bg-orange-400 shrink-0" />}
          <span className={`font-bold text-xs truncate ${naoLido ? 'text-white' : 'text-slate-300'}`}>
            {c.cliente}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={e => { e.stopPropagation(); onEspiar(c); }} title="Espiar conversa"
            className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-blue-400 transition-colors">
            <Eye size={12} />
          </button>
          <button onClick={e => { e.stopPropagation(); onApagar(c.id, e); }} title="Apagar"
            className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-rose-400 transition-colors">
            <Trash2 size={12} />
          </button>
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
  onExecutarFluxo, fluxoSugerido
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
          <div className="mt-1">
            {!conversa.cnpjVerificado
              ? <EmojiIcon name="question" label="CNPJ Pendente" size="sm" />
              : ehParceiro
                ? <EmojiIcon name="shield" label={`${parceiroCadastrado?.razaoSocial} (${mascararCnpj(conversa.cnpj)})`} size="sm" />
                : <EmojiIcon name="warning" label={`CNPJ ${mascararCnpj(conversa.cnpj)} (Sem Contrato)`} size="sm" />
            }
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

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
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

export default function AtendimentoView({ conversas, setConversas, fluxos, parceiros }) {
  const [abaAtual,      setAbaAtual]     = useState('abertos');
  const [selecionada,   setSelecionada]  = useState(null);
  const [texto,         setTexto]        = useState('');
  const [espiandoChat,  setEspiandoChat] = useState(null);
  const [modalCnpj,     setModalCnpj]    = useState(false);
  const [inputCnpj,     setInputCnpj]    = useState('');
  const [busca,         setBusca]        = useState('');
  const scrollRef = useRef(null);

  const conversa = conversas.find(c => c.id === selecionada);

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
  });

  const contadores = ABAS.reduce((acc, aba) => {
    acc[aba.id] = conversas.filter(aba.statusMatch).length;
    return acc;
  }, {});

  const atenderConversa = useCallback((id, e) => {
    if (e) e.stopPropagation();
    setConversas(prev => prev.map(c =>
      c.id === id ? { ...c, statusAtendimento: 'em_atendimento', lido: true } : c
    ));
    setAbaAtual('abertos');
    setSelecionada(id);
  }, [setConversas]);

  const finalizarAtendimento = useCallback((id) => {
    if (!window.confirm('Deseja concluir e finalizar este atendimento?')) return;
    setConversas(prev => prev.map(c =>
      c.id === id ? { ...c, statusAtendimento: 'finalizado' } : c
    ));
    setSelecionada(null);
  }, [setConversas]);

  const resolverAtendimento = useCallback((id) => {
    setConversas(prev => prev.map(c =>
      c.id === id ? { ...c, statusAtendimento: 'resolvido', lido: true } : c
    ));
    setSelecionada(null);
    setAbaAtual('fechados');
  }, [setConversas]);

  const marcarComoLido = useCallback((id) => {
    setConversas(prev => prev.map(c => c.id === id ? { ...c, lido: true } : c));
  }, [setConversas]);

  const apagarChat = useCallback((id, e) => {
    if (e) e.stopPropagation();
    if (!window.confirm('Deseja realmente apagar este atendimento?')) return;
    setConversas(prev => prev.filter(c => c.id !== id));
    if (selecionada === id) setSelecionada(null);
  }, [setConversas, selecionada]);

  const enviarResposta = useCallback((txt) => {
    if (!txt.trim() || !conversa) return;
    const cnpjNumeros = limparCnpj(txt);
    let conv = { ...conversa };

    if (cnpjNumeros.length === 14 && !conversa.cnpjVerificado) {
      const parceiroEncontrado = parceiros.find(p => p.cnpj === cnpjNumeros && p.status === 'ativo');
      conv.cnpj          = cnpjNumeros;
      conv.cnpjVerificado = true;
      const msgConf = parceiroEncontrado
        ? `✅ CNPJ ${mascararCnpj(cnpjNumeros)} validado! Razão Social: ${parceiroEncontrado.razaoSocial} Parceiro com Contrato Ativo.`
        : `⚠️ CNPJ ${mascararCnpj(cnpjNumeros)} consultado. Não possui contrato de parceiro ativo.`;
      conv.mensagens = [
        ...conv.mensagens,
        { de: 'equipe', texto: txt.trim(), hora: horaAgora() },
        { de: 'equipe', texto: `[🤖 Validação Automática Arka]: ${msgConf}`, hora: horaAgora() },
      ];
    } else {
      conv.mensagens = [...conv.mensagens, { de: 'equipe', texto: txt.trim(), hora: horaAgora() }];
    }

    setConversas(prev => prev.map(c => c.id === conversa.id ? conv : c));
    setTexto('');
  }, [conversa, parceiros, setConversas]);

  const solicitarCnpjBot = useCallback(() => {
    if (!conversa) return;
    const msg = '[🤖 Arka Tecnologia]: Para prosseguirmos e verificar benefícios de parceiro, informe o CNPJ da sua empresa:';
    setConversas(prev => prev.map(c =>
      c.id === conversa.id
        ? { ...c, mensagens: [...c.mensagens, { de: 'equipe', texto: msg, hora: horaAgora() }] }
        : c
    ));
  }, [conversa, setConversas]);

  const validarCnpjManual = useCallback(() => {
    const c = limparCnpj(inputCnpj);
    if (!cnpjValido(c)) { alert('CNPJ inválido!'); return; }
    const parceiroEncontrado = parceiros.find(p => p.cnpj === c && p.status === 'ativo');
    const msgBot = parceiroEncontrado
      ? `✅ CNPJ ${mascararCnpj(c)} identificado! Razão Social: ${parceiroEncontrado.razaoSocial} (Parceiro Cadastrado).`
      : `⚠️ CNPJ ${mascararCnpj(c)} não consta como parceiro cadastrado.`;
    setConversas(prev => prev.map(item =>
      item.id === conversa.id
        ? { ...item, cnpj: c, cnpjVerificado: true,
            mensagens: [...item.mensagens, { de: 'equipe', texto: `[🤖 Validação de CNPJ]: ${msgBot}`, hora: horaAgora() }] }
        : item
    ));
    setInputCnpj('');
    setModalCnpj(false);
  }, [inputCnpj, conversa, parceiros, setConversas]);

  const executarFluxo = useCallback((fluxo) => {
    if (!conversa || !fluxo) return;
    const msgsBot = fluxo.passos
      .filter(p => p.tipo === 'mensagem' || p.tipo === 'acao')
      .map(p => ({ de: 'equipe', texto: `[🤖 ${p.titulo}]: ${p.desc || p.texto}`, hora: horaAgora() }));
    setConversas(prev => prev.map(c =>
      c.id === conversa.id ? { ...c, mensagens: [...c.mensagens, ...msgsBot] } : c
    ));
  }, [conversa, setConversas]);

  const fluxoSugerido = conversa
    ? fluxos.find(f => f.ativo && conversa.mensagens.some(m =>
        m.de === 'cliente' && m.texto.toLowerCase().includes(f.gatilho)
      ))
    : null;

  const naoLidos = conversas.filter(c =>
    !c.lido && c.statusAtendimento !== 'finalizado' && c.statusAtendimento !== 'resolvido'
  ).length;

  return (
    <div className="fade-in space-y-4 h-full flex flex-col">
  
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-white tracking-tight font-display">
              Central de Atendimentos
            </h1>
            {naoLidos > 0 && (
              <span className="text-sm px-2.5 py-0.5 rounded-full bg-orange-500 text-slate-950 font-bold">
                {naoLidos}
              </span>
            )}
            
            <div className="flex items-center justify-center w-7 h-7 rounded-full bg-rose-500/15 border border-rose-500/40 text-rose-400" title="WhatsApp offline">
              <WifiOff size={13} />
            </div>
          </div>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">
            Assuma conversas, consulte CNPJ e automatize respostas.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 min-h-[550px]">
    
        <div className="lg:col-span-4 glass-panel rounded-2xl flex flex-col overflow-hidden border border-[#2A3040]">
       
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
                onApagar={apagarChat}
                onEspiar={setEspiandoChat}
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

        <div className="lg:col-span-8 glass-panel rounded-2xl flex flex-col overflow-hidden border border-[#2A3040]">
          {!conversa || (conversa.statusAtendimento !== 'em_atendimento' && conversa.statusAtendimento !== 'resolvido') ? (
            <div
              className="flex-1 flex items-center justify-center relative overflow-hidden"
              style={{
                background: '#0B141A',
                backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.03'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
              }}
            >
              {/* Gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-br from-[#0B141A] via-transparent to-[#0B141A] opacity-60 pointer-events-none" />

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
            />
          )}
        </div>
      </div>

      {espiandoChat && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass-panel border border-[#2A3040] rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl fade-in">
            <div className="p-4 bg-[#1E2330] border-b border-[#2A3040] flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-sm text-white">
                <Eye className="text-blue-400" size={16} />
                Espiando: {espiandoChat.cliente}
              </div>
              <button onClick={() => setEspiandoChat(null)} className="text-slate-400 hover:text-white"><X size={16}/></button>
            </div>
            <div className="p-4 max-h-96 overflow-y-auto space-y-2 text-xs">
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
            <div className="p-4 bg-[#1E2330] border-t border-[#2A3040] flex justify-end">
              <button onClick={() => setEspiandoChat(null)} className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs font-semibold">Fechar</button>
            </div>
          </div>
        </div>
      )}

      {modalCnpj && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass-panel border border-[#2A3040] rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl fade-in">
            <h3 className="text-base font-bold text-white font-display">Validar CNPJ do Cliente</h3>
            <p className="text-xs text-slate-400">Insira o CNPJ para pesquisar o status do parceiro.</p>
            <input
              value={inputCnpj}
              onChange={e => setInputCnpj(mascararCnpj(e.target.value))}
              placeholder="00.000.000/0000-00"
              className="w-full bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2.5 text-xs text-white font-mono placeholder-slate-500 focus:outline-none focus:border-orange-500/50"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setModalCnpj(false)} className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs font-semibold">Cancelar</button>
              <button onClick={validarCnpjManual} className="px-4 py-1.5 rounded-lg bg-orange-500 text-slate-950 text-xs font-bold">Validar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
