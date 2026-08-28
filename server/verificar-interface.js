/**
 * A INTERFACE CUMPRE O QUE ELA PROMETE?
 *
 * ── POR QUE ESTE ARQUIVO EXISTE ────────────────────────────────────────────
 *
 * Tres defeitos desta sessao foram a MESMA coisa, e nenhum deles o build pega:
 *
 *     Es.turnstile is not a function     metade do recurso veio na branch
 *     js.sairDeTodos is not a function   metade do recurso veio na branch
 *     "cole com Ctrl+V" nao colava       a funcao existia e nunca foi ligada
 *
 * No terceiro, `BugsPage.jsx` tinha a funcao `aoColar` escrita, testada no olho,
 * e o texto "ou cole com Ctrl+V" na tela -- faltava so o `onPaste` no elemento.
 * JavaScript nao reclama de uma funcao que ninguem chama, e a tela continua
 * anunciando o recurso. Quem descobre e o usuario, tentando.
 *
 * As duas conferencias aqui atacam esse formato de erro:
 *
 *   1. Funcao de evento escrita e NUNCA ligada. Se alguem escreveu `aoColar`,
 *      `aoSoltar`, `aoArrastar`, era para acontecer alguma coisa.
 *   2. Texto que PROMETE Ctrl+V numa tela sem `onPaste`. A promessa esta na
 *      interface; a implementacao tem de estar no mesmo arquivo.
 *
 * Nao sobe servidor e nao toca no banco: e leitura dos arquivos do cliente.
 *
 *   cd server && node verificar-interface.js
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

const erros = [];
let secao = "";
const titulo = (t) => { secao = t; console.log(`\n=== ${t} ===`); };
const check = (rotulo, ocorrencias) => {
  const ok = ocorrencias.length === 0;
  console.log(`  ${ok ? "OK  " : "FALHA"} ${rotulo}`);
  for (const o of ocorrencias) console.log(`        ${o}`);
  if (!ok) erros.push(`[${secao}] ${rotulo} (${ocorrencias.length})`);
};

// Comentario nao e codigo: ele CITA nomes de funcao para explica-los.
const semComentarios = (fonte) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ---------------------------------------------------------------------------
titulo("1. Funcao de evento escrita e nunca ligada");

// Nomes que existem para RESPONDER a uma acao de quem usa. Se um deles aparece
// uma vez so no arquivo, essa vez foi a declaracao -- ninguem o usa.
const PREFIXOS = /^(ao|on|handle|lidar|tratar)[A-Z]/;
const naoLigadas = [];
for (const f of arquivos) {
  const fonte = semComentarios(fs.readFileSync(f, "utf8"));
  const declaradas = new Set();
  for (const m of fonte.matchAll(/function\s+([A-Za-z0-9_]+)\s*\(/g)) declaradas.add(m[1]);
  for (const m of fonte.matchAll(/const\s+([A-Za-z0-9_]+)\s*=\s*(?:useCallback\()?\s*(?:async\s*)?\(/g)) declaradas.add(m[1]);

  for (const nome of declaradas) {
    if (!PREFIXOS.test(nome)) continue;
    const usos = (fonte.match(new RegExp(`\\b${nome}\\b`, "g")) || []).length;
    // 1 = so a propria declaracao. Exportada nao conta: quem usa e outro arquivo.
    const exportada = new RegExp(`export\\s+(?:default\\s+)?(?:function\\s+)?${nome}\\b`).test(fonte)
      || new RegExp(`\\b${nome}\\b\\s*[,}]`).test(fonte.split("export")[1] || "");
    if (usos <= 1 && !exportada) {
      const linha = fonte.slice(0, fonte.search(new RegExp(`\\b${nome}\\b`))).split("\n").length;
      naoLigadas.push(`${rel(f)}:${linha}  ${nome}() e declarada e nunca usada`);
    }
  }
}
check("toda funcao de evento esta ligada a alguma coisa", naoLigadas);

// ---------------------------------------------------------------------------
titulo("2. Quem promete Ctrl+V precisa ter onPaste");

// Foi o defeito literal: o rodape do modal de editar relato dizia "ou cole com
// Ctrl+V", o `aoColar` estava escrito, e faltava o `onPaste` no elemento.
const PROMESSA = /ctrl\s*\+?\s*v/i;
const prometeSemFazer = [];
for (const f of arquivos) {
  const fonte = fs.readFileSync(f, "utf8");
  const linhas = fonte.split("\n");
  const promete = linhas.some((l, i) => PROMESSA.test(l) && !/^\s*(\/\/|\*)/.test(l));
  if (!promete) continue;
  if (/onPaste\s*=/.test(fonte)) continue;
  const linha = linhas.findIndex((l) => PROMESSA.test(l) && !/^\s*(\/\/|\*)/.test(l)) + 1;
  prometeSemFazer.push(`${rel(f)}:${linha}  anuncia Ctrl+V mas o arquivo nao tem onPaste`);
}
check("toda tela que anuncia Ctrl+V tem onPaste", prometeSemFazer);

// ---------------------------------------------------------------------------
titulo("3. O colar de ARQUIVO nao pode engolir o colar de TEXTO");

// Interceptar todo `paste` quebraria o Ctrl+V normal dentro da descricao -- o
// usuario perderia algo que sempre funcionou para ganhar um recurso novo.
// Medido no navegador: com o filtro por `kind === 'file'`, colar texto passa
// direto (o handler nem chama preventDefault).
// Ha DOIS tipos de colar neste projeto, e a regra vale so para um:
//
//   ARQUIVO -- anexar print (ReportarBug, BugsPage, AtendimentoView). Tem de
//              filtrar `kind === 'file'`, senao cancela o colar de texto junto.
//   TEXTO   -- colar uma lista de "nome | telefone" no Envio em Massa. Este
//              PRECISA ler texto, e nao ha nada a corrigir nele. Ele ja se
//              protege do jeito certo: se veio uma linha so, devolve o evento
//              (`if (linhas.length <= 1) return`) e o Ctrl+V normal segue.
//
// Distinguir os dois pelo que o handler LE: quem chama `getData('text')` esta
// tratando texto de proposito.
const engoleTexto = [];
for (const f of arquivos) {
  const fonte = semComentarios(fs.readFileSync(f, "utf8"));
  if (!/onPaste\s*=/.test(fonte)) continue;
  if (/getData\(\s*['"]text/.test(fonte)) continue;   // colar de TEXTO, proposital
  const filtraArquivo = /kind\s*===\s*['"]file['"]/.test(fonte);
  const cancela = /preventDefault\(\)/.test(fonte);
  if (cancela && !filtraArquivo) {
    engoleTexto.push(`${rel(f)}  cancela o paste de arquivo sem filtrar por kind === 'file'`);
  }
}
check("o colar de ARQUIVO nao cancela o colar de texto", engoleTexto);

console.log(
  "\n" + (erros.length
    ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ")
    : `INTERFACE: TUDO CONFERE (${arquivos.length} arquivos)`)
);
process.exit(erros.length ? 1 : 0);
