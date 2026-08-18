function limparCnpj(valor) {
  return String(valor || "").replace(/\D/g, "");
}

function mascararCnpj(valor) {
  const c = limparCnpj(valor).slice(0, 14);
  return c
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

function cnpjValido(valor) {
  const c = limparCnpj(valor);
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

function limparTelefone(valor) {
  return String(valor || "").replace(/\D/g, "");
}

/**
 * Normaliza um numero brasileiro para o formato que a Evolution espera.
 *
 * Ate aqui o projeto so tinha `limparTelefone` (tira o que nao e digito), o que
 * bastava para numero que CHEGA do WhatsApp -- ele ja vem com DDI. Numero
 * DIGITADO por um operador nao vem: "27 99999-0000" sairia como "27999990000" e
 * a Evolution entenderia como um numero de outro pais. Daí a normalizacao.
 *
 * Devolve null quando o numero nao tem cara de telefone, para o chamador poder
 * recusar antes de gastar uma chamada na Evolution.
 *
 * @param {string} valor  numero em qualquer formatacao
 * @returns {string|null} so digitos, com DDI 55, ou null se invalido
 */
function normalizarTelefoneBr(valor) {
  // Zeros a esquerda vem de quem digita "0 27 9..." por costume de telefonia.
  let d = limparTelefone(valor).replace(/^0+/, "");
  if (!d) return null;

  // Ja veio com DDI: 55 + DDD(2) + 8 ou 9 digitos.
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) return d;

  // Sem DDI: DDD(2) + 8 ou 9 digitos.
  if (d.length === 10 || d.length === 11) return `55${d}`;

  // 55 na frente de um numero curto e ambiguo (pode ser DDD 55, de Santa Maria).
  // Nesse caso tratamos como DDD e prefixamos o DDI, que e o caso comum.
  return null;
}

function formatarHora(date = new Date()) {
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  limparCnpj,
  mascararCnpj,
  cnpjValido,
  limparTelefone,
  normalizarTelefoneBr,
  formatarHora,
  sleep,
};
