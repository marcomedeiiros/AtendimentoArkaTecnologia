import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Zap, MessageSquare, GitFork, Clock, CheckCircle2, ShieldCheck, Plus, Trash2,
  Play, RotateCcw, ZoomIn, ZoomOut, Maximize2, LayoutGrid, Copy, Clipboard,
  Sparkles, Layers, FileText, ArrowRight, CornerDownRight, RefreshCw, X, HelpCircle, Eye, Power
} from 'lucide-react';
import { FlowMinimap } from './FlowMinimap';
import { FlowPropertyPanel } from './FlowPropertyPanel';
import { FlowExecutionLogs } from './FlowExecutionLogs';
import { EmojiIcon } from '../pages/EmojiIcon';

function formatNodesPositions(passos = []) {
  return passos.map((p, idx) => ({
    ...p,
    x: p.x !== undefined ? p.x : 80 + idx * 260,
    y: p.y !== undefined ? p.y : 180 + (idx % 2 === 0 ? 0 : 40),
    w: p.w || (p.tipo === 'comentario' ? 240 : 220),
    h: p.h || (p.tipo === 'comentario' ? 120 : 96),
    targetId: p.targetId || (idx < passos.length - 1 ? passos[idx + 1].id : null)
  }));
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
  const [mouseCanvasPos, setMouseCanvasPos] = useState({ x: 0, y: 0 });

  const [marquee, setMarquee] = useState(null);

  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const [isRunningSim, setIsRunningSim] = useState(false);
  const [activeSimNodeId, setActiveSimNodeId] = useState(null);
  const [executedNodeIds, setExecutedNodeIds] = useState([]);
  const [simLogs, setSimLogs] = useState([]);
  const [showLogsConsole, setShowLogsConsole] = useState(false);

  const containerRef = useRef(null);

  useEffect(() => {
    if (flow) {
      const formatted = formatNodesPositions(flow.passos || []);
      setNodes(formatted);
      setSelectedNodeIds([]);
      setActivePropertyNodeId(null);
      pushHistory(formatted);
    }
  }, [selectedFlowId]);

  const pushHistory = (newNodes) => {
    const nextHistory = history.slice(0, historyIndex + 1);
    nextHistory.push(JSON.stringify(newNodes));
    setHistory(nextHistory);
    setHistoryIndex(nextHistory.length - 1);
  };

  const syncFlowToParent = useCallback((updatedNodes) => {
    setNodes(updatedNodes);
    const updatedFluxos = fluxos.map(f => {
      if (f.id === selectedFlowId) {
        return { ...f, passos: updatedNodes };
      }
      return f;
    });
    setFluxos(updatedFluxos);
  }, [fluxos, selectedFlowId, setFluxos]);

  const handleUndo = () => {
    if (historyIndex > 0) {
      const prevNodes = JSON.parse(history[historyIndex - 1]);
      setHistoryIndex(historyIndex - 1);
      setNodes(prevNodes);
      syncFlowToParent(prevNodes);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const nextNodes = JSON.parse(history[historyIndex + 1]);
      setHistoryIndex(historyIndex + 1);
      setNodes(nextNodes);
      syncFlowToParent(nextNodes);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'Space' && !e.repeat && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        setIsSpacePressed(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c' && selectedNodeIds.length > 0) {
        const copied = nodes.filter(n => selectedNodeIds.includes(n.id));
        setClipboard(copied);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v' && clipboard) {
        const newCopied = clipboard.map((n, idx) => ({
          ...n,
          id: 'p_' + Date.now() + '_' + idx,
          x: n.x + 40,
          y: n.y + 40,
          titulo: n.titulo + ' (Cópia)'
        }));
        const combined = [...nodes, ...newCopied];
        syncFlowToParent(combined);
        pushHistory(combined);
        setSelectedNodeIds(newCopied.map(n => n.id));
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeIds.length > 0 && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        deleteSelectedNodes();
      }
    };

    const handleKeyUp = (e) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [selectedNodeIds, nodes, clipboard, historyIndex, history]);

  const handleWheel = (e) => {
    e.preventDefault();
    const zoomFactor = 1.08;
    let newZoom = e.deltaY < 0 ? zoom * zoomFactor : zoom / zoomFactor;
    newZoom = Math.min(Math.max(newZoom, 0.25), 2.5);

    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const newOffsetX = mouseX - (mouseX - canvasOffset.x) * (newZoom / zoom);
    const newOffsetY = mouseY - (mouseY - canvasOffset.y) * (newZoom / zoom);

    setZoom(newZoom);
    setCanvasOffset({ x: newOffsetX, y: newOffsetY });
  };

  const handleMouseDown = (e) => {
    if (e.button === 1 || isSpacePressed || e.target === containerRef.current || e.target.tagName === 'svg') {
      setIsPanning(true);
      setPanStart({ x: e.clientX - canvasOffset.x, y: e.clientY - canvasOffset.y });
    } else if (e.target === containerRef.current || e.target.tagName === 'svg') {

      const rect = containerRef.current.getBoundingClientRect();
      const startX = (e.clientX - rect.left - canvasOffset.x) / zoom;
      const startY = (e.clientY - rect.top - canvasOffset.y) / zoom;
      setMarquee({ startX, startY, currentX: startX, currentY: startY });
      setSelectedNodeIds([]);
    }
  };

  const handleMouseMove = (e) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      const curX = (e.clientX - rect.left - canvasOffset.x) / zoom;
      const curY = (e.clientY - rect.top - canvasOffset.y) / zoom;
      setMouseCanvasPos({ x: curX, y: curY });
    }

    if (isPanning) {
      setCanvasOffset({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y
      });
    } else if (marquee) {
      const startX = marquee.startX;
      const startY = marquee.startY;
      const curX = (e.clientX - rect.left - canvasOffset.x) / zoom;
      const curY = (e.clientY - rect.top - canvasOffset.y) / zoom;
      setMarquee({ ...marquee, currentX: curX, currentY: curY });

      const minX = Math.min(startX, curX);
      const maxX = Math.max(startX, curX);
      const minY = Math.min(startY, curY);
      const maxY = Math.max(startY, curY);

      const selected = nodes.filter(n => n.x >= minX && n.x + n.w <= maxX && n.y >= minY && n.y + n.h <= maxY).map(n => n.id);
      setSelectedNodeIds(selected);
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    setMarquee(null);
    if (connectingFromId) {
      setConnectingFromId(null);
    }
  };

  const latestNodesRef = useRef(nodes);
  useEffect(() => {
    latestNodesRef.current = nodes;
  }, [nodes]);

  const handleNodeDrag = (nodeId, e) => {
    e.stopPropagation();
    let startMouseX = e.clientX;
    let startMouseY = e.clientY;

    const initialNodes = [...latestNodesRef.current];
    const draggedNodes = selectedNodeIds.includes(nodeId) ? selectedNodeIds : [nodeId];
    let currentDragNodes = initialNodes;

    const onMouseMove = (moveEvent) => {
      const dx = (moveEvent.clientX - startMouseX) / zoom;
      const dy = (moveEvent.clientY - startMouseY) / zoom;

      currentDragNodes = initialNodes.map(n => {
        if (draggedNodes.includes(n.id)) {
          const newX = Math.round((n.x + dx) / 10) * 10;
          const newY = Math.round((n.y + dy) / 10) * 10;
          return { ...n, x: newX, y: newY };
        }
        return n;
      });
      latestNodesRef.current = currentDragNodes;
      setNodes(currentDragNodes);
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      syncFlowToParent(currentDragNodes);
      pushHistory(currentDragNodes);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleAutoOrganize = () => {
    const updated = nodes.map((n, idx) => ({
      ...n,
      x: 100 + idx * 270,
      y: 180 + (idx % 2 === 0 ? 0 : 50)
    }));
    setNodes(updated);
    syncFlowToParent(updated);
    pushHistory(updated);
  };

  const addNode = (tipo) => {
    const newId = 'p_' + Date.now();
    const titleMap = {
      gatilho: 'Novo Gatilho',
      mensagem: 'Nova Mensagem Bot',
      condicao: 'Validar CNPJ',
      delay: 'Aguardar 2.0s',
      acao: 'Ação Automática',
      comentario: 'Nota Explicativa'
    };
    const newNode = {
      id: newId,
      tipo,
      titulo: titleMap[tipo] || 'Nova Etapa',
      desc: tipo === 'comentario' ? 'Digite uma anotação sobre esta etapa...' : 'Descrição da etapa...',
      x: -canvasOffset.x / zoom + 300,
      y: -canvasOffset.y / zoom + 200,
      w: tipo === 'comentario' ? 240 : 220,
      h: tipo === 'comentario' ? 120 : 96,
      targetId: null
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
    const updated = nodes.filter(n => !selectedNodeIds.includes(n.id)).map(n => {
      if (selectedNodeIds.includes(n.targetId)) {
        return { ...n, targetId: null };
      }
      return n;
    });
    setSelectedNodeIds([]);
    setActivePropertyNodeId(null);
    syncFlowToParent(updated);
    pushHistory(updated);
  };

  const handleConnectPort = (targetNodeId) => {
    if (connectingFromId && connectingFromId !== targetNodeId) {
      const updated = nodes.map(n => n.id === connectingFromId ? { ...n, targetId: targetNodeId } : n);
      syncFlowToParent(updated);
      pushHistory(updated);
    }
    setConnectingFromId(null);
  };

  const handleRunSimulation = () => {
    if (nodes.length === 0) return;
    setIsRunningSim(true);
    setShowLogsConsole(true);
    setExecutedNodeIds([]);
    setSimLogs([{ type: 'info', title: 'Iniciando Simulação de Fluxo', message: `Fluxo: "${flow.nome}"`, timeMs: 0 }]);

    let index = 0;
    const runStep = () => {
      if (index >= nodes.length) {
        setIsRunningSim(false);
        setActiveSimNodeId(null);
        setSimLogs(prev => [...prev, { type: 'success', title: 'Fluxo Concluído com Sucesso ✅', message: 'Todas as etapas foram executadas sem erros.', timeMs: 1450 }]);
        return;
      }

      const curr = nodes[index];
      setActiveSimNodeId(curr.id);
      setExecutedNodeIds(prev => [...prev, curr.id]);

      const delayMs = curr.tipo === 'delay' ? 1800 : 900;
      setSimLogs(prev => [
        ...prev,
        {
          type: curr.tipo === 'condicao' ? 'success' : 'running',
          title: `Etapa ${index + 1}: ${curr.titulo}`,
          message: curr.desc || curr.texto,
          timeMs: Math.floor(120 + Math.random() * 200)
        }
      ]);

      index++;
      setTimeout(runStep, delayMs);
    };

    runStep();
  };

  const activePropertyNode = nodes.find(n => n.id === activePropertyNodeId);

  return (
    <div className="flex flex-col h-[calc(100vh-60px)] w-full relative bg-[#0B0D12] overflow-hidden select-none font-sans">
      <div className="p-3 bg-[#11141C]/90 backdrop-blur-md border-b border-[#2A3040] flex flex-wrap items-center justify-between gap-3 z-20">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-orange-500/10 text-orange-400 border border-orange-500/30">
              <Zap size={18} />
            </span>
            <div>
              <select
                value={selectedFlowId}
                onChange={(e) => setSelectedFlowId(e.target.value)}
                className="bg-[#161922] border border-[#2A3040] rounded-xl px-3 py-1.5 text-xs font-bold text-white font-display focus:outline-none focus:border-orange-500"
              >
                {fluxos.map(f => (
                  <option key={f.id} value={f.id}>{f.nome} ({f.gatilho})</option>
                ))}
              </select>
            </div>
          </div>

          <button
            onClick={() => {
              const novoId = 'f' + Date.now();
              const novo = {
                id: novoId,
                nome: `Novo Fluxo ${fluxos.length + 1}`,
                gatilho: 'novo',
                ativo: true,
                passos: [
                  { id: 'p1', tipo: 'gatilho', titulo: 'Gatilho Recebido', desc: 'Cliente digita "novo"', x: 100, y: 180, w: 220, h: 96 }
                ]
              };
              setFluxos([...fluxos, novo]);
              setSelectedFlowId(novoId);
            }}
            className="px-3 py-1.5 rounded-xl bg-orange-500/15 hover:bg-orange-500/25 text-orange-400 text-xs font-semibold border border-orange-500/30 flex items-center gap-1.5 transition-all"
          >
            <Plus size={14} /> Novo Fluxo
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center bg-[#161922] border border-[#2A3040] rounded-xl p-1 text-xs text-slate-300">
            <button onClick={() => setZoom(z => Math.max(z / 1.15, 0.25))} className="p-1.5 hover:text-white"><ZoomOut size={14} /></button>
            <span className="px-2 font-mono text-[11px] text-slate-400">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom(z => Math.min(z * 1.15, 2.5))} className="p-1.5 hover:text-white"><ZoomIn size={14} /></button>
            <button onClick={() => { setZoom(1); setCanvasOffset({ x: 100, y: 100 }); }} className="p-1.5 hover:text-white border-l border-[#2A3040] ml-1" title="Resetar visão"><Maximize2 size={13} /></button>
          </div>

          <div className="flex items-center bg-[#161922] border border-[#2A3040] rounded-xl p-1 text-xs">
            <button onClick={handleUndo} disabled={historyIndex <= 0} className="p-1.5 text-slate-400 hover:text-white disabled:opacity-30"><RotateCcw size={14} /></button>
            <button onClick={handleRedo} disabled={historyIndex >= history.length - 1} className="p-1.5 text-slate-400 hover:text-white disabled:opacity-30"><RefreshCw size={14} /></button>
          </div>

          <button
            onClick={handleAutoOrganize}
            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors border border-slate-700"
            title="Organizar layout dos blocos automaticamente"
          >
            <LayoutGrid size={14} /> Organizar
          </button>

          <button
            onClick={() => setShowLogsConsole(!showLogsConsole)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all border ${
              showLogsConsole ? 'bg-orange-500/20 text-orange-400 border-orange-500/40' : 'bg-slate-800 text-slate-300 border-slate-700'
            }`}
          >
            <Sparkles size={14} /> Console ({simLogs.length})
          </button>

          <button
            onClick={handleRunSimulation}
            disabled={isRunningSim}
            className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-slate-950 text-xs font-bold flex items-center gap-2 shadow-md shadow-orange-500/20 transition-all disabled:opacity-50"
          >
            <Play size={14} fill="currentColor" /> {isRunningSim ? 'Simulando...' : 'Simular Execução'}
          </button>
        </div>
      </div>

      <div className="flex-1 flex relative overflow-hidden">
        <div className="w-56 bg-[#11141C] border-r border-[#2A3040] p-3 flex flex-col gap-2 z-10 hidden md:flex select-none">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
            <Layers size={13} className="text-orange-400" /> Biblioteca de Blocos
          </div>

          {[
            { tipo: 'gatilho', label: 'Gatilho', desc: 'Início de conversa' },
            { tipo: 'mensagem', label: 'Mensagem', desc: 'Texto para cliente' },
            { tipo: 'condicao', label: 'Validar CNPJ', desc: 'Checar parceiro' },
            { tipo: 'delay', label: 'Espera / Delay', desc: 'Simula digitação' },
            { tipo: 'acao', label: 'Ação ERP', desc: 'Desconto / Boleto' },
            { tipo: 'comentario', label: 'Anotação / Nota', desc: 'Post-it de equipe' },
          ].map(item => (
            <button
              key={item.tipo}
              onClick={() => addNode(item.tipo)}
              className="p-2.5 rounded-xl bg-[#161922] hover:bg-[#1E2330] border border-[#2A3040] hover:border-orange-500/40 text-left transition-all group flex items-center gap-2.5"
            >
              <EmojiIcon name={item.tipo === 'comentario' ? 'question' : item.tipo} label="" size="sm" />
              <div>
                <div className="text-xs font-semibold text-white group-hover:text-orange-400 transition-colors">{item.label}</div>
                <div className="text-[10px] text-slate-400">{item.desc}</div>
              </div>
            </button>
          ))}
        </div>

        <div
          ref={containerRef}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          className={`flex-1 relative overflow-hidden bg-[#0B0D12] ${isSpacePressed ? 'cursor-grab' : isPanning ? 'cursor-grabbing' : 'cursor-default'}`}
        >
          <div
            className="absolute inset-0 pointer-events-none opacity-20"
            style={{
              backgroundImage: `radial-gradient(#384156 1px, transparent 1px)`,
              backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
              backgroundPosition: `${canvasOffset.x}px ${canvasOffset.y}px`
            }}
          />

          <div
            style={{
              transform: `translate3d(${canvasOffset.x}px, ${canvasOffset.y}px, 0) scale(${zoom})`,
              transformOrigin: '0 0',
              width: '100%',
              height: '100%',
              position: 'absolute'
            }}
          >

            <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible z-0">
              <defs>
                <linearGradient id="curveGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#FF7A29" />
                  <stop offset="100%" stopColor="#10B981" />
                </linearGradient>
              </defs>

              {nodes.map(node => {
                if (!node.targetId) return null;
                const target = nodes.find(n => n.id === node.targetId);
                if (!target) return null;

                const startX = node.x + (node.w || 220);
                const startY = node.y + (node.h || 96) / 2;
                const endX = target.x;
                const endY = target.y + (target.h || 96) / 2;

                const dx = Math.abs(endX - startX) * 0.5;
                const pathD = `M ${startX} ${startY} C ${startX + dx} ${startY}, ${endX - dx} ${endY}, ${endX} ${endY}`;

                const isPathActive = activeSimNodeId === node.id || executedNodeIds.includes(node.id);

                return (
                  <g key={`${node.id}-${target.id}`}>
                    <path
                      d={pathD}
                      fill="none"
                      stroke={isPathActive ? '#10B981' : '#384156'}
                      strokeWidth={isPathActive ? 3 : 2}
                      className="transition-all duration-300"
                    />
                    {isPathActive && (
                      <path
                        d={pathD}
                        fill="none"
                        stroke="#FF7A29"
                        strokeWidth="3"
                        strokeDasharray="6 6"
                        className="animate-pulse"
                      />
                    )}
                  </g>
                );
              })}

              {connectingFromId && (() => {
                const source = nodes.find(n => n.id === connectingFromId);
                if (!source) return null;
                const startX = source.x + (source.w || 220);
                const startY = source.y + (source.h || 96) / 2;
                const endX = mouseCanvasPos.x;
                const endY = mouseCanvasPos.y;
                const dx = Math.abs(endX - startX) * 0.5;
                const pathD = `M ${startX} ${startY} C ${startX + dx} ${startY}, ${endX - dx} ${endY}, ${endX} ${endY}`;
                return <path d={pathD} fill="none" stroke="#FF7A29" strokeWidth="2.5" strokeDasharray="4 4" />;
              })()}
            </svg>


            {marquee && (
              <div
                className="absolute border border-orange-500 bg-orange-500/10 pointer-events-none rounded-md"
                style={{
                  left: Math.min(marquee.startX, marquee.currentX),
                  top: Math.min(marquee.startY, marquee.currentY),
                  width: Math.abs(marquee.currentX - marquee.startX),
                  height: Math.abs(marquee.currentY - marquee.startY)
                }}
              />
            )}


            {nodes.map(node => {
              const isSelected = selectedNodeIds.includes(node.id);
              const isExecuting = activeSimNodeId === node.id;
              const isExecuted = executedNodeIds.includes(node.id);
              const isComment = node.tipo === 'comentario';

              return (
                <div
                  key={node.id}
                  onMouseDown={(e) => {
                    if (e.button === 0 && !isSpacePressed) {
                      e.stopPropagation();
                      if (!e.shiftKey && !isSelected) {
                        setSelectedNodeIds([node.id]);
                      } else if (e.shiftKey) {
                        setSelectedNodeIds(prev => isSelected ? prev.filter(id => id !== node.id) : [...prev, node.id]);
                      }
                      setActivePropertyNodeId(node.id);
                      handleNodeDrag(node.id, e);
                    }
                  }}
                  className={`absolute rounded-2xl transition-all duration-150 cursor-grab active:cursor-grabbing select-none ${
                    isComment
                      ? 'bg-amber-500/10 border-2 border-amber-500/40 p-4 text-amber-200 shadow-lg'
                      : 'glass-panel p-4 border border-[#2A3040] shadow-xl'
                  } ${
                    isSelected ? 'ring-2 ring-orange-500 border-orange-500/60 shadow-orange-500/10' : ''
                  } ${
                    isExecuting ? 'ring-4 ring-amber-400 border-amber-400 animate-pulse glow-orange' : ''
                  } ${
                    isExecuted && !isExecuting ? 'border-emerald-500/80 shadow-emerald-500/10' : ''
                  }`}
                  style={{
                    left: node.x,
                    top: node.y,
                    width: node.w || 220,
                    minHeight: node.h || 96
                  }}
                >

                  {!isComment && (
                    <div
                      onClick={() => handleConnectPort(node.id)}
                      className="absolute -left-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-[#161922] border-2 border-orange-500 hover:bg-orange-500 transition-colors cursor-pointer flex items-center justify-center shadow-md z-10"
                      title="Porta de Entrada"
                    >
                      <div className="w-2 h-2 rounded-full bg-orange-400" />
                    </div>
                  )}


                  {!isComment && (
                    <div
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        setConnectingFromId(node.id);
                      }}
                      className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-[#161922] border-2 border-emerald-500 hover:bg-emerald-500 transition-colors cursor-pointer flex items-center justify-center shadow-md z-10"
                      title="Arrastar para conectar"
                    >
                      <div className="w-2 h-2 rounded-full bg-emerald-400" />
                    </div>
                  )}


                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <EmojiIcon name={isComment ? 'question' : node.tipo} label="" size="sm" />
                        <span className="font-bold text-xs text-white truncate font-display">{node.titulo}</span>
                      </div>
                      {isExecuted && <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />}
                    </div>

                    <p className="text-[11px] text-slate-300 leading-snug line-clamp-2">
                      {node.desc || node.texto || 'Clique para configurar...'}
                    </p>
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
          viewportSize={{
            width: containerRef.current?.clientWidth || 800,
            height: containerRef.current?.clientHeight || 600
          }}
          onNavigate={(targetX, targetY) => setCanvasOffset({ x: targetX, y: targetY })}
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
              const newNodes = nodes.map(n => n.id === updated.id ? updated : n);
              setNodes(newNodes);
              syncFlowToParent(newNodes);
            }}
            onDeleteNode={(id) => {
              setSelectedNodeIds([id]);
              deleteSelectedNodes();
            }}
            onTestSingleNode={(n) => {
              setShowLogsConsole(true);
              setSimLogs(prev => [
                ...prev,
                { type: 'info', title: `Teste Unitário: ${n.titulo}`, message: 'Simulação isolada do bloco...', timeMs: 45 }
              ]);
            }}
          />
        )}
      </div>
    </div>
  );
}
