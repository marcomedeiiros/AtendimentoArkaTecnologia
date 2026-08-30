import { useRef, useState, useEffect, useCallback } from 'react';
import { X, Play, HelpCircle, Trash2, Variable, GitBranch, Save, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';

const BLOCK_META = {
  gatilho:    { emoji: '⚡', label: 'Gatilho'     },
  mensagem:   { emoji: '💬', label: 'Mensagem'    },
  condicao:   { emoji: '🔍', label: 'Validar CNPJ'},
  delay:      { emoji: '⏳', label: 'Delay'       },
  acao:       { emoji: '🚀', label: 'Ação ERP'    },
  comentario: { emoji: '📝', label: 'Anotação'    },
  avaliacao:  { emoji: '⭐', label: 'Pesquisa de Satisfação' }
};

const VARS = [
  { tag: '{{cliente.nome}}',      label: 'Nome do cliente',    emoji: '👤' },
  { tag: '{{cliente.cnpj}}',      label: 'CNPJ do cliente',    emoji: '🏢' },
  { tag: '{{parceiro.status}}',   label: 'Status do parceiro', emoji: '🛡️' },
  { tag: '{{data.hoje}}',         label: 'Data de hoje',       emoji: '📅' },
  { tag: '{{atendente.nome}}',    label: 'Atendente',          emoji: '🧑‍💼' },
  { tag: '{{empresa.nome}}',      label: 'Nome da empresa',    emoji: '🏷️' },
];

const typeHelpText = {
  gatilho:    'Define a palavra-chave ou evento que inicia a execução deste fluxo.',
  mensagem:   'Mensagem de texto enviada automaticamente ao cliente no WhatsApp.',
  condicao:   'Valida se o CNPJ possui contrato de parceiro ativo no banco Arka.',
  delay:      'Pausa estratégica em segundos, simulando digitação humana.',
  acao:       'Executa ação automática: desconto, geração de boleto/Pix, etc.',
  comentario: 'Anotação interna visual para organização da equipe.',
  avaliacao:  'Pergunta a nota (1–5) e um comentário ao cliente, salva a avaliação e encerra o atendimento. Só funciona no modo "local".'
};

function RichTextEditor({ value, onChange, rows = 4, placeholder }) {
  const textareaRef = useRef(null);

  function insertTag(tag) {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end   = el.selectionEnd;
    const newVal = value.slice(0, start) + tag + value.slice(end);
    onChange(newVal);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + tag.length, start + tag.length);
    });
  }

  function renderPreview(text) {
    if (!text) return null;
    const regex = /(\{\{[^}]+\}\})/g;
    const parts = text.split(regex);
    return parts.map((part, i) => {
      const v = VARS.find(v => v.tag === part);
      if (v) {
        return (
          <span key={i} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-acao/20 border border-acao/40 text-acao-200 text-[10px] font-semibold font-mono mx-0.5 align-middle">
            {v.emoji} {v.label}
          </span>
        );
      }
      return <span key={i} className="whitespace-pre-wrap break-words">{part}</span>;
    });
  }

  return (
    <div className="space-y-2">
      <textarea
        ref={textareaRef}
        rows={rows}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-grafite-700 border border-linha rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-acao/50 resize-none font-mono leading-relaxed"
      />
      {value && value.includes('{{') && (
        <div className="bg-grafite-900 border border-linha rounded-xl p-3 text-xs text-slate-200 leading-relaxed">
          <div className="text-[10px] text-slate-500 font-semibold mb-1.5 flex items-center gap-1">
            <span>👁️</span> Preview (como será enviado)
          </div>
          <div>{renderPreview(value)}</div>
        </div>
      )}
    </div>
  );
}


/**
 * ── O PAINEL AGORA EDITA UM RASCUNHO, E SALVAR É UM ATO ────────────────────
 *
 * Antes, cada `onChange` deste painel subia direto: digitar "Bom dia" mandava
 * sete gravações do FLUXO INTEIRO ao servidor, uma por tecla, sem ordem
 * garantida de chegada. E como cada gravação reescrevia todos os passos, a
 * resposta que chegasse por último vencia, e podia ser a mais velha.
 *
 * O que muda aqui é só ONDE a digitação mora. O corpo do painel continua
 * chamando `onChangeNode({ ...node, campo: valor })` exatamente como antes; o
 * que ele altera passa a ser o RASCUNHO local (`node`, o estado abaixo), e não
 * mais o servidor. Foi de propósito: manter a assinatura interna evita mexer
 * nas dezenas de campos do painel só para trocar o destino do dado.
 *
 * Quem sobe é o botão Salvar, uma vez, com o bloco inteiro e ele diz o que
 * aconteceu. Se falhar, o rascunho FICA: perder o texto que a pessoa acabou de
 * escrever porque a rede piscou seria trocar um problema por outro pior.
 *
 * `onChangeGatilhoFluxo` continua fora disso: o gatilho é do FLUXO, não deste
 * bloco, e já tinha o próprio rascunho.
 */
