/**
 * O PÓDIO: QUANTOS SOBEM, ATÉ ONDE DÁ PARA CONFIGURAR, E QUEM DESEMPATA.
 *
 * ── O QUE MOTIVOU ──────────────────────────────────────────────────────────
 *
 * O pódio eram três lugares, sempre. Na equipe externa, que tem TRÊS pessoas,
 * isso premiava o time inteiro -- o "3º lugar" era o último colocado recebendo
 * medalha.
 *
 * E as mesmas três pessoas também atendem na sede. A pergunta "quem se saiu
 * melhor no mês, considerando tudo?" é legítima -- e a resposta que existiu
 * aqui (a média ponderada das duas notas) deixou de ser defensável quando a
 * pontuação da sede perdeu o teto. Ver o bloco da média mais abaixo.
 *
 * ── O QUE ESTÁ TRAVADO AQUI ────────────────────────────────────────────────
 *
 * Três coisas, e todas são "justo" -- que é a palavra que o usuário usou, e é
 * ela que precisa resistir a exemplo numérico:
 *
 *   O PÓDIO PREMIA     um campeão por competição, e nunca mais vagas do que
 *                      gente existindo no ranking.
 *   UM TETO SÓ         o número de premiados que a tela oferece é o mesmo que o
 *                      registro de prêmio aceita -- em UM lugar (`MAXIMO`).
 *   SEM MISTURA        nada do outro ranking decide posição neste: as duas
 *                      escalas não são comparáveis, e média entre elas não é.
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

// ── Um campeão por competição ────────────────────────────────────────────────
//
// Houve uma regra derivada do tamanho da equipe (um terço, entre 1 e 3). Ela
// resolvia o caso da equipe de três, mas deixava as duas competições com
// números diferentes -- 2 na sede, 1 fora --, e a assimetria não se explica
// para quem é avaliado. Foi REMOVIDA, e as checagens dela saíram junto: teste
// de regra que não existe mais é teste que nunca reprova.
{
  const problemas = [];
  for (const total of [1, 3, 6, 9, 30]) {
    const obtido = premiados.quantos(total);
    if (obtido !== 1) problemas.push(`com ${total} pessoas deveria premiar 1, premiou ${obtido}`);
  }
  if (premiados.quantos(0) !== 0) {
    problemas.push("ranking vazio deveria dar 0 premiados, deu " + premiados.quantos(0));
  }
  if (premiados.PADRAO.sede !== 1 || premiados.PADRAO.externo !== 1) {
    problemas.push("o padrao deveria ser 1 em cada: " + JSON.stringify(premiados.PADRAO));
  }
  check("um campeao por competicao, em qualquer tamanho de equipe", problemas);
}

// ── A escolha manual vence, mas não inventa vaga ─────────────────────────────
{
  const problemas = [];
  if (premiados.quantos(9, 3) !== 3) problemas.push("com 3 configurado e 9 pessoas, deveria dar 3");
  // Pódio com vaga vazia é pior que pódio pequeno.
  if (premiados.quantos(2, 3) !== 2) {
    problemas.push("com 3 configurado e 2 pessoas, deveria dar 2, deu " + premiados.quantos(2, 3));
  }
  // Zero/vazio DESFAZEM a escolha manual -- é assim que se volta ao padrão sem
  // precisar de um segundo campo.
  const desfeito = premiados.validar({ sede: 0, externo: "" }, { sede: 3, externo: 3 });
  if (desfeito.sede !== 1 || desfeito.externo !== 1) {
    problemas.push("zero/vazio deveriam voltar a 1: " + JSON.stringify(desfeito));
  }
  check("a escolha manual vence, sem passar do que existe", problemas);
}
// ── UM TETO SO PARA O PODIO ─────────────────────────────────────────────────
//
// O DEFEITO (auditoria-tela-rankings-10-09.md, achado 2): o campo aceitava 50,
// o `premiacaoSchema` e o servico travavam em 1-2-3, e a tela tem tres cores de
// medalha. Configurando 5, apareciam cinco botoes de premio e os dois ultimos
// falhavam SEMPRE -- e o cartao do 4o saia com `rgb(var(undefined))`.
//
// O numero passou a morar em `premiados.MAXIMO`, e quem o consome importa de
// la. Este teste existe para o mesmo numero nao voltar a ser escrito em quatro
// lugares, com um deles discordando.
{
  const fs = require("fs");
  const problemas = [];

  if (premiados.MAXIMO !== 3) {
    problemas.push("o teto deveria ser 3 (ouro, prata, bronze), e e " + premiados.MAXIMO);
  }
  // O que passar do teto e APARADO na leitura tambem: um 5 gravado antes desta
  // regra volta como 3, em vez de continuar mandando na tela.
  const aparado = premiados.validar({ sede: 5, externo: 50 }, premiados.PADRAO);
  if (aparado.sede !== premiados.MAXIMO || aparado.externo !== premiados.MAXIMO) {
    problemas.push("valor acima do teto deveria ser aparado para o teto: " + JSON.stringify(aparado));
  }

  // A BORDA usa o mesmo numero, e nao uma copia dele.
  const { premiacaoSchema } = require(path.join(__dirname, "src/modules/rankings/ranking.dto"));
  const base = { ranking: "sede", competencia: "2026-09" };
  if (!premiacaoSchema.safeParse({ ...base, posicao: premiados.MAXIMO }).success) {
    problemas.push("a borda recusa a ultima posicao do podio (" + premiados.MAXIMO + ")");
  }
  if (premiacaoSchema.safeParse({ ...base, posicao: premiados.MAXIMO + 1 }).success) {
    problemas.push("a borda aceita posicao acima do teto");
  }

  // E O PODIO CONFIGURADO TAMBEM E LIMITE, no servico: com um campeao so, o 2o
  // lugar nao tem premio a registrar -- e esconder o botao nunca foi protecao,
  // porque a mesma chamada sai no curl.
  const servico = fs.readFileSync(
    path.join(__dirname, "src/modules/rankings/ranking.service.js"),
    "utf8"
  );
  if (!servico.includes("pos > r.premiados")) {
    problemas.push("o servico deixou de recusar premio para posicao fora do podio configurado");
  }
  if (!servico.includes("FORA_DO_PODIO")) {
    problemas.push("o codigo de erro FORA_DO_PODIO saiu -- a tela nao tem como explicar a recusa");
  }
  if (servico.includes("[1, 2, 3].includes")) {
    problemas.push("o servico voltou a cravar 1-2-3 em vez de usar premiados.MAXIMO");
  }

  // E a TELA nao pode oferecer o que o servidor recusa.
  const tela = fs.readFileSync(
    path.join(__dirname, "../client/src/components/pages/Rankings.jsx"),
    "utf8"
  );
  if (tela.includes("Math.min(50,") || tela.includes("max={50}")) {
    problemas.push("o campo de premiados voltou a oferecer 50");
  }
  if (!tela.includes("Number(config?.premiadosMaximo)")) {
    problemas.push("a tela nao le mais o teto do servidor");
  }
  check("um teto so para o podio, do formulario ao banco", problemas);
}

// ── A MEDIA DAS DUAS NOTAS NAO EXISTE MAIS ──────────────────────────────────
//
// Existia uma `notaGeral`: media das duas notas, ponderada pelo volume de cada
// lado. Ela era JUSTA enquanto as duas escalas iam de 0 a 100 -- e as checagens
// que moravam aqui provavam isso (neutra a escala, sem prejuizo para quem atua
// num lado so, dentro da escala).
//
// A pontuacao da SEDE perdeu o teto, e a media perdeu o sentido junto: 250 na
// sede com 80 fora da sede dava 165. E este teste NAO PEGOU, porque alimentava
// a funcao com `pontos: 100` dos dois lados -- uma regua da sede que nao existia
// mais. Era um teste protegendo a alegacao do comentario, e nao o comportamento
// do codigo.
//
// A media saiu (auditoria-tela-rankings-10-09.md, achado 1). O que se trava
// agora e o contrario: que ela NAO VOLTE, e que o outro lado viaje so para
// exibicao -- sem tocar a ordem.
//
// Sem regex de proposito: sao trechos literais de codigo, e a comparacao por
// texto exato falha alto quando alguem os reescreve -- que e o que se quer.
const fs = require("fs");
const SALTO = String.fromCharCode(10);
// Lido SEM o retorno de carro: os arquivos deste projeto estao em CRLF, e
// comparar trecho de codigo com quebra de linha exige uma forma so.
const semCR = (t) => t.split(String.fromCharCode(13)).join("");
const fonteServico = semCR(fs.readFileSync(
  path.join(__dirname, "src/modules/rankings/ranking.service.js"),
  "utf8"
));

/** O trecho entre um cabecalho de funcao e a marca que a fecha. */
function corpoDe(fonte, cabecalho, fechamento) {
  const i = fonte.indexOf(cabecalho);
  if (i < 0) return "";
  const j = fonte.indexOf(fechamento, i);
  return j < 0 ? "" : fonte.slice(i, j);
}

