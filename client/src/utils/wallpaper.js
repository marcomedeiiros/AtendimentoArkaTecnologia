/**
 * Papel de parede da area de conversas (estilo WhatsApp).
 *
 * === Como trocar a imagem ===
 * 1. Salve o arquivo em `client/public/` (ex.: wallpaper-whatsapp.png)
 * 2. Ajuste ARQUIVO_WALLPAPER abaixo. Aceita .png, .jpg, .webp ou .svg.
 * Como fica em `public/`, o Vite serve direto: nao precisa recompilar nem
 * importar o arquivo em lugar nenhum.
 *
 * === Como o padrao fica discreto ===
 * Em vez de clarear a imagem num editor, empilhamos DUAS camadas de fundo no
 * mesmo elemento: um veu translucido da cor do chat por cima do padrao.
 * Assim qualquer imagem que voce jogar na pasta ja entra suave, sem editar o
 * arquivo -- e sem precisar de um ::before com z-index, que exigiria mexer na
 * estrutura das mensagens e ainda quebraria dentro de um container que rola.
 *
 * Menos VEU = padrao mais visivel.
 */

const ARQUIVO_WALLPAPER = '/wallpaper.jpg';

// Veu translucido por cima do padrao. DESLIGADO (0): a imagem em uso ja vem no
// tom certo, e qualquer veu so lavava o desenho.
// Se um dia entrar uma imagem contrastada demais, suba para 0.5-0.9 -- em 0 a
// camada nem chega a ser criada.
const VEU = 0;

// Lado do tile em px. Use 'auto' para respeitar o tamanho real da imagem.
const TAMANHO_TILE = '360px';

// Cor do chat. Fica por tras enquanto a imagem carrega (sem "flash" escuro) e
// tambem e a cor do veu.
export const COR_FUNDO_CHAT = '#EFEAE2';

const veu = `rgba(239, 234, 226, ${VEU})`;
const padrao = `url("${ARQUIVO_WALLPAPER}")`;

// Com VEU em 0 a camada nem entra: a imagem vai pura para a tela, sem um
// gradiente transparente por cima so ocupando lugar.
export const wallpaperStyle = VEU > 0
  ? {
      backgroundColor: COR_FUNDO_CHAT,
      // 1a camada: veu liso. 2a camada: o padrao repetido.
      backgroundImage: `linear-gradient(${veu}, ${veu}), ${padrao}`,
      backgroundRepeat: 'no-repeat, repeat',
      backgroundSize: `cover, ${TAMANHO_TILE} ${TAMANHO_TILE}`,
      backgroundPosition: 'center, center',
    }
  : {
      backgroundColor: COR_FUNDO_CHAT,
      backgroundImage: padrao,
      backgroundRepeat: 'repeat',
      backgroundSize: `${TAMANHO_TILE} ${TAMANHO_TILE}`,
      backgroundPosition: 'center',
    };

export default wallpaperStyle;
