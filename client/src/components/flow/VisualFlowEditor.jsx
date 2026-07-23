import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Zap, GitFork, Clock, CheckCircle2, Plus, Trash2,
  Play, RotateCcw, ZoomIn, ZoomOut, Maximize2, LayoutGrid,
  Sparkles, Layers, RefreshCw, X, Power, ChevronUp, ChevronDown,
  MessageSquare, Settings, AlertCircle
} from 'lucide-react';
import { FlowMinimap } from './FlowMinimap';
import { FlowPropertyPanel } from './FlowPropertyPanel';
import { FlowExecutionLogs } from './FlowExecutionLogs';

const BLOCK_META = {
  gatilho:    { emoji: '⚡', label: 'Gatilho',       desc: 'Início da conversa', color: 'border-orange-500/60 bg-orange-500/5',  badge: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
  mensagem:   { emoji: '💬', label: 'Mensagem',       desc: 'Texto para cliente', color: 'border-blue-500/60 bg-blue-500/5',      badge: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  condicao:   { emoji: '🔍', label: 'Validar CNPJ',   desc: 'Checar parceiro',    color: 'border-purple-500/60 bg-purple-500/5',  badge: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  delay:      { emoji: '⏳', label: 'Delay',          desc: 'Simula digitação',   color: 'border-slate-500/60 bg-slate-500/5',    badge: 'bg-slate-500/20 text-slate-300 border-slate-500/30' },
  acao:       { emoji: '🚀', label: 'Ação ERP',        desc: 'Desconto / Boleto',  color: 'border-emerald-500/60 bg-emerald-500/5',badge: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  comentario: { emoji: '📝', label: 'Anotação',       desc: 'Post-it de equipe',  color: 'border-amber-500/60 bg-amber-500/10',   badge: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
};


function formatNodesPositions(passos = []) {
  return passos.map((p, idx) => ({
    ...p,
    x: p.x !== undefined ? p.x : 80 + idx * 270,
    y: p.y !== undefined ? p.y : 180 + (idx % 2 === 0 ? 0 : 40),
    w: p.w || (p.tipo === 'comentario' ? 240 : 220),
    h: p.h || (p.tipo === 'comentario' ? 120 : 96),
    targetId: p.targetId || (idx < passos.length - 1 ? passos[idx + 1].id : null),
  }));
}

function SequencePanel({ nodes, onReorder, onSelectNode, selectedNodeIds }) {
  const orderedIds = [];

  const allTargets = new Set(nodes.map(n => n.targetId).filter(Boolean));
  let current = nodes.find(n => !allTargets.has(n.id) && n.tipo !== 'comentario') || nodes[0];
  const visited = new Set();
  while (current && !visited.has(current.id)) {
    orderedIds.push(current.id);
    visited.add(current.id);
    current = nodes.find(n => n.id === current.targetId);
  }

  nodes.forEach(n => { if (!visited.has(n.id)) orderedIds.push(n.id); });

  const orderedNodes = orderedIds.map(id => nodes.find(n => n.id === id)).filter(Boolean);

  function moveUp(idx) {
    if (idx === 0) return;
    const newOrder = [...orderedNodes];
    [newOrder[idx - 1], newOrder[idx]] = [newOrder[idx], newOrder[idx - 1]];

    const reconnected = newOrder.map((n, i) => ({
      ...n,
      targetId: n.tipo === 'comentario' ? n.targetId : (newOrder[i + 1]?.tipo !== 'comentario' ? newOrder[i + 1]?.id || null : null),
    }));
    const missing = nodes.filter(n => !reconnected.find(r => r.id === n.id));
    onReorder([...reconnected, ...missing]);
  }

  function moveDown(idx) {
    if (idx >= orderedNodes.length - 1) return;
    moveUp(idx + 1);
  }

  return (
    <div className="space-y-1">
      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1">
        <Settings size={11} className="text-orange-400" /> Sequência
      </div>
      {orderedNodes.map((node, idx) => {
        const meta = BLOCK_META[node.tipo] || BLOCK_META.mensagem;
        const isSel = selectedNodeIds.includes(node.id);
        return (
          <div
            key={node.id}
            onClick={() => onSelectNode(node.id)}
            className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-all border text-xs ${
              isSel ? 'bg-orange-500/15 border-orange-500/40 text-orange-300' : 'bg-[#161922] border-[#2A3040] text-slate-300 hover:border-slate-600 hover:text-white'
            }`}
          >
            <span className="text-sm shrink-0">{meta.emoji}</span>
            <span className="flex-1 truncate font-medium text-[11px]">{node.titulo}</span>
            <div className="flex flex-col gap-0.5 shrink-0">
              <button onClick={e => { e.stopPropagation(); moveUp(idx); }} disabled={idx === 0}
                className="p-0.5 rounded hover:bg-slate-700 disabled:opacity-20 text-slate-400 hover:text-white transition-colors">
                <ChevronUp size={10} />
              </button>
              <button onClick={e => { e.stopPropagation(); moveDown(idx); }} disabled={idx >= orderedNodes.length - 1}
                className="p-0.5 rounded hover:bg-slate-700 disabled:opacity-20 text-slate-400 hover:text-white transition-colors">
                <ChevronDown size={10} />
              </button>
            </div>
          </div>
        );
      })}
      {orderedNodes.length === 0 && (
        <div className="text-[11px] text-slate-500 text-center py-3">Nenhum bloco ainda.</div>
      )}
    </div>
  );
}


export function VisualFlowEditor({ fluxos, setFluxos, equipe }) {
  const [selectedFlowId, setSelectedFlowId] = useState(fluxos[0]?.id || null);
  const flow = fluxos.find(f => f.id === selectedFlowId) || fluxos[0];

  const [zoom, setZoom] = useState(1);
  const [canvasOffset, setCanvasOffset] = useState({ x: 100, y: 100 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [isSpacePressed, setIsSpacePressed] = useState(false);

  const [nodes, setNodes] = useState(() => formatNodesPositions(flow?.passos || []));
  const [selectedNodeIds, setSelectedNodeIds] = useState([]);
  const [activePropertyNodeId, setActivePropertyNodeId] = useState(null);
  const [clipboard, setClipboard] = useState(null);

  const [connectingFromId, setConnectingFromId] = useState(null);
  const [selectedEdgeTargetId, setSelectedEdgeTargetId] = useState(null); // nó cujo edge de entrada está selecionado
  const [mouseCanvasPos, setMouseCanvasPos] = useState({ x: 0, y: 0 });
  const [marquee, setMarquee] = useState(null);

  // ── Posição da sidebar flutuante ──────────────────────────────────────────
  const [sidebarPos, setSidebarPos] = useState({ x: 12, y: 60 });
  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false);
  const sidebarDragStart = useRef({ mx: 0, my: 0, sx: 0, sy: 0 });
  const sidebarRef = useRef(null);

  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const [isRunningSim, setIsRunningSim] = useState(false);
  const [activeSimNodeId, setActiveSimNodeId] = useState(null);
  const [executedNodeIds, setExecutedNodeIds] = useState([]);
  const [simLogs, setSimLogs] = useState([]);
  const [showLogsConsole, setShowLogsConsole] = useState(false);
  const [showSequencePanel, setShowSequencePanel] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const containerRef = useRef(null);

  useEffect(() => {
    if (flow) {
      const formatted = formatNodesPositions(flow.passos || []);
      setNodes(formatted);
      setSelectedNodeIds([]);
      setActivePropertyNodeId(null);
      setShowDeleteConfirm(false);
      pushHistory(formatted);
    }
  }, [selectedFlowId]);

  const pushHistory = (newNodes) => {
    setHistory(prev => {
      const next = prev.slice(0, historyIndex + 1);
      next.push(JSON.stringify(newNodes));
      setHistoryIndex(next.length - 1);
      return next;
    });
  };

  const syncFlowToParent = useCallback((updatedNodes) => {
    setNodes(updatedNodes);
    setFluxos(fluxos.map(f => f.id === selectedFlowId ? { ...f, passos: updatedNodes } : f));
  }, [fluxos, selectedFlowId, setFluxos]);

  const handleUndo = () => {
    if (historyIndex > 0) {
      const prev = JSON.parse(history[historyIndex - 1]);
      setHistoryIndex(h => h - 1);
      setNodes(prev);
      syncFlowToParent(prev);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const next = JSON.parse(history[historyIndex + 1]);
      setHistoryIndex(h => h + 1);
      setNodes(next);
      syncFlowToParent(next);
    }
  };

  const handleDeleteFlow = () => {
    if (fluxos.length <= 1) return; // não deleta o último
    const remaining = fluxos.filter(f => f.id !== selectedFlowId);
    setFluxos(remaining);
    setSelectedFlowId(remaining[0].id);
    setShowDeleteConfirm(false);
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      const tag = document.activeElement.tagName;
      if (e.code === 'Space' && !e.repeat && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        setIsSpacePressed(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? handleRedo() : handleUndo();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); handleRedo(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c' && selectedNodeIds.length > 0) {
        setClipboard(nodes.filter(n => selectedNodeIds.includes(n.id)));
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v' && clipboard) {
        const pasted = clipboard.map((n, idx) => ({
          ...n, id: 'p_' + Date.now() + '_' + idx, x: n.x + 40, y: n.y + 40, titulo: n.titulo + ' (Cópia)'
        }));
        const combined = [...nodes, ...pasted];
        syncFlowToParent(combined);
        pushHistory(combined);
        setSelectedNodeIds(pasted.map(n => n.id));
      }
      if (e.key === 'Escape') {
        setConnectingFromId(null);
        setSelectedEdgeTargetId(null);
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;

        if (selectedEdgeTargetId) {
          const updated = nodes.map(n => n.targetId === selectedEdgeTargetId ? { ...n, targetId: null } : n);
          setSelectedEdgeTargetId(null);
          syncFlowToParent(updated);
          pushHistory(updated);
        } else if (selectedNodeIds.length > 0) {
          deleteSelectedNodes();
        }
      }
    };
    const handleKeyUp = (e) => { if (e.code === 'Space') setIsSpacePressed(false); };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => { window.removeEventListener('keydown', handleKeyDown); window.removeEventListener('keyup', handleKeyUp); };
  }, [selectedNodeIds, nodes, clipboard, historyIndex, history]);

  const handleSidebarDragStart = (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    sidebarDragStart.current = { mx: e.clientX, my: e.clientY, sx: sidebarPos.x, sy: sidebarPos.y };
    setIsDraggingSidebar(true);
    const onMove = (me) => {
      const dx = me.clientX - sidebarDragStart.current.mx;
      const dy = me.clientY - sidebarDragStart.current.my;
      setSidebarPos({ x: sidebarDragStart.current.sx + dx, y: sidebarDragStart.current.sy + dy });
    };
    const onUp = () => {
      setIsDraggingSidebar(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const factor = 1.08;
    let nz = e.deltaY < 0 ? zoom * factor : zoom / factor;
    nz = Math.min(Math.max(nz, 0.25), 2.5);
    const rect = containerRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setZoom(nz);
    setCanvasOffset({ x: mx - (mx - canvasOffset.x) * (nz / zoom), y: my - (my - canvasOffset.y) * (nz / zoom) });
  };

  const handleMouseDown = (e) => {
    if (e.button === 1 || isSpacePressed) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - canvasOffset.x, y: e.clientY - canvasOffset.y });
    } else if (e.target === containerRef.current || e.target.tagName === 'svg') {
      const rect = containerRef.current.getBoundingClientRect();
      const sx = (e.clientX - rect.left - canvasOffset.x) / zoom;
      const sy = (e.clientY - rect.top - canvasOffset.y) / zoom;
      setMarquee({ startX: sx, startY: sy, currentX: sx, currentY: sy });
      setSelectedNodeIds([]);
      setSelectedEdgeTargetId(null); 
    }
  };

  const handleMouseMove = (e) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      const cx = (e.clientX - rect.left - canvasOffset.x) / zoom;
      const cy = (e.clientY - rect.top - canvasOffset.y) / zoom;
      setMouseCanvasPos({ x: cx, y: cy });
    }
    if (isPanning) {
      setCanvasOffset({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
    } else if (marquee && rect) {
      const cx = (e.clientX - rect.left - canvasOffset.x) / zoom;
      const cy = (e.clientY - rect.top - canvasOffset.y) / zoom;
      setMarquee(m => ({ ...m, currentX: cx, currentY: cy }));
      const minX = Math.min(marquee.startX, cx), maxX = Math.max(marquee.startX, cx);
      const minY = Math.min(marquee.startY, cy), maxY = Math.max(marquee.startY, cy);
      setSelectedNodeIds(nodes.filter(n => n.x >= minX && n.x + n.w <= maxX && n.y >= minY && n.y + n.h <= maxY).map(n => n.id));
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    setMarquee(null);

  };

  const handleCanvasMouseUp = (e) => {
    if (e.target === containerRef.current || e.target.tagName === 'svg' || e.target.tagName === 'SVG') {
      setConnectingFromId(null);
    }
    handleMouseUp();
  };

  const latestNodesRef = useRef(nodes);
  useEffect(() => { latestNodesRef.current = nodes; }, [nodes]);

  const handleNodeDrag = (nodeId, e) => {
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const initialNodes = [...latestNodesRef.current];
    const dragging = selectedNodeIds.includes(nodeId) ? selectedNodeIds : [nodeId];
    let cur = initialNodes;
    const onMove = (me) => {
      const dx = (me.clientX - startX) / zoom, dy = (me.clientY - startY) / zoom;
      cur = initialNodes.map(n => dragging.includes(n.id)
        ? { ...n, x: Math.round((n.x + dx) / 10) * 10, y: Math.round((n.y + dy) / 10) * 10 }
        : n);
      latestNodesRef.current = cur;
      setNodes(cur);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      syncFlowToParent(cur);
      pushHistory(cur);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleAutoOrganize = () => {
    const updated = nodes.map((n, idx) => ({ ...n, x: 100 + idx * 270, y: 180 + (idx % 2 === 0 ? 0 : 50) }));
    syncFlowToParent(updated);
    pushHistory(updated);
  };

  const addNode = (tipo) => {
    const newId = 'p_' + Date.now();
    const titleMap = { gatilho: 'Novo Gatilho', mensagem: 'Nova Mensagem', condicao: 'Validar CNPJ', delay: 'Aguardar...', acao: 'Ação Automática', comentario: 'Anotação' };
    const newNode = {
      id: newId, tipo,
      titulo: titleMap[tipo] || 'Nova Etapa',
      desc: '',
      x: -canvasOffset.x / zoom + 300,
      y: -canvasOffset.y / zoom + 200,
      w: tipo === 'comentario' ? 240 : 220,
      h: tipo === 'comentario' ? 120 : 96,
      targetId: null,
    };
    const updated = [...nodes];
    if (updated.length > 0 && tipo !== 'comentario') {
      const last = updated[updated.length - 1];
      if (!last.targetId) last.targetId = newId;
    }
    updated.push(newNode);
    syncFlowToParent(updated);
    pushHistory(updated);
    setSelectedNodeIds([newId]);
    setActivePropertyNodeId(newId);
  };

  const deleteSelectedNodes = () => {
    if (selectedNodeIds.length === 0) return;
    const updated = nodes
      .filter(n => !selectedNodeIds.includes(n.id))
      .map(n => selectedNodeIds.includes(n.targetId) ? { ...n, targetId: null } : n);
    setSelectedNodeIds([]);
    setActivePropertyNodeId(null);
    syncFlowToParent(updated);
    pushHistory(updated);
  };

  const handleConnectPort = (e, targetNodeId) => {
    e.stopPropagation();
    if (connectingFromId && connectingFromId !== targetNodeId) {
  
      const updated = nodes.map(n => n.id === connectingFromId ? { ...n, targetId: targetNodeId } : n);
      syncFlowToParent(updated);
      pushHistory(updated);
      setConnectingFromId(null);
      setSelectedEdgeTargetId(null);
    } else {
      const hasIncoming = nodes.some(n => n.targetId === targetNodeId);
      if (hasIncoming) {
        setSelectedEdgeTargetId(prev => prev === targetNodeId ? null : targetNodeId);
        setSelectedNodeIds([]);
        setActivePropertyNodeId(null);
      }
      setConnectingFromId(null);
    }
  };

  const handleOutgoingPortMouseDown = (e, nodeId) => {
    e.stopPropagation();
    e.preventDefault();
    setConnectingFromId(nodeId);
    setSelectedEdgeTargetId(null);
  };

  const handleReorder = (reorderedNodes) => {
    syncFlowToParent(reorderedNodes);
    pushHistory(reorderedNodes);
  };

  const handleRunSimulation = () => {
    if (nodes.length === 0) return;
    setIsRunningSim(true);
    setShowLogsConsole(true);
    setExecutedNodeIds([]);
    setSimLogs([{ type: 'info', title: 'Iniciando Simulação de Fluxo', message: `Fluxo: "${flow?.nome}"`, timeMs: 0 }]);
    let index = 0;
    const runStep = () => {
      if (index >= nodes.length) {
        setIsRunningSim(false);
        setActiveSimNodeId(null);
        setSimLogs(prev => [...prev, { type: 'success', title: 'Fluxo Concluído ✅', message: 'Todas as etapas foram executadas.', timeMs: 1450 }]);
        return;
      }
      const curr = nodes[index];
      setActiveSimNodeId(curr.id);
      setExecutedNodeIds(prev => [...prev, curr.id]);
      setSimLogs(prev => [...prev, {
        type: curr.tipo === 'condicao' ? 'success' : 'running',
        title: `Etapa ${index + 1}: ${curr.titulo}`,
        message: curr.desc || curr.texto,
        timeMs: Math.floor(120 + Math.random() * 200)
      }]);
      index++;
      setTimeout(runStep, curr.tipo === 'delay' ? 1800 : 900);
    };
    runStep();
  };

  const activePropertyNode = nodes.find(n => n.id === activePropertyNodeId);

  return (
    <div className="flex flex-col h-[calc(100vh-60px)] w-full relative bg-[#0B0D12] overflow-hidden select-none font-sans">

      <div className="p-3 bg-[#11141C]/90 backdrop-blur-md border-b border-[#2A3040] flex flex-wrap items-center justify-between gap-3 z-20">
        <div className="flex items-center gap-2 flex-wrap">
          
          <span className="p-2 rounded-xl bg-orange-500/10 text-orange-400 border border-orange-500/30">
            <Zap size={18} />
          </span>
          <select
            value={selectedFlowId || ''}
            onChange={e => setSelectedFlowId(e.target.value)}
            className="bg-[#161922] border border-[#2A3040] rounded-xl px-3 py-1.5 text-xs font-bold text-white focus:outline-none focus:border-orange-500 max-w-[220px] truncate"
          >
            {fluxos.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>

          <button
            onClick={() => {
              const novoId = 'f' + Date.now();
              const novo = { id: novoId, nome: `Novo Fluxo ${fluxos.length + 1}`, gatilho: 'novo', ativo: true, passos: [] };
              setFluxos([...fluxos, novo]);
              setSelectedFlowId(novoId);
            }}
            className="px-3 py-1.5 rounded-xl bg-orange-500/15 hover:bg-orange-500/25 text-orange-400 text-xs font-semibold border border-orange-500/30 flex items-center gap-1.5 transition-all"
          >
            <Plus size={14} /> Novo Fluxo
          </button>

          {fluxos.length > 1 && !showDeleteConfirm && (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-semibold border border-rose-500/30 flex items-center gap-1.5 transition-all"
            >
              <Trash2 size={14} /> Deletar Fluxo
            </button>
          )}
          {showDeleteConfirm && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/15 border border-rose-500/40 text-xs">
              <AlertCircle size={13} className="text-rose-400 shrink-0" />
              <span className="text-rose-300 font-semibold">Confirmar?</span>
              <button onClick={handleDeleteFlow} className="px-2 py-0.5 rounded-lg bg-rose-500 hover:bg-rose-400 text-white font-bold transition-colors">Sim</button>
              <button onClick={() => setShowDeleteConfirm(false)} className="px-2 py-0.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold transition-colors">Não</button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">

          <div className="flex items-center bg-[#161922] border border-[#2A3040] rounded-xl p-1 text-xs text-slate-300">
            <button onClick={() => setZoom(z => Math.max(z / 1.15, 0.25))} className="p-1.5 hover:text-white"><ZoomOut size={14} /></button>
            <span className="px-2 font-mono text-[11px] text-slate-400">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom(z => Math.min(z * 1.15, 2.5))} className="p-1.5 hover:text-white"><ZoomIn size={14} /></button>
            <button onClick={() => { setZoom(1); setCanvasOffset({ x: 100, y: 100 }); }} className="p-1.5 hover:text-white border-l border-[#2A3040] ml-1" title="Resetar"><Maximize2 size={13} /></button>
          </div>

          <div className="flex items-center bg-[#161922] border border-[#2A3040] rounded-xl p-1">
            <button onClick={handleUndo} disabled={historyIndex <= 0} className="p-1.5 text-slate-400 hover:text-white disabled:opacity-30"><RotateCcw size={14} /></button>
            <button onClick={handleRedo} disabled={historyIndex >= history.length - 1} className="p-1.5 text-slate-400 hover:text-white disabled:opacity-30"><RefreshCw size={14} /></button>
          </div>
          <button onClick={handleAutoOrganize} className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 border border-slate-700 transition-colors">
            <LayoutGrid size={14} /> Organizar
          </button>
          <button onClick={() => setShowSequencePanel(s => !s)} className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition-all ${showSequencePanel ? 'bg-blue-500/20 text-blue-400 border-blue-500/40' : 'bg-slate-800 text-slate-300 border-slate-700'}`}>
            <Settings size={14} /> Sequência
          </button>
          <button onClick={() => setShowLogsConsole(s => !s)} className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition-all ${showLogsConsole ? 'bg-orange-500/20 text-orange-400 border-orange-500/40' : 'bg-slate-800 text-slate-300 border-slate-700'}`}>
            <Sparkles size={14} /> Console ({simLogs.length})
          </button>
          <button onClick={handleRunSimulation} disabled={isRunningSim} className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-slate-950 text-xs font-bold flex items-center gap-2 shadow-md shadow-orange-500/20 disabled:opacity-50 transition-all">
            <Play size={14} fill="currentColor" /> {isRunningSim ? 'Simulando...' : 'Simular'}
          </button>
        </div>
      </div>

      <div className="flex-1 flex relative overflow-hidden">

        <div className="w-56 bg-[#11141C] border-r border-[#2A3040] p-3 flex flex-col gap-3 z-10 hidden md:flex select-none overflow-y-auto">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
            <Layers size={13} className="text-orange-400" /> Biblioteca
          </div>
          {Object.entries(BLOCK_META).map(([tipo, meta]) => (
            <button key={tipo} onClick={() => addNode(tipo)}
              className="p-2.5 rounded-xl bg-[#161922] hover:bg-[#1E2330] border border-[#2A3040] hover:border-orange-500/40 text-left transition-all group flex items-center gap-2.5">
              <span className="text-lg leading-none">{meta.emoji}</span>
              <div>
                <div className="text-xs font-semibold text-white group-hover:text-orange-400 transition-colors">{meta.label}</div>
                <div className="text-[10px] text-slate-400">{meta.desc}</div>
              </div>
            </button>
          ))}

          {showSequencePanel && (
            <div className="mt-2 border-t border-[#2A3040] pt-3">
              <SequencePanel
                nodes={nodes}
                onReorder={handleReorder}
                onSelectNode={(id) => { setSelectedNodeIds([id]); setActivePropertyNodeId(id); }}
                selectedNodeIds={selectedNodeIds}
              />
            </div>
          )}
        </div>

        <div
          ref={containerRef}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleCanvasMouseUp}
          className={`flex-1 relative overflow-hidden bg-[#0B0D12] ${isSpacePressed ? 'cursor-grab' : isPanning ? 'cursor-grabbing' : 'cursor-default'}`}
        >
          <div className="absolute inset-0 pointer-events-none opacity-20" style={{
            backgroundImage: `radial-gradient(#384156 1px, transparent 1px)`,
            backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
            backgroundPosition: `${canvasOffset.x}px ${canvasOffset.y}px`
          }} />

          <div style={{ transform: `translate3d(${canvasOffset.x}px, ${canvasOffset.y}px, 0) scale(${zoom})`, transformOrigin: '0 0', width: '100%', height: '100%', position: 'absolute' }}>

            <svg className="absolute inset-0 w-full h-full overflow-visible z-0" style={{ pointerEvents: 'none' }}>
              {nodes.map(node => {
                if (!node.targetId) return null;
                const target = nodes.find(n => n.id === node.targetId);
                if (!target) return null;
                const sx = node.x + (node.w || 220), sy = node.y + (node.h || 96) / 2;
                const ex = target.x, ey = target.y + (target.h || 96) / 2;
                const dx = Math.abs(ex - sx) * 0.5;
                const d = `M ${sx} ${sy} C ${sx + dx} ${sy}, ${ex - dx} ${ey}, ${ex} ${ey}`;
                const active  = activeSimNodeId === node.id || executedNodeIds.includes(node.id);
                const edgeSel = selectedEdgeTargetId === node.targetId;
                return (
                  <g key={`${node.id}->${target.id}`}>
                   
                    <path d={d} fill="none" stroke="transparent" strokeWidth={12}
                      style={{ cursor: 'pointer', pointerEvents: 'all' }}
                      onClick={(e) => { e.stopPropagation(); setSelectedEdgeTargetId(prev => prev === node.targetId ? null : node.targetId); setSelectedNodeIds([]); }} />
                    <path d={d} fill="none"
                      stroke={edgeSel ? '#F43F5E' : active ? '#10B981' : '#384156'}
                      strokeWidth={edgeSel ? 3 : active ? 3 : 2}
                      strokeDasharray={edgeSel ? '6 3' : 'none'}
                      style={{ pointerEvents: 'none' }}
                      className="transition-all duration-300" />
                    {active && !edgeSel && <path d={d} fill="none" stroke="#FF7A29" strokeWidth="3" strokeDasharray="6 6" style={{ pointerEvents: 'none' }} className="animate-pulse" />}
                  </g>
                );
              })}
              {connectingFromId && (() => {
                const src = nodes.find(n => n.id === connectingFromId);
                if (!src) return null;
                const sx = src.x + (src.w || 220), sy = src.y + (src.h || 96) / 2;
                const dx = Math.abs(mouseCanvasPos.x - sx) * 0.5;
                const d = `M ${sx} ${sy} C ${sx + dx} ${sy}, ${mouseCanvasPos.x - dx} ${mouseCanvasPos.y}, ${mouseCanvasPos.x} ${mouseCanvasPos.y}`;
                return <path d={d} fill="none" stroke="#FF7A29" strokeWidth="2.5" strokeDasharray="4 4" style={{ pointerEvents: 'none' }} />;
              })()}
            </svg>

            {marquee && (
              <div className="absolute border border-orange-500 bg-orange-500/10 pointer-events-none rounded-md" style={{
                left: Math.min(marquee.startX, marquee.currentX), top: Math.min(marquee.startY, marquee.currentY),
                width: Math.abs(marquee.currentX - marquee.startX), height: Math.abs(marquee.currentY - marquee.startY)
              }} />
            )}

            {nodes.length === 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 pointer-events-none">
                <div className="text-6xl opacity-30">⚡</div>
                <div className="text-center">
                  <p className="text-slate-400 text-sm font-semibold">Fluxo vazio</p>
                  <p className="text-slate-600 text-xs mt-1">Adicione blocos pela biblioteca à esquerda</p>
                </div>
              </div>
            )}

            {nodes.map(node => {
              const isSelected  = selectedNodeIds.includes(node.id);
              const isExecuting = activeSimNodeId === node.id;
              const isExecuted  = executedNodeIds.includes(node.id);
              const isComment   = node.tipo === 'comentario';
              const meta        = BLOCK_META[node.tipo] || BLOCK_META.mensagem;

              return (
                <div
                  key={node.id}
                  onMouseDown={(e) => {
                    if (e.button === 0 && !isSpacePressed) {
                      e.stopPropagation();
                      if (!e.shiftKey && !isSelected) setSelectedNodeIds([node.id]);
                      else if (e.shiftKey) setSelectedNodeIds(prev => isSelected ? prev.filter(id => id !== node.id) : [...prev, node.id]);
                      setActivePropertyNodeId(node.id);
                      handleNodeDrag(node.id, e);
                    }
                  }}
                  className={`absolute rounded-2xl transition-all duration-150 cursor-grab active:cursor-grabbing select-none
                    ${isComment ? 'p-4 text-amber-200 shadow-lg' : 'p-4 shadow-xl'}
                    border-2 ${meta.color}
                    ${isSelected  ? 'ring-2 ring-orange-500 shadow-orange-500/20' : ''}
                    ${isExecuting ? 'ring-4 ring-amber-400 animate-pulse' : ''}
                    ${isExecuted && !isExecuting ? 'border-emerald-500/80' : ''}
                  `}
                  style={{ left: node.x, top: node.y, width: node.w || 220, minHeight: node.h || 96 }}
                >
                 
                  {!isComment && (() => {
                    const hasIncoming = nodes.some(n => n.targetId === node.id);
                    const isEdgeSel   = selectedEdgeTargetId === node.id;
                    return (
                      <div
                        onClick={(e) => handleConnectPort(e, node.id)}
                        className={`absolute -left-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full border-2 transition-all cursor-pointer flex items-center justify-center shadow-md z-10
                          ${connectingFromId && connectingFromId !== node.id
                            ? 'bg-orange-500 border-orange-300 scale-125 shadow-orange-500/50'
                            : isEdgeSel
                              ? 'bg-rose-500 border-rose-300 scale-110 shadow-rose-500/50'
                              : hasIncoming
                                ? 'bg-[#161922] border-orange-500 hover:bg-orange-500'
                                : 'bg-[#161922] border-slate-600 hover:border-orange-500/60 opacity-60'
                          }`}
                        title={isEdgeSel ? 'Pressione Delete para desconectar' : hasIncoming ? 'Clique para selecionar conexão' : 'Porta de entrada (sem conexão)'}
                      >
                        <div className={`w-2 h-2 rounded-full ${isEdgeSel ? 'bg-rose-300' : 'bg-orange-400'}`} />
                        {isEdgeSel && (
                          <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] bg-rose-500 text-white px-1.5 py-0.5 rounded font-bold whitespace-nowrap pointer-events-none">
                            Delete
                          </span>
                        )}
                      </div>
                    );
                  })()}

                  {!isComment && (
                    <div
                      onMouseDown={(e) => handleOutgoingPortMouseDown(e, node.id)}
                      className={`absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full border-2 transition-all cursor-crosshair flex items-center justify-center shadow-md z-10
                        ${connectingFromId === node.id
                          ? 'bg-emerald-500 border-emerald-300 scale-125 shadow-emerald-500/50'
                          : 'bg-[#161922] border-emerald-500 hover:bg-emerald-500'
                        }`}
                      title="Arrastar para conectar ao próximo bloco"
                    >
                      <div className="w-2 h-2 rounded-full bg-emerald-400" />
                    </div>
                  )}

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-lg leading-none shrink-0">{meta.emoji}</span>
                        <div className="min-w-0">
                          <div className="font-bold text-xs text-white truncate font-display">{node.titulo}</div>
                          <span className={`inline-flex text-[9px] px-1.5 py-0.5 rounded-full border font-semibold mt-0.5 ${meta.badge}`}>{meta.label}</span>
                        </div>
                      </div>
                      {isExecuted && <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />}
                    </div>
                    {node.desc && (
                      <p className="text-[11px] text-slate-300 leading-snug line-clamp-2">{node.desc}</p>
                    )}
                    {!node.desc && (
                      <p className="text-[11px] text-slate-500 italic">Clique para configurar...</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <FlowMinimap
          nodes={nodes}
          canvasOffset={canvasOffset}
          zoom={zoom}
          viewportSize={{ width: containerRef.current?.clientWidth || 800, height: containerRef.current?.clientHeight || 600 }}
          onNavigate={(x, y) => setCanvasOffset({ x, y })}
        />

        {showLogsConsole && (
          <FlowExecutionLogs
            logs={simLogs}
            isRunning={isRunningSim}
            activeNodeId={activeSimNodeId}
            onClear={() => setSimLogs([])}
            onClose={() => setShowLogsConsole(false)}
          />
        )}

        {activePropertyNode && (
          <FlowPropertyPanel
            node={activePropertyNode}
            onClose={() => setActivePropertyNodeId(null)}
            onChangeNode={(updated) => {
              const nn = nodes.map(n => n.id === updated.id ? updated : n);
              setNodes(nn);
              syncFlowToParent(nn);
            }}
            onDeleteNode={(id) => {
              setSelectedNodeIds([id]);
              deleteSelectedNodes();
            }}
            onTestSingleNode={(n) => {
              setShowLogsConsole(true);
              setSimLogs(prev => [...prev, { type: 'info', title: `Teste: ${n.titulo}`, message: 'Simulação isolada do bloco...', timeMs: 45 }]);
            }}
          />
        )}
      </div>
    </div>
  );
}
