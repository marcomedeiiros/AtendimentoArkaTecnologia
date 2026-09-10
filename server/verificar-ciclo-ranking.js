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
//
// A VIGENCIA AQUI E ANTIGA de proposito. Antes este caso usava
// `vigenteDesde: "2026-09"` e pedia a janela de 2026-09 -- ou seja, media a
// competencia de TRANSICAO acreditando medir um mes comum, e por isso travava a
// regra errada para ela. O mes de transicao tem caso proprio, logo abaixo.
{
  const cfg = { dia: 25, hora: 18, minuto: 0, vigenteDesde: "2026-01" };
  const problemas = [];
  const j = ciclo.janela(2026, 9, cfg);
  if (iso(j.inicio) !== "2026-09-25 18:00") problemas.push("inicio deveria ser 25/09 18:00, e " + iso(j.inicio));
  if (iso(j.fim) !== "2026-10-25 18:00") problemas.push("fim deveria ser 25/10 18:00, e " + iso(j.fim));
  if (!j.personalizada) problemas.push("deveria se declarar personalizada");
  if (j.transicao) problemas.push("nao e mes de transicao (a vigencia e de janeiro)");
  check("o ciclo configurado vai do dia escolhido ao mesmo dia do mes seguinte", problemas);
}

// ── A COMPETENCIA DE TRANSICAO NAO PODE DEIXAR DIAS ORFAOS ───────────────────
//
// O defeito de producao de 10/09/2026, em teste. Com fechamento no dia 28 e
// vigencia em setembro:
//
//   2026-08 -> 01/08 a 01/09  (calendario, e anterior a vigencia)
//   2026-09 -> 28/09 a 28/10  <- era isto, e sobrava 01/09..28/09 sem dono
//
// O painel de parede (que usa o mes de calendario) mostrava 84 pontos e a tela
// do Ranking do Time mostrava 0 -- lido como "o ranking zerou os pontos",
// quando nada havia sido apagado.
{
  const cfg = { dia: 28, hora: 0, minuto: 0, vigenteDesde: "2026-09" };
  const problemas = [];
  const t = ciclo.janela(2026, 9, cfg);
  if (iso(t.inicio) !== "2026-09-01 00:00") {
    problemas.push("a transicao deveria comecar em 01/09 (onde o calendario parou), e " + iso(t.inicio));
  }
  if (iso(t.fim) !== "2026-10-28 00:00") problemas.push("e terminar na virada nova, 28/10; veio " + iso(t.fim));
  if (!t.transicao) problemas.push("deveria se declarar transicao, para a tela poder explicar o ciclo mais longo");

  // O ciclo SEGUINTE ja e o normal: 28 a 28. A transicao vale uma vez.
  const seg = ciclo.janela(2026, 10, cfg);
  if (iso(seg.inicio) !== "2026-10-28 00:00") problemas.push("outubro deveria comecar em 28/10, e " + iso(seg.inicio));
  if (seg.transicao) problemas.push("outubro nao e transicao");

  // E o passado segue intocado -- e o que `vigenteDesde` existe para garantir.
  const ago = ciclo.janela(2026, 8, cfg);
  if (iso(ago.inicio) !== "2026-08-01 00:00") problemas.push("agosto mudou de conteudo: " + iso(ago.inicio));
  if (iso(ago.fim) !== "2026-09-01 00:00") problemas.push("agosto mudou de fim: " + iso(ago.fim));

  check("a competencia de transicao absorve os dias entre o calendario e a virada nova", problemas);
}

