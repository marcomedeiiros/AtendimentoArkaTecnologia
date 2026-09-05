// Verificacao do ZOOM DO EDITOR DE FLUXOS -- `node verificar-zoom-fluxos.js`.
//
// O zoom do canvas passou a ser guardado por operador. O que pode dar errado
// aqui nao e "esquecer o zoom" -- e GUARDAR UM ZOOM QUE QUEBRA A TELA.
//
// O valor vem do servidor e volta para uma multiplicacao de coordenadas. Um
// `0` guardado (por um erro de gravacao, um valor antigo, um JSON estragado)
// multiplica o desenho inteiro por zero: o canvas vira um ponto, e nao ha como
// sair de la clicando -- os botoes de mais e menos TAMBEM multiplicam, entao
// 0 * 1.15 continua 0. A tela ficaria travada para sempre para aquele usuario,
// e nem o F5 ajudaria, porque o valor esta salvo no servidor.
//
// Por isso `limitarZoom` roda na leitura E na escrita, e e ele que este script
// exercita -- lido do arquivo da tela, nao copiado.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const erros = [];
const check = (cond, msg) => {
  if (!cond) erros.push(msg);
  console.log(`  ${cond ? "OK   " : "FALHA"} ${msg}`);
};
const titulo = (t) => console.log(`\n=== ${t} ===\n`);

const arquivo = path.join(
  __dirname, "..", "client", "src", "components", "flow", "VisualFlowEditor.jsx"
);
const fonte = fs.readFileSync(arquivo, "utf8");

titulo("1. O LIMITADOR DE ZOOM");

const inicio = fonte.indexOf("const ZOOM_MIN");
const fim = fonte.indexOf("export function VisualFlowEditor");
check(inicio > 0 && fim > inicio, "achei o limitador no arquivo da tela");

const caixa = {};
vm.createContext(caixa);
vm.runInContext(
  `${fonte.slice(inicio, fim)}; this.limitarZoom = limitarZoom; this.ZOOM_MIN = ZOOM_MIN; this.ZOOM_MAX = ZOOM_MAX;`,
  caixa
);
const { limitarZoom, ZOOM_MIN, ZOOM_MAX } = caixa;

// O CASO QUE TRAVA A TELA. Zero e o unico valor de onde nao se volta.
check(limitarZoom(0) === 1, "zoom 0 vira 100% (senao o canvas some e nao ha como voltar)");
check(limitarZoom(-2) === 1, "negativo vira 100%");
check(limitarZoom(null) === 1, "null vira 100%");
check(limitarZoom(undefined) === 1, "undefined vira 100%");
check(limitarZoom(NaN) === 1, "NaN vira 100%");
check(limitarZoom("") === 1, "string vazia vira 100%");
check(limitarZoom("abc") === 1, "texto vira 100%");

// FORA DA FAIXA. Um valor gravado por uma versao futura (ou na mao) nao pode
// levar a tela a um zoom que os botoes nao conseguem desfazer.
check(limitarZoom(99) === ZOOM_MAX, `acima do teto vira ${ZOOM_MAX}`);
check(limitarZoom(0.01) === ZOOM_MIN, `abaixo do piso vira ${ZOOM_MIN}`);

// O QUE E VALIDO PASSA INTACTO -- senao o zoom "guardado" nunca seria o
// escolhido, e o recurso inteiro nao serviria para nada.
for (const z of [ZOOM_MIN, 0.5, 1, 1.15, 2, ZOOM_MAX]) {
  check(limitarZoom(z) === z, `${z} passa intacto`);
}
// Texto numerico: o servidor devolve JSON, e um valor gravado como string
// ("1.5") ainda e um zoom valido -- recusar seria jogar fora a preferencia.
check(limitarZoom("1.5") === 1.5, '"1.5" (texto) e aceito como 1.5');

titulo("2. A TELA ESTA LIGADA NA PREFERENCIA");

check(/usePreferencia\('fluxos\.zoom', 1\)/.test(fonte),
  "o zoom vem de usePreferencia (por usuario, no servidor), e nao de useState");
check(/const zoom = limitarZoom\(zoomSalvo\)/.test(fonte),
  "o valor guardado passa pelo limitador ANTES de virar zoom da tela");
check(/setZoomSalvo\(\(antes\) => limitarZoom\(/.test(fonte),
  "e tudo que e escrito passa pelo limitador tambem");

// Os tres pontos que mexem no zoom precisam usar o MESMO limitador. Enquanto a
// faixa vivia repetida em cada um deles, bastava ajustar um para o valor
// guardado sair do que a tela aceita.
const usos = (fonte.match(/limitarZoom\(/g) || []).length;
check(usos >= 6, `o limitador e usado em todos os caminhos (${usos} chamadas)`);
check(!/Math\.min\(Math\.max\(nz/.test(fonte), "a roda do mouse nao tem mais faixa propria");
check(!/Math\.max\(z \/ 1\.15, 0\.25\)/.test(fonte), "o botao de diminuir nao tem mais faixa propria");
check(!/Math\.min\(z \* 1\.15, 2\.5\)/.test(fonte), "o botao de aumentar nao tem mais faixa propria");

titulo("3. O PAN CONTINUA NASCENDO NO COMECO DO FLUXO");

// De proposito: o pan aponta para um LUGAR do desenho, e cada fluxo tem o seu.
// Um valor unico guardado abriria o fluxo B olhando para o vazio onde ficam os
// blocos do fluxo A.
check(/useState\(\{ x: 100, y: 100 \}\)/.test(fonte),
  "canvasOffset segue em useState com 100,100 (nao e preferencia)");

console.log(`\n${erros.length === 0 ? "ZOOM DO EDITOR: TUDO CONFERE" : `${erros.length} FALHA(S)`}\n`);
if (erros.length) {
  erros.forEach((e) => console.log(`  - ${e}`));
  process.exit(1);
}
