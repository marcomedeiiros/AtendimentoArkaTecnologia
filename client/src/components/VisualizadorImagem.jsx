/**
 * VISUALIZADOR DE IMAGEM em tela cheia -- com zoom, arraste e download.
 *
 * Nasceu na Central, para as fotos que o cliente manda, e substituiu um
 * `window.open()`: os navegadores bloqueiam navegação para `data:` URLs (que é o
 * formato em que a mídia chega da Evolution), então o clique simplesmente não
 * fazia nada.
 *
 * ── POR QUE ELE VIROU UM ARQUIVO PRÓPRIO ───────────────────────────────────
 *
 * Ele vivia dentro do AtendimentoView, e por isso os Relatos de Bugs tinham o
 * seu próprio "lightbox": um `<img>` com `max-h-[85dvh] object-contain` e mais
 * nada. Funcionava para ver que existe um print, e não para LER o print -- que é
 * o motivo de alguém anexar uma captura de tela num relato de bug. Uma captura
 * de 1920px encolhida para caber na altura da janela fica com o texto ilegível, e
 * não havia zoom, nem arraste, nem download.
 *
 * Duas telas mostrando imagem, duas implementações, uma delas incompleta. Agora
 * é uma.
 *
 * Zoom: roda do mouse, botões, `+`/`-`, duplo clique, e `0` para voltar ao
 * original. Acima de 100% o cursor vira mãozinha e a imagem se arrasta.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { ZoomIn, ZoomOut, Maximize2, Download, X } from 'lucide-react';
import Portal from './Portal';

export default function VisualizadorImagem({ url, legenda, nomeArquivo, onFechar }) {
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const arrastando = useRef(null);

  const ajustarZoom = useCallback((delta) => {
    setZoom(z => {
      const novo = Math.min(Math.max(z + delta, 1), 6);
      // Voltou ao tamanho original: recentraliza. Sem isto a imagem ficaria
      // deslocada e sem como arrastar de volta (o arraste exige zoom > 1).
      if (novo === 1) setPos({ x: 0, y: 0 });
      return novo;
    });
  }, []);

  useEffect(() => {
    const onTecla = (e) => {
      if (e.key === 'Escape') onFechar();
      if (e.key === '+' || e.key === '=') ajustarZoom(0.4);
      if (e.key === '-') ajustarZoom(-0.4);
      if (e.key === '0') { setZoom(1); setPos({ x: 0, y: 0 }); }
    };
    window.addEventListener('keydown', onTecla);
    return () => window.removeEventListener('keydown', onTecla);
  }, [onFechar, ajustarZoom]);

  const aoRolar = (e) => { e.preventDefault(); ajustarZoom(e.deltaY < 0 ? 0.3 : -0.3); };

  const iniciarArraste = (e) => {
    if (zoom <= 1) return;
    arrastando.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
  };
  const moverArraste = (e) => {
    if (!arrastando.current) return;
    setPos({ x: e.clientX - arrastando.current.x, y: e.clientY - arrastando.current.y });
  };
  const pararArraste = () => { arrastando.current = null; };

  const btn = 'p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-200 transition-colors disabled:opacity-40';

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[60] bg-slate-950/95 backdrop-blur-sm flex flex-col"
        onMouseMove={moverArraste}
        onMouseUp={pararArraste}
        onMouseLeave={pararArraste}
      >
        <div className="shrink-0 flex items-center justify-between gap-3 p-3 bg-grafite-800/90 border-b border-linha">
          <span className="text-xs text-slate-300 font-semibold truncate min-w-0">
            {nomeArquivo || legenda || 'Imagem'}
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={() => ajustarZoom(-0.4)} disabled={zoom <= 1} className={btn} title="Diminuir (-)">
              <ZoomOut size={16} />
            </button>
            <span className="text-[11px] text-slate-400 font-mono w-12 text-center">{Math.round(zoom * 100)}%</span>
            <button onClick={() => ajustarZoom(0.4)} disabled={zoom >= 6} className={btn} title="Aumentar (+)">
              <ZoomIn size={16} />
            </button>
            <button onClick={() => { setZoom(1); setPos({ x: 0, y: 0 }); }} className={btn} title="Tamanho original (0)">
              <Maximize2 size={16} />
            </button>
            <a href={url} download={nomeArquivo || 'imagem.jpg'} className={btn} title="Baixar">
              <Download size={16} />
            </a>
            <button onClick={onFechar} className={btn} title="Fechar (Esc)">
              <X size={16} />
            </button>
          </div>
        </div>

        <div
          className="flex-1 overflow-hidden flex items-center justify-center p-4"
          onWheel={aoRolar}
          onClick={e => { if (e.target === e.currentTarget) onFechar(); }}
        >
          <img
            src={url}
            alt={legenda || 'imagem'}
            draggable={false}
            onMouseDown={iniciarArraste}
            onDoubleClick={() => (zoom > 1 ? (setZoom(1), setPos({ x: 0, y: 0 })) : ajustarZoom(1))}
            style={{
              transform: `translate(${pos.x}px, ${pos.y}px) scale(${zoom})`,
              cursor: zoom > 1 ? (arrastando.current ? 'grabbing' : 'grab') : 'zoom-in',
              transition: arrastando.current ? 'none' : 'transform 0.15s ease-out'
            }}
            className="max-w-full max-h-full object-contain select-none"
          />
        </div>

        {legenda && (
          <div className="shrink-0 p-3 bg-grafite-800/90 border-t border-linha text-xs text-slate-300 text-center">
            {legenda}
          </div>
        )}
      </div>
    </Portal>
  );
}