{
  const problemas = [];
  if (fonteServico.includes("function notaGeral")) {
    problemas.push("`notaGeral` voltou: media de escala aberta com escala fechada nao significa nada");
  }
  // O bloco que explica POR QUE ela saiu tem de continuar la: sem ele, o
  // proximo a olhar a coluna do outro lado recria a media em uma tarde.
  if (!fonteServico.includes('POR QUE NAO EXISTE MAIS UMA "NOTA GERAL"')) {
    problemas.push("o bloco que explica por que a media saiu foi removido");
  }
  check("nao ha media entre as duas escalas", problemas);
}

// ── O DESEMPATE E O DA PROPRIA COMPETICAO ───────────────────────────────────
//
// Empate em pontos volta a cair no VOLUME proprio e, por fim, no nome. Era
// assim antes da geral, e e assim de novo: o que a geral trazia era pontuacao
// do OUTRO ranking decidindo posicao neste -- no externo, onde ninguem passa de
// 100, quem tambem atende na sede desempatava com 165 contra 62.
{
  const corpo = corpoDe(fonteServico, "function classificar(pessoas, volumeDe) {", SALTO + "}");
  const problemas = [];
  if (!corpo) problemas.push("nao achei `classificar` em ranking.service.js");
  if (corpo.includes("geral")) {
    problemas.push("`classificar` voltou a olhar a geral -- o outro ranking nao ordena este");
  }
  const desempate = [
    "        b.pontos - a.pontos ||",
    "        volumeDe(b) - volumeDe(a) ||",
    "        a.nome.localeCompare(b.nome)",
  ].join(SALTO);
  if (corpo && !corpo.includes(desempate)) {
    problemas.push("o desempate deixou de ser pontos -> volume proprio -> nome");
  }
  // `posicao` por ultimo: com ela antes do espalhar, reclassificar uma lista ja
  // classificada mantinha a posicao velha.
  if (corpo && !corpo.includes("{ ...p, posicao: i + 1 }")) {
    problemas.push("`posicao` voltou a ser escrita ANTES do espalhar: reclassificar nao renumera");
  }
  check("o desempate e o criterio da propria competicao", problemas);
}

