import React from 'react';

export function FlowMinimap({ nodes, canvasOffset, zoom, viewportSize, onNavigate }) {
  if (!nodes || nodes.length === 0) return null;

  const padding = 100;
  const minX = Math.min(...nodes.map(n => n.x)) - padding;
  const maxX = Math.max(...nodes.map(n => n.x + (n.w || 220))) + padding;
  const minY = Math.min(...nodes.map(n => n.y)) - padding;
  const maxY = Math.max(...nodes.map(n => n.y + (n.h || 100))) + padding;

  const width = Math.max(maxX - minX, 600);
  const height = Math.max(maxY - minY, 400);

  const miniMapWidth = 180;
  const miniMapHeight = 120;
  const scaleX = miniMapWidth / width;
  const scaleY = miniMapHeight / height;
  const miniScale = Math.min(scaleX, scaleY);

  const viewX = (-canvasOffset.x - minX) * miniScale;
  const viewY = (-canvasOffset.y - minY) * miniScale;
  const viewW = (viewportSize.width / zoom) * miniScale;
  const viewH = (viewportSize.height / zoom) * miniScale;

  const categoryColors = {
    gatilho: '#FF7A29',
    mensagem: '#3B82F6',
    condicao: '#8B5CF6',
    delay: '#94A3B8',
    acao: '#10B981',
    comentario: '#F59E0B'
  };

  return (
    <div className="absolute bottom-4 right-4 z-20 glass-panel border border-[#2A3040] rounded-xl p-2 shadow-2xl select-none hidden sm:block">
      <div className="text-[10px] font-bold text-slate-400 mb-1 flex items-center justify-between">
        <span>MINIMAP</span>
        <span className="text-orange-400">{nodes.length} NÓS</span>
      </div>
      <div 
        className="relative bg-[#0B0D12] border border-[#2A3040] rounded-lg overflow-hidden cursor-crosshair"
        style={{ width: miniMapWidth, height: miniMapHeight }}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const clickX = e.clientX - rect.left;
          const clickY = e.clientY - rect.top;
          const targetCanvasX = minX + clickX / miniScale - (viewportSize.width / (2 * zoom));
          const targetCanvasY = minY + clickY / miniScale - (viewportSize.height / (2 * zoom));
          onNavigate(-targetCanvasX, -targetCanvasY);
        }}
      >
        {nodes.map(node => (
          <div
            key={node.id}
            className="absolute rounded-sm opacity-80"
            style={{
              left: (node.x - minX) * miniScale,
              top: (node.y - minY) * miniScale,
              width: Math.max((node.w || 220) * miniScale, 6),
              height: Math.max((node.h || 90) * miniScale, 4),
              backgroundColor: categoryColors[node.tipo] || '#FF7A29',
              boxShadow: '0 0 4px rgba(0,0,0,0.5)'
            }}
          />
        ))}

        <div
          className="absolute border-2 border-orange-400 bg-orange-500/10 pointer-events-none rounded-sm transition-all duration-75"
          style={{
            left: Math.max(0, viewX),
            top: Math.max(0, viewY),
            width: Math.min(miniMapWidth, viewW),
            height: Math.min(miniMapHeight, viewH)
          }}
        />
      </div>
    </div>
  );
}
