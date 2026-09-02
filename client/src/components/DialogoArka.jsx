/**
 * O CARTÃO DOS DIÁLOGOS -- a cara da Arka no lugar da caixa do navegador.
 *
 * Fica montado UMA vez, no topo do app (ver App.jsx), e desenha o pedido que
 * estiver na frente da fila (ver utils/dialogo.js). Nenhuma tela precisa
 * conhecê-lo: quem quer perguntar algo chama `confirmar(...)` e recebe a
 * resposta por Promise.
 *
 * ── O QUE ELE COPIA DO NATIVO, DE PROPÓSITO ────────────────────────────────
 *
 * Teclado: Enter confirma, ESC cancela. São os dois atalhos que qualquer pessoa
 * já tem no dedo, e um modal bonito que exige mouse é mais lento que a caixa
 * feia que ele substituiu.
 *
 * Foco: entra no botão de ação (ou no campo, quando há um) e VOLTA para onde
 * estava ao fechar. Sem devolver o foco, quem usa teclado é jogado para o começo
 * da página a cada confirmação.
 *
 * Bloqueio: o fundo escurece e o clique fora cancela -- mas só em pedidos que
 * têm cancelamento. Num aviso de erro, clicar fora fecha, porque não há decisão
 * a tomar.
 *
 * ── ALTURA ─────────────────────────────────────────────────────────────────
 *
 * O cartão tem `max-h-[calc(100dvh-2rem)]` e o corpo rola por dentro. Mensagem
 * de erro do servidor pode ser longa, e num notebook de tela curta um cartão sem
 * teto passa da viewport sem deixar rolagem -- com o botão de confirmar parando
 * fora do alcance, num diálogo que só existe para receber esse clique.
 */
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Info, XCircle, HelpCircle } from 'lucide-react';
import Portal from './Portal';
import { inscreverDialogo, responderDialogo } from '../utils/dialogo';

// Ícone e cor por tipo. O vermelho é reservado para o que falhou ou não tem
// volta; aviso é amarelo; pergunta comum é neutra.
const ESTILOS = {
  erro:   { Icon: XCircle,       cor: 'text-falha-400',  aro: 'bg-falha/15 border-falha/30' },
  aviso:  { Icon: AlertTriangle, cor: 'text-espera-400', aro: 'bg-espera/15 border-espera/30' },
  info:   { Icon: Info,          cor: 'text-acao-200',   aro: 'bg-acao/15 border-acao/30' },
  pergunta: { Icon: HelpCircle,  cor: 'text-acao-200',   aro: 'bg-acao/15 border-acao/30' },
};

