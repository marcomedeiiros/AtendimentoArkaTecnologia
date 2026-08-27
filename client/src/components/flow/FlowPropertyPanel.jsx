import { useRef, useState, useEffect } from 'react';
import { X, Play, HelpCircle, Trash2, Variable, GitBranch } from 'lucide-react';

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


export function FlowPropertyPanel({
  node,
  nodes = [],
  gatilhoFluxo = '',
  onChangeGatilhoFluxo,
  onClose,
  onChangeNode,
  onDeleteNode,
  onTestSingleNode,
}) {
  // Rascunho local do gatilho: salvar a cada tecla dispararia um PUT por
  // caractere. Sobe no blur / Enter. Hook antes do early return de proposito.
  const [gatilhoDraft, setGatilhoDraft] = useState(gatilhoFluxo);
  useEffect(() => { setGatilhoDraft(gatilhoFluxo); }, [gatilhoFluxo]);

  if (!node) return null;

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
            <h3 className="font-bold text-sm text-white font-display leading-tight">{node.titulo || 'Configurar Bloco'}</h3>
            <span className="text-[10px] text-slate-500 font-mono">ID: {node.id} · {meta.label}</span>
          </div>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
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
                <input
                  type="number" step="0.5" min="0.5"
                  value={node.delaySeconds || 1.5}
                  onChange={e => onChangeNode({ ...node, delaySeconds: parseFloat(e.target.value) || 1 })}
                  className="w-full bg-grafite-700 border border-linha rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none"
                />
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

            {/* Ramificacoes importadas. Somente leitura de proposito: editar
                aqui daria a entender que o motor local ja segue todas elas. */}
            {opcoes.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <GitBranch size={13} className="text-blue-400" /> Ramificações ({opcoes.length})
                </div>
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  Importadas do JSON e desenhadas no canvas. O motor local ainda executa
                  apenas a saída principal.
                </p>
                {opcoes.map((op, i) => (
                  <div key={op.id || i} className="p-2.5 rounded-xl bg-grafite-700 border border-linha space-y-1.5">
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
                    {/* O QUE ESTA OPCAO DECIDE, alem de para onde ela vai.
                        Setor e desassociacao de CNPJ sao regras do fluxo, e nao
                        do codigo -- entao precisam ser legiveis aqui, senao a
                        unica forma de saber que "1" define o Setor Técnico
                        seria abrir o JSON. */}
                    {(op.setor || op.limparCnpj) && (
                      <div className="flex flex-wrap gap-1">
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

      <div className="p-4 bg-grafite-600 border-t border-linha flex items-center justify-between gap-2">
        <button
          onClick={() => onDeleteNode(node.id)}
          className="px-3 py-2 rounded-xl bg-falha/10 hover:bg-falha/20 text-falha-400 text-xs font-semibold border border-falha/30 flex items-center gap-1.5 transition-colors"
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
    </aside>
  );
}
