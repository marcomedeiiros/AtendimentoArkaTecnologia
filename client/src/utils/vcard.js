/**
 * Leitura do cartão de contato que o cliente ENCAMINHA pelo WhatsApp.
 *
 * O WhatsApp manda o contato como um vCard cru dentro da mensagem, e é isso que
 * fica guardado em `midia.vcard`. Sem interpretar esse texto, o cartão na bolha
 * era só um rótulo: dava para ler "Arlene Avocado" e nada mais -- para falar com
 * essa pessoa o atendente tinha que abrir o WhatsApp no celular, copiar o número
 * na mão e voltar para digitar em "Nova conversa".
 *
 * ── DE ONDE SAI O NÚMERO ───────────────────────────────────────────────────
 *
 * Uma linha TEL do WhatsApp costuma vir assim:
 *
 *   TEL;type=CELL;type=VOICE;waid=5527999990000:+55 27 99999-0000
 *
 * O `waid` é o identificador da conta NO WHATSAPP -- já vem com DDI, sem
 * máscara e sem ambiguidade. Por isso ele tem preferência sobre o valor depois
 * dos dois-pontos, que é texto livre digitado por quem salvou o contato e pode
 * vir sem DDD, com ramal, ou escrito de qualquer jeito.
 *
 * Quando não há `waid` (contato salvo na agenda que NÃO usa WhatsApp), caímos
 * no número escrito. Ele pode não existir no WhatsApp -- e é o servidor, no
 * envio, que descobre isso; aqui não temos como saber.
 */

// Junta as linhas dobradas do vCard. Pelo padrão, uma linha longa pode ser
// quebrada e continuada na seguinte iniciada por espaço/tab -- e um `waid`
// partido no meio viraria um número truncado.
function desdobrar(bruto) {
  return String(bruto || '').replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '');
}

// 10 a 13 dígitos: DDD + número (10-11) ou com o DDI 55 na frente (12-13). É a
// mesma faixa que o modal de conversa nova aceita -- fora dela não é telefone
// brasileiro discável, e mandar assim mesmo só produziria erro no envio.
function telefoneValido(digitos) {
  return [10, 11, 12, 13].includes(digitos.length);
}

/**
 * Extrai `{ nome, telefone }` de um vCard. Devolve `null` quando não dá para
 * chegar num número discável -- e aí a tela não oferece o botão de conversar,
 * em vez de oferecer um botão que falha.
 */
export function contatoDoVcard(vcard, nomeAlternativo = '') {
  const texto = desdobrar(vcard);
  const linhas = texto.split('\n');

  let nome = '';
  let porWaid = '';
  let porTexto = '';

  for (const linha of linhas) {
    const sep = linha.indexOf(':');
    if (sep < 0) continue;
    const cabecalho = linha.slice(0, sep);
    const valor = linha.slice(sep + 1).trim();
    // "item1.TEL;waid=..." -> a propriedade é a última parte antes do ";".
    const propriedade = cabecalho.split(';')[0].split('.').pop().toUpperCase();

    if (propriedade === 'FN' && !nome) {
      nome = valor;
      continue;
    }
    if (propriedade !== 'TEL') continue;

    const waid = /waid=(\d+)/i.exec(cabecalho)?.[1] || '';
    // O primeiro TEL com waid ganha; guardamos o texto do primeiro TEL como
    // reserva para o caso de nenhum ter waid.
    if (waid && !porWaid && telefoneValido(waid)) porWaid = waid;
    if (!porTexto) {
      const digitos = valor.replace(/\D/g, '');
      if (telefoneValido(digitos)) porTexto = digitos;
    }
  }

  const telefone = porWaid || porTexto;
  if (!telefone) return null;

  return {
    nome: nome || String(nomeAlternativo || '').trim(),
    telefone,
    // O contato está no WhatsApp? Só o `waid` responde isso. Serve para a tela
    // avisar antes do clique em vez de deixar o envio falhar sem explicação.
    temWhatsApp: !!porWaid,
  };
}
