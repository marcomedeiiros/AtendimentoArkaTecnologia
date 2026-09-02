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

/**
 * SEPARA A ASSINATURA DO CORPO de uma mensagem JÁ ENVIADA.
 *
 * ── O PROBLEMA QUE ISTO RESOLVE ────────────────────────────────────────────
 *
 * Editar uma mensagem carregava o texto GRAVADO para a caixa -- e o texto
 * gravado começa com a assinatura (`> *Marco Medeiros*`). Resultado: quem ia
 * corrigir uma palavra da frase encontrava o próprio nome editável na primeira
 * linha, e um backspace a mais o apagava, ou o transformava em outro nome. Pior:
 * a mensagem editada ia para o WhatsApp assim, sem assinatura ou assinada com
 * um nome quebrado -- e do lado do cliente aquilo é a identidade de quem
 * atende.
 *
 * A assinatura não é conteúdo da mensagem: é a identificação de quem escreveu.
 * Editar o texto e trocar a autoria são duas ações diferentes, e a segunda se
 * faz no perfil, não numa caixa de mensagem.
 *
 * ── COMO A DETECÇÃO FUNCIONA ───────────────────────────────────────────────
 *
 * Estruturalmente, pela PRIMEIRA linha: `> *qualquer coisa*`. Não compara com o
 * nome do operador logado de propósito -- a mensagem pode ter sido assinada com
 * um nome antigo (a pessoa mudou a assinatura no perfil depois), ou com uma das
 * variantes que já circularam (`> **Nome**`, `> *Nome*:`). Todas continuam
 * sendo preservadas.
 *
 * O falso positivo possível é uma mensagem cuja primeira linha seja uma citação
 * inteira em negrito. Nesse caso ela é preservada em vez de editável -- o dado
 * não se perde, e é o lado errado mais barato.
 *
 * @returns {{assinatura: string, nome: string, corpo: string}}
 */
const LINHA_ASSINATURA = /^>[ \t]*\*{1,2}[ \t]*([^*\n]+?)[ \t]*\*{1,2}:?[ \t]*$/;

export function separarAssinatura(texto) {
  const str = String(texto ?? '');
  const quebra = str.indexOf('\n');
  const primeira = (quebra >= 0 ? str.slice(0, quebra) : str).trim();
  const achado = LINHA_ASSINATURA.exec(primeira);
  if (!achado) return { assinatura: '', nome: '', corpo: str };
  return {
    assinatura: primeira,
    nome: achado[1].trim(),
    // `replace` inicial: a assinatura é separada do corpo por UMA quebra, mas
    // texto colado pode ter linha em branco sobrando -- e ela viraria um recuo
    // fantasma no começo da caixa de edição.
    corpo: quebra >= 0 ? str.slice(quebra + 1).replace(/^\n+/, '') : '',
  };
}

/**
 * Recompõe a mensagem: a assinatura ORIGINAL de volta na frente do corpo editado.
 *
 * Sem passar por `formatarComAssinatura` de propósito -- aquela função decide se
 * deve assinar, com qual nome, e limpa assinaturas repetidas. Aqui não há
 * decisão a tomar: a mensagem já foi enviada assinada, e o que se está editando
 * é só o corpo.
 */
export function juntarAssinatura(assinatura, corpo) {
  const limpo = String(corpo ?? '').trim();
  if (!assinatura) return limpo;
  return limpo ? `${assinatura}\n${limpo}` : assinatura;
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
