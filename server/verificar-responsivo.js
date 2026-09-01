/**
 * RESPONSIVIDADE NO CELULAR -- as regras que a tela pequena impõe.
 *
 * ── POR QUE ESTE ARQUIVO EXISTE ────────────────────────────────────────────
 *
 * Responsividade não se prova lendo o código uma vez: ela se PERDE no arquivo
 * seguinte. Alguém escreve `h-screen` porque ficou bom no monitor, e três meses
 * depois o campo de escrever some no celular de quem está de plantão.
 *
 * As telas do painel exigem login, então não dá para abrir todas num navegador
 * de teste. O que dá -- e o que este arquivo faz -- é conferir as REGRAS que
 * produzem os defeitos conhecidos, em todo arquivo, sempre:
 *
 *   1. `100vh` é MENTIRA no celular. O navegador móvel mede com a barra de
 *      endereço recolhida, que é o estado em que ela quase nunca está. O rodapé
 *      da página fica embaixo da barra -- e o rodapé da Central é o CAMPO DE
 *      ESCREVER. Use `altura-app` / `dvh`.
 *
 *   2. Modal centralizado sem teto de altura TRANSBORDA. O fundo é `fixed`,
 *      então não há rolagem: o "Salvar" fica fora do alcance, sem saída.
 *
 *   3. Tabela sem container rolável estica a página inteira, e aí a barra
 *      horizontal aparece em TUDO, não só na tabela.
 *
 *   4. Grade de N colunas sem ponto de quebra espreme N colunas em 320px.
 *
 *   5. Largura fixa em px sem `max-w-full` não cabe em aparelho estreito.
 *
 * Não sobe servidor e não toca no banco: é leitura dos arquivos do cliente.
 *
 *   cd server && node verificar-responsivo.js
 */
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..", "client", "src");

function listar(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return listar(p);
    return /\.jsx?$/.test(e.name) ? [p] : [];
  });
}

const arquivos = listar(RAIZ);
const rel = (p) => path.relative(RAIZ, p).replace(/\\/g, "/");
const linhasDe = (f) => fs.readFileSync(f, "utf8").split("\n");

// Linha de comentário não é interface. Os comentários deste projeto CITAM as
// classes proibidas justamente para explicar por que não usá-las.
const ehComentario = (l) => /^\s*(\/\/|\*|\/\*)/.test(l);

const erros = [];
let secao = "";
const titulo = (t) => { secao = t; console.log(`\n=== ${t} ===`); };
const check = (rotulo, ocorrencias) => {
  const ok = ocorrencias.length === 0;
  console.log(`  ${ok ? "OK  " : "FALHA"} ${rotulo}`);
  for (const o of ocorrencias) console.log(`        ${o}`);
  if (!ok) erros.push(`[${secao}] ${rotulo} (${ocorrencias.length})`);
};

// ---------------------------------------------------------------------------
titulo("1. Altura: nada de 100vh, que mente no celular");

const comHScreen = [];
for (const f of arquivos) {
  linhasDe(f).forEach((l, i) => {
    if (ehComentario(l)) return;
    if (/className[^\n]*\b(h-screen|min-h-screen)\b/.test(l)) {
      comHScreen.push(`${rel(f)}:${i + 1}  use altura-app / altura-app-min`);
    }
  });
}
check("nenhum h-screen / min-h-screen", comHScreen);

