/**
 * Utilitário para formatação segura de assinaturas de mensagens (texto e mídias).
 *
 * Defesa em profundidade:
 * 1. NUNCA duplica assinatura se o texto já possui o nome do operador no início ou no fim.
 * 2. NUNCA assina áudio (áudios no WhatsApp não possuem legenda/texto).
 * 3. Normaliza espaços e quebras de linha para evitar poluição visual.
 */

export function formatarComAssinatura(texto, assinar, nome) {
  if (typeof texto !== 'string') return '';
  const limpo = texto.trim();
  if (!limpo) return '';
  if (!assinar || !nome || !nome.trim()) return limpo;

  const nomeLimpo = nome.trim();
  // Escapar caracteres especiais para uso seguro em RegExp
  const nomeEscapado = nomeLimpo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Caso 1: O texto é exatamente o nome (com ou sem asteriscos, espaços ou dois pontos)
  // Ex: "Marco Medeiros" ou "*Marco Medeiros*" ou "*Marco Medeiros*:"
  const regexExato = new RegExp(`^\\*?\\s*${nomeEscapado}\\s*\\*?:?$`, 'i');
  if (regexExato.test(limpo)) {
    return `*${nomeLimpo}*`;
  }

  let corpo = limpo;

  // Caso 2: O texto já começa com a assinatura no topo
  // Ex: "*Marco Medeiros*\nOlá" ou "Marco Medeiros:\nOlá" ou "*Marco Medeiros*:\nOlá"
  const regexInicio = new RegExp(`^\\*?\\s*${nomeEscapado}\\s*\\*?:?\\s*\\n+`, 'i');
  if (regexInicio.test(corpo)) {
    corpo = corpo.replace(regexInicio, '').trim();
  }

  // Caso 3: O texto termina com a assinatura no rodapé (ex: mensagens rápidas com assinatura manual)
  // Ex: "Olá\n\nMarco Medeiros" ou "Olá\n*Marco Medeiros*" ou "Olá\nAtt,\nMarco Medeiros"
  const regexFim = new RegExp(
    `(?:\\n+|^\\s*)(?:(?:atenciosamente|att\\.?|cordialmente|abraços?|grato|obrigado)\\s*,?\\s*\\n*)?\\*?\\s*${nomeEscapado}\\s*\\*?\\s*$`,
    'i'
  );
  if (regexFim.test(corpo)) {
    corpo = corpo.replace(regexFim, '').trim();
  }

  // Se após remover duplicatas o corpo ficou vazio
  if (!corpo) {
    return `*${nomeLimpo}*`;
  }

  // Retorna a assinatura padronizada única no topo
  return `*${nomeLimpo}*\n${corpo}`;
}
