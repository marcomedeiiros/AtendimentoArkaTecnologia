/**
 * Utilitário para formatação segura de assinaturas de mensagens de texto.
 *
 * Defesa em profundidade:
 * 1. NUNCA duplica assinatura se o texto já possui o nome do operador no início, no meio ou no fim.
 * 2. Normaliza quebras de linha e higieniza espaços.
 *
 * ONDE SE APLICA: em tudo que o atendente ESCREVE -- mensagem de texto, primeira
 * mensagem de uma conversa nova e a LEGENDA de imagem/vídeo/documento (o que
 * cobre também a mensagem rápida com anexo, cujo texto vira legenda).
 *
 * A única exceção é o ÁUDIO, e não por esquecimento: áudio não tem legenda no
 * WhatsApp, e o servidor zera `caption` para ele em `enviarMidia`. Assinar ali
 * criaria um texto que ninguém veria.
 */

/**
 * Assinatura da LEGENDA de uma mídia.
 *
 * Difere de `formatarComAssinatura` num ponto só, e é justamente o caso comum:
 * **mídia sem texto**. Mandar um print sem escrever nada é normal -- e era aí
 * que a assinatura sumia, porque texto vazio devolve vazio (numa mensagem de
 * texto, "só o nome" seria uma mensagem sem conteúdo; numa foto, é a legenda
 * correta). Quem manda a foto continua sendo alguém, e o cliente precisa saber
 * com quem está falando.
 *
 * Não se aplica a áudio: áudio não tem legenda no WhatsApp -- ver o cabeçalho.
 */
export function formatarLegendaComAssinatura(texto, assinar, nome) {
  const comTexto = formatarComAssinatura(texto, assinar, nome);
  if (comTexto) return comTexto;
  const nomeLimpo = typeof nome === 'string' ? nome.trim() : '';
  return assinar && nomeLimpo ? `*${nomeLimpo}*` : '';
}

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
