/**
 * CPF ou CNPJ -- a validação e a máscara, num lugar só.
 *
 * Isto nasceu de uma duplicata: `limparCnpj`, `mascararCnpj` e `cnpjValido`
 * existiam ESCRITOS DUAS VEZES, em ParceirosPage e em AtendimentoView, com as
 * mesmas regras copiadas. Enquanto ninguém mexia, ninguém percebia. Na hora de
 * aceitar CPF ao lado do CNPJ ficou claro o preço: a mesma mudança teria de ser
 * feita duas vezes, e a primeira tela que alguém esquecesse passaria a recusar
 * um documento que a outra aceita -- com o servidor concordando com a segunda.
 *
 * ── POR QUE O TAMANHO BASTA PARA SABER O TIPO ──────────────────────────────
 *
 * 11 dígitos é CPF, 14 é CNPJ, e não existe sobreposição. Por isso não há campo
 * de "tipo de documento" para o operador escolher (nem para ele errar): o
 * número diz o que é. Um valor com qualquer outro tamanho não é nem um nem
 * outro, e a máscara devolve só os dígitos em vez de pontuar no formato errado
 * -- número pontuado errado passa a impressão de que o sistema entendeu.
 *
 * As regras aqui são as mesmas de `server/src/shared/helpers/cnpj.helper.js`.
 * Duas implementações da mesma conta é o preço de o painel validar antes de
 * enviar; quem decide continua sendo o servidor, e é lá que a regra vale.
 */

export function limparDocumento(valor) {
  return String(valor || '').replace(/\D/g, '');
}

export function cpfValido(valor) {
  const c = limparDocumento(valor);
  if (c.length !== 11) return false;
  // 111.111.111-11 e companhia passam na conta dos dígitos verificadores e não
  // são CPF de ninguém.
  if (/^(\d)\1{10}$/.test(c)) return false;

  const digito = (base, pesoInicial) => {
    const soma = [...base].reduce((acc, n, i) => acc + Number(n) * (pesoInicial - i), 0);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  const d1 = digito(c.slice(0, 9), 10);
  const d2 = digito(c.slice(0, 10), 11);
  return c === c.slice(0, 9) + String(d1) + String(d2);
}

export function cnpjValido(valor) {
  const c = limparDocumento(valor);
  if (c.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(c)) return false;

  const calc = (base, pesos) => {
    const soma = pesos.reduce((acc, peso, i) => acc + Number(base[i]) * peso, 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const p2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const d1 = calc(c.slice(0, 12), p1);
  const d2 = calc(c.slice(0, 12) + d1, p2);
  return c === c.slice(0, 12) + String(d1) + String(d2);
}

/** `'cpf'`, `'cnpj'` ou `null` quando não é nenhum dos dois. */
export function tipoDocumento(valor) {
  const c = limparDocumento(valor);
  if (c.length === 11) return cpfValido(c) ? 'cpf' : null;
  if (c.length === 14) return cnpjValido(c) ? 'cnpj' : null;
  return null;
}

export function documentoValido(valor) {
  return tipoDocumento(valor) !== null;
}

/**
 * Máscara que se decide pelo tamanho, DIGITANDO INCLUSIVE.
 *
 * O campo é mascarado a cada tecla, então esta função recebe números pela
 * metade o tempo todo: "5299" não é CPF nem CNPJ ainda, e vai virar um dos
 * dois. Pontuar por um formato antes de saber qual é faz o campo "pular"
 * quando o operador chega ao 12º dígito.
 *
 * A saída: até 11 dígitos, pontua como CPF; acima disso, como CNPJ. Assim quem
 * digita um CNPJ vê a máscara de CPF até o 11º dígito e ela se corrige sozinha
 * no 12º -- o único ponto em que os dois formatos deixam de ser ambíguos.
 */
export function mascararDocumento(valor) {
  const c = limparDocumento(valor).slice(0, 14);

  if (c.length <= 11) {
    return c
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4');
  }

  return c
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

/** "CPF" / "CNPJ" / "documento" -- para rótulo e mensagem de erro. */
export function rotuloDocumento(valor) {
  const tipo = tipoDocumento(valor);
  if (tipo === 'cpf') return 'CPF';
  if (tipo === 'cnpj') return 'CNPJ';
  return 'documento';
}
