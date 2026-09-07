/**
 * O CICLO DO RANKING -- quando o mês começa, quando fecha, e o que fica intacto.
 *
 * ── POR QUE ISTO MERECE UM ARQUIVO ─────────────────────────────────────────
 *
 * Nada de ranking é guardado: o histórico é recalculado a cada consulta, a
 * partir dos atendimentos. Isso torna o cálculo da janela do mês uma peça de
 * risco desproporcional ao seu tamanho -- mover o dia de fechamento sem cuidado
 * reescreve meses já fechados, muda posições sozinho e deixa premiações
 * registradas apontando para quem não é mais o primeiro.
 *
 * ── O QUE ESTÁ TRAVADO ─────────────────────────────────────────────────────
 *
 *   PADRÃO INTACTO      sem configurar nada, a janela é o mês do calendário,
 *                       exatamente como as quatro cópias faziam antes.
 *   PASSADO INTACTO     competência anterior à vigência continua calendário.
 *   VIGÊNCIA HONESTA    ela é carimbada pelo servidor, não recebida do cliente
 *                       -- senão dava para pedir vigência retroativa.
 *   O MÊS CORRENTE      com fechamento no dia 25, o dia 7 pertence ao ciclo que
 *                       começou no mês passado.
 *   DIA 29, 30, 31      recusados: fevereiro não os tem, e o ciclo mudaria de
 *                       janela sozinho conforme o mês.
 */
const path = require("path");

const erros = [];
function check(nome, problemas) {
  if (problemas.length) {
    erros.push(nome);
    console.log("  FALHA " + nome);
    for (const p of problemas) console.log("        " + p);
  } else {
    console.log("  OK   " + nome);
  }
}

const ciclo = require(path.join(__dirname, "src/modules/rankings/ciclo"));

