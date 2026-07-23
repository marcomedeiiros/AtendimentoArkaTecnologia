import React, { useRef, useState, useEffect } from 'react';
import { X, Play, HelpCircle, Trash2, Variable } from 'lucide-react';

const BLOCK_META = {
  gatilho:    { emoji: '⚡', label: 'Gatilho'     },
  mensagem:   { emoji: '💬', label: 'Mensagem'    },
  condicao:   { emoji: '🔍', label: 'Validar CNPJ'},
  delay:      { emoji: '⏳', label: 'Delay'       },
  acao:       { emoji: '🚀', label: 'Ação ERP'    },
  comentario: { emoji: '📝', label: 'Anotação'    },
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
          <span key={i} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-orange-500/20 border border-orange-500/40 text-orange-300 text-[10px] font-semibold font-mono mx-0.5 align-middle">
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
        className="w-full bg-[#161922] border border-[#2A3040] rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50 resize-none font-mono leading-relaxed"
      />
      {value && value.includes('{{') && (
        <div className="bg-[#0B0D12] border border-[#2A3040] rounded-xl p-3 text-xs text-slate-200 leading-relaxed">
          <div className="text-[10px] text-slate-500 font-semibold mb-1.5 flex items-center gap-1">
            <span>👁️</span> Preview (como será enviado)
          </div>
          <div>{renderPreview(value)}</div>
        </div>
      )}
    </div>
  );
}


export function FlowPropertyPanel({ node, onClose, onChangeNode, onDeleteNode, onTestSingleNode }) {
  if (!node) return null;

  const isComment = node.tipo === 'comentario';
  const meta = BLOCK_META[node.tipo] || BLOCK_META.mensagem;
  const currentDesc = node.desc || node.texto || '';

  function insertVar(tag) {
    const newDesc = currentDesc + (currentDesc.endsWith(' ') || !currentDesc ? '' : ' ') + tag;
    onChangeNode({ ...node, desc: newDesc, texto: newDesc });
  }

  return (
    <aside className="w-80 lg:w-96 shrink-0 bg-[#11141C] border-l border-[#2A3040] h-full flex flex-col z-30 shadow-2xl fade-in overflow-hidden">

      <div className="p-4 bg-[#1E2330] border-b border-[#2A3040] flex items-center justify-between">
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
            className="w-full bg-[#161922] border border-[#2A3040] rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50"
            placeholder="Nome da etapa"
          />
        </div>

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
              className="w-full bg-[#161922] border border-[#2A3040] rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50 resize-none"
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

        {!isComment && (
          <>
            {node.tipo === 'gatilho' && (
              <div className="p-3.5 rounded-xl bg-orange-500/10 border border-orange-500/30 space-y-2">
                <label className="text-xs font-bold text-orange-400 flex items-center gap-1.5">⚡ Palavra-Chave Gatilho</label>
                <input
                  value={node.gatilho || ''}
                  onChange={e => onChangeNode({ ...node, gatilho: e.target.value, desc: `Cliente digita "${e.target.value}"` })}
                  placeholder="ex: orçamento, boleto, suporte"
                  className="w-full bg-[#161922] border border-[#2A3040] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-orange-500/50"
                />
              </div>
            )}

            {node.tipo === 'delay' && (
              <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">⏳ Tempo de Espera (segundos)</label>
                <input
                  type="number" step="0.5" min="0.5"
                  value={node.delaySeconds || 1.5}
                  onChange={e => onChangeNode({ ...node, delaySeconds: parseFloat(e.target.value) || 1 })}
                  className="w-full bg-[#161922] border border-[#2A3040] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none"
                />
              </div>
            )}

            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Variable size={13} className="text-orange-400" /> Inserir Variável
              </div>
              <div className="flex flex-wrap gap-1.5">
                {VARS.map(v => (
                  <button
                    key={v.tag}
                    onClick={() => insertVar(v.tag)}
                    title={`Inserir ${v.tag}`}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[#1E2330] border border-[#2A3040] hover:border-orange-500/50 hover:bg-orange-500/10 text-[11px] text-slate-300 hover:text-orange-300 transition-all"
                  >
                    <span>{v.emoji}</span>
                    <span className="font-medium">{v.label}</span>
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-slate-500">Clique na variável para inserir no cursor do texto.</p>
            </div>

            <div className="p-3 rounded-xl bg-[#161922] border border-[#2A3040] text-xs text-slate-400 space-y-1">
              <div className="font-semibold text-slate-200 flex items-center gap-1">
                <HelpCircle size={13} className="text-blue-400" /> Ajuda
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
