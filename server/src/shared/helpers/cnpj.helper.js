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

// Sempre no fuso de Brasilia: o servidor costuma rodar em UTC (nuvem/Docker), e
// sem fixar o timeZone a hora saia adiantada (ex.: 3h a frente). Aceita Date ou
// string ISO.
function formatarHora(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

// Data (YYYY-MM-DD) no fuso de Brasilia. Mesmo motivo do formatarHora acima: o
// servidor roda em UTC no Docker, e `toISOString().slice(0,10)` das 21h em
// diante ja devolve o dia SEGUINTE -- o que fazia a agenda tratar hoje como
// passado (e apagar concluido do proprio dia). "en-CA" da exatamente
// YYYY-MM-DD.
function dataBrasilia(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

// Hora/minuto e dia da semana EM BRASILIA, para regra de expediente.
//
// `date.getHours()` e `date.getDay()` usam o fuso do PROCESSO -- e o container
// roda em UTC. Com isso, um expediente configurado como 08:00-18:00 valia, na
// pratica, das 05:00 as 15:00 de Brasilia: o bot calava no meio da tarde e
// respondia de madrugada. Na sexta as 21h o `getDay()` ja dizia sabado.
const DIAS_SEMANA = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatadorPartes = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Sao_Paulo",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function partesBrasilia(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const partes = {};
  for (const p of formatadorPartes.formatToParts(d)) partes[p.type] = p.value;
  // Meia-noite sai como "24" em alguns ICU: o % 24 normaliza.
  const hora = Number(partes.hour) % 24;
  return {
    minutosDoDia: hora * 60 + Number(partes.minute),
    diaSemana: DIAS_SEMANA[partes.weekday] ?? 0,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * O TIPO DE CLIENTE QUE A OPCAO ESCOLHIDA DECLARA -- "avulso" ou null.
 *
 * O caminho oficial e `opcao.clienteTipo`, no JSON do fluxo. Como esse campo e
 * novo e o fluxo vive no BANCO de cada instalacao, ha o mesmo encaixe que
 * `setorDaOpcaoEscolhida` usa para setor: o tipo sai do ROTULO DA OPCAO QUE O
 * CLIENTE ESCOLHEU ("2,cliente avulso,avulso,novo cliente").
 *
 * Isso NAO e adivinhar pelo texto do cliente. O rotulo foi escrito por quem
 * montou o fluxo, e o cliente escolheu aquela opcao explicitamente -- e a mesma
 * natureza da escolha de setor no menu principal. Palpite sobre a frase livre do
 * cliente continua fora de questao.
 *
 * So existe "avulso": nao ha rotulo que declare "cadastrado", e nao deveria
 * haver. Ser cliente cadastrado e um fato do cadastro de parceiros, verificado
 * pelo CNPJ -- nunca algo que o cliente escolhe num menu.
 *
 * CASAMENTO POR TOKEN INTEIRO, pela mesma razao do setor: substring casaria
 * "avulso" dentro de frases que nao sao a opcao.
 */
const PALAVRAS_DE_AVULSO = ["avulso", "cliente avulso", "atendimento avulso", "sou cliente avulso"];

function tipoClienteDaOpcaoEscolhida(opcao) {
  if (!opcao) return null;
  if (opcao.clienteTipo === "avulso") return "avulso";

  const semAcento = (s) =>
    String(s || "").toLowerCase().trim().normalize("NFD").replace(/[̀-ͯ]/g, "");

  const tokens = [
    ...(Array.isArray(opcao.palavrasChave) ? opcao.palavrasChave : []),
    ...String(opcao.rotulo || "").split(","),
  ].map(semAcento).filter(Boolean);

  return tokens.some((t) => PALAVRAS_DE_AVULSO.includes(t)) ? "avulso" : null;
}

module.exports = {
  limparCnpj,
  mascararCnpj,
  cnpjValido,
  limparTelefone,
  normalizarTelefoneBr,
  formatarHora,
  dataBrasilia,
  partesBrasilia,
  sleep,
  tipoClienteDaOpcaoEscolhida,
};
