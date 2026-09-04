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
import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { ZoomIn, ZoomOut, Maximize2, Download, X, Expand, RotateCcw, RotateCw } from 'lucide-react';
import Portal from './Portal';

export default function VisualizadorMidia({ url, tipo = 'imagem', legenda, nomeArquivo, onFechar }) {
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  // GIRO em graus, sempre multiplo de 90.
  //
  // Existe porque foto de cliente chega deitada o tempo todo: o celular grava a
  // orientacao num campo EXIF que o WhatsApp nem sempre preserva, e o que
  // aparece na Central e a imagem crua. Ate agora a saida era inclinar a cabeca.
  //
  // 90 em 90, e nao um angulo livre: o defeito real e sempre um quarto de volta
  // (retrato gravado como paisagem). Um controle de angulo fino resolveria um
  // problema que nao existe e atrapalharia o que existe.
  const [giro, setGiro] = useState(0);
  const arrastando = useRef(null);
  // O arraste MOVEU de fato? Só serve para vídeo: sem isto, arrastar a imagem do
  // vídeo terminava num clique, e clique em vídeo é play/pause -- a pessoa
  // reposicionava o quadro e o vídeo pausava junto, parecendo defeito.
  const arrastou = useRef(false);
  const midiaRef = useRef(null);
  const areaRef = useRef(null);
  const ehVideo = tipo === 'video';

  // ── POR QUE GIRAR PRECISA MEXER NA ESCALA ─────────────────────────────────
  //
  // O `object-contain` dimensiona a midia ANTES do transform: uma foto deitada
  // entra ocupando toda a largura da tela e pouca altura. Girada 90 graus, a
  // largura vira altura -- e ela passa a ser mais alta que a area disponivel,
  // saindo pelas bordas. A pessoa gira para ler e perde metade da imagem.
  //
  // `ajuste` e o fator que faz a caixa GIRADA caber de novo. So vale nos giros
  // de 1/4 e 3/4 de volta: em 0 e 180 a caixa nao muda de forma.
  //
  // Ele multiplica o zoom em vez de substitui-lo, entao o "100%" que a barra
  // mostra continua sendo o zoom que a pessoa escolheu -- o encaixe e trabalho
  // do componente, nao um numero para o operador administrar.
  const [ajuste, setAjuste] = useState(1);

  const recalcularAjuste = useCallback(() => {
    const el = midiaRef.current;
    const area = areaRef.current;
    if (!el || !area) return;
    const quarto = ((giro % 360) + 360) % 360;
    if (quarto === 0 || quarto === 180) { setAjuste(1); return; }
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const W = area.clientWidth;
    const H = area.clientHeight;
    if (!w || !h || !W || !H) { setAjuste(1); return; }
    // Depois de girar, a caixa passa a medir h x w. Nunca AUMENTA a midia (o
    // teto de 1): girar nao e um jeito escondido de dar zoom.
    setAjuste(Math.min(1, W / h, H / w));
  }, [giro]);

  // `useLayoutEffect`: o ajuste entra no mesmo quadro do giro. Num `useEffect`
  // a imagem apareceria transbordando por um instante antes de encolher.
  useLayoutEffect(() => { recalcularAjuste(); }, [recalcularAjuste]);

  useEffect(() => {
    window.addEventListener('resize', recalcularAjuste);
    return () => window.removeEventListener('resize', recalcularAjuste);
  }, [recalcularAjuste]);

  // Midia nova comeca do zero: o giro da foto anterior nao pode ser herdado
  // pela proxima (o visualizador e reaproveitado sem desmontar em alguns
  // caminhos, como a navegacao entre imagens da conversa).
  useEffect(() => {
    setGiro(0);
    setZoom(1);
    setPos({ x: 0, y: 0 });
  }, [url]);

  const girar = useCallback((graus) => {
    setGiro((g) => g + graus);
    // Recentraliza: o arraste foi feito para a imagem na posicao antiga, e
    // depois de girar aquele deslocamento aponta para outro pedaco da foto.
    setPos({ x: 0, y: 0 });
  }, []);

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
      if (e.key === '0') { setZoom(1); setPos({ x: 0, y: 0 }); setGiro(0); }
      // `r` gira no sentido horario, `Shift+R` no anti-horario -- o mesmo par
      // que os visualizadores de foto usam, para nao ter de reaprender aqui.
      if (e.key === 'r') girar(90);
      if (e.key === 'R') girar(-90);
    };
    window.addEventListener('keydown', onTecla);
    return () => window.removeEventListener('keydown', onTecla);
  }, [onFechar, ajustarZoom, girar]);

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
  //
  // A ORDEM IMPORTA: `translate` fica por FORA para o arraste continuar sendo
  // em coordenadas de tela -- puxar para a direita move para a direita, mesmo
  // com a imagem de cabeça para baixo. Com o translate depois do rotate, os
  // eixos girariam junto e arrastar viraria um quebra-cabeça.
  const estiloMidia = {
    transform: `translate(${pos.x}px, ${pos.y}px) rotate(${giro}deg) scale(${zoom * ajuste})`,
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
            {/* Girar: os dois sentidos, porque a foto pode chegar deitada para
                qualquer lado e ninguem deveria clicar tres vezes para
                desentortar o que estava a um clique no outro sentido. */}
            <button onClick={() => girar(-90)} className={btn} title="Girar à esquerda (Shift+R)">
              <RotateCcw size={16} />
            </button>
            <button onClick={() => girar(90)} className={btn} title="Girar à direita (R)">
              <RotateCw size={16} />
            </button>
            <button
              onClick={() => { setZoom(1); setPos({ x: 0, y: 0 }); setGiro(0); }}
              className={btn}
              title="Tamanho original, sem giro (0)"
            >
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
          ref={areaRef}
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
              // Antes dos metadados o elemento nao tem dimensao, e o encaixe do
              // giro sairia calculado sobre zero.
              onLoadedMetadata={recalcularAjuste}
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
              // Ate a imagem carregar o elemento nao tem largura nem altura, e
              // o encaixe do giro sairia calculado sobre zero.
              onLoad={recalcularAjuste}
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