// ── A INVARIANTE QUE FALTAVA: OS DOIS LADOS TEM DE CONCORDAR ─────────────────
//
// `competenciaDe` responde "em que competencia cai este instante" e `janela`
// responde "que intervalo e esta competencia". Elas eram conferidas
// SEPARADAMENTE -- uma pelo rotulo que devolvia, a outra pelas datas -- e por
// isso podiam discordar sem que nenhum teste reclamasse. Foi assim que o vao
// acima passou.
//
// A regra em uma linha: para QUALQUER instante, a janela da competencia que
// `competenciaDe` escolher tem de CONTER aquele instante. Sem isso, existe dia
// que nao pertence a ranking nenhum -- e o trabalho feito nele desaparece da
// tela sem nada explicar.
{
  const problemas = [];
  const configs = [
    { dia: 1, hora: 0, minuto: 0, vigenteDesde: null },
    { dia: 28, hora: 0, minuto: 0, vigenteDesde: "2026-09" },
    { dia: 25, hora: 18, minuto: 0, vigenteDesde: "2026-09" },
    { dia: 25, hora: 18, minuto: 0, vigenteDesde: "2026-01" },
    { dia: 15, hora: 12, minuto: 30, vigenteDesde: "2026-06" },
    // OS DIAS QUE NAO EXISTEM EM TODO MES. Antes o teto era 28 para nao lidar
    // com eles; agora a data e aparada para o ultimo dia do mes (ver
    // `diaQueExiste`), e e AQUI que a aparagem se prova: se a janela e a
    // competencia corrente discordarem sobre onde fevereiro vira, esta
    // varredura acha o dia orfao.
    { dia: 29, hora: 0, minuto: 0, vigenteDesde: "2025-12" },
    { dia: 30, hora: 18, minuto: 0, vigenteDesde: "2025-12" },
    { dia: 31, hora: 23, minuto: 59, vigenteDesde: "2025-12" },
  ];
  for (const cfg of configs) {
    // Varre 18 meses dia a dia -- barato, e cobre viradas, meses curtos e o
    // mes da vigencia inteiro. Vai ate meados de 2028 para pegar o fevereiro
    // BISSEXTO: com dia 30, a virada cai em 29/02 naquele ano e em 28/02 nos
    // outros, e as duas contas tem de concordar nos dois casos.
    for (let d = new Date(2025, 11, 1); d < new Date(2028, 5, 1); d.setDate(d.getDate() + 1)) {
      const quando = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 13, 10, 0);
      const comp = ciclo.competenciaDe(quando, cfg);
      const [ano, mes] = comp.split("-").map(Number);
      const j = ciclo.janela(ano, mes, cfg);
      if (!(quando >= j.inicio && quando < j.fim)) {
        problemas.push(
          `ciclo ${JSON.stringify(cfg)}: ${iso(quando)} caiu em ${comp}, ` +
            `cuja janela e ${iso(j.inicio)}..${iso(j.fim)} -- nao contem o instante`
        );
        break; // uma amostra por config basta para o diagnostico
      }
    }
  }
  check("todo instante pertence a uma competencia cuja janela o contem", problemas);
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
  // A VIGENCIA E BEM ANTIGA de proposito: aqui se mede o regime NORMAL, em que
  // todo mes ja usa o ciclo novo. Antes ela era "2026-01", e o ultimo caso
  // ("comeco de janeiro pertence ao ciclo de dezembro") caia justamente no mes
  // da vigencia -- ou seja, o proprio teste afirmava um rotulo cuja janela NAO
  // continha o instante: `janela(2025-12)` terminava em 01/01 (calendario, por
  // ser anterior a vigencia) e o caso pedia que 03/01 pertencesse a ela.
  //
  // Era o mesmo defeito que esta auditoria encontrou, escrito como expectativa.
  // A transicao tem caso proprio logo abaixo.
  const cfg = { dia: 25, hora: 18, minuto: 0, vigenteDesde: "2025-06" };
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

// ── E NO MES DA VIGENCIA, O CORRENTE E ELE MESMO ─────────────────────────────
//
// O caso de producao: dia 28, vigencia em setembro, relogio em 10/09. A resposta
// antiga era "2026-08" -- competencia cuja janela terminava em 01/09, e que
// portanto nao continha o dia 10. Nem escolhendo a competencia "certa" a tela
// alcançava o trabalho do dia.
{
  const cfg = { dia: 28, hora: 0, minuto: 0, vigenteDesde: "2026-09" };
  const problemas = [];
  const casos = [
    [new Date(2026, 8, 1, 0, 0), "2026-09", "o primeiro dia da vigencia ja e da competencia nova"],
    [new Date(2026, 8, 10, 13, 10), "2026-09", "10/09 (o caso da auditoria) pertence a transicao"],
    [new Date(2026, 8, 27, 23, 59), "2026-09", "vespera da virada segue na transicao"],
    [new Date(2026, 8, 28, 0, 0), "2026-09", "a transicao vai ATE 28/10, entao 28/09 continua nela"],
    [new Date(2026, 9, 27, 23, 0), "2026-09", "27/10 e o ultimo dia do ciclo de transicao"],
    [new Date(2026, 9, 28, 0, 0), "2026-10", "28/10 abre o primeiro ciclo normal"],
    [new Date(2026, 7, 15, 9, 0), "2026-08", "agosto, anterior a vigencia, segue calendario"],
  ];
  for (const [quando, esperado, porque] of casos) {
    const obtido = ciclo.competenciaDe(quando, cfg);
    if (obtido !== esperado) problemas.push(`${porque}: esperava ${esperado}, veio ${obtido}`);
  }
  check("no mes da vigencia, o instante pertence a propria competencia de transicao", problemas);
}

