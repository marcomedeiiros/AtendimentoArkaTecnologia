/**
 * VISUALIZADOR DE MÍDIA em tela cheia -- imagem OU vídeo, com zoom e arraste.
 *
 * Nasceu na Central, para as fotos que o cliente manda, e substituiu um
 * `window.open()`: os navegadores bloqueiam navegação para `data:` URLs (que é o
 * formato em que a mídia chega da Evolution), então o clique simplesmente não
 * fazia nada.
 *
 * ── POR QUE VÍDEO ENTROU NO MESMO COMPONENTE ───────────────────────────────
 *
 * O vídeo tinha só o player de 260px da bolha e um botão de tela cheia. Tela
 * cheia resolve "quero ver grande", e não resolve "quero ler o que está escrito
 * naquele canto da tela gravada" -- que é o caso real: o cliente grava a tela do
 * sistema dele e a mensagem de erro fica num quadradinho. Para isso precisa de
 * zoom, e zoom é exatamente o que a imagem já tinha.
 *
 * O zoom, o arraste, os atalhos e a moldura são idênticos nos dois tipos, então
 * duplicar tudo para trocar `<img>` por `<video>` seria criar duas
 * implementações destinadas a divergir. O que muda por tipo está isolado em dois
 * lugares: o elemento renderizado e o botão extra de tela cheia (que só o vídeo
 * tem, porque só ele tem controles nativos que valem a pena ampliar).
 *
 * Zoom: roda do mouse, botões, `+`/`-`, duplo clique, e `0` para voltar ao
 * original. Acima de 100% o cursor vira mãozinha e a mídia se arrasta.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { ZoomIn, ZoomOut, Maximize2, Download, X, Expand } from 'lucide-react';
import Portal from './Portal';

export default function VisualizadorMidia({ url, tipo = 'imagem', legenda, nomeArquivo, onFechar }) {
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const arrastando = useRef(null);
  // O arraste MOVEU de fato? Só serve para vídeo: sem isto, arrastar a imagem do
  // vídeo terminava num clique, e clique em vídeo é play/pause -- a pessoa
  // reposicionava o quadro e o vídeo pausava junto, parecendo defeito.
  const arrastou = useRef(false);
  const midiaRef = useRef(null);
  const ehVideo = tipo === 'video';

  const ajustarZoom = useCallback((delta) => {
    setZoom(z => {
      const novo = Math.min(Math.max(z + delta, 1), 6);
      // Voltou ao tamanho original: recentraliza. Sem isto a mídia ficaria
      // deslocada e sem como arrastar de volta (o arraste exige zoom > 1).
      if (novo === 1) setPos({ x: 0, y: 0 });
      return novo;
    });
  }, []);

  useEffect(() => {
    const onTecla = (e) => {
      // Digitando não conta: o vídeo tem controles nativos que respondem a
      // teclado (espaço, setas) e não podem competir com os atalhos daqui.
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
    arrastou.current = false;
    arrastando.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
  };
  const moverArraste = (e) => {
    if (!arrastando.current) return;
    arrastou.current = true;
    setPos({ x: e.clientX - arrastando.current.x, y: e.clientY - arrastando.current.y });
  };
  const pararArraste = () => { arrastando.current = null; };

  // Tela cheia de verdade (só vídeo): é onde os controles nativos ficam grandes e
  // a barra de progresso dá para acertar com o dedo.
  const telaCheia = () => {
    const v = midiaRef.current;
    if (!v) return;
    if (v.requestFullscreen) v.requestFullscreen();
    else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen(); // iOS Safari
    else if (v.webkitRequestFullscreen) v.webkitRequestFullscreen();
  };

  const btn = 'p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-200 transition-colors disabled:opacity-40';

  // O mesmo transform nos dois tipos -- é o que faz o zoom ser um só.
  const estiloMidia = {
    transform: `translate(${pos.x}px, ${pos.y}px) scale(${zoom})`,
    cursor: zoom > 1 ? (arrastando.current ? 'grabbing' : 'grab') : (ehVideo ? 'default' : 'zoom-in'),
    transition: arrastando.current ? 'none' : 'transform 0.15s ease-out',
  };

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
            {nomeArquivo || legenda || (ehVideo ? 'Vídeo' : 'Imagem')}
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
            {ehVideo && (
              <button onClick={telaCheia} className={btn} title="Tela cheia (controles grandes)">
                <Expand size={16} />
              </button>
            )}
            <a href={url} download={nomeArquivo || (ehVideo ? 'video.mp4' : 'imagem.jpg')} className={btn} title="Baixar">
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
          {ehVideo ? (
            <video
              ref={midiaRef}
              src={url}
              controls
              playsInline
              preload="metadata"
              controlsList="nodownload"
              onMouseDown={iniciarArraste}
              // Engole o clique que veio de um arraste: senão reposicionar o
              // quadro pausaria o vídeo (ver `arrastou`).
              onClick={e => { if (arrastou.current) { e.preventDefault(); e.stopPropagation(); arrastou.current = false; } }}
              onDoubleClick={() => (zoom > 1 ? (setZoom(1), setPos({ x: 0, y: 0 })) : ajustarZoom(1))}
              style={estiloMidia}
              className="max-w-full max-h-full object-contain bg-black select-none"
            />
          ) : (
            <img
              ref={midiaRef}
              src={url}
              alt={legenda || 'imagem'}
              draggable={false}
              onMouseDown={iniciarArraste}
              onDoubleClick={() => (zoom > 1 ? (setZoom(1), setPos({ x: 0, y: 0 })) : ajustarZoom(1))}
              style={estiloMidia}
              className="max-w-full max-h-full object-contain select-none"
            />
          )}
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
