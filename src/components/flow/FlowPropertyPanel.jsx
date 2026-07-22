import React from 'react';
import { X, Play, Zap, MessageSquare, GitFork, Clock, CheckCircle2, ShieldCheck, HelpCircle, Code, Variable, Trash2 } from 'lucide-react';
import { EmojiIcon } from '../EmojiIcon';

export function FlowPropertyPanel({ node, onClose, onChangeNode, onDeleteNode, onTestSingleNode }) {
  if (!node) return null;

  const isComment = node.tipo === 'comentario';

  const typeHelpText = {
    gatilho: 'Define a palavra-chave ou evento do cliente que inicia a execução deste fluxo.',
    mensagem: 'Mensagem de texto enviada automaticamente ao cliente WhatsApp.',
    condicao: 'Valida se o CNPJ informado possui contrato de parceiro ativo no banco de dados Arka.',
    delay: 'Insere uma pausa estratégica (em segundos) simulando digitação humana.',
    acao: 'Executa uma ação automatizada no sistema (desconto automático, geração de boleto/Pix).',
    comentario: 'Bloco de nota/anotação interna visual para organização da equipe.'
  };

  return (
    <aside className="w-80 lg:w-96 shrink-0 glass-panel border-l border-[#2A3040] h-full flex flex-col z-30 shadow-2xl fade-in overflow-hidden">
      {/* Drawer Header */}
      <div className="p-4 bg-[#1E2330] border-b border-[#2A3040] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <EmojiIcon name={node.tipo === 'comentario' ? 'question' : node.tipo} label="" size="sm" />
          <div>
            <h3 className="font-bold text-sm text-white font-display leading-tight">{node.titulo || 'Configurar Bloco'}</h3>
            <span className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">ID: {node.id}</span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Title */}
        <div>
          <label className="text-xs font-semibold text-slate-300 block mb-1.5">Título do Bloco</label>
          <input
            value={node.titulo || ''}
            onChange={(e) => onChangeNode({ ...node, titulo: e.target.value })}
            className="w-full bg-[#161922] border border-[#2A3040] rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50"
            placeholder="Nome da etapa"
          />
        </div>

        <div>
          <label className="text-xs font-semibold text-slate-300 block mb-1.5">
            {isComment ? 'Conteúdo da Anotação' : 'Descrição / Texto da Etapa'}
          </label>
          <textarea
            rows={isComment ? 5 : 3}
            value={node.desc || node.texto || ''}
            onChange={(e) => onChangeNode({ ...node, desc: e.target.value, texto: e.target.value })}
            className="w-full bg-[#161922] border border-[#2A3040] rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50 resize-none"
            placeholder={isComment ? 'Escreva uma nota de organização...' : 'Descrição ou mensagem enviada...'}
          />
        </div>

        {!isComment && (
          <>
            {node.tipo === 'gatilho' && (
              <div className="p-3.5 rounded-xl bg-orange-500/10 border border-orange-500/30 space-y-2">
                <label className="text-xs font-bold text-orange-400 block">Palavra-Chave Gatilho</label>
                <input
                  value={node.gatilho || node.desc?.replace('Cliente digita ', '').replace(/"/g, '') || ''}
                  onChange={(e) => onChangeNode({ ...node, gatilho: e.target.value, desc: `Cliente digita "${e.target.value}"` })}
                  placeholder="ex: orçamento, boleto, suporte"
                  className="w-full bg-[#161922] border border-[#2A3040] rounded-lg px-3 py-1.5 text-xs text-white"
                />
              </div>
            )}

            {node.tipo === 'delay' && (
              <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                <label className="text-xs font-semibold text-slate-300 block">Tempo de Espera (segundos)</label>
                <input
                  type="number"
                  step="0.5"
                  value={node.delaySeconds || 1.5}
                  onChange={(e) => onChangeNode({ ...node, delaySeconds: parseFloat(e.target.value) || 1 })}
                  className="w-full bg-[#161922] border border-[#2A3040] rounded-lg px-3 py-1.5 text-xs text-white"
                />
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                <span className="flex items-center gap-1.5"><Variable size={13} className="text-orange-400" /> Variáveis Dinâmicas</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {['{{cliente.nome}}', '{{cliente.cnpj}}', '{{parceiro.status}}', '{{data.hoje}}'].map(v => (
                  <button
                    key={v}
                    onClick={() => {
                      const current = node.desc || '';
                      onChangeNode({ ...node, desc: current + ' ' + v, texto: current + ' ' + v });
                    }}
                    className="px-2 py-1 rounded-md bg-[#1E2330] border border-[#2A3040] text-[10px] font-mono text-slate-300 hover:text-orange-400 hover:border-orange-500/40 transition-colors"
                  >
                    + {v}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-[#161922] border border-[#2A3040] text-xs text-slate-400 space-y-1">
              <div className="font-semibold text-slate-200 flex items-center gap-1">
                <HelpCircle size={13} className="text-blue-400" /> Ajuda Contextual
              </div>
              <p className="leading-relaxed text-[11px]">{typeHelpText[node.tipo] || typeHelpText.mensagem}</p>
            </div>
          </>
        )}
      </div>

      <div className="p-4 bg-[#1E2330] border-t border-[#2A3040] flex items-center justify-between gap-2">
        <button
          onClick={() => onDeleteNode(node.id)}
          className="px-3 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-semibold border border-rose-500/30 flex items-center gap-1.5 transition-colors"
        >
          <Trash2 size={13} /> Excluir Bloco
        </button>

        {!isComment && (
          <button
            onClick={() => onTestSingleNode(node)}
            className="px-3 py-2 rounded-xl bg-orange-500 hover:bg-orange-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 shadow-md shadow-orange-500/20 transition-all"
          >
            <Play size={13} /> Testar Bloco
          </button>
        )}
      </div>
    </aside>
  );
}
