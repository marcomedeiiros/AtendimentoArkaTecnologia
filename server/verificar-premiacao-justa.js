/**
 * O PÓDIO DO TAMANHO DA EQUIPE, E A NOTA GERAL DE QUEM FAZ AS DUAS FUNÇÕES.
 *
 * ── O QUE MOTIVOU ──────────────────────────────────────────────────────────
 *
 * O pódio eram três lugares, sempre. Na equipe externa, que tem TRÊS pessoas,
 * isso premiava o time inteiro -- o "3º lugar" era o último colocado recebendo
 * medalha.
 *
 * E as mesmas três pessoas também atendem na sede. A pergunta "quem se saiu
 * melhor no mês, considerando tudo?" é legítima; a resposta proposta (somar as
 * duas notas) não é -- ver `notaGeral` em `ranking.service`.
 *
 * ── O QUE ESTÁ TRAVADO AQUI ────────────────────────────────────────────────
 *
 * A regra do pódio em cada tamanho de equipe, e as propriedades da média
 * ponderada que a tornam JUSTA -- que é a palavra que o usuário usou, e é ela
 * que precisa resistir a exemplo numérico:
 *
 *   NEUTRA À ESCALA   a mistura de trabalho (definida pela empresa) não pode
 *                     mudar a nota de quem trabalha igual bem nos dois lados.
 *   SEM PREJUÍZO      quem atua num lado só recebe a nota daquele lado.
 *   DENTRO DA ESCALA  o resultado fica entre as duas notas, nunca 0-200.
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

const premiados = require(path.join(__dirname, "src/modules/rankings/premiados"));

console.log("=== Premiacao justa ===");

// ── O pódio acompanha o tamanho da equipe ────────────────────────────────────
{
  const problemas = [];
  const esperado = [
    [1, 1, "uma pessoa: ela mesma"],
    [2, 1, "duas pessoas"],
    [3, 1, "TRES pessoas -- o caso da equipe externa"],
    [5, 1, "cinco pessoas"],
    [6, 2, "seis pessoas"],
    [8, 2, "oito pessoas"],
    [9, 3, "nove pessoas"],
    [30, 3, "trinta: o teto de 3 segura a diluicao"],
  ];
  for (const [total, quero, porque] of esperado) {
    const obtido = premiados.quantos(total);
    if (obtido !== quero) problemas.push(`${porque}: esperava ${quero}, veio ${obtido}`);
  }
  if (premiados.quantos(0) !== 0) {
    problemas.push("ranking vazio deveria dar 0 premiados, deu " + premiados.quantos(0));
  }
  check("o podio e um terco da equipe, entre 1 e 3", problemas);
}

// ── A escolha manual vence, mas não inventa vaga ─────────────────────────────
{
  const problemas = [];
  if (premiados.quantos(3, 3) !== 3) problemas.push("com 3 configurado e 3 pessoas, deveria dar 3");
  // Pódio com vaga vazia é pior que pódio pequeno.
  if (premiados.quantos(2, 3) !== 2) {
    problemas.push("com 3 configurado e 2 pessoas, deveria dar 2, deu " + premiados.quantos(2, 3));
  }
  // Zero/vazio DESFAZEM a escolha manual -- é assim que se volta ao automático
  // sem precisar de um segundo campo.
  const desfeito = premiados.validar({ sede: 0, externo: "" }, { sede: 3, externo: 1 });
  if (desfeito.sede !== null || desfeito.externo !== null) {
    problemas.push("zero/vazio deveriam voltar ao automatico: " + JSON.stringify(desfeito));
  }
  check("a escolha manual vence, sem passar do que existe", problemas);
}

// ── A NOTA GERAL ─────────────────────────────────────────────────────────────
//
// `notaGeral` nao e exportada (e detalhe do servico), entao a formula e extraida
// do arquivo e executada. Reimplementa-la aqui faria o teste concordar com o
// defeito no dia em que ele voltasse.
{
  const fs = require("fs");
  const fonte = fs.readFileSync(path.join(__dirname, "src/modules/rankings/ranking.service.js"), "utf8");
  const corpo = /function notaGeral\(sede, externo\) \{([\s\S]*?)\n\}/.exec(fonte)?.[1];

  check("achei a formula da nota geral", corpo ? [] : ["nao achei `notaGeral` em ranking.service.js"]);

  if (corpo) {
    // eslint-disable-next-line no-new-func
    const geral = new Function("sede", "externo", corpo);

    // ── Neutra à escala ──────────────────────────────────────────────────────
    //
    // O núcleo do pedido. Duas pessoas igualmente boas (80 dos dois lados) com
    // misturas de trabalho MUITO diferentes -- uma quase toda na sede, outra
    // quase toda na rua -- têm de receber a mesma nota. A escala é definida pela
    // empresa; ninguém pode ganhar ou perder por ela.
    const quaseSede = geral({ pontos: 80, registros: 40 }, { pontos: 80, registros: 2 });
    const quaseRua = geral({ pontos: 80, registros: 2 }, { pontos: 80, registros: 40 });
    check("a mistura de trabalho nao muda a nota de quem vai igual bem", [
      ...(quaseSede === 80 && quaseRua === 80
        ? []
        : [`80/80 deveria dar 80 nas duas misturas; deu ${quaseSede} e ${quaseRua}`]),
    ]);

    // ── Quem atua num lado só não é prejudicado ──────────────────────────────
    const soSede = geral({ pontos: 72, registros: 30 }, { pontos: 0, registros: 0 });
    const soRua = geral({ pontos: 0, registros: 0 }, { pontos: 91, registros: 12 });
    check("quem atua num lado so recebe a nota daquele lado", [
      ...(soSede === 72 ? [] : ["so sede deveria dar 72, deu " + soSede]),
      ...(soRua === 91 ? [] : ["so rua deveria dar 91, deu " + soRua]),
    ]);

    // ── Nunca vira soma ──────────────────────────────────────────────────────
    //
    // Era exatamente a proposta descartada: 100 + 100 = 200, e todo mundo que
    // trabalha bem dos dois lados volta a empatar no teto.
    const otimo = geral({ pontos: 100, registros: 20 }, { pontos: 100, registros: 20 });
    check("continua de 0 a 100 -- e media, nao soma", [
      ...(otimo === 100 ? [] : ["100 e 100 deveriam dar 100 (media), deu " + otimo]),
    ]);

    // ── Fica entre as duas notas ─────────────────────────────────────────────
    const problemas = [];
    for (const [a, va, b, vb] of [[40, 10, 90, 30], [90, 1, 40, 99], [55, 7, 55, 7], [0, 5, 100, 5]]) {
      const g = geral({ pontos: a, registros: va }, { pontos: b, registros: vb });
      if (g < Math.min(a, b) || g > Math.max(a, b)) {
        problemas.push(`${a}(${va}) e ${b}(${vb}) deram ${g}, fora do intervalo [${Math.min(a, b)}, ${Math.max(a, b)}]`);
      }
    }
    // E o peso PUXA para o lado onde a pessoa trabalhou mais.
    const puxaSede = geral({ pontos: 90, registros: 40 }, { pontos: 30, registros: 2 });
    if (!(puxaSede > 80)) problemas.push("com 40 atendimentos e 2 visitas, a geral deveria ficar perto da sede; deu " + puxaSede);
    check("fica entre as duas notas, puxada para onde houve mais trabalho", problemas);

    // ── Mês sem trabalho nenhum não tem nota ─────────────────────────────────
    check("mes sem trabalho nenhum nao recebe nota zero", [
      ...(geral({ pontos: 0, registros: 0 }, { pontos: 0, registros: 0 }) === null
        ? []
        : ["deveria ser null: `0` afirmaria 'foi mal' sobre um mes em que nao ha o que julgar"]),
    ]);
  }
}

// ── O desempate usa a geral ──────────────────────────────────────────────────
{
  const fs = require("fs");
  const fonte = fs.readFileSync(path.join(__dirname, "src/modules/rankings/ranking.service.js"), "utf8");
  const corpo = /function classificar\(pessoas, volumeDe\) \{([\s\S]*?)\n\}/.exec(fonte)?.[1] || "";
  const problemas = [];
  if (!/\(b\.geral \?\? b\.pontos\) - \(a\.geral \?\? a\.pontos\)/.test(corpo)) {
    problemas.push("`classificar` nao desempata pela geral -- empate volta a cair na ordem alfabetica");
  }
  // `posicao` por ultimo: com ela antes do espalhar, reclassificar uma lista ja
  // classificada mantinha a posicao velha -- e e isso que `obter` faz.
  if (!/\{ \.\.\.p, posicao: i \+ 1 \}/.test(corpo)) {
    problemas.push("`posicao` voltou a ser escrita ANTES do espalhar: reclassificar nao renumera");
  }
  check("o desempate olha o mes inteiro da pessoa", problemas);
}

// ── A TELA NAO PODE CONTRADIZER A REGRA ──────────────────────────────────────
//
// O podio virou variavel e os botoes de premio ficaram com `[1, 2, 3]` cravado:
// podio de UM lugar e, logo abaixo, tres botoes oferecendo premio para 1o, 2o e
// 3o. Nao e so feio -- registrar premio para quem a regra nao premia vira linha
// no banco, e ninguem desfaz.
{
  const fs = require("fs");
  const tela = fs.readFileSync(
    path.join(__dirname, "../client/src/components/pages/Rankings.jsx"),
    "utf8"
  );
  const problemas = [];
  if (tela.includes("{[1, 2, 3].map((pos) => {")) {
    problemas.push("os botoes de premio voltaram a oferecer tres posicoes fixas");
  }
  if (!tela.includes("Array.from({ length: dados?.premiados ?? 3 }")) {
    problemas.push("os botoes de premio nao seguem o numero de premiados do servidor");
  }
  if (!tela.includes("const vagas = Math.max(0, Number(premiados ?? 3));")) {
    problemas.push("o podio nao le mais o numero de premiados do servidor");
  }
  check("os botoes de premio seguem o mesmo numero do podio", problemas);
}
console.log(
  "\n" +
    (erros.length
      ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ")
      : "PREMIACAO JUSTA: TUDO CONFERE")
);
process.exit(erros.length ? 1 : 0);
