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

const ARQUIVO_WALLPAPER = '/wallpaper.svg';

// O veu e um seguro de legibilidade, nao a fonte da discricao: o wallpaper do
// WhatsApp ja vem com o traco bem claro. Um veu alto (0.9) sobre uma imagem que
// ja e suave simplesmente apaga o desenho.
//   0.15 - 0.25  imagem ja discreta (caso do wallpaper do WhatsApp)
//   0.60 - 0.90  imagem com contraste alto, que atrapalharia a leitura
const VEU = 0.2;

// Lado do tile em px. Use 'auto' para respeitar o tamanho real da imagem.
const TAMANHO_TILE = '360px';

// Cor do chat. Fica por tras enquanto a imagem carrega (sem "flash" escuro) e
// tambem e a cor do veu.
export const COR_FUNDO_CHAT = '#EFEAE2';

const veu = `rgba(239, 234, 226, ${VEU})`;

export const wallpaperStyle = {
  backgroundColor: COR_FUNDO_CHAT,
  // 1a camada: veu liso. 2a camada: o padrao repetido.
  backgroundImage: `linear-gradient(${veu}, ${veu}), url("${ARQUIVO_WALLPAPER}")`,
  backgroundRepeat: 'no-repeat, repeat',
  backgroundSize: `cover, ${TAMANHO_TILE} ${TAMANHO_TILE}`,
  backgroundPosition: 'center, center',
};

export default wallpaperStyle;
