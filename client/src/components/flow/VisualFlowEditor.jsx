import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Zap, CheckCircle2, Plus, Trash2,
  Play, RotateCcw, ZoomIn, ZoomOut, Maximize2, LayoutGrid,
  Sparkles, Layers, RefreshCw, X, ChevronUp, ChevronDown,
  Settings, AlertCircle, Pencil, Flame
} from 'lucide-react';
import { FluxosAPI } from '../../services/api';
import { usePreferencia } from '../../hooks/usePreferencia';
import { FlowMinimap } from './FlowMinimap';
import { FlowPropertyPanel } from './FlowPropertyPanel';
import { FlowExecutionLogs } from './FlowExecutionLogs';

const BLOCK_META = {
  gatilho:    { emoji: '⚡', label: 'Gatilho',       desc: 'Início da conversa', color: 'border-acao/60 bg-acao/5',  badge: 'bg-acao/20 text-acao-200 border-acao/30' },
  mensagem:   { emoji: '💬', label: 'Mensagem',       desc: 'Texto para cliente', color: 'border-blue-500/60 bg-blue-500/5',      badge: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  condicao:   { emoji: '🔍', label: 'Validar CNPJ',   desc: 'Checar parceiro',    color: 'border-purple-500/60 bg-purple-500/5',  badge: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  delay:      { emoji: '⏳', label: 'Delay',          desc: 'Simula digitação',   color: 'border-linha bg-slate-500/5',    badge: 'bg-slate-500/20 text-slate-300 border-linha-forte' },
  acao:       { emoji: '🚀', label: 'Ação ERP',        desc: 'Desconto / Boleto',  color: 'border-ativo/60 bg-ativo/5',badge: 'bg-ativo/20 text-ativo-400 border-ativo/30' },
  comentario: { emoji: '📝', label: 'Anotação',       desc: 'Post-it de equipe',  color: 'border-espera/60 bg-espera/10',   badge: 'bg-espera/20 text-espera-400 border-espera/30' }
};


function formatNodesPositions(passos = []) {
  return passos.map((p, idx) => ({
    ...p,
    // Usa ?? para tratar null (posicao nao salva no banco) alem de undefined
    // senao os blocos do seed (posX/posY null) empilhavam todos em left:0.
    x: p.x ?? (80 + idx * 270),
    y: p.y ?? (180 + (idx % 2 === 0 ? 0 : 40)),
    w: p.w || (p.tipo === 'comentario' ? 240 : 220),
    h: p.h || (p.tipo === 'comentario' ? 120 : 96),
    targetId: p.targetId || (idx < passos.length - 1 ? passos[idx + 1].id : null)
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
      targetId: n.tipo === 'comentario' ? n.targetId : (newOrder[i + 1]?.tipo !== 'comentario' ? newOrder[i + 1]?.id || null : null)
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
        <Settings size={11} className="text-acao-200" /> Sequência
      </div>
      {orderedNodes.map((node, idx) => {
        const meta = BLOCK_META[node.tipo] || BLOCK_META.mensagem;
        const isSel = selectedNodeIds.includes(node.id);
        return (
          <div
            key={node.id}
            onClick={() => onSelectNode(node.id)}
            className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-all border text-xs ${
              isSel ? 'bg-acao/15 border-acao/40 text-acao-200' : 'bg-grafite-700 border-linha text-slate-300 hover:border-linha-forte hover:text-white'
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
  // Fluxos marcados como "simulando". Fica no servidor (por operador), entao o
  // indicador verde continua piscando mesmo depois de atualizar a pagina.
  const [simAtiva, setSimAtiva] = usePreferencia('fluxos.simulacaoAtiva', {});
  const [activeSimNodeId, setActiveSimNodeId] = useState(null);
  const [executedNodeIds, setExecutedNodeIds] = useState([]);
  const [simLogs, setSimLogs] = useState([]);
  const [showLogsConsole, setShowLogsConsole] = useState(false);
  const [showSequencePanel, setShowSequencePanel] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [dragOverCanvas, setDragOverCanvas] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [nomeEditado, setNomeEditado] = useState('');

  const containerRef = useRef(null);

  // Os fluxos chegam da API depois da montagem. Sem isto, selectedFlowId ficava
  // null para sempre: o canvas abria vazio e "Simular" nao fazia nada.
  useEffect(() => {
    if (!fluxos.length) return;
    if (!fluxos.some(f => f.id === selectedFlowId)) {
      setSelectedFlowId(fluxos[0].id);
    }
  }, [fluxos, selectedFlowId]);

  // Depende de flow?.id (e nao de selectedFlowId) para disparar tambem quando o
  // fluxo e resolvido pelo fallback fluxos[0].
  useEffect(() => {
    if (flow) {
      const formatted = formatNodesPositions(flow.passos || []);
      setNodes(formatted);
      setSelectedNodeIds([]);
      setActivePropertyNodeId(null);
      setShowDeleteConfirm(false);
      setShowDeleteAllConfirm(false);
      pushHistory(formatted);
    }
  }, [flow?.id]);

  const pushHistory = (newNodes) => {
    setHistory(prev => {
      const next = prev.slice(0, historyIndex + 1);
      next.push(JSON.stringify(newNodes));
      setHistoryIndex(next.length - 1);
      return next;
    });
  };

  const syncFlowToParent = useCallback(async (updatedNodes) => {
    setNodes(updatedNodes);
    setFluxos(fluxos.map(f => f.id === selectedFlowId ? { ...f, passos: updatedNodes } : f));
    try {
      if (selectedFlowId) {
        await FluxosAPI.atualizar(selectedFlowId, { passos: updatedNodes });
      }
    } catch {}
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

  const handleRenameFlow = async () => {
    if (!nomeEditado.trim() || !selectedFlowId) return;
    const novoNome = nomeEditado.trim();
    setFluxos(fluxos.map(f => f.id === selectedFlowId ? { ...f, nome: novoNome } : f));
    setIsRenaming(false);
    try {
      await FluxosAPI.atualizar(selectedFlowId, { nome: novoNome });
    } catch {}
  };

  const handleDeleteFlow = async () => {
    const targetId = selectedFlowId;
    const remaining = fluxos.filter(f => f.id !== targetId);
    setFluxos(remaining);
    if (remaining.length > 0) setSelectedFlowId(remaining[0].id);
    else setSelectedFlowId(null);
    setShowDeleteConfirm(false);
    try {
      if (targetId) await FluxosAPI.remover(targetId);
    } catch {}
  };

  const handleDeleteAllFlows = async () => {
    setFluxos([]);
    setSelectedFlowId(null);
    setNodes([]);
    setShowDeleteAllConfirm(false);
    try {
      await FluxosAPI.removerTodos();
    } catch {}
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
    const onEmptyCanvas = e.target === containerRef.current || e.target.tagName === 'svg';
    // Arrastar o canvas vazio com o botao esquerdo (ou meio/espaco) faz o "pan"
    // com a mãozinha. Shift+arrasto no vazio faz selecao retangular (marquee).
    if (e.button === 1 || isSpacePressed || (e.button === 0 && onEmptyCanvas && !e.shiftKey)) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - canvasOffset.x, y: e.clientY - canvasOffset.y });
      setSelectedNodeIds([]);
      setSelectedEdgeTargetId(null);
    } else if (e.button === 0 && onEmptyCanvas && e.shiftKey) {
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

  const addNode = (tipo, pos = null) => {
    // Sem um fluxo selecionado nao ha onde anexar o bloco: o syncFlowToParent
    // nao encontraria nenhum fluxo para gravar os passos, entao o bloco ficaria
    // "solto" na tela e sumiria no primeiro reload. Bloqueamos aqui.
    if (!flow) return;
    const newId = 'p_' + Date.now();
    const titleMap = { gatilho: 'Novo Gatilho', mensagem: 'Nova Mensagem', condicao: 'Validar CNPJ', delay: 'Aguardar...', acao: 'Ação Automática', comentario: 'Anotação' };
    const newNode = {
      id: newId, tipo,
      titulo: titleMap[tipo] || 'Nova Etapa',
      desc: '',
      x: pos ? pos.x : -canvasOffset.x / zoom + 300,
      y: pos ? pos.y : -canvasOffset.y / zoom + 200,
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

  // Solta um bloco arrastado da biblioteca na posição do mouse no canvas.
  const handleCanvasDrop = (e) => {
    e.preventDefault();
    setDragOverCanvas(false);
    const tipo = e.dataTransfer.getData('tipo');
    if (!tipo || !BLOCK_META[tipo]) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left - canvasOffset.x) / zoom) / 10) * 10;
    const y = Math.round(((e.clientY - rect.top - canvasOffset.y) / zoom) / 10) * 10;
    addNode(tipo, { x, y });
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

  // Chave da simulacao: `selectedFlowId` nasce null quando os fluxos ainda nao
  // chegaram da API (o editor cai no fallback fluxos[0]), entao usamos flow.id.
  const fluxoSimId = flow?.id || selectedFlowId;
  const simulacaoMarcada = !!(fluxoSimId && simAtiva?.[fluxoSimId]);

  const pararSimulacao = () => {
    setIsRunningSim(false);
    setActiveSimNodeId(null);
    setSimAtiva(prev => {
      const novo = { ...prev };
      delete novo[fluxoSimId];
      return novo;
    });
  };

  const handleRunSimulation = () => {
    // Segundo clique enquanto esta verde: desliga o indicador.
    if (simulacaoMarcada && !isRunningSim) {
      pararSimulacao();
      return;
    }
    if (nodes.length === 0) return;
    if (fluxoSimId) setSimAtiva(prev => ({ ...prev, [fluxoSimId]: true }));
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
    <div className="flex flex-col h-full min-h-[500px] w-full relative bg-grafite-900 overflow-hidden select-none font-sans">

      <div className="p-3 bg-grafite-800/90 backdrop-blur-md border-b border-linha flex flex-wrap items-center justify-between gap-3 z-20">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="p-2 rounded-xl bg-acao/10 text-acao-200 border border-acao/30">
            <Zap size={18} />
          </span>

          {!isRenaming ? (
            <div className="flex items-center gap-1.5">
              {fluxos.length > 0 ? (
                <>
                  <select
                    value={selectedFlowId || ''}
                    onChange={e => setSelectedFlowId(e.target.value)}
                    className="bg-grafite-700 border border-linha rounded-xl px-3 py-1.5 text-xs font-bold text-white focus:outline-none focus:border-acao max-w-[220px] truncate"
                  >
                    {fluxos.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
                  </select>
                  {flow && (
                    <button
                      onClick={() => { setNomeEditado(flow.nome); setIsRenaming(true); }}
                      className="p-1.5 rounded-xl bg-grafite-700 hover:bg-grafite-600 border border-linha text-slate-400 hover:text-white transition-colors"
                      title="Renomear este fluxo"
                    >
                      <Pencil size={13} />
                    </button>
                  )}
                </>
              ) : (
                <span className="text-xs text-slate-500 font-semibold px-1">Nenhum fluxo clique em “Novo Fluxo”</span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <input
                value={nomeEditado}
                onChange={e => setNomeEditado(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleRenameFlow()}
                placeholder="Novo nome do fluxo"
                autoFocus
                className="bg-grafite-700 border border-acao/60 rounded-xl px-3 py-1.5 text-xs font-bold text-white focus:outline-none w-48"
              />
              <button
                onClick={handleRenameFlow}
                className="px-2.5 py-1.5 rounded-xl bg-acao hover:bg-acao-200 text-slate-950 text-xs font-bold transition-all"
              >
                Salvar
              </button>
              <button
                onClick={() => setIsRenaming(false)}
                className="p-1.5 rounded-xl bg-slate-800 text-slate-400 hover:text-white transition-colors"
              >
                <X size={13} />
              </button>
            </div>
          )}

          <button
            onClick={async () => {
              const tempId = 'f' + Date.now();
              const nome = `Novo Fluxo ${fluxos.length + 1}`;
              const gatilho = `gatilho_${Date.now().toString().slice(-4)}`;
              const novoLocal = { id: tempId, nome, gatilho, ativo: true, passos: [] };
              setFluxos([...fluxos, novoLocal]);
              setSelectedFlowId(tempId);
              try {
                // Usa o id real do back-end para que os blocos adicionados persistam.
                const criado = await FluxosAPI.criar({ nome, gatilho, ativo: true, passos: [] });
                setFluxos(prev => prev.map(f => (f.id === tempId ? criado : f)));
                setSelectedFlowId(criado.id);
              } catch {}
            }}
            className="px-3 py-1.5 rounded-xl bg-acao/15 hover:bg-acao/25 text-acao-200 text-xs font-semibold border border-acao/30 flex items-center gap-1.5 transition-all"
          >
            <Plus size={14} /> Novo Fluxo
          </button>

          {fluxos.length > 0 && !showDeleteConfirm && !showDeleteAllConfirm && (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="px-3 py-1.5 rounded-xl bg-falha/10 hover:bg-falha/20 text-falha-400 text-xs font-semibold border border-falha/30 flex items-center gap-1.5 transition-all"
            >
              <Trash2 size={14} /> Deletar Fluxo
            </button>
          )}
          {showDeleteConfirm && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-falha/15 border border-falha/40 text-xs">
              <AlertCircle size={13} className="text-falha-400 shrink-0" />
              <span className="text-falha-400 font-semibold">Excluir este fluxo?</span>
              <button onClick={handleDeleteFlow} className="px-2 py-0.5 rounded-lg bg-falha hover:bg-falha-400 text-white font-bold transition-colors">Sim</button>
              <button onClick={() => setShowDeleteConfirm(false)} className="px-2 py-0.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold transition-colors">Não</button>
            </div>
          )}

          {fluxos.length > 0 && !showDeleteAllConfirm && !showDeleteConfirm && (
            <button
              onClick={() => setShowDeleteAllConfirm(true)}
              className="px-3 py-1.5 rounded-xl bg-falha-600/60 hover:bg-falha-600/80 text-falha-400 text-xs font-semibold border border-falha/50 flex items-center gap-1.5 transition-all"
              title="Apagar todos os fluxos cadastrados"
            >
              <Flame size={14} className="text-falha-400" /> Apagar Todos
            </button>
          )}
          {showDeleteAllConfirm && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-falha-600 border border-falha-600 text-xs">
              <AlertCircle size={13} className="text-falha-400 shrink-0" />
              <span className="text-falha-400 font-bold">Apagar TODOS os fluxos?</span>
              <button onClick={handleDeleteAllFlows} className="px-2.5 py-0.5 rounded-lg bg-falha-600 hover:bg-falha text-white font-extrabold transition-colors">Apagar Todos</button>
              <button onClick={() => setShowDeleteAllConfirm(false)} className="px-2 py-0.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold transition-colors">Cancelar</button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center bg-grafite-700 border border-linha rounded-xl p-1 text-xs text-slate-300">
            <button onClick={() => setZoom(z => Math.max(z / 1.15, 0.25))} className="p-1.5 hover:text-white"><ZoomOut size={14} /></button>
            <span className="px-2 font-mono text-[11px] text-slate-400">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom(z => Math.min(z * 1.15, 2.5))} className="p-1.5 hover:text-white"><ZoomIn size={14} /></button>
            <button onClick={() => { setZoom(1); setCanvasOffset({ x: 100, y: 100 }); }} className="p-1.5 hover:text-white border-l border-linha ml-1" title="Resetar"><Maximize2 size={13} /></button>
          </div>
          <div className="flex items-center bg-grafite-700 border border-linha rounded-xl p-1">
            <button onClick={handleUndo} disabled={historyIndex <= 0} className="p-1.5 text-slate-400 hover:text-white disabled:opacity-30"><RotateCcw size={14} /></button>
            <button onClick={handleRedo} disabled={historyIndex >= history.length - 1} className="p-1.5 text-slate-400 hover:text-white disabled:opacity-30"><RefreshCw size={14} /></button>
          </div>
          <button onClick={handleAutoOrganize} className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 border border-linha transition-colors">
            <LayoutGrid size={14} /> Organizar
          </button>
          <button onClick={() => setShowSequencePanel(s => !s)} className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition-all ${showSequencePanel ? 'bg-blue-500/20 text-blue-400 border-blue-500/40' : 'bg-slate-800 text-slate-300 border-linha'}`}>
            <Settings size={14} /> Sequência
          </button>
          <button onClick={() => setShowLogsConsole(s => !s)} className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition-all ${showLogsConsole ? 'bg-acao/20 text-acao-200 border-acao/40' : 'bg-slate-800 text-slate-300 border-linha'}`}>
            <Sparkles size={14} /> Console ({simLogs.length})
          </button>
          <button
            onClick={handleRunSimulation}
            title={simulacaoMarcada && !isRunningSim ? 'Clique para parar a simulação' : 'Executar simulação do fluxo'}
            className={`px-4 py-1.5 rounded-xl text-xs font-bold flex items-center gap-2 shadow-md transition-all ${
              simulacaoMarcada
                ? 'bg-gradient-to-r from-ativo to-green-500 text-slate-950 shadow-ativo/30 animate-pulse'
                : 'bg-gradient-to-r from-acao to-espera hover:from-acao-200 hover:to-espera-400 text-slate-950 shadow-acao/20'
            }`}
          >
            <Play size={14} fill="currentColor" />
            {isRunningSim ? 'Simulando...' : simulacaoMarcada ? 'Simulação ativa' : 'Simular'}
          </button>
        </div>
      </div>

      <div className="flex-1 flex relative overflow-hidden">

        {/* Sidebar Biblioteca colapsável */}
        <div className="relative flex-shrink-0 flex z-10">
          {/* Painel da biblioteca com animação de largura */}
          <div
            className="bg-grafite-800 border-r border-linha flex flex-col gap-3 select-none overflow-hidden"
            style={{
              width: showLibrary ? '224px' : '0px',
              padding: showLibrary ? '12px' : '0px',
              opacity: showLibrary ? 1 : 0,
              transition: 'width 0.28s cubic-bezier(0.4,0,0.2,1), padding 0.28s cubic-bezier(0.4,0,0.2,1), opacity 0.2s ease',
              overflow: 'hidden'
            }}
          >
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1 whitespace-nowrap">
              <Layers size={13} className="text-acao-200" /> Biblioteca de Blocos
            </div>
            <div className="text-[10px] text-slate-500 -mt-1 whitespace-nowrap">Clique ou arraste para direita os blocos</div>
            {Object.entries(BLOCK_META).map(([tipo, meta]) => (
              <button key={tipo}
                onClick={() => addNode(tipo)}
                draggable
                onDragStart={(e) => { e.dataTransfer.setData('tipo', tipo); e.dataTransfer.effectAllowed = 'copy'; }}
                className="p-2.5 rounded-xl bg-grafite-700 hover:bg-grafite-600 border border-linha hover:border-acao/40 text-left transition-all group flex items-center gap-2.5 whitespace-nowrap cursor-grab active:cursor-grabbing">
                <span className="text-lg leading-none">{meta.emoji}</span>
                <div>
                  <div className="text-xs font-semibold text-white group-hover:text-acao-200 transition-colors">{meta.label}</div>
                  <div className="text-[10px] text-slate-400">{meta.desc}</div>
                </div>
              </button>
            ))}

            {showSequencePanel && (
              <div className="mt-2 border-t border-linha pt-3">
                <SequencePanel
                  nodes={nodes}
                  onReorder={handleReorder}
                  onSelectNode={(id) => { setSelectedNodeIds([id]); setActivePropertyNodeId(id); }}
                  selectedNodeIds={selectedNodeIds}
                />
              </div>
            )}
          </div>

          {/* Botão toggle << / >> */}
          <button
            onClick={() => setShowLibrary(v => !v)}
            title={showLibrary ? 'Recolher biblioteca' : 'Abrir biblioteca de blocos'}
            className="absolute top-1/2 -translate-y-1/2 -right-4 z-20 w-8 h-14 flex items-center justify-center bg-grafite-600 border border-linha rounded-r-xl text-slate-400 hover:text-acao-200 hover:border-acao/40 transition-all shadow-lg hover:shadow-acao/10 cursor-pointer"
            style={{ right: '-32px' }}
          >
            <span
              className="font-bold text-base tracking-tighter leading-none transition-transform duration-300"
              style={{ transform: showLibrary ? 'scaleX(1)' : 'scaleX(1)' }}
            >
              {showLibrary ? '\u00AB' : '\u00BB'}
            </span>
          </button>
        </div>

        <div
          ref={containerRef}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (!dragOverCanvas) setDragOverCanvas(true); }}
          onDragLeave={(e) => { if (e.target === containerRef.current) setDragOverCanvas(false); }}
          onDrop={handleCanvasDrop}
          className={`flex-1 relative overflow-hidden bg-grafite-900 transition-shadow ${isPanning ? 'cursor-grabbing' : 'cursor-grab'} ${dragOverCanvas ? 'ring-2 ring-inset ring-acao/50' : ''}`}
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
              <div className="absolute border border-acao bg-acao/10 pointer-events-none rounded-md" style={{
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
                    ${isComment ? 'p-4 text-espera-400 shadow-lg' : 'p-4 shadow-xl'}
                    border-2 ${meta.color}
                    ${isSelected  ? 'ring-2 ring-acao shadow-acao/20' : ''}
                    ${isExecuting ? 'ring-4 ring-espera-400 animate-pulse' : ''}
                    ${isExecuted && !isExecuting ? 'border-ativo/80' : ''}
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
                            ? 'bg-acao border-acao-200 scale-125 shadow-acao/50'
                            : isEdgeSel
                              ? 'bg-falha border-falha-400 scale-110 shadow-falha/50'
                              : hasIncoming
                                ? 'bg-grafite-700 border-acao hover:bg-acao'
                                : 'bg-grafite-700 border-linha-forte hover:border-acao/60 opacity-60'
                          }`}
                        title={isEdgeSel ? 'Pressione Delete para desconectar' : hasIncoming ? 'Clique para selecionar conexão' : 'Porta de entrada (sem conexão)'}
                      >
                        <div className={`w-2 h-2 rounded-full ${isEdgeSel ? 'bg-falha-400' : 'bg-acao-200'}`} />
                        {isEdgeSel && (
                          <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] bg-falha text-white px-1.5 py-0.5 rounded font-bold whitespace-nowrap pointer-events-none">
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
                          ? 'bg-ativo border-ativo-400 scale-125 shadow-ativo/50'
                          : 'bg-grafite-700 border-ativo hover:bg-ativo'
                        }`}
                      title="Arrastar para conectar ao próximo bloco"
                    >
                      <div className="w-2 h-2 rounded-full bg-ativo-400" />
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
                      {isExecuted && <CheckCircle2 size={14} className="text-ativo-400 shrink-0" />}
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