const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ` +
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

console.log("=== Ciclo do ranking ===");

// ── O padrao e o mes do calendario ───────────────────────────────────────────
{
  const problemas = [];
  const j = ciclo.janela(2026, 9, ciclo.PADRAO);
  if (iso(j.inicio) !== "2026-09-01 00:00") problemas.push("inicio deveria ser 01/09 00:00, e " + iso(j.inicio));
  if (iso(j.fim) !== "2026-10-01 00:00") problemas.push("fim deveria ser 01/10 00:00, e " + iso(j.fim));
  if (j.personalizada) problemas.push("o padrao nao pode se declarar personalizado");

  // Dezembro: a virada de ano e onde um calculo ingenuo quebra.
  const dez = ciclo.janela(2026, 12, ciclo.PADRAO);
  if (iso(dez.fim) !== "2027-01-01 00:00") problemas.push("dezembro deveria terminar em 01/01/2027, termina " + iso(dez.fim));

  check("sem configurar nada, a janela e o mes do calendario", problemas);
}

// ── O ciclo configurado move a janela ────────────────────────────────────────
{
  const cfg = { dia: 25, hora: 18, minuto: 0, vigenteDesde: "2026-09" };
  const problemas = [];
  const j = ciclo.janela(2026, 9, cfg);
  if (iso(j.inicio) !== "2026-09-25 18:00") problemas.push("inicio deveria ser 25/09 18:00, e " + iso(j.inicio));
  if (iso(j.fim) !== "2026-10-25 18:00") problemas.push("fim deveria ser 25/10 18:00, e " + iso(j.fim));
  if (!j.personalizada) problemas.push("deveria se declarar personalizada");
  check("o ciclo configurado vai do dia escolhido ao mesmo dia do mes seguinte", problemas);
}

// ── O PASSADO NAO SE MEXE ────────────────────────────────────────────────────
//
// O nucleo deste arquivo. Uma regra criada em setembro nao pode mudar o que
// julho continha -- julho ja foi premiado.
{
  const cfg = { dia: 25, hora: 18, minuto: 0, vigenteDesde: "2026-09" };
  const problemas = [];
  for (const [ano, mes, rotulo] of [[2026, 7, "julho"], [2026, 8, "agosto"], [2025, 12, "dez/2025"]]) {
    const j = ciclo.janela(ano, mes, cfg);
    const esperadoInicio = `${ano}-${String(mes).padStart(2, "0")}-01 00:00`;
    if (iso(j.inicio) !== esperadoInicio) {
      problemas.push(`${rotulo} mudou de conteudo: comeca em ${iso(j.inicio)}, deveria ser ${esperadoInicio}`);
    }
    if (j.personalizada) problemas.push(`${rotulo} nao deveria usar o ciclo novo`);
  }
  // E o mes da vigencia em diante usa o ciclo novo.
  if (!ciclo.janela(2026, 9, cfg).personalizada) problemas.push("setembro (a vigencia) deveria usar o ciclo novo");
  if (!ciclo.janela(2027, 3, cfg).personalizada) problemas.push("marco/2027 deveria usar o ciclo novo");

  check("competencia anterior a vigencia continua sendo mes de calendario", problemas);
}

// ── Que mes esta corrente ────────────────────────────────────────────────────
{
  const cfg = { dia: 25, hora: 18, minuto: 0, vigenteDesde: "2026-01" };
  const problemas = [];
  const casos = [
    [new Date(2026, 8, 7, 10, 0), "2026-08", "dia 7 ainda pertence ao ciclo aberto em 25/08"],
    [new Date(2026, 8, 25, 17, 59), "2026-08", "um minuto antes da virada ainda e o ciclo velho"],
    [new Date(2026, 8, 25, 18, 0), "2026-09", "no instante da virada ja e o ciclo novo"],
    [new Date(2026, 8, 30, 23, 0), "2026-09", "fim do mes, ciclo novo"],
    [new Date(2026, 0, 3, 9, 0), "2025-12", "comeco de janeiro pertence ao ciclo de dezembro"],
  ];
  for (const [quando, esperado, porque] of casos) {
    const obtido = ciclo.competenciaDe(quando, cfg);
    if (obtido !== esperado) problemas.push(`${porque}: esperava ${esperado}, veio ${obtido}`);
  }
  check("o mes corrente segue o ciclo, e nao o calendario", problemas);
}

// ── Valores que nao podem passar ─────────────────────────────────────────────
{
  const problemas = [];
  for (const dia of [29, 30, 31, 40]) {
    const v = ciclo.validar({ dia }, ciclo.PADRAO);
    if (v.dia > 28) problemas.push(`dia ${dia} passou (virou ${v.dia}) -- fevereiro nao tem esse dia`);
  }
  if (ciclo.validar({ dia: 0 }, ciclo.PADRAO).dia < 1) problemas.push("dia 0 passou");
  if (ciclo.validar({ hora: 99 }, ciclo.PADRAO).hora > 23) problemas.push("hora 99 passou");
  if (ciclo.validar({ minuto: -5 }, ciclo.PADRAO).minuto < 0) problemas.push("minuto negativo passou");
  // Vigencia com formato errado vira null (= sem regra), e nao uma string solta
  // que a comparacao de competencia trataria como sempre verdadeira.
  if (ciclo.validar({ vigenteDesde: "ontem" }, ciclo.PADRAO).vigenteDesde !== null) {
    problemas.push("vigencia com formato invalido deveria virar null");
  }
  check("dia impossivel e valor absurdo nao viram regra", problemas);
}

// ── A vigencia nao pode ser pedida de fora ───────────────────────────────────
//
// `validar` aceita `vigenteDesde` porque le o que ESTA no banco. Quem grava e
// `salvar`, e e ela que carimba -- senao um pedido com vigencia retroativa
// reescreveria meses ja premiados.
{
  const fonte = require("fs").readFileSync(
    path.join(__dirname, "src/modules/rankings/ciclo.js"),
    "utf8"
  );
  const corpo = /async function salvar\(([\s\S]*?)\n}/.exec(fonte)?.[1] || "";
  check("a vigencia e carimbada pelo servidor, nao recebida", [
    ...(corpo ? [] : ["nao achei `salvar` em ciclo.js"]),
    ...(corpo.includes("novo.vigenteDesde = compDe(new Date())")
      ? []
      : ["`salvar` nao carimba a vigencia com a data do servidor"]),
  ]);
}

console.log(
  "\n" +
    (erros.length ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ") : "CICLO DO RANKING: TUDO CONFERE")
);
process.exit(erros.length ? 1 : 0);