// `[70vh]` e afins. Aceito quando (a) é variante >= sm -- tablet e desktop, onde
// a barra do navegador não muda a conta -- ou (b) há um `dvh` na mesma linha.
const vhCru = [];
for (const f of arquivos) {
  linhasDe(f).forEach((l, i) => {
    if (ehComentario(l)) return;
    if (l.includes("dvh")) return;
    const achados = l.match(/(?:^|[\s"'`:])((?:max-|min-)?h-\[[^\]]*vh[^\]]*\])/g) || [];
    for (const a of achados) {
      const trecho = a.trim();
      const antes = l.slice(0, l.indexOf(trecho));
      if (/\b(sm|md|lg|xl|2xl):$/.test(antes)) continue;
      vhCru.push(`${rel(f)}:${i + 1}  ${trecho}  -> use dvh, ou prefixe com sm:`);
    }
  });
}
check("nenhum vh sem dvh no celular", vhCru);

// ---------------------------------------------------------------------------
titulo("2. Modal: o painel precisa caber na tela");

// A regra vale para o modal que CENTRALIZA um painel -- é ele que transborda
// para os dois lados quando cresce, sem deixar rolagem.
//
// Não vale para a TELA CHEIA (`fixed inset-0 flex flex-col`): o modo mural e o
// visualizador de imagem ocupam o retângulo do `inset-0`, que já é o tamanho
// visível de verdade. Ali não há nada para transbordar, e exigir `max-h` seria
// pedir para limitar uma coisa que já está limitada.
const modalSemTeto = [];
for (const f of arquivos) {
  const linhas = linhasDe(f);
  linhas.forEach((l, i) => {
    if (!/fixed inset-0/.test(l)) return;
    if (!/justify-center/.test(l)) return;                   // não centraliza painel
    if (!/items-(center|end|start)/.test(l)) return;         // idem
    if (/overflow-y-auto|overflow-auto/.test(l)) return;     // o próprio fundo rola
    const bloco = linhas.slice(i, i + 12).join("\n");
    const temTeto = /max-h-|modal-cabe|overflow-y-auto|overflow-auto/.test(bloco);
    const ehImagem = /<img\b/.test(bloco);   // visualizador: o teto vai na imagem
    if (!temTeto && !ehImagem) {
      modalSemTeto.push(`${rel(f)}:${i + 1}  painel sem max-h / modal-cabe`);
    }
  });
}
check("todo modal limita a altura", modalSemTeto);

// ---------------------------------------------------------------------------
titulo("2b. Estilo inline não pode contradizer a classe de overflow");

// O painel da Sequência (editor de fluxos) tinha `overflow-hidden` na classe E
// `overflow: 'hidden'` no estilo inline. O inline VENCE, então trocar a classe
// não surtia efeito nenhum -- e a lista de blocos ficava recortada sem rolagem,
// com o fim da sequência inalcançável num fluxo de 15 nós.
//
// Quando os dois aparecem no mesmo elemento, um deles é mentira. Se o eixo
// precisa de tratamento diferente (recortar na horizontal, rolar na vertical),
// escreva `overflowX`/`overflowY` -- explícito, e sem classe competindo.
const overflowBrigando = [];
for (const f of arquivos) {
  const linhas = linhasDe(f);
  linhas.forEach((l, i) => {
    if (ehComentario(l)) return;
    if (!/className=.*\boverflow-(hidden|auto|visible|scroll|x-|y-)/.test(l)) return;
    // O `style={{ ... }}` do mesmo elemento costuma vir logo abaixo.
    const bloco = linhas.slice(i, i + 10).join("\n");
    const ateOProximoElemento = bloco.split(/<[a-zA-Z]/)[0];
    if (/\boverflow\s*:\s*['"]/.test(ateOProximoElemento)) {
      overflowBrigando.push(
        `${rel(f)}:${i + 1}  classe e estilo inline disputam o overflow (o inline vence)`
      );
    }
  });
}
check("nenhum overflow em disputa", overflowBrigando);

// ---------------------------------------------------------------------------
titulo("3. Tabela: rolagem própria, para não esticar a página");

const tabelaSolta = [];
for (const f of arquivos) {
  const linhas = linhasDe(f);
  linhas.forEach((l, i) => {
    if (!/<table\b/.test(l)) return;
    const acima = linhas.slice(Math.max(0, i - 6), i).join("\n");
    if (!/overflow-x-auto|overflow-auto/.test(acima)) {
      tabelaSolta.push(`${rel(f)}:${i + 1}  <table> sem overflow-x-auto por perto`);
    }
  });
}
check("toda tabela tem container rolável", tabelaSolta);

// ---------------------------------------------------------------------------
titulo("4. Grade: colunas que sabem virar uma só");

// Grades LIBERADAS, com o motivo. Não são descuido:
//   calendário -> as 7 colunas SÃO os sete dias; com menos vira outra coisa
//   emoji e miniaturas -> células minúsculas, cabem de sobra em 320px
const GRADES_LIBERADAS = new Map([
  ["components/pages/Agenda.jsx:173", "cabeçalho dom..sáb"],
  ["components/pages/Agenda.jsx:178", "dias do mês"],
  // A chave e arquivo:LINHA, entao ela ANDA quando alguem edita algo acima. Foi
  // o que aconteceu aqui: o seletor de emoji nao mudou uma virgula, so desceu
  // de 1556 para 1621 quando o cabecalho da conversa e o modal de
  // transferencia cresceram. Se este teste acusar uma grade que voce nao
  // escreveu, confira primeiro se e so a linha que mudou.
  ["components/pages/AtendimentoView.jsx:1621", "seletor de emoji"],
  ["components/ReportarBug.jsx:237", "miniaturas dos anexos"],
  // MEDIDO, não presumido: reproduzido com o CSS compilado numa tela de 320px,
  // a linha precisa de 286px e tem 286px -- inclusive com os números de uma
  // operação grande (12.847 avaliações, 87,4%). Não transborda e não corta.
  ["components/pages/Dashboard.jsx:384", "3 números curtos, medidos em 320px"],
  // O seletor de emoji não é uma grade de conteúdo: é uma paleta dentro de um
  // popup de LARGURA FIXA (`w-72`, 288px, declarado no container em
  // AtendimentoView.jsx:1642). Ela não precisa virar uma coluna porque nunca
  // depende da largura da tela -- 288px cabem no menor celular (320px), e cada
  // célula fica com 36px, acima dos 24px do alvo de toque confortável.
  //
  // Quebrar em pontos de ruptura aqui pioraria: a paleta viraria uma tira alta
  // e estreita dentro de um popup que continua com 288px.
  ["components/pages/AtendimentoView.jsx:1668", "paleta de emoji em popup de largura fixa w-72"],
]);

const gradeRigida = [];
for (const f of arquivos) {
  linhasDe(f).forEach((l, i) => {
    if (ehComentario(l)) return;
    // `grid-cols-N` SEM prefixo de ponto de quebra imediatamente antes.
    const achados = l.match(/(?:^|[\s"'`])grid-cols-([0-9]+)/g) || [];
    for (const a of achados) {
      const n = Number(a.match(/([0-9]+)$/)[1]);
      if (n < 3) continue;                 // 2 colunas ainda cabem em 320px
      const chave = `${rel(f)}:${i + 1}`;
      if (GRADES_LIBERADAS.has(chave)) continue;
      gradeRigida.push(`${chave}  grid-cols-${n} sem ponto de quebra`);
    }
  });
}
check("nenhuma grade rígida de 3+ colunas", gradeRigida);

// ---------------------------------------------------------------------------
titulo("5. Largura fixa: precisa saber encolher");

// Largura fixa é aceitável quando algo por perto ROLA: uma tabela de 520px
// dentro de um `overflow-x-auto` é a solução, não o problema -- a rolagem fica
// na tabela em vez de na página inteira. Por isso a checagem olha as linhas
// acima, e não só a própria: o container rolável é o elemento PAI.
const larguraTeimosa = [];
for (const f of arquivos) {
  const linhas = linhasDe(f);
  linhas.forEach((l, i) => {
    if (ehComentario(l)) return;
    const vizinhanca = linhas.slice(Math.max(0, i - 4), i + 1).join("\n");
    if (/max-w-full|overflow-x-auto|overflow-auto/.test(vizinhanca)) return;
    const achados = l.match(/(?:^|[\s"'`:])((?:min-)?w-\[([0-9]+)px\])/g) || [];
    for (const a of achados) {
      const px = Number(a.match(/([0-9]+)px/)[1]);
      if (px < 300) continue;              // cabe até no aparelho de 320px
      larguraTeimosa.push(`${rel(f)}:${i + 1}  ${a.trim()} sem max-w-full`);
    }
  });
}
check("largura fixa grande sempre com max-w-full", larguraTeimosa);

// ---------------------------------------------------------------------------
titulo("6. As classes de apoio existem de fato");

const css = fs.readFileSync(path.join(RAIZ, "index.css"), "utf8");
const faltando = [
  "altura-app", "altura-app-min", "seguro-barra", "seguro-cabecalho", "modal-cabe",
].filter((c) => !new RegExp(`\\.${c}\\s*[{,\\s]`).test(css))
  .map((c) => `.${c} não está em index.css`);
check("index.css define as classes usadas", faltando);

// ---------------------------------------------------------------------------
titulo("7. Ajuste de celular não pode vazar para o computador");

// A REGRA DA CASA: o computador fica como estava. Quem pede responsividade pede
// para o celular parar de quebrar, não para a tela grande mudar.
//
// E o vazamento é silencioso. `env(safe-area-inset-top)` vale 0 no monitor, mas
// `padding-top: 0` continua sendo um `padding-top` -- e ele VENCE o `py-12` do
// Tailwind na cascata. Foi assim que o formulário de login perdeu os 48px de
// respiro no computador, onde não havia nada a corrigir.
//
// Por isso toda classe que existe por causa do celular precisa morar dentro de
// um `@media (max-width: ...)`. Fora dele, ela alcança quem não pediu.
//
// `altura-app` fica de fora da exigência, e com motivo medido: ela é
// `height:100vh` seguido de `height:100dvh`, e no computador as duas valem o
// mesmo (medido: 800px numa janela de 800px). Não há o que vazar.
const SO_NO_CELULAR = ["seguro-barra", "seguro-cabecalho", "modal-cabe"];
const vazando = [];
for (const c of SO_NO_CELULAR) {
  const i = css.search(new RegExp(`\\.${c}\\s*[{,\\s]`));
  if (i < 0) continue;                       // ausência já é acusada na seção 6
  // A regra está dentro de um `@media` ainda ABERTO neste ponto do arquivo?
  const inicioMedia = css.lastIndexOf("@media", i);
  let dentroDeMedia = false;
  if (inicioMedia >= 0) {
    let nivel = 0;
    for (const ch of css.slice(inicioMedia, i)) {
      if (ch === "{") nivel++;
      else if (ch === "}") nivel--;
    }
    dentroDeMedia = nivel > 0 && /@media[^{]*max-width/.test(css.slice(inicioMedia, inicioMedia + 60));
  }
  if (!dentroDeMedia) {
    vazando.push(`.${c} está fora de @media (max-width: ...) -- alcança o computador`);
  }
}
check("classe de celular fica dentro de @media max-width", vazando);

// Sem `viewport-fit=cover` no HTML, todo `env(safe-area-inset-*)` vale 0 e as
// classes `seguro-*` viram enfeite silencioso.
const html = fs.readFileSync(path.join(RAIZ, "..", "index.html"), "utf8");
check(
  "index.html tem viewport-fit=cover (senão safe-area vale 0)",
  /viewport-fit\s*=\s*cover/.test(html) ? [] : ["falta viewport-fit=cover no <meta name=viewport>"]
);

console.log(
  "\n" + (erros.length
    ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ")
    : `RESPONSIVIDADE: TUDO CONFERE (${arquivos.length} arquivos)`)
);
process.exit(erros.length ? 1 : 0);
