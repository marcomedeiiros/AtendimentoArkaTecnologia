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

/**
 * AS FORMAS COMPARAVEIS DE UM TELEFONE BRASILEIRO.
 *
 * Existe para uma pergunta que parece trivial e nao e: "este numero que chegou
 * do WhatsApp e o mesmo que esta no cadastro do parceiro?".
 *
 * As duas pontas escrevem diferente. O WhatsApp entrega `5527999998888` (DDI +
 * DDD + 9 digitos). O cadastro guarda `(27)99999-8888` -- e, em 183 parceiros
 * reais, tambem `(27)9999-8888`, com OITO digitos: numeros anteriores ao nono
 * digito, que a Anatel prefixou com 9 em 2012 e que nunca foram reescritos no
 * cadastro.
 *
 * Comparar string com string erra os dois casos. Comparar "os ultimos 8 digitos"
 * -- a saida facil -- casaria `(27)9999-8888` com `(27)99999-8888` de graca, mas
 * tambem casaria dois assinantes DIFERENTES do mesmo DDD que por acaso
 * terminassem igual. Num fluxo que ADOTA o CNPJ do parceiro casado, isso
 * significaria atender uma empresa como se fosse outra.
 *
 * Entao: normaliza para `DDD + local` e devolve as duas grafias legitimas do
 * MESMO assinante -- com e sem o nono digito. Duas listas casam quando tem algum
 * elemento em comum, o que e casamento exato, e nao aproximado.
 *
 * @param {string} valor  telefone em qualquer formatacao, com ou sem DDI
 * @returns {Set<string>} formas normalizadas; vazio se nao parece telefone
 */
function variantesTelefoneBr(valor) {
  const formas = new Set();
  let d = limparTelefone(valor).replace(/^0+/, "");
  if (!d) return formas;

  // DDI 55 fora: o cadastro nao o usa, e e ele que faz as duas pontas diferirem.
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  // Numero longo demais (DDI de outro pais, ou digitacao errada): nao arrisca.
  if (d.length < 10 || d.length > 11) return formas;

  const ddd = d.slice(0, 2);
  const local = d.slice(2);
  formas.add(ddd + local);

  // ── AS DUAS GRAFIAS, E A SIMETRIA QUE ELAS EXIGEM ──────────────────────────
  //
  // Celular movel no Brasil sempre foi (8 digitos comecando em 6..9); em 2012 a
  // Anatel prefixou um 9. Entao a mesma linha aparece como `9XXXXXXXX` (nova) ou
  // `XXXXXXXX` (antiga), e a conversao vale nos DOIS sentidos -- desde que a
  // parte de 8 digitos seja de MOVEL.
  //
  // A condicao sobre o resto e o que impede o erro que o teste pegou: sem ela,
  // `(27)93222-8888` (movel) perdia o 9 e virava `3222-8888`, que e FIXO -- dois
  // assinantes diferentes tratados como o mesmo. Num fluxo que ADOTA o CNPJ do
  // parceiro casado, isso significaria atender uma empresa como se fosse outra.
  const ehMovel8 = (n) => n.length === 8 && /^[6-9]/.test(n);
  if (local.length === 9 && local.startsWith("9") && ehMovel8(local.slice(1))) {
    formas.add(ddd + local.slice(1));
  }
  if (ehMovel8(local)) formas.add(ddd + "9" + local);

  return formas;
}

// Duas escritas do MESMO assinante? Ver variantesTelefoneBr.
function mesmoTelefoneBr(a, b) {
  const va = variantesTelefoneBr(a);
  if (!va.size) return false;
  for (const forma of variantesTelefoneBr(b)) if (va.has(forma)) return true;
  return false;
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
const FUSO_PADRAO = "America/Sao_Paulo";

// ── UM FORMATADOR POR FUSO, e nao um por chamada ────────────────────────────
//
// `new Intl.DateTimeFormat` custa caro (carrega dados de ICU) e esta funcao roda
// em TODA mensagem que chega. O fuso deixou de ser fixo porque o horario de
// atendimento passou a ser configuravel (ver chatbot.horario.js) -- entao o
// formatador virou um cache por fuso, em vez de uma constante de modulo.
const formatadores = new Map();
function formatadorDe(timeZone) {
  const tz = String(timeZone || "").trim() || FUSO_PADRAO;
  let f = formatadores.get(tz);
  if (f) return f;
  try {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    // Fuso invalido (typo na configuracao) nao pode derrubar o atendimento: cai
    // no de Brasilia, que e o do resto do sistema.
    if (tz === FUSO_PADRAO) throw new Error("fuso padrao invalido");
    return formatadorDe(FUSO_PADRAO);
  }
  formatadores.set(tz, f);
  return f;
}

/**
 * Hora/minuto e dia da semana NO FUSO PEDIDO.
 *
 * Generalizacao de `partesBrasilia`: a regra de expediente passou a ter fuso
 * proprio na configuracao, e o resto do sistema (agenda, SLA) continua em
 * Brasilia. Fuso desconhecido cai em Brasilia em vez de estourar.
 */
function partesEmFuso(date = new Date(), timeZone = FUSO_PADRAO) {
  const d = date instanceof Date ? date : new Date(date);
  const partes = {};
  for (const p of formatadorDe(timeZone).formatToParts(d)) partes[p.type] = p.value;
  // Meia-noite sai como "24" em alguns ICU: o % 24 normaliza.
  const hora = Number(partes.hour) % 24;
  return {
    minutosDoDia: hora * 60 + Number(partes.minute),
    diaSemana: DIAS_SEMANA[partes.weekday] ?? 0,
  };
}

function partesBrasilia(date = new Date()) {
  return partesEmFuso(date, FUSO_PADRAO);
}

// "2026-08-31" no fuso pedido. E a chave das EXCECOES de horario (feriado numa
// data especifica), e por isso ela nao pode sair do fuso do processo: em UTC,
// as 22h de 24/12 em Brasilia ja seriam 25/12.
function dataISOEmFuso(date = new Date(), timeZone = FUSO_PADRAO) {
  const d = date instanceof Date ? date : new Date(date);
  try {
    return d.toLocaleDateString("en-CA", { timeZone: String(timeZone || "").trim() || FUSO_PADRAO });
  } catch {
    return d.toLocaleDateString("en-CA", { timeZone: FUSO_PADRAO });
  }
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
  variantesTelefoneBr,
  mesmoTelefoneBr,
  formatarHora,
  dataBrasilia,
  partesBrasilia,
  partesEmFuso,
  dataISOEmFuso,
  FUSO_PADRAO,
  sleep,
  tipoClienteDaOpcaoEscolhida,
};