export default function DialogoArka() {
  const [pedido, setPedido] = useState(null);
  const [texto, setTexto] = useState('');
  const focoAnteriorRef = useRef(null);
  const acaoRef = useRef(null);
  const campoRef = useRef(null);

  useEffect(() => inscreverDialogo(setPedido), []);

  // Cada pedido novo começa com o campo no valor inicial dele.
  useEffect(() => {
    if (!pedido) return;
    setTexto(pedido.modo === 'texto' ? (pedido.valorInicial || '') : '');
  }, [pedido?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Guarda quem tinha o foco, joga o foco para dentro e devolve ao fechar.
  useEffect(() => {
    if (!pedido) return;
    focoAnteriorRef.current = document.activeElement;
    const alvo = pedido.modo === 'texto' ? campoRef.current : acaoRef.current;
    alvo?.focus();
    if (pedido.modo === 'texto') campoRef.current?.select?.();
    return () => {
      const anterior = focoAnteriorRef.current;
      if (anterior && typeof anterior.focus === 'function') anterior.focus();
    };
  }, [pedido?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!pedido) return null;

  const { id, modo, mensagem, titulo, tipo, perigo } = pedido;
  const ehConfirmacao = modo === 'confirmar' || modo === 'texto';
  const estilo = ESTILOS[tipo] || (perigo ? ESTILOS.aviso : ESTILOS[ehConfirmacao ? 'pergunta' : 'erro']);
  const { Icon, cor, aro } = estilo;

  // O que cada modo devolve. O contrato é o do nativo: `confirm` dá booleano,
  // `prompt` dá string ou null, `alert` não dá nada.
  const cancelar = () => responderDialogo(id, modo === 'texto' ? null : false);
  const confirmar = () => responderDialogo(id, modo === 'texto' ? texto : modo === 'confirmar' ? true : undefined);

  const rotuloAcao =
    pedido.rotuloConfirmar || (modo === 'aviso' ? pedido.rotuloOk || 'Entendi' : 'Confirmar');

  const aoTeclar = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelar(); return; }
    // Enter confirma -- menos dentro de textarea, onde ele é quebra de linha.
    if (e.key === 'Enter' && e.target?.tagName !== 'TEXTAREA') {
      e.preventDefault();
      e.stopPropagation();
      confirmar();
    }
  };

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
        // Clique no fundo: cancela quando há o que cancelar, fecha quando é só
        // aviso. Só reage no próprio fundo (não em clique que subiu do cartão).
        onMouseDown={(e) => { if (e.target === e.currentTarget) (ehConfirmacao ? cancelar() : confirmar()); }}
        onKeyDown={aoTeclar}
      >
        {/* Teto de altura + corpo rolável -- ver a nota no topo do arquivo. */}
        <div
          role="dialog"
          aria-modal="true"
          className="glass-panel fade-in flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-linha shadow-2xl shadow-black/50"
          aria-labelledby={`dlg-${id}-titulo`}
          aria-describedby={`dlg-${id}-msg`}
        >
          {/* Cabeçalho com a MARCA. É o ponto do exercício: em vez de "o site tal
              diz", quem está falando é a Arka. */}
          <div className="flex shrink-0 items-center gap-2.5 border-b border-linha bg-grafite-600 px-4 py-3">
            <img
              src="/arka_tecnologia_logo-removebg-preview.png"
              alt="Arka Tecnologia"
              className="arka-logo h-6 w-auto shrink-0 object-contain"
            />
            <div className="h-5 w-px bg-linha" />
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-texto-suave">
              Central de Atendimento
            </span>
          </div>

          <div className="flex min-h-0 flex-1 gap-3.5 overflow-y-auto p-5">
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border ${aro} ${cor}`}>
              <Icon size={18} />
            </span>
            <div className="min-w-0 flex-1 space-y-1.5">
              <h2 id={`dlg-${id}-titulo`} className="font-display text-sm font-bold text-white">
                {titulo || (modo === 'aviso' ? 'Aviso' : 'Confirmar ação')}
              </h2>
              {/* `whitespace-pre-line`: as mensagens herdadas do `alert` usam \n
                  para separar parágrafos, e sem isto tudo viraria um bloco só. */}
              <p id={`dlg-${id}-msg`} className="whitespace-pre-line text-xs leading-relaxed text-texto-suave">
                {mensagem}
              </p>

              {modo === 'texto' && (
                <input
                  ref={campoRef}
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  placeholder={pedido.placeholder || ''}
                  className="mt-2 w-full rounded-xl border border-linha bg-grafite-800 px-3 py-2 text-xs text-white placeholder-texto-fraco outline-none transition-colors focus:border-acao focus:ring-2 focus:ring-acao/25"
                />
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-linha bg-grafite-700/60 px-4 py-3">
            {ehConfirmacao && (
              <button
                type="button"
                onClick={cancelar}
                className="rounded-xl border border-linha bg-grafite-700 px-3.5 py-2 text-xs font-semibold text-texto-suave transition-colors hover:border-linha-forte hover:text-white"
              >
                {pedido.rotuloCancelar || 'Cancelar'}
              </button>
            )}
            <button
              ref={acaoRef}
              type="button"
              onClick={confirmar}
              className={`rounded-xl px-3.5 py-2 text-xs font-bold text-slate-950 shadow-md transition-colors ${
                perigo
                  ? 'bg-falha-400 shadow-falha/20 hover:bg-falha'
                  : 'bg-acao shadow-acao/20 hover:bg-acao-200'
              }`}
            >
              {rotuloAcao}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
