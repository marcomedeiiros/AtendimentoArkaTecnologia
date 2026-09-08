/**
 * OS GRÁFICOS DO RELATÓRIO DE ATENDIMENTOS, UM EMBAIXO DO OUTRO.
 *
 * ── O QUE ESTAVA FEIO, E POR QUÊ ───────────────────────────────────────────
 *
 * Era UMA captura do container inteiro. Na tela os dois gráficos ficam lado a
 * lado (`md:grid-cols-2`), e essa imagem larga era então reduzida para caber na
 * largura do papel -- cada gráfico terminava com METADE da largura útil, e as
 * legendas ficavam pequenas demais para serem lidas impressas.
 *
 * Capturando cada cartão em separado, eles empilham e cada um ocupa a largura
 * toda. Medido no navegador com a função real: antes ~91mm por gráfico, agora
 * 182mm (210 de página menos as duas margens de 14).
 *
 * ── O DEFEITO QUE A MEDIÇÃO REVELOU ────────────────────────────────────────
 *
 * O laço tinha um `try` só, do lado de fora. Uma captura que falha abortava as
 * seguintes: o relatório saía com o primeiro gráfico e sem os outros, sem erro
 * nenhum na tela. Só apareceu porque a primeira medição contou as imagens
 * desenhadas e achou uma a menos do que devia.
 */
const fs = require("fs");
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

const fonte = fs
  .readFileSync(path.resolve(__dirname, "../client/src/utils/exportarPdf.js"), "utf8")
  .split("\r\n")
  .join("\n");

console.log("=== Graficos do PDF ===");

// ── Um cartão por vez, e não a grade inteira ────────────────────────────────
{
  const problemas = [];
  if (!/const cartoes = elemento\.children\?\.length > 1 \? \[\.\.\.elemento\.children\] : \[elemento\];/.test(fonte)) {
    problemas.push("nao separa os cartoes: volta a capturar a grade inteira e cada grafico fica com metade da largura");
  }
  if (!/for \(const cartao of cartoes\) \{/.test(fonte)) {
    problemas.push("nao ha laco por cartao");
  }
  // Largura cheia para CADA um -- é isso que dobra o tamanho da letra impressa.
  if (!/const larguraImg = larguraPg - margem \* 2;/.test(fonte)) {
    problemas.push("os cartoes deixaram de usar a largura util inteira");
  }
  check("cada grafico e capturado sozinho, na largura da pagina", problemas);
}

// ── Um cartão que falha não leva os outros ──────────────────────────────────
//
// Foi assim que o defeito apareceu: com o `try` do lado de fora do laço, o
// segundo gráfico sumiu em silêncio e o relatório saiu pela metade.
{
  const corpo = /for \(const cartao of cartoes\) \{([\s\S]*?)\n    \}/.exec(fonte)?.[1] || "";
  check("a falha de um cartao nao derruba os outros", [
    ...(corpo ? [] : ["nao achei o corpo do laco"]),
    ...(corpo && !/^\s*try \{/m.test(corpo) ? ["o `try` nao esta DENTRO do laco"] : []),
    ...(corpo && !/\} catch \(err\) \{/.test(corpo) ? ["o cartao que falha nao e capturado em separado"] : []),
  ]);
}

// ── OS DOIS GRAFICOS CABEM NUMA FOLHA SO ────────────────────────────────────
//
// Empilhados na largura cheia eles ficaram legiveis, mas o segundo caia numa
// segunda folha quase vazia. A captura acontece ANTES do desenho justamente
// para saber a altura de todos e escolher UMA escala que faca o conjunto caber.
//
// O ESPACO ENTRE OS CARTOES NAO ENCOLHE. Incluindo-o no total a ser reduzido, a
// escala sai generosa demais: medido, o conjunto ficava 0,8 mm mais alto que a
// pagina e quebrava por um fio -- exatamente o defeito que a mudanca resolvia.
{
  const problemas = [];
  // Comparacoes por TEXTO: o que se quer travar aqui sao trechos exatos, e
  // regex sobre codigo so acrescenta escape (foi assim que esta secao nasceu
  // quebrada na primeira tentativa).
  if (!fonte.includes("const imagens = [];")) {
    problemas.push("nao captura tudo antes de desenhar: sem as alturas nao da para escolher a escala");
  }
  if (!fonte.includes("const ESPACOS = ESPACO * (imagens.length - 1);")) {
    problemas.push("o espaco entre cartoes nao e descontado antes da escala -- volta a quebrar por um fio");
  }
  // A linha do total NAO pode somar o espaco de volta.
  const linhaTotal = /const alturaNatural = [^\n]*\n?[^\n]*/.exec(fonte)?.[0] || "";
  if (linhaTotal.includes("ESPACO")) {
    problemas.push("o espaco voltou para dentro do total que e reduzido");
  }
  if (!fonte.includes("const MENOR_ESCALA_UTIL = 0.6;")) {
    problemas.push("sem piso de escala: encolher demais devolve o grafico ilegivel que motivou a mudanca");
  }
  check("os graficos cabem numa folha so, sem virar miniatura", problemas);
}

// ── Gráfico não pode sair maior que o papel ─────────────────────────────────
//
// Sem teto, o desenho passa da borda e o que sobra some -- sem erro, só um
// gráfico cortado. Reduzir a escala mantém o desenho inteiro; fatiar entre
// páginas (o que havia antes) parte o gráfico ao meio, e assim não se lê.
{
  const problemas = [];
  if (!fonte.includes("const alturaMax = alturaPg - margem * 2;")) {
    problemas.push("nao ha teto de altura: cartao alto sai cortado pela borda do papel");
  }
  if (!fonte.includes("const aFinal = Math.min(alturaImg, alturaMax);")) {
    problemas.push("a altura nao e limitada ao papel");
  }
  // A largura tem de acompanhar o corte da altura NA MESMA RAZAO. Limitar so a
  // altura desenharia o grafico achatado -- e achatado ainda "cabe", entao o
  // erro passaria despercebido.
  if (!fonte.includes("const lFinal = aFinal < alturaImg ? l * (aFinal / alturaImg) : l;")) {
    problemas.push("o teto nao preserva a proporcao -- o grafico sairia achatado");
  }
  check("cartao alto e reduzido, e nao cortado", problemas);
}

// ── O título aparece uma vez ────────────────────────────────────────────────
{
  const corpo = /for \(const cartao of cartoes\) \{([\s\S]*?)\n    \}/.exec(fonte)?.[1] || "";
  check("o titulo 'Graficos' nao se repete a cada cartao", [
    ...(/pdf\.text\('Gráficos'/.test(corpo) ? ["o titulo esta DENTRO do laco: sairia uma vez por grafico"] : []),
  ]);
}

console.log(
  "\n" + (erros.length ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ") : "GRAFICOS DO PDF: TUDO CONFERE")
);
process.exit(erros.length ? 1 : 0);
