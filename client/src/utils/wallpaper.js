/**
 * Papel de parede da area de conversas (estilo WhatsApp).
 *
 * O arquivo fica em `client/public/`, entao e servido direto pelo Vite e pode
 * ser trocado sem recompilar: basta substituir o arquivo e ajustar
 * ARQUIVO_WALLPAPER abaixo (aceita .svg, .png, .jpg).
 *
 * O tamanho do tile e fixo para o padrao nao esticar em telas grandes.
 */

const ARQUIVO_WALLPAPER = '/wallpaper.svg';

// Cor de fundo por tras do padrao. Combina com o tom do wallpaper para que a
// emenda nao apareca enquanto a imagem carrega. E o bege do WhatsApp Web claro.
export const COR_FUNDO_CHAT = '#EFEAE2';

export const wallpaperStyle = {
  backgroundColor: COR_FUNDO_CHAT,
  backgroundImage: `url("${ARQUIVO_WALLPAPER}")`,
  backgroundRepeat: 'repeat',
  backgroundSize: '360px 360px',
};

export default wallpaperStyle;
