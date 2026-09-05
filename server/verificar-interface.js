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
/**
 * O ALERTA "AUTOMACAO DESATIVADA" -- as tres condicoes que ele precisa.
 *
 * Ele ja acusou o bot de estar desligado com os fluxos rodando, e para a equipe
 * inteira. Duas causas, e as duas faceis de reintroduzir sem perceber:
 *
 *   LISTA VAZIA POR FALHA    `resolver` transforma chamada recusada em `[]`, e
 *                            "nao ha fluxo" ficava igual a "nao consegui
 *                            perguntar";
 *   PUBLICO ERRADO           a mensagem manda ativar um fluxo numa tela que so
 *                            o administrador abre.
 *
 * Isto e conferido por LEITURA do arquivo porque a regra vive num efeito de
 * React, e exercita-la de verdade exigiria montar o contexto inteiro -- caro
 * demais para o que se quer travar, que e a condicao nao voltar a ser so
 * `fluxosAtivos === 0`.
 */
titulo("2b. O alerta de automacao so acusa quando SABE, e so para quem resolve");
{
  const ctx = arquivos.find((f) => f.endsWith("AppContext.jsx"));
  const s = ctx ? fs.readFileSync(ctx, "utf8") : "";
  const condicao = /if \(([^)]*fluxosAtivos === 0[^)]*)\)/.exec(s)?.[1] || "";
  check("o alerta existe e tem condicao legivel", condicao ? [] : ["nao achei a condicao do alerta em AppContext.jsx"]);
  check(
    "so acusa quando a leitura dos fluxos deu certo",
    /fluxosCarregados/.test(condicao) ? [] : [`condicao sem \`fluxosCarregados\`: ${condicao}`]
  );
  check(
    "e so para administrador",
    /ehAdmin|Administrador/.test(condicao) ? [] : [`condicao sem recorte de cargo: ${condicao}`]
  );
  // O estado tem de ser DESLIGADO quando a leitura falha -- senao ele fica
  // `true` de uma leitura anterior e a protecao nao vale nada.
  check(
    "e `fluxosCarregados` volta a falso quando a leitura falha",
    /setFluxosCarregados\(false\)/.test(s) ? [] : ["nao ha reset de `fluxosCarregados` no catch"]
  );
}

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

/**
 * COMPONENTE USADO NO JSX E NUNCA IMPORTADO -- a TELA BRANCA.
 *
 * ── POR QUE O BUILD NAO PEGA ───────────────────────────────────────────────
 *
 * `<Trophy />` com `Trophy` inexistente compila sem um pio: o Vite nao resolve
 * identificador livre dentro de JSX. O erro so aparece quando a tela RENDERIZA,
 * e ai e "Trophy is not defined" com a pagina em branco -- em producao, depois
 * do deploy.
 *
 * Ja aconteceu duas vezes neste projeto, as duas por edicao em massa: um
 * `Trophy`/`ClipboardList` que ficou de fora do import, e depois um
 * `ChevronRight` cuja linha de import nao foi aplicada porque o guard achou que
 * ja estava la. Nos dois casos o build passou.
 *
 * ── O QUE ELA CONSIDERA DEFINIDO ───────────────────────────────────────────
 *
 * Import (nomeado, default ou renomeado), funcao/classe declarada no arquivo, e
 * variavel recebida por desestruturacao ou atribuicao -- que e como um
 * componente vindo de prop (`{ Icon }`) entra em cena. O objetivo e nao ter
 * falso positivo: uma varredura que grita a toa e desligada na primeira semana.
 */
const naoDefinidos = [];
for (const f of arquivos.filter((a) => a.endsWith(".jsx"))) {
  const s = fs.readFileSync(f, "utf8");
  const definidos = new Set();
  // `import X, { A, B } from` tambem: o default no meio do caminho fazia a
  // lista nomeada inteira passar batido, e a varredura acusava seis
  // componentes importados como se nao estivessem.
  for (const m of s.matchAll(/import\s+[^{;]*\{([^}]*)\}\s*from/g)) {
    // COMENTARIO FORA ANTES DE SEPARAR. Ha bloco de import com explicacao no
    // meio, e uma delas contem " as " -- o `split` colava o comentario inteiro
    // no nome seguinte, e o import ficava invisivel para esta varredura.
    const lista = m[1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    for (const n of lista.split(",")) {
      const nome = n.trim().split(/\s+as\s+/).pop().trim();
      if (/^[A-Za-z0-9_$]+$/.test(nome)) definidos.add(nome);
    }
  }
  for (const m of s.matchAll(/^\s*import\s+([A-Za-z0-9_$]+)\s*(?:,|from)/gm)) definidos.add(m[1]);
  for (const m of s.matchAll(/(?:function|class)\s+([A-Za-z0-9_$]+)/g)) definidos.add(m[1]);
  // `const X = ...`, `const { X, Y } = ...`, `let X`
  for (const m of s.matchAll(/(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=/g)) definidos.add(m[1]);
  for (const m of s.matchAll(/(?:const|let|var|\()\s*\{([^}]*)\}\s*(?:=|\))/g)) {
    for (const n of m[1].split(",")) definidos.add(n.trim().split(":").pop().trim().split("=")[0].trim());
  }

  for (const m of s.matchAll(/<([A-Z][A-Za-z0-9_$]*)[\s/>]/g)) {
    // `<Foo.Bar>` e um namespace; basta `Foo` estar definido.
    const raiz = m[1].split(".")[0];
    if (!definidos.has(raiz)) naoDefinidos.push(`${rel(f)}  <${m[1]}> usado sem import nem declaracao`);
  }
}
check("componente usado no JSX esta importado (tela branca)", [...new Set(naoDefinidos)]);

console.log(
  "\n" + (erros.length
    ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ")
    : `INTERFACE: TUDO CONFERE (${arquivos.length} arquivos)`)
);
process.exit(erros.length ? 1 : 0);
