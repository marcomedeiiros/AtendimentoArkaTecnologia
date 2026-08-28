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
 *
 * ── O FORMATO, E POR QUE ELE É ASSIM ──────────────────────────────────────
 *
 *     > *Marco*
 *     texto da mensagem
 *
 * São duas marcações do WhatsApp, e nenhuma é Markdown:
 *
 *   `*nome*`  negrito. UM asterisco de cada lado. Com dois (`**nome**`), o
 *             WhatsApp não reconhece a marcação e mostra os asteriscos como
 *             texto -- foi exatamente o defeito relatado.
 *   `> `      citação. Deixa a assinatura num bloco recuado, separada do corpo
 *             da mensagem, em vez de parecer a primeira linha do que se disse.
 *
 * Isso vale para o WhatsApp, não para a tela do painel: a Central mostra o
 * texto cru, então lá a assinatura aparece literalmente como `> *Marco*`.
 */

// Marcação que o WhatsApp usa. Ficam em constantes porque aparecem tanto na
// ESCRITA quanto nas expressões que DETECTAM assinatura já existente -- e as
// duas coisas precisam concordar, senão reenviar um texto assinado duplica.
const NEGRITO = '*';
const CITACAO = '> ';

/**
 * Limpa o nome antes de embrulhar.
 *
 * Quem preenche o campo de assinatura no perfil costuma digitar a marcação
 * junto (`*Marco*`, `> Marco`), porque é assim que ela aparece no WhatsApp. Se
 * o código embrulhar por cima, sai `**Marco**` -- que o WhatsApp mostra com os
 * asteriscos à mostra. Era essa a origem do defeito, e não a formatação em si.
 *
 * Também tira `:` no fim ("Marco:"), que é outro jeito comum de escrever.
 */
function nomeNormalizado(nome) {
  return String(nome || '')
    .trim()
    .replace(/^>+\s*/, '')      // citação digitada à mão
    .replace(/^\*+|\*+$/g, '')  // asteriscos de negrito, quantos forem
    .replace(/:+$/, '')         // dois-pontos no fim
    .trim();
}

/** A assinatura pronta, como o WhatsApp espera. */
function assinaturaDe(nome) {
  return `${CITACAO}${NEGRITO}${nome}${NEGRITO}`;
}

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
  const nomeLimpo = nomeNormalizado(nome);
  return assinar && nomeLimpo ? assinaturaDe(nomeLimpo) : '';
}

export function formatarComAssinatura(texto, assinar, nome) {
  if (typeof texto !== 'string') return '';
  const limpo = texto.trim();
  if (!limpo) return '';

  const nomeLimpo = nomeNormalizado(nome);
  if (!assinar || !nomeLimpo) return limpo;

  // Escapar caracteres especiais para uso seguro em RegExp
  const nomeEscapado = nomeLimpo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Trecho que reconhece uma assinatura já escrita, em QUALQUER das formas que
  // já circularam: com ou sem `> `, com um ou mais asteriscos de cada lado, com
  // ou sem `:` no fim. Tolerar as variantes antigas é o que impede a mensagem
  // reenviada de acumular assinaturas quando o formato muda.
  const ASSINATURA = `>?\\s*\\*{0,2}\\s*${nomeEscapado}\\s*\\*{0,2}:?`;

  // Caso 1: O texto é exatamente o nome
  if (new RegExp(`^${ASSINATURA}$`, 'i').test(limpo)) {
    return assinaturaDe(nomeLimpo);
  }

  let corpo = limpo;

  // Caso 2: Remove assinaturas existentes no início
  const regexInicio = new RegExp(`^${ASSINATURA}\\s*\\n+`, 'i');
  while (regexInicio.test(corpo)) {
    corpo = corpo.replace(regexInicio, '').trim();
  }

  // Caso 3: Remove assinaturas existentes no rodapé
  const regexFim = new RegExp(
    `(?:\\n+|^\\s*)(?:(?:atenciosamente|att\\.?|cordialmente|abraços?|grato|obrigado)\\s*,?\\s*\\n*)?${ASSINATURA}\\s*$`,
    'i'
  );
  while (regexFim.test(corpo)) {
    corpo = corpo.replace(regexFim, '').trim();
  }

  // Caso 4: Remove assinaturas isoladas em linhas intermediárias
  const regexMeio = new RegExp(`\\n+${ASSINATURA}\\s*\\n+`, 'gi');
  corpo = corpo.replace(regexMeio, '\n\n').trim();

  if (!corpo) {
    return assinaturaDe(nomeLimpo);
  }

  return `${assinaturaDe(nomeLimpo)}\n${corpo}`;
}
