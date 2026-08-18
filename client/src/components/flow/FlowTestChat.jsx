import { useEffect, useRef, useState } from 'react';
import { MessageSquare, Send, X, RotateCcw, Loader2, CheckCircle2, UserRound, AlertCircle } from 'lucide-react';
import { ChatbotAPI } from '../../services/api';

// Painel de teste do fluxo: conversa de verdade contra o motor do chatbot.
//
// Diferente do botao "Simular", que so percorre os blocos na tela em sequencia,
// aqui cada mensagem passa pelo motor real (casamento de palavras-chave,
// ramificacoes, transferencia, encerramento). Nada e enviado ao WhatsApp e nada
// e gravado: o back-end roda o motor com conversa e sessao em memoria.
//
// O historico fica aqui e vai inteiro em cada chamada - o endpoint e stateless,
// entao nao ha sessao de teste no servidor para expirar ou colidir entre dois
// operadores testando ao mesmo tempo.
export function FlowTestChat({ fluxo, onClose, onPassoAtivo }) {
  const [mensagens, setMensagens] = useState([]); // strings do cliente
  const [turnos, setTurnos] = useState([]);
  const [entrada, setEntrada] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const fimRef = useRef(null);
  const inputRef = useRef(null);

  const ultimo = turnos[turnos.length - 1] || null;
  const finalizado = !!(ultimo?.encerrado || ultimo?.transferido);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turnos, carregando]);

  // Destaca no canvas o bloco em que a conversa parou.
  useEffect(() => {
    onPassoAtivo?.(ultimo?.passoAtualId || null);
  }, [ultimo?.passoAtualId, onPassoAtivo]);

  // Trocar de fluxo com um teste em andamento deixaria a transcricao falando de
  // um fluxo que nao esta mais na tela.
  useEffect(() => {
    setMensagens([]);
    setTurnos([]);
    setErro(null);
  }, [fluxo?.id]);

  const reiniciar = () => {
    setMensagens([]);
    setTurnos([]);
    setErro(null);
    setEntrada('');
    inputRef.current?.focus();
  };

  async function enviar(texto) {
    const msg = String(texto ?? '').trim();
    if (!msg || carregando || !fluxo?.id) return;

    const historico = [...mensagens, msg];
    setMensagens(historico);
    setEntrada('');
    setCarregando(true);
    setErro(null);
    try {
      const r = await ChatbotAPI.simular({ fluxoId: fluxo.id, mensagens: historico });
      setTurnos(r.turnos || []);
    } catch (e) {
      // Desfaz a mensagem: o turno nao aconteceu, deixa-la na lista faria a
      // proxima chamada reproduzir uma conversa que o motor nunca processou.
      setMensagens(mensagens);
      setErro(e?.message || 'Falha ao simular a conversa.');
    } finally {
      setCarregando(false);
    }
  }

  // Id otimista do "Novo Fluxo" (`'f' + Date.now()`): ainda nao existe no
  // servidor, e a simulacao le os passos de lá.
  const naoSalvo = !fluxo?.id || /^f\d+$/.test(String(fluxo.id));

  return (
    <div className="absolute top-3 right-3 bottom-3 z-40 w-[min(22rem,calc(100%-1.5rem))] flex flex-col rounded-2xl border border-linha bg-grafite-800/98 backdrop-blur-md shadow-2xl overflow-hidden fade-in">

      <div className="shrink-0 p-3 bg-grafite-600 border-b border-linha flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-bold text-white font-display">
            <MessageSquare size={14} className="text-acao-200 shrink-0" />
            <span className="truncate">Testar fluxo</span>
          </div>
          <div className="text-[10px] text-slate-400 truncate mt-0.5">
            {fluxo?.nome} · gatilho{' '}
            <span className="font-mono text-slate-300">
              {fluxo?.gatilho === '*' ? 'qualquer mensagem' : fluxo?.gatilho || '-'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={reiniciar}
            title="Reiniciar a conversa de teste"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <RotateCcw size={13} />
          </button>
          <button
            onClick={onClose}
            title="Fechar"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-grafite-900">
        {turnos.length === 0 && !carregando && (
          <div className="text-[11px] text-slate-500 leading-relaxed space-y-2">
            <p>
              Escreva como se fosse o cliente no WhatsApp. As respostas vêm do motor
              real do chatbot, mas <strong className="text-slate-400">nada é enviado</strong> e
              nada é gravado.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {['oi', '1', '2', 'menu inicial'].map(sugestao => (
                <button
                  key={sugestao}
                  onClick={() => enviar(sugestao)}
                  className="px-2 py-1 rounded-lg bg-grafite-700 border border-linha text-[10px] text-slate-300 hover:border-acao/40 hover:text-acao-200 transition-all font-mono"
                >
                  {sugestao}
                </button>
              ))}
            </div>
          </div>
        )}

        {turnos.map((turno, i) => (
          <div key={i} className="space-y-2">
            <div className="flex justify-end">
              <div className="max-w-[85%] px-2.5 py-1.5 rounded-xl rounded-br-sm bg-acao/20 border border-acao/30 text-[11px] text-white whitespace-pre-wrap break-words">
                {turno.entrada}
              </div>
            </div>

            {turno.respostas.length === 0 && (
              <div className="text-[10px] text-slate-500 italic px-1">(bot não respondeu)</div>
            )}
            {turno.respostas.map((resp, j) => (
              <div key={j} className="flex justify-start">
                <div className="max-w-[85%] px-2.5 py-1.5 rounded-xl rounded-bl-sm bg-grafite-700 border border-linha text-[11px] text-slate-200 whitespace-pre-wrap break-words">
                  {resp}
                </div>
              </div>
            ))}

            {/* Estado depois do turno: e o que explica por que o bot respondeu
                aquilo, e onde a conversa parou no desenho do fluxo. */}
            <div className="flex flex-wrap gap-1 px-1">
              {turno.passoAtualTitulo && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-grafite-800 border border-linha text-slate-400">
                  em: {turno.passoAtualTitulo}
                </span>
              )}
              {turno.transferido && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-blue-500/15 border border-blue-500/30 text-blue-400 inline-flex items-center gap-1">
                  <UserRound size={9} /> atendente
                  {turno.setor && turno.setor !== 'Geral' ? ` · ${turno.setor}` : ''}
                  {turno.filaId != null ? ` · fila ${turno.filaId}` : ''}
                </span>
              )}
              {turno.encerrado && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-ativo/15 border border-ativo/30 text-ativo-400 inline-flex items-center gap-1">
                  <CheckCircle2 size={9} /> encerrado
                </span>
              )}
              {turno.motivo && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-grafite-800 border border-linha text-slate-500 font-mono">
                  {turno.motivo}
                </span>
              )}
            </div>
          </div>
        ))}

        {carregando && (
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400 px-1">
            <Loader2 size={11} className="animate-spin" /> processando...
          </div>
        )}

        {erro && (
          <div className="flex items-start gap-1.5 p-2 rounded-xl bg-falha/15 border border-falha/40 text-[10px] text-falha-400">
            <AlertCircle size={11} className="shrink-0 mt-0.5" />
            <span className="break-words">{erro}</span>
          </div>
        )}

        <div ref={fimRef} />
      </div>

      <div className="shrink-0 p-2.5 bg-grafite-800 border-t border-linha space-y-2">
        {naoSalvo && (
          <p className="text-[10px] text-espera-400">
            Salve o fluxo antes de testar: a simulação lê os blocos do servidor.
          </p>
        )}
        {finalizado && (
          <p className="text-[10px] text-slate-500">
            Conversa finalizada. Use o botão de reiniciar para testar outro caminho.
          </p>
        )}
        <div className="flex items-center gap-1.5">
          <input
            ref={inputRef}
            value={entrada}
            onChange={e => setEntrada(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') enviar(entrada); }}
            placeholder={finalizado ? 'Reinicie para continuar' : 'Mensagem do cliente...'}
            disabled={carregando || finalizado}
            className="flex-1 min-w-0 bg-grafite-700 border border-linha rounded-xl px-3 py-2 text-[11px] text-white placeholder-slate-500 focus:outline-none focus:border-acao/50 disabled:opacity-50"
          />
          <button
            onClick={() => enviar(entrada)}
            disabled={carregando || finalizado || !entrada.trim()}
            title="Enviar como cliente"
            className="p-2 rounded-xl bg-acao hover:bg-acao-200 text-slate-950 transition-all disabled:opacity-40 shrink-0"
          >
            <Send size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
