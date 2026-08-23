/**
 * Utilitário para formatação segura de assinaturas de mensagens de texto.
 *
 * Defesa em profundidade:
 * 1. NUNCA duplica assinatura se o texto já possui o nome do operador no início, no meio ou no fim.
 * 2. Mídias (imagem, vídeo, áudio, documentos) NÃO levam assinatura automática.
 * 3. Normaliza quebras de linha e higieniza espaços.
 */

export function formatarComAssinatura(texto, assinar, nome) {
  if (typeof texto !== 'string') return '';
  const limpo = texto.trim();
  if (!limpo) return '';
  if (!assinar || !nome || !nome.trim()) return limpo;

  const nomeLimpo = nome.trim();
  // Escapar caracteres especiais para uso seguro em RegExp
  const nomeEscapado = nomeLimpo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Caso 1: O texto é exatamente o nome
  const regexExato = new RegExp(`^\\*?\\s*${nomeEscapado}\\s*\\*?:?$`, 'i');
  if (regexExato.test(limpo)) {
    return `*${nomeLimpo}*`;
  }

  let corpo = limpo;

  // Caso 2: Remove assinaturas existentes no início
  const regexInicio = new RegExp(`^\\*?\\s*${nomeEscapado}\\s*\\*?:?\\s*\\n+`, 'i');
  while (regexInicio.test(corpo)) {
    corpo = corpo.replace(regexInicio, '').trim();
  }

  // Caso 3: Remove assinaturas existentes no rodapé
  const regexFim = new RegExp(
    `(?:\\n+|^\\s*)(?:(?:atenciosamente|att\\.?|cordialmente|abraços?|grato|obrigado)\\s*,?\\s*\\n*)?\\*?\\s*${nomeEscapado}\\s*\\*?\\s*$`,
    'i'
  );
  while (regexFim.test(corpo)) {
    corpo = corpo.replace(regexFim, '').trim();
  }

  // Caso 4: Remove assinaturas isoladas em linhas intermediárias
  const regexMeio = new RegExp(`\\n+\\*?\\s*${nomeEscapado}\\s*\\*?:?\\s*\\n+`, 'gi');
  corpo = corpo.replace(regexMeio, '\n\n').trim();

  if (!corpo) {
    return `*${nomeLimpo}*`;
  }

  return `*${nomeLimpo}*\n${corpo}`;
}