// ── O OUTRO LADO VIAJA, MAS NAO REORDENA ────────────────────────────────────
//
// A coluna "como foi o mes desta pessoa do outro lado" precisa dos numeros do
// outro ranking. Anexar e barato; REORDENAR com eles e trazer a mistura de
// volta pela porta de tras.
{
  const corpo = corpoDe(
    fonteServico,
    "const comOutroLado = async (r, aa, mm) => {",
    SALTO + "    };"
  );
  const problemas = [];
  if (!corpo) problemas.push("nao achei `comOutroLado` -- a coluna do outro lado saiu?");
  if (corpo.includes("classificar(")) {
    problemas.push("`comOutroLado` reclassifica: o outro ranking voltou a mexer na ordem deste");
  }
  if (corpo && !corpo.includes("outroLado: o ? { ranking: outraChave, pontos: o.pontos, registros: o.registros }")) {
    problemas.push("o outro lado nao viaja mais com os pontos e registros proprios");
  }
  check("o outro lado e exibicao, nao ordem", problemas);
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
  if (/\{\[1, 2, 3\]\.map\(\(pos\)/.test(tela)) {
    problemas.push("os botoes de premio voltaram a oferecer tres posicoes fixas");
  }
  if (!tela.includes("Array.from({ length: dados?.premiados ?? 1 }")) {
    problemas.push("os botoes de premio nao seguem o numero de premiados do servidor");
  }
  if (!tela.includes("const vagas = Math.max(0, Number(premiados ?? 1));")) {
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
