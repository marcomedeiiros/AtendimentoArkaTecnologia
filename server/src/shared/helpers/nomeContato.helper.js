/**
 * NOME DE CONTATO VINDO DA AGENDA DO WHATSAPP -- e por que ele precisa de
 * faxina.
 *
 * ── O QUE CHEGA ────────────────────────────────────────────────────────────
 *
 * Muita gente salva contato no celular colando o numero na frente do nome:
 *
 *     "27999724004 João S.Damace"
 *     "+55 27 99972-4004 - Maria (financeiro)"
 *     "João S.Damace 27999724004"
 *
 * A Evolution devolve esse texto exatamente como esta no aparelho, e ele ia
 * cru para a agenda da Central. Resultado: a lista mostrava o numero DUAS
 * vezes -- uma dentro do nome e outra na linha do telefone, logo abaixo -- e a
 * ordenacao alfabetica jogava essas pessoas todas para o comeco, agrupadas
 * pelo digito, longe do proprio nome.
 *
 * ── O QUE ESTA FUNCAO NAO FAZ ──────────────────────────────────────────────
 *
 * Nao inventa nome. Se depois de tirar o numero nao sobrar letra nenhuma, o
 * retorno e `null` e quem chama decide -- na sincronizacao, o proprio telefone
 * vira o rotulo, que e o comportamento que ja existia para contato sem nome.
 *
 * Nao mexe em numero DENTRO do nome que nao seja telefone: "Loja 2",
 * "Suporte 24h" e "Sala 101" passam intactos. O corte exige uma sequencia de
 * 8 digitos ou mais -- abaixo disso nao e telefone, e cortar seria perder
 * informacao de verdade.
 */

// Um pedaco "telefone": 8 a 15 digitos, aceitando +, espaco, ponto, hifen e
// parenteses no meio. 8 e o piso porque telefone fixo sem DDD tem 8 digitos;
// com menos, e numero de casa, de loja ou de sala.
// O `(` no inicio nao e enfeite: "(27) 99972-4004 Pedro" e uma das formas mais
// comuns de salvar, e sem ele o pedaco nao casava e o numero ficava no nome.
// Abrir para `(` e seguro por causa da peneira de 8 digitos logo abaixo --
// "(financeiro) João" nao tem digito nenhum e passa intacto.
const PEDACO_TELEFONE = String.raw`\+?[(\d][\d\s().-]{6,20}\d`;

function contaDigitos(s) {
  return (String(s).match(/\d/g) || []).length;
}

// Sobrou alguma LETRA? E o que separa "nome de gente" de "so numero e sinal".
function temLetra(s) {
  return /\p{L}/u.test(String(s));
}

/**
 * Devolve o nome sem o telefone colado, ou `null` quando nao sobra nome.
 *
 * @param {string} bruto  o texto como veio da agenda do WhatsApp
 * @returns {string|null}
 */
function limparNomeContato(bruto) {
  let nome = String(bruto || "").trim();
  if (!nome) return null;

  // So numero (com ou sem mascara): nao ha nome aqui para preservar.
  if (!temLetra(nome)) return null;

  const inicio = new RegExp(`^\\s*${PEDACO_TELEFONE}\\s*`);
  const fim = new RegExp(`\\s*${PEDACO_TELEFONE}\\s*$`);

  for (const regex of [inicio, fim]) {
    const achado = nome.match(regex);
    // `contaDigitos` como segunda peneira: a expressao aceita pontuacao no
    // meio, entao "S.Damace" poderia casar em teoria -- mas nao tem 8 digitos.
    if (achado && contaDigitos(achado[0]) >= 8) {
      const restante = nome.replace(regex, "").trim();
      if (temLetra(restante)) nome = restante;
    }
  }

  // Sobras de separador que ficavam entre o numero e o nome ("- João", "| Ana").
  nome = nome.replace(/^[\s\-–—|/,.:]+/, "").replace(/[\s\-–—|/,.:]+$/, "").trim();

  return temLetra(nome) ? nome : null;
}

module.exports = { limparNomeContato };