export function FlowPropertyPanel({
  node: nodeSalvo,
  nodes = [],
  gatilhoFluxo = '',
  onChangeGatilhoFluxo,
  onClose,
  onSalvarNode,
  onDeleteNode,
  onTestSingleNode,
}) {
  // Rascunho local do gatilho: salvar a cada tecla dispararia um PUT por
  // caractere. Sobe no blur / Enter. Hook antes do early return de proposito.
  const [gatilhoDraft, setGatilhoDraft] = useState(gatilhoFluxo);
  useEffect(() => { setGatilhoDraft(gatilhoFluxo); }, [gatilhoFluxo]);

  // O rascunho do BLOCO. Todos os hooks ficam antes do early return.
  const [rascunho, setRascunho] = useState(nodeSalvo);
  const [sujo, setSujo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState(null); // { tipo: 'ok'|'erro', msg }

  // Troca de bloco (outro id) recomeça o rascunho. Depende do ID e não do
  // objeto: o pai recria os nós a cada render, e observar o objeto apagaria o
  // que a pessoa está digitando a cada atualização da tela.
  useEffect(() => {
    setRascunho(nodeSalvo);
    setSujo(false);
    setResultado(null);
  }, [nodeSalvo?.id]);

  // O corpo do painel inteiro segue escrevendo em `node` via `onChangeNode`.
  // A diferença é o destino: rascunho, não servidor.
  const onChangeNode = useCallback((atualizado) => {
    setRascunho(atualizado);
    setSujo(true);
    setResultado(null);
  }, []);

  const salvarBloco = useCallback(async () => {
    // A trava é esta linha, e não o `disabled` do botão: `disabled` some com um
    // duplo-clique rápido (o segundo clique chega antes do re-render) e não
    // existe para quem dispara pelo teclado. Duas gravações do mesmo bloco não
    // corrompem nada, mas a segunda pode chegar antes da primeira e regravar a
    // versão anterior por cima.
    if (salvando) return;
    const titulo = String(rascunho?.titulo || '').trim();
    if (!titulo) {
      setResultado({ tipo: 'erro', msg: 'O bloco precisa de um título.' });
      return;
    }
    setSalvando(true);
    setResultado(null);
    try {
      await onSalvarNode({ ...rascunho, titulo });
      setSujo(false);
      setResultado({ tipo: 'ok', msg: 'Bloco salvo.' });
    } catch (e) {
      // O rascunho NÃO é descartado: a pessoa tenta de novo sem redigitar.
      setResultado({ tipo: 'erro', msg: e.message || 'Não foi possível salvar o bloco.' });
    } finally {
      setSalvando(false);
    }
  }, [salvando, rascunho, onSalvarNode]);

  // Fechar com alteração pendente avisa. Sem isto, o X do canto vira um
  // "descartar" silencioso e o painel acabou de deixar de salvar sozinho.
  const fechar = useCallback(() => {
    if (sujo && !window.confirm('Este bloco tem alterações não salvas. Descartar?')) return;
    onClose();
  }, [sujo, onClose]);

  useEffect(() => {
    if (resultado?.tipo !== 'ok') return undefined;
    const t = setTimeout(() => setResultado(null), 2500);
    return () => clearTimeout(t);
  }, [resultado]);

  if (!nodeSalvo) return null;
  const node = rascunho || nodeSalvo;

  const isComment = node.tipo === 'comentario';
  const meta = BLOCK_META[node.tipo] || BLOCK_META.mensagem;
  const currentDesc = node.desc || node.texto || '';
  const opcoes = Array.isArray(node.config?.opcoes) ? node.config.opcoes : [];

  function descreverDestino(op) {
    if (op.acao === 'transferir') return `Transferir para atendente${op.filaId ? ` (fila ${op.filaId})` : ''}`;
    if (op.acao === 'encerrar') return 'Encerrar atendimento';
    const destino = nodes.find(n => n.id === op.targetId);
    return destino ? destino.titulo : 'Destino não encontrado';
  }

  function insertVar(tag) {
    const newDesc = currentDesc + (currentDesc.endsWith(' ') || !currentDesc ? '' : ' ') + tag;
    onChangeNode({ ...node, desc: newDesc, texto: newDesc });
  }

  // Abaixo de lg o painel flutua sobre o canvas em vez de ocupar uma coluna:
  // com 320px fixos numa tela de 400px nao sobrava area util para o fluxo.
  return (
    <aside className="absolute inset-y-0 right-0 w-full max-w-[20rem] lg:static lg:w-96 lg:max-w-none shrink-0 bg-grafite-800 border-l border-linha h-full flex flex-col z-30 shadow-2xl fade-in overflow-hidden">

      <div className="p-4 bg-grafite-600 border-b border-linha flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-2xl leading-none">{meta.emoji}</span>
          <div>
            <h3 className="font-bold text-sm text-white font-display leading-tight">
              {node.titulo || 'Configurar Bloco'}
              {sujo && <span className="ml-1.5 text-espera-400" title="Alterações não salvas">•</span>}
            </h3>
            <span className="text-[10px] text-slate-500 font-mono">ID: {node.id} · {meta.label}</span>
          </div>
        </div>
        <button onClick={fechar} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">

        <div>
          <label className="text-xs font-semibold text-slate-300 block mb-1.5">Título do Bloco</label>
          <input
            value={node.titulo || ''}
            onChange={e => onChangeNode({ ...node, titulo: e.target.value })}
            className="w-full bg-grafite-700 border border-linha rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-acao/50"
            placeholder="Nome da etapa"
          />
        </div>

        {/* Avaliacao nao usa o texto generico: suas mensagens ficam no bloco de
            config abaixo (config.mensagem*). */}
        {node.tipo !== 'avaliacao' && (
        <div>
          <label className="text-xs font-semibold text-slate-300 block mb-1.5">
            {isComment ? 'Conteúdo da Anotação' : 'Texto / Mensagem'}
            {!isComment && <span className="ml-1.5 text-slate-500 font-normal">({currentDesc.length} chars)</span>}
          </label>
          {isComment ? (
            <textarea
              rows={5}
              value={currentDesc}
              onChange={e => onChangeNode({ ...node, desc: e.target.value, texto: e.target.value })}
              className="w-full bg-grafite-700 border border-linha rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-acao/50 resize-none"
              placeholder="Escreva uma nota de organização..."
            />
          ) : (
            <RichTextEditor
              value={currentDesc}
              onChange={val => onChangeNode({ ...node, desc: val, texto: val })}
              rows={5}
              placeholder="Digite a mensagem ou descrição da etapa..."
            />
          )}
        </div>
        )}

        {!isComment && (
          <>
            {node.tipo === 'gatilho' && (
              <div className="p-3.5 rounded-xl bg-acao/10 border border-acao/30 space-y-2">
                <label className="text-xs font-bold text-acao-200 flex items-center gap-1.5">⚡ Palavra-Chave Gatilho</label>
                {/* Este campo escrevia em `node.gatilho`, que o zod do back-end
                    descarta (passoSchema nao tem `gatilho`): nada era salvo. O
                    gatilho e do FLUXO, nao do passo, entao vai por aqui. */}
                <input
                  value={gatilhoDraft}
                  onChange={e => setGatilhoDraft(e.target.value)}
                  onBlur={() => onChangeGatilhoFluxo?.(gatilhoDraft)}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                  placeholder="ex: orçamento, boleto, suporte"
                  className="w-full bg-grafite-700 border border-linha rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-acao/50 font-mono"
                />
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  Palavra que o cliente envia para o bot abrir este fluxo. Separe várias
                  por vírgula. Use <code className="text-acao-200 font-mono">*</code> para
                  abrir em qualquer mensagem (menu de boas-vindas).
                </p>
              </div>
            )}

            {node.tipo === 'delay' && (
              <div className="p-3.5 rounded-xl bg-slate-900 border border-linha space-y-2">
                <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">⏳ Tempo de Espera (segundos)</label>
                {/* ── ESTE CAMPO ERA DECORATIVO ──────────────────────────────
                    Ele escrevia em `node.delaySeconds`, que nao existia em
                    lugar nenhum do resto do projeto:

                      - o `passoSchema` nao o declara, e o `validate` troca
                        `req.body` pelo resultado do Zod -- o valor morria na
                        borda, sem chegar ao banco;
                      - nao ha coluna para ele, nem no `mapPasso`, entao o campo
                        relia o padrao 1.5 a cada abertura;
                      - e o motor le OUTRA coisa, em OUTRA unidade:
                        `Number(passo.config?.ms) || 1000` (chatbot.engine).

                    Lugar, nome e unidade divergentes ao mesmo tempo. Digitar
                    aqui nao gravava nada e nao mudava o comportamento do bot.

                    Agora o campo escreve em `config.ms`, que e o que o motor
                    de fato usa. A tela continua em SEGUNDOS porque e assim que
                    se pensa uma pausa de conversa; a conversao mora aqui.

                    (O painel ja tinha a cicatriz do mesmo defeito num outro
                    campo -- ver o comentario do gatilho acima. O Delay ficou
                    de fora naquela vez.) */}
                <input
                  type="number" step="0.5" min="0.5"
                  value={((Number(node.config?.ms) || 1000) / 1000)}
                  onChange={e => {
                    const seg = parseFloat(e.target.value);
                    const ms = Math.round((Number.isFinite(seg) && seg > 0 ? seg : 1) * 1000);
                    onChangeNode({ ...node, config: { ...(node.config || {}), ms } });
                  }}
                  className="w-full bg-grafite-700 border border-linha rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none"
                />
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  Pausa antes de seguir para o próximo bloco. O servidor limita o
                  valor máximo, então um número muito grande é reduzido ao teto.
                </p>
              </div>
            )}

            {/* ESPERA / TIMEOUT -- o relógio do bot, agora visível.
                Esta regra sempre existiu, mas morava dentro do `config` de uma
                anotação: pelo desenho, ninguém descobria que o bot fecha a
                conversa depois de 5 minutos calado. Como bloco, ela se explica.

                Os DOIS relógios são coisas diferentes e não podem compartilhar
                configuração: quem espera atendimento não "deixou de responder",
                e receber "não entendemos sua demanda" na fila seria errado. */}
            {node.tipo === 'espera' && (
              <div className="p-3.5 rounded-xl bg-orange-500/10 border border-orange-500/30 space-y-3">
                <label className="text-xs font-bold text-orange-400 flex items-center gap-1.5">⏱️ Espera / Timeout</label>

                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">O que está sendo esperado</label>
                  <select
                    value={node.config?.modo || 'sem_resposta'}
                    onChange={e => onChangeNode({ ...node, config: { ...(node.config || {}), modo: e.target.value } })}
                    className="w-full bg-grafite-700 border border-linha rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-orange-500/50"
                  >
                    <option value="sem_resposta">O cliente não respondeu ao bot</option>
                    <option value="fila_pendentes">Ninguém assumiu a conversa na fila</option>
                  </select>
                  <p className="text-[10px] text-slate-400 leading-relaxed mt-1.5">
                    {(node.config?.modo || 'sem_resposta') === 'sem_resposta'
                      ? 'O bot fez uma pergunta obrigatória (CNPJ, opção do menu) e o cliente sumiu.'
                      : 'Não há pergunta pendente: a conversa está em Pendentes e nenhum atendente assumiu.'}
                  </p>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">Esperar por (minutos)</label>
                  <input
                    type="number" min="1" max="1440"
                    value={node.config?.minutos ?? ((node.config?.modo || 'sem_resposta') === 'sem_resposta' ? 5 : 10)}
                    onChange={e => onChangeNode({ ...node, config: { ...(node.config || {}), minutos: Number(e.target.value) || 5 } })}
                    className="w-full bg-grafite-700 border border-linha rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-orange-500/50"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    O prazo corre no SERVIDOR: vale com a aba fechada e atravessa reinício.
                  </p>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">Mensagem enviada ao cliente</label>
                  <textarea
                    rows={2}
                    value={node.config?.mensagem || ''}
                    onChange={e => onChangeNode({ ...node, config: { ...(node.config || {}), mensagem: e.target.value } })}
                    className="w-full bg-grafite-700 border border-linha rounded-lg p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50 resize-none"
                    placeholder={(node.config?.modo || 'sem_resposta') === 'sem_resposta'
                      ? 'Padrão: Não entendemos a sua demanda. Por favor, abra um chamado novamente.'
                      : 'Padrão: Ei {{cliente}}! Estamos com uma demanda alta no momento...'}
                  />
                </div>

                {(node.config?.modo || 'sem_resposta') === 'sem_resposta' ? (
                  <div>
                    <label className="text-[11px] font-semibold text-slate-300 block mb-1">Depois disso</label>
                    <select
                      value={node.config?.acao || 'encerrar'}
                      onChange={e => onChangeNode({ ...node, config: { ...(node.config || {}), acao: e.target.value } })}
                      className="w-full bg-grafite-700 border border-linha rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-orange-500/50"
                    >
                      <option value="encerrar">Encerrar o atendimento</option>
                      <option value="fila">Devolver para a fila (atendente humano)</option>
                    </select>
                    <p className="text-[10px] text-slate-400 leading-relaxed mt-1.5">
                      Encerrar <strong className="text-orange-400">não pede nota de avaliação</strong>: quem
                      abandonou a conversa não foi atendido, então não há atendimento para avaliar.
                    </p>
                  </div>
                ) : (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={node.config?.repetir === true}
                      onChange={e => onChangeNode({ ...node, config: { ...(node.config || {}), repetir: e.target.checked } })}
                      className="accent-orange-500"
                    />
                    <span className="text-[11px] text-slate-300">
                      Repetir o aviso <span className="text-slate-500">(desmarcado: uma vez por atendimento)</span>
                    </span>
                  </label>
                )}

                <p className="text-[10px] text-slate-500 leading-relaxed border-t border-linha pt-2">
                  Este bloco é uma REGRA sobre a conversa, não um passo dela: ele não se liga a
                  outros blocos e não precisa de fio.
                  <strong className="text-orange-400"> Com o fluxo pausado, nada disso roda.</strong>
                </p>
              </div>
            )}

            {node.tipo === 'avaliacao' && (
              <div className="p-3.5 rounded-xl bg-yellow-500/10 border border-yellow-500/30 space-y-3">
                <label className="text-xs font-bold text-yellow-400 flex items-center gap-1.5">⭐ Pesquisa de Satisfação</label>
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  Ao chegar aqui, o bot pergunta a nota (1–5), salva a avaliação e encerra o
                  atendimento. Campo em branco = usa o texto padrão mostrado no próprio campo.
                  <strong className="text-yellow-400"> Com o fluxo pausado, nada disso é enviado.</strong>
                </p>

                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">Pergunta da nota</label>
                  <textarea
                    rows={2}
                    value={node.config?.mensagemNota || ''}
                    onChange={e => onChangeNode({ ...node, config: { ...(node.config || {}), mensagemNota: e.target.value } })}
                    className="w-full bg-grafite-700 border border-linha rounded-lg p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-yellow-500/50 resize-none"
                    placeholder="Padrão: Antes de encerrar: de 1 a 5, que nota você dá para este atendimento? (1 = péssimo, 5 = ótimo)"
                  />
                </div>

                {/* MODO DE INTERAÇÃO DA PESQUISA DE SATISFAÇÃO */}
                <div className="p-3 rounded-xl bg-grafite-700 border border-linha space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-white flex items-center gap-1.5">
                      <span>🔘</span> Modo de Resposta da Nota
                    </label>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {node.config?.exibicao === 'text' ? 'Digitar nota (1 a 5)' : 'Botões interativos'}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 leading-relaxed">
                    Escolha como o cliente responderá à pergunta da nota:
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: 'buttons', label: '🔘 Botões', sub: 'Clicar na nota (1 a 5)' },
                      { id: 'text',    label: '💬 Texto', sub: 'Digitar a nota (1 a 5)' },
                    ].map((modo) => {
                      const ativo = (node.config?.exibicao || 'buttons') === modo.id;
                      return (
                        <button
                          key={modo.id}
                          type="button"
                          onClick={() =>
                            onChangeNode({
                              ...node,
                              config: { ...(node.config || {}), exibicao: modo.id },
                            })
                          }
                          className={`p-2.5 rounded-xl border text-left transition-all ${
                            ativo
                              ? 'bg-yellow-500/15 border-yellow-500/50 text-white shadow-sm'
                              : 'bg-grafite-800 border-linha text-slate-300 hover:border-slate-500'
                          }`}
                        >
                          <div className="text-xs font-bold flex items-center justify-between">
                            <span>{modo.label}</span>
                            {ativo && <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />}
                          </div>
                          <div className="text-[9px] text-slate-400 mt-0.5">{modo.sub}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={node.config?.pedirComentario !== false}
                    onChange={e => onChangeNode({ ...node, config: { ...(node.config || {}), pedirComentario: e.target.checked } })}
                    className="accent-yellow-500"
                  />
                  Pedir um comentário depois da nota
                </label>

                {node.config?.pedirComentario !== false && (
                  <div>
                    <label className="text-[11px] font-semibold text-slate-300 block mb-1">Pergunta do comentário</label>
                    <textarea
                      rows={2}
                      value={node.config?.mensagemComentario || ''}
                      onChange={e => onChangeNode({ ...node, config: { ...(node.config || {}), mensagemComentario: e.target.value } })}
                      className="w-full bg-grafite-700 border border-linha rounded-lg p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-yellow-500/50 resize-none"
                      placeholder='Padrão: Obrigado! Em poucas palavras, o que foi bom ou o que podemos melhorar? (ou responda "pular")'
                    />
                  </div>
                )}

                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">Mensagem de agradecimento</label>
                  <textarea
                    rows={2}
                    value={node.config?.mensagemAgradecimento || ''}
                    onChange={e => onChangeNode({ ...node, config: { ...(node.config || {}), mensagemAgradecimento: e.target.value } })}
                    className="w-full bg-grafite-700 border border-linha rounded-lg p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none resize-none focus:border-yellow-500/50"
                    placeholder="Padrão: Sua avaliação foi registrada. Obrigado pelo seu feedback!"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">Resposta que não é uma nota de 1 a 5</label>
                  <textarea
                    rows={2}
                    value={node.config?.mensagemNotaInvalida || ''}
                    onChange={e => onChangeNode({ ...node, config: { ...(node.config || {}), mensagemNotaInvalida: e.target.value } })}
                    className="w-full bg-grafite-700 border border-linha rounded-lg p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none resize-none focus:border-yellow-500/50"
                    placeholder="Padrão: Por favor, responda apenas com um número de 1 a 5."
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                    Tentativas antes de desistir da nota
                  </label>
                  <input
                    type="number" min="1" max="10"
                    value={node.config?.maxTentativasAvaliacao ?? 2}
                    onChange={e => onChangeNode({ ...node, config: { ...(node.config || {}), maxTentativasAvaliacao: Number(e.target.value) || 2 } })}
                    className="w-full bg-grafite-700 border border-linha rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-yellow-500/50"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    Esgotadas, o atendimento é registrado como <strong>“Optou por não dar nota”</strong>
                    nunca com uma nota inventada.
                  </p>
                </div>

                <div className="pt-2 border-t border-yellow-500/20">
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                    ⏱️ Esperar a resposta por (minutos)
                  </label>
                  <input
                    type="number" min="1" max="1440"
                    value={node.config?.timeoutAvaliacaoMin ?? 5}
                    onChange={e => onChangeNode({ ...node, config: { ...(node.config || {}), timeoutAvaliacaoMin: Number(e.target.value) || 5 } })}
                    className="w-full bg-grafite-700 border border-linha rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-yellow-500/50"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    Contado pelo <strong>servidor</strong>: vale com o navegador fechado e atravessa
                    reinício do sistema. Sem resposta no prazo, o atendimento fica como
                    <strong> “Sem resposta”</strong> (não fica pendente para sempre).
                  </p>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">Mensagem quando o prazo acaba</label>
                  <textarea
                    rows={2}
                    value={node.config?.mensagemTimeoutAvaliacao || ''}
                    onChange={e => onChangeNode({ ...node, config: { ...(node.config || {}), mensagemTimeoutAvaliacao: e.target.value } })}
                    className="w-full bg-grafite-700 border border-linha rounded-lg p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none resize-none focus:border-yellow-500/50"
                    placeholder="Padrão: Agradecemos o seu contato! Caso precise de mais alguma coisa, estaremos à disposição."
                  />
                </div>
              </div>
            )}

            {/* ---------- VALIDAR CNPJ: todos os parâmetros da identificação ---------- */}
            {node.tipo === 'condicao' && (
              <div className="p-3.5 rounded-xl bg-blue-500/10 border border-blue-500/30 space-y-3">
                <label className="text-xs font-bold text-blue-300 flex items-center gap-1.5">🔎 Identificação por CNPJ</label>
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  O bot distingue quatro situações: <strong>resposta fora do esperado</strong>,
                  <strong> CNPJ inválido</strong>, <strong>CNPJ válido mas fora da lista de Clientes</strong> e
                  <strong> cliente cadastrado</strong>. Cada uma tem a sua mensagem aqui.
                </p>

                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">Tentativas permitidas</label>
                  <input
                    type="number" min="1" max="10"
                    value={node.config?.maxTentativasCnpj ?? 2}
                    onChange={e => onChangeNode({ ...node, config: { ...(node.config || {}), maxTentativasCnpj: Number(e.target.value) || 2 } })}
                    className="w-full bg-grafite-700 border border-linha rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500/50"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">Quando as tentativas acabam</label>
                  <select
                    value={node.config?.aoEsgotarTentativasCnpj || 'transferir'}
                    onChange={e => onChangeNode({ ...node, config: { ...(node.config || {}), aoEsgotarTentativasCnpj: e.target.value } })}
                    className="w-full bg-grafite-700 border border-linha rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500/50"
                  >
                    <option value="transferir">Transferir para um atendente</option>
                    <option value="avulso">Seguir como cliente avulso</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">CNPJ inválido</label>
                  <textarea
                    rows={2}
                    value={node.config?.mensagemCnpjInvalido || ''}
                    onChange={e => onChangeNode({ ...node, config: { ...(node.config || {}), mensagemCnpjInvalido: e.target.value } })}
                    className="w-full bg-grafite-700 border border-linha rounded-lg p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none resize-none focus:border-blue-500/50"
                    placeholder="Padrão: Hmm, o número informado parece estar incorreto. Poderia conferir o CNPJ e tentar novamente?"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">Última tentativa</label>
                  <textarea
                    rows={2}
                    value={node.config?.mensagemCnpjUltimaTentativa || ''}
                    onChange={e => onChangeNode({ ...node, config: { ...(node.config || {}), mensagemCnpjUltimaTentativa: e.target.value } })}
                    className="w-full bg-grafite-700 border border-linha rounded-lg p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none resize-none focus:border-blue-500/50"
                    placeholder="Padrão: O número informado parece estar incorreto. Você tem mais uma tentativa: confira o CNPJ e envie novamente."
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">CNPJ válido, fora da lista de Clientes</label>
                  <textarea
                    rows={2}
                    value={node.config?.mensagemCnpjNaoCadastrado || ''}
                    onChange={e => onChangeNode({ ...node, config: { ...(node.config || {}), mensagemCnpjNaoCadastrado: e.target.value } })}
                    className="w-full bg-grafite-700 border border-linha rounded-lg p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none resize-none focus:border-blue-500/50"
                    placeholder="Padrão: Não encontramos esse CNPJ em nossa lista de Clientes. Você será atendido como cliente avulso."
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">Cliente respondeu outra coisa</label>
                  <textarea
                    rows={2}
                    value={node.config?.mensagemRespostaInvalida || ''}
                    onChange={e => onChangeNode({ ...node, config: { ...(node.config || {}), mensagemRespostaInvalida: e.target.value } })}
                    className="w-full bg-grafite-700 border border-linha rounded-lg p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none resize-none focus:border-blue-500/50"
                    placeholder="Padrão: Hmm, não entendi o que você falou. Poderia repetir?"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    Usada quando a resposta nem parece um CNPJ (“quero falar com alguém”).
                    <strong> Não gasta tentativa.</strong>
                  </p>
                </div>

                <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-300 cursor-pointer pt-1 border-t border-blue-500/20">
                  <input
                    type="checkbox"
                    checked={node.config?.memoriaCnpj !== false}
                    onChange={e => onChangeNode({ ...node, config: { ...(node.config || {}), memoriaCnpj: e.target.checked } })}
                    className="accent-blue-500"
                  />
                  Lembrar o CNPJ de atendimentos anteriores e pedir confirmação
                </label>

                {node.config?.memoriaCnpj !== false && (
                  <>
                    <div>
                      <label className="text-[11px] font-semibold text-slate-300 block mb-1">Confirmação (empresa conhecida)</label>
                      <textarea
                        rows={3}
                        value={node.config?.mensagemConfirmarCnpj || ''}
                        onChange={e => onChangeNode({ ...node, config: { ...(node.config || {}), mensagemConfirmarCnpj: e.target.value } })}
                        className="w-full bg-grafite-700 border border-linha rounded-lg p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none resize-none focus:border-blue-500/50"
                        placeholder={'Padrão: Vi que você já foi atendido por aqui. O atendimento continua sendo para esta empresa?\n\n🏢 {{empresa}}\n\nResponda *SIM* para confirmar ou *NÃO* para informar outro CNPJ.'}
                      />
                      <p className="text-[10px] text-slate-500 mt-1">
                        Aceita <code className="text-blue-300 font-mono">{'{{empresa}}'}</code> e{' '}
                        <code className="text-blue-300 font-mono">{'{{cnpj}}'}</code>.
                      </p>
                    </div>

                    {/* MODO DE INTERAÇÃO DA CONFIRMAÇÃO DE CNPJ */}
                    <div className="p-3 rounded-xl bg-grafite-700 border border-linha space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-white flex items-center gap-1.5">
                          <span>🔘</span> Modo de Confirmação (SIM / NÃO)
                        </label>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {node.config?.exibicao === 'text' ? 'Digitar SIM/NÃO' : 'Botões interativos'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { id: 'buttons', label: '🔘 Botões', sub: 'Clicar em SIM ou NÃO' },
                          { id: 'text',    label: '💬 Texto', sub: 'Digitar SIM ou NÃO' },
                        ].map((modo) => {
                          const ativo = (node.config?.exibicao || 'buttons') === modo.id;
                          return (
                            <button
                              key={modo.id}
                              type="button"
                              onClick={() =>
                                onChangeNode({
                                  ...node,
                                  config: { ...(node.config || {}), exibicao: modo.id },
                                })
                              }
                              className={`p-2.5 rounded-xl border text-left transition-all ${
                                ativo
                                  ? 'bg-blue-500/15 border-blue-500/50 text-white shadow-sm'
                                  : 'bg-grafite-800 border-linha text-slate-300 hover:border-slate-500'
                              }`}
                            >
                              <div className="text-xs font-bold flex items-center justify-between">
                                <span>{modo.label}</span>
                                {ativo && <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />}
                              </div>
                              <div className="text-[9px] text-slate-400 mt-0.5">{modo.sub}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <label className="text-[11px] font-semibold text-slate-300 block mb-1">Pedir outro CNPJ (respondeu NÃO)</label>
                      <textarea
                        rows={2}
                        value={node.config?.mensagemPedirOutroCnpj || ''}
                        onChange={e => onChangeNode({ ...node, config: { ...(node.config || {}), mensagemPedirOutroCnpj: e.target.value } })}
                        className="w-full bg-grafite-700 border border-linha rounded-lg p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none resize-none focus:border-blue-500/50"
                        placeholder="Padrão: Sem problema. Por favor, informe o *CNPJ* (pode enviar com ou sem pontuação)."
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            {node.tipo !== 'avaliacao' && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Variable size={13} className="text-acao-200" /> Inserir Variável
              </div>
              <div className="flex flex-wrap gap-1.5">
                {VARS.map(v => (
                  <button
                    key={v.tag}
                    onClick={() => insertVar(v.tag)}
                    title={`Inserir ${v.tag}`}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-grafite-600 border border-linha hover:border-acao/50 hover:bg-acao/10 text-[11px] text-slate-300 hover:text-acao-200 transition-all"
                  >
                    <span>{v.emoji}</span>
                    <span className="font-medium">{v.label}</span>
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-slate-500">Clique na variável para inserir no cursor do texto.</p>
            </div>
            )}

            {/* MODO DE INTERAÇÃO COM O CLIENTE */}
            {(opcoes.length > 0 || node.tipo === 'mensagem' || node.tipo === 'gatilho') && (
              <div className="p-3.5 rounded-xl bg-grafite-700/80 border border-linha space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-white flex items-center gap-1.5">
                    <span>🔘</span> Modo de Interação do Menu
                  </label>
                  <span className="text-[10px] text-slate-400 font-mono">
                    {node.config?.exibicao === 'text'
                      ? 'Texto (Falar/Digitar)'
                      : node.config?.exibicao === 'list'
                      ? 'Lista'
                      : node.config?.exibicao === 'enquete'
                      ? 'Enquete'
                      : 'Botões (Clicar)'}
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  Escolha como o cliente interagirá com as opções deste bloco no WhatsApp:
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'buttons', label: '🔘 Botões', sub: 'Clicar na tela' },
                    { id: 'text',    label: '💬 Texto', sub: 'Digitar / Falar (1, 2...)' },
                    { id: 'list',    label: '📋 Lista', sub: 'Menu "Ver opções"' },
                    { id: 'enquete', label: '📊 Enquete', sub: 'Votação nativa' },
                  ].map((modo) => {
                    const ativo = (node.config?.exibicao || 'buttons') === modo.id;
                    return (
                      <button
                        key={modo.id}
                        type="button"
                        onClick={() =>
                          onChangeNode({
                            ...node,
                            config: { ...(node.config || {}), exibicao: modo.id },
                          })
                        }
                        className={`p-2.5 rounded-xl border text-left transition-all ${
                          ativo
                            ? 'bg-acao/15 border-acao/50 text-white shadow-sm'
                            : 'bg-grafite-800 border-linha text-slate-300 hover:border-slate-500'
                        }`}
                      >
                        <div className="text-xs font-bold flex items-center justify-between">
                          <span>{modo.label}</span>
                          {ativo && <span className="w-1.5 h-1.5 rounded-full bg-acao-200" />}
                        </div>
                        <div className="text-[9px] text-slate-400 mt-0.5">{modo.sub}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Ramificacoes / Opções */}
            {opcoes.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <GitBranch size={13} className="text-blue-400" /> Ramificações ({opcoes.length})
                </div>
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  Opções deste menu. Você pode ajustar o texto do botão exibido no WhatsApp.
                </p>
                {opcoes.map((op, i) => (
                  <div key={op.id || i} className="p-2.5 rounded-xl bg-grafite-700 border border-linha space-y-2">
                    <div className="text-[11px] font-semibold text-white break-words">
                      {op.rotulo || (op.esperaEscolha ? '(sem rótulo)' : 'Qualquer resposta')}
                    </div>
                    {Array.isArray(op.palavrasChave) && op.palavrasChave.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {op.palavrasChave.map((p, j) => (
                          <span key={j} className="text-[9px] px-1.5 py-0.5 rounded-md bg-grafite-900 border border-linha text-slate-400 font-mono break-all">
                            {p}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="text-[10px] text-slate-400 flex items-center gap-1">
                      <span className="text-blue-400">→</span> {descreverDestino(op)}
                    </div>

                    {/* Texto no Botão do WhatsApp */}
                    <div className="pt-1.5 border-t border-linha/50">
                      <div className="flex items-center justify-between text-[10px] text-slate-300 mb-1">
                        <span className="font-semibold">Texto do Botão (WhatsApp):</span>
                        <span className={`text-[9px] ${String(op.botao || '').length > 20 ? 'text-falha-400 font-bold' : 'text-slate-400'}`}>
                          {String(op.botao || '').length}/20 chars
                        </span>
                      </div>
                      <input
                        type="text"
                        maxLength={24}
                        value={op.botao || ''}
                        placeholder={op.rotulo?.split(',')[1] || op.rotulo?.split(',')[0] || 'Texto do botão'}
                        onChange={(e) => {
                          const novasOpcoes = [...opcoes];
                          novasOpcoes[i] = { ...op, botao: e.target.value };
                          onChangeNode({
                            ...node,
                            config: { ...(node.config || {}), opcoes: novasOpcoes },
                          });
                        }}
                        className="w-full bg-grafite-800 border border-linha rounded-lg px-2.5 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-acao/50 font-sans"
                      />
                    </div>

                    {/* O QUE ESTA OPCAO DECIDE, alem de para onde ela vai. */}
                    {(op.setor || op.limparCnpj) && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {op.setor && (
                          <span
                            title="Ao escolher esta opção, a conversa passa a ser deste setor"
                            className="text-[9px] px-1.5 py-0.5 rounded-md bg-blue-500/10 border border-blue-500/30 text-blue-300 font-bold"
                          >
                            define setor: {op.setor}
                          </span>
                        )}
                        {op.limparCnpj && (
                          <span
                            title="Desassocia o CNPJ desta conversa (o cadastro da empresa não é tocado) e pede outro"
                            className="text-[9px] px-1.5 py-0.5 rounded-md bg-espera/10 border border-espera/30 text-espera-400 font-bold"
                          >
                            desassocia CNPJ
                          </span>
                        )}
                      </div>
                    )}
                    {op.mensagemEncerramento && (
                      <div className="text-[10px] text-slate-500 italic line-clamp-2 break-words">
                        “{op.mensagemEncerramento}”
                      </div>
                    )}
                    {op.mensagemHandoff && (
                      <div className="text-[10px] text-slate-500 italic line-clamp-2 break-words">
                        “{op.mensagemHandoff}”
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="p-3 rounded-xl bg-grafite-700 border border-linha text-xs text-slate-400 space-y-1">
              <div className="font-semibold text-slate-200 flex items-center gap-1">
                <HelpCircle size={13} className="text-blue-400" /> Ajuda
              </div>
              <p className="leading-relaxed text-[11px]">{typeHelpText[node.tipo] || typeHelpText.mensagem}</p>
            </div>
          </>
        )}
      </div>

      {/* ── SALVAR ────────────────────────────────────────────────────────
          O botão fica no rodapé, largo e sozinho na primeira linha: é a ação
          principal do painel desde que a digitação parou de subir sozinha.

          Ele mostra os três estados que importam pendente, salvando, salvo
          e o erro aparece AQUI, colado nele, e não num aviso qualquer no canto
          da tela. Uma falha de gravação que a pessoa não lê é a mesma coisa que
          o `catch {}` que existia antes. */}
      <div className="p-4 bg-grafite-600 border-t border-linha space-y-2">
        {resultado && (
          <div
            role="status"
            aria-live="polite"
            className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-[11px] border ${
              resultado.tipo === 'ok'
                ? 'bg-ativo/10 border-ativo/30 text-ativo-400'
                : 'bg-falha/10 border-falha/30 text-falha-400'
            }`}
          >
            {resultado.tipo === 'ok'
              ? <CheckCircle2 size={12} className="shrink-0" />
              : <AlertCircle size={12} className="shrink-0" />}
            <span className="font-semibold break-words">{resultado.msg}</span>
          </div>
        )}

        <button
          onClick={salvarBloco}
          disabled={salvando || !sujo}
          title={sujo ? 'Gravar as alterações deste bloco' : 'Nada para salvar'}
          className={`w-full px-3 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
            salvando || !sujo
              ? 'bg-grafite-700 text-slate-500 border border-linha cursor-not-allowed'
              : 'bg-ativo hover:bg-ativo-400 text-slate-950 shadow-md shadow-ativo/20'
          }`}
        >
          {salvando
            ? <><RefreshCw size={13} className="animate-spin" /> Salvando…</>
            : <><Save size={13} /> {sujo ? 'Salvar Bloco' : 'Salvo'}</>}
        </button>

        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => onDeleteNode(node.id)}
            disabled={salvando}
            className="px-3 py-2 rounded-xl bg-falha/10 hover:bg-falha/20 disabled:opacity-40 text-falha-400 text-xs font-semibold border border-falha/30 flex items-center gap-1.5 transition-colors"
          >
            <Trash2 size={13} /> Excluir Bloco
          </button>
          {!isComment && (
            <button
              onClick={() => onTestSingleNode(node)}
              className="px-3 py-2 rounded-xl bg-acao hover:bg-acao-200 text-slate-950 text-xs font-bold flex items-center gap-1.5 shadow-md shadow-acao/20 transition-all"
            >
              <Play size={13} /> Testar Bloco
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