// ── Valores que nao podem passar ─────────────────────────────────────────────
{
  const problemas = [];
  // O TETO SUBIU DE 28 PARA 31, e o que impede o "31 de fevereiro" nao e mais
  // o limite: e a aparagem. Quem fecha folha no dia 30 precisava do dia 30.
  for (const dia of [32, 40, 99]) {
    const v = ciclo.validar({ dia }, ciclo.PADRAO);
    if (v.dia > 31) problemas.push(`dia ${dia} passou (virou ${v.dia}) -- nao existe mes com esse dia`);
  }
  for (const dia of [29, 30, 31]) {
    if (ciclo.validar({ dia }, ciclo.PADRAO).dia !== dia) {
      problemas.push(`dia ${dia} deveria ser aceito -- e aparado mes a mes, nao recusado`);
    }
  }
  // A APARAGEM, no dia em que ela importa: fevereiro.
  const apara = [
    [2026, 1, 30, 28, "fevereiro comum"],
    [2028, 1, 30, 29, "fevereiro bissexto"],
    [2026, 1, 31, 28, "dia 31 em fevereiro"],
    [2026, 3, 31, 30, "dia 31 em abril"],
    [2026, 0, 31, 31, "dia 31 em janeiro fica 31"],
    [2026, 0, 15, 15, "dia que existe nao e mexido"],
  ];
  for (const [ano, mesIdx, dia, esperado, oque] of apara) {
    const obtido = ciclo.diaQueExiste(ano, mesIdx, dia);
    if (obtido !== esperado) {
      problemas.push(`${oque}: dia ${dia} deveria cair em ${esperado}, caiu em ${obtido}`);
    }
  }
  // E o efeito na JANELA: nada de transbordar para o mes seguinte, que era o
  // motivo do teto de 28 (`new Date(2026, 1, 30)` vira 02/03).
  const fev = ciclo.janela(2026, 2, { dia: 30, hora: 0, minuto: 0, vigenteDesde: "2025-12" });
  if (iso(fev.inicio) !== "2026-02-28 00:00") {
    problemas.push("com dia 30, fevereiro/2026 deveria comecar em 28/02; veio " + iso(fev.inicio));
  }
  // A ponta de cima tambem e aparada, senao sobra um vao entre um mes curto e o
  // seguinte.
  const jan = ciclo.janela(2026, 1, { dia: 31, hora: 0, minuto: 0, vigenteDesde: "2025-12" });
  if (iso(jan.fim) !== "2026-02-28 00:00") {
    problemas.push("com dia 31, janeiro/2026 deveria terminar em 28/02; veio " + iso(jan.fim));
  }
  if (ciclo.validar({ dia: 0 }, ciclo.PADRAO).dia < 1) problemas.push("dia 0 passou");
  if (ciclo.validar({ hora: 99 }, ciclo.PADRAO).hora > 23) problemas.push("hora 99 passou");
  if (ciclo.validar({ minuto: -5 }, ciclo.PADRAO).minuto < 0) problemas.push("minuto negativo passou");
  // Vigencia com formato errado vira null (= sem regra), e nao uma string solta
  // que a comparacao de competencia trataria como sempre verdadeira.
  if (ciclo.validar({ vigenteDesde: "ontem" }, ciclo.PADRAO).vigenteDesde !== null) {
    problemas.push("vigencia com formato invalido deveria virar null");
  }
  check("dia 29, 30 e 31 valem -- aparados para o ultimo dia do mes", problemas);
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
