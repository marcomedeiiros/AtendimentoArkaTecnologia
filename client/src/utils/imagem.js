/**
 * Regras de anexo de imagem, espelhando o servidor.
 *
 * Quem barra de verdade é o back-end (`shared/helpers/imagemSegura.helper.js`:
 * whitelist raster, magic bytes após decodificar, teto de bytes, reserialização).
 * Isto aqui é conveniência de tela — recusar cedo e explicar o motivo, em vez de
 * subir 8 MB para receber um 400.
 *
 * Existe como util compartilhado porque agora DOIS lugares anexam print (o botão
 * flutuante de reportar e a edição do relato na tela de Bugs). Com uma cópia em
 * cada, os limites divergiriam do servidor no primeiro ajuste.
 */

// Espelha bug.imagens.js (MAX_IMAGENS / MAX_BYTES_POR_IMAGEM).
export const MAX_IMAGENS = 3;
export const MAX_BYTES = 3 * 1024 * 1024;

// SVG fica FORA de propósito: pode carregar <script> e virar XSS ao ser aberto.
// O servidor recusa igual — isto só evita a viagem inútil.
export const TIPOS_ACEITOS = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
export const ACCEPT_ATTR = TIPOS_ACEITOS.join(',');

export function lerComoDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Valida uma lista de File contra tipo, tamanho e vagas restantes.
 * Devolve { novas: [{ id, dataUrl }], erro } — `erro` é a primeira recusa, para
 * a tela poder dizer o motivo sem esconder as que passaram.
 */
export async function prepararImagens(files, jaAnexadas = 0) {
  const lista = Array.from(files || []).filter(Boolean);
  const novas = [];
  let erro = '';
  let restantes = MAX_IMAGENS - jaAnexadas;

  if (lista.length === 0) return { novas, erro };
  if (restantes <= 0) return { novas, erro: `Você pode anexar no máximo ${MAX_IMAGENS} imagens.` };

  for (const file of lista) {
    if (restantes <= 0) {
      erro = erro || `Você pode anexar no máximo ${MAX_IMAGENS} imagens.`;
      break;
    }
    if (!TIPOS_ACEITOS.includes(file.type)) {
      erro = erro || 'Só são aceitas imagens PNG, JPEG, WebP ou GIF.';
      continue;
    }
    if (file.size > MAX_BYTES) {
      erro = erro || 'Cada imagem deve ter no máximo 3 MB.';
      continue;
    }
    try {
      const dataUrl = await lerComoDataUrl(file);
      novas.push({ id: `${file.name}-${file.size}-${Date.now()}-${novas.length}`, dataUrl });
      restantes -= 1;
    } catch {
      erro = erro || 'Não foi possível ler uma das imagens.';
    }
  }

  return { novas, erro };
}
