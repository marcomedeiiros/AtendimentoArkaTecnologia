/**
 * Papel de parede da area de conversas (estilo WhatsApp).
 *
 * === Como trocar a imagem ===
 * 1. Salve o arquivo em `client/public/` (ex.: wallpaper.jpg)
 * 2. Ajuste ARQUIVO_WALLPAPER e COR_FUNDO_CHAT abaixo.
 * Como fica em `public/`, o Vite serve direto: nao precisa recompilar nem
 * importar o arquivo em lugar nenhum.
 *
 * === Por que a largura do tile e nao um quadrado ===
 * A arte do WhatsApp e uma imagem de tela de celular (1080x1920, retrato).
 * Forcar um tile quadrado -- como `360px 360px` -- espremia os 1920px de altura
 * dentro de 360, achatando todos os doodles. Aqui definimos so a LARGURA e
 * deixamos a altura em `auto`, entao a proporcao 9:16 e preservada.
 *
 * O valor de LARGURA_TILE reproduz a escala que a arte tem no celular: uma tela
 * de ~400px de CSS mostra a imagem de 1080px inteira, ou seja, os desenhos
 * aparecem a cerca de 1/2,7 do tamanho do arquivo.
 */

const ARQUIVO_WALLPAPER = '/whatsapp-bg-dark.png';

// Largura de cada repeticao. Altura fica em `auto` para nao distorcer.
// Menor = doodles menores e mais densos.
const LARGURA_TILE = '400px';

// Veu translucido por cima do padrao. DESLIGADO (0)
const VEU = 0;

// Cor lisa do fundo da imagem
const COR_FUNDO_CHAT = '#0b141a';

const veu = COR_FUNDO_CHAT + Math.round(VEU * 255).toString(16).padStart(2, '0');
const padrao = `url("${ARQUIVO_WALLPAPER}")`;

// Com VEU em 0 a camada nem entra: a imagem vai pura para a tela, sem um
// gradiente transparente por cima so ocupando lugar.
export const wallpaperStyle = VEU > 0
  ? {
      backgroundColor: COR_FUNDO_CHAT,
      // 1a camada: veu liso. 2a camada: o padrao repetido.
      backgroundImage: `linear-gradient(${veu}, ${veu}), ${padrao}`,
      backgroundRepeat: 'no-repeat, repeat',
      backgroundSize: `cover, ${LARGURA_TILE} auto`,
      backgroundPosition: 'center, top center',
    }
  : {
      backgroundColor: COR_FUNDO_CHAT,
      backgroundImage: padrao,
      backgroundRepeat: 'repeat',
      backgroundSize: `${LARGURA_TILE} auto`,
      backgroundPosition: 'top center',
    };

export default wallpaperStyle;
