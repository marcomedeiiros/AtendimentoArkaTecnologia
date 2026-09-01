/**
 * CONTRATO ENTRE A TELA E O SERVIDOR -- as duas pontas precisam existir.
 *
 * ── POR QUE ESTE ARQUIVO EXISTE ────────────────────────────────────────────
 *
 * Este defeito já aconteceu DUAS vezes, do mesmo jeito:
 *
 *     Es.turnstile is not a function      (tela de login, em produção)
 *     js.sairDeTodos is not a function    (perfil: encerrar sessões)
 *
 * Nos dois casos o recurso foi escrito numa branch, e só METADE chegou na main:
 * a tela veio, o método do cliente de API não. Em desenvolvimento nada acusa --
 * `AuthAPI.sairDeTodos` é `undefined`, e `undefined` só explode no clique. Quem
 * descobre é o usuário, no ar, com o nome minificado da variável na cara.
 *
 * O build não pega isso: chamar propriedade que não existe é JavaScript válido.
 * Então a conferência tem que ser esta aqui, e ela cobre os dois sentidos:
 *
 *   1. Todo `XxxAPI.metodo(...)` chamado numa tela EXISTE em services/api.js.
 *      (é o erro exato que aparece no navegador)
 *
 *   2. Todo caminho que o api.js chama EXISTE como rota no servidor.
 *      (o outro meio recurso: método no cliente, rota nenhuma -> 404 no clique)
 *
 * Não sobe servidor e não toca no banco: é leitura dos dois lados do código.
 *
 *   cd server && node verificar-contrato-api.js
 */
const fs = require("fs");
const path = require("path");

const RAIZ_CLIENTE = path.join(__dirname, "..", "client", "src");
const RAIZ_SERVIDOR = path.join(__dirname, "src");
const API_JS = path.join(RAIZ_CLIENTE, "services", "api.js");

function listar(dir, filtro) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return listar(p, filtro);
    return filtro.test(e.name) ? [p] : [];
  });
}

const arquivosCliente = listar(RAIZ_CLIENTE, /\.jsx?$/);
const rel = (p, raiz) => path.relative(raiz, p).replace(/\\/g, "/");

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
// O QUE O api.js OFERECE
//
// Cada `export const XxxAPI = { ... }` é um objeto de métodos. O corte entre um
// objeto e o seguinte é o próximo `export const` -- não dá para casar chaves com
// expressão regular, e não precisa: o que interessa são os nomes no primeiro
// nível de indentação, que é como o arquivo inteiro é escrito.
const fonteApi = fs.readFileSync(API_JS, "utf8");
const linhasApi = fonteApi.split("\n");

const objetosApi = new Map();   // nome do objeto -> Set de métodos
const caminhosPedidos = [];     // { caminho, metodoHttp, linha }

let objetoAtual = null;
linhasApi.forEach((l, i) => {
  const abre = l.match(/^export const ([A-Za-z0-9_]+API)\s*=\s*\{/);
  if (abre) {
    objetoAtual = abre[1];
    objetosApi.set(objetoAtual, new Set());
    return;
  }
  if (/^export /.test(l) || /^\}/.test(l)) {
    if (!abre) objetoAtual = objetosApi.has(objetoAtual) && /^\}/.test(l) ? null : objetoAtual;
  }
  if (!objetoAtual) return;

  // Método no primeiro nível: `  nome: ...` ou `  nome(...)`.
  const m = l.match(/^  ([A-Za-z0-9_]+)\s*[:(]/);
  if (m) objetosApi.get(objetoAtual).add(m[1]);
});

// Caminhos pedidos ao servidor. Cobre `request('/x')`, `publico('/x', ...)` e
// as crases com interpolação -- nestas, só a parte fixa antes do `${` importa,
// que é justamente o pedaço que precisa bater com a rota.
linhasApi.forEach((l, i) => {
  if (/^\s*(\/\/|\*|\/\*)/.test(l)) return;
  const chamadas = l.match(/\b(?:request|publico)\(\s*[`'"]([^`'"$]*)/g) || [];
  for (const c of chamadas) {
    const caminho = c.replace(/\b(?:request|publico)\(\s*[`'"]/, "");
    if (!caminho.startsWith("/")) continue;
    // `publico()` é sempre POST (ver o helper no api.js: ele existe justamente
    // para mandar corpo sem token). `request()` é GET quando não diz o método.
    const ehPublico = /\bpublico\(/.test(c);
    const metodoHttp = ehPublico
      ? "POST"
      : (l.match(/method:\s*['"]([A-Z]+)['"]/) || [, "GET"])[1];
    caminhosPedidos.push({ caminho, metodoHttp, linha: i + 1 });
  }
});

// ---------------------------------------------------------------------------
titulo("1. Todo XxxAPI.metodo() chamado na tela existe no api.js");

const chamadasOrfas = [];
for (const f of arquivosCliente) {
  if (f === API_JS) continue;
  fs.readFileSync(f, "utf8").split("\n").forEach((l, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(l)) return;
    const usos = l.match(/\b([A-Za-z0-9_]+API)\.([A-Za-z0-9_]+)\s*\(/g) || [];
    for (const u of usos) {
      const [, objeto, metodo] = u.match(/\b([A-Za-z0-9_]+API)\.([A-Za-z0-9_]+)\s*\(/);
      if (!objetosApi.has(objeto)) continue;   // objeto de outro lugar
      if (objetosApi.get(objeto).has(metodo)) continue;
      chamadasOrfas.push(
        `${rel(f, RAIZ_CLIENTE)}:${i + 1}  ${objeto}.${metodo}() nao existe em services/api.js`
      );
    }
  });
}
check("nenhuma chamada sem metodo", chamadasOrfas);

// ---------------------------------------------------------------------------
titulo("2. Todo caminho que o api.js chama existe como rota no servidor");

// Onde cada prefixo é montado (app.js) -- é o que liga `/api/auth` ao arquivo
// de rotas correspondente.
const appJs = fs.readFileSync(path.join(RAIZ_SERVIDOR, "app.js"), "utf8");
const montagens = new Map();  // "/api/auth" -> "authRoutes"
for (const m of appJs.matchAll(/app\.use\(\s*"([^"]+)"\s*,\s*([A-Za-z0-9_]+)\s*\)/g)) {
  if (m[1].startsWith("/api")) montagens.set(m[1], m[2]);
}

// De `authRoutes` para o arquivo que o define. Duas formas convivem no app.js:
//
//   const authRoutes = require("./modules/auth/auth.routes");
//   const { webhookRouter, adminRouter } = require("./modules/whatsapp/...");
//
// A segunda é a que faltava, e por causa dela as 8 rotas de WhatsApp apareciam
// como inexistentes.
const arquivoDoRouter = new Map();
for (const m of appJs.matchAll(/const\s+([A-Za-z0-9_]+)\s*=\s*require\(["']([^"']+)["']\)/g)) {
  arquivoDoRouter.set(m[1], m[2]);
}
for (const m of appJs.matchAll(/const\s*\{([^}]+)\}\s*=\s*require\(["']([^"']+)["']\)/g)) {
  for (const nome of m[1].split(",").map((s) => s.trim()).filter(Boolean)) {
    arquivoDoRouter.set(nome, m[2]);
  }
}

// Todas as rotas declaradas no servidor, já com o prefixo de montagem.
//
// O nome da variável importa: num arquivo com DOIS routers (whatsapp tem o
// público do webhook e o administrativo), procurar por `router.` pegaria os dois
// e daria rota por existir no arquivo errado. Procura-se o nome montado.
const rotasDoServidor = new Set();
const semArquivo = [];
for (const [prefixo, nomeRouter] of montagens) {
  const relativo = arquivoDoRouter.get(nomeRouter);
  const alvo = relativo &&
    path.resolve(RAIZ_SERVIDOR, relativo.replace(/^\.\//, "") + (relativo.endsWith(".js") ? "" : ".js"));
  if (!alvo || !fs.existsSync(alvo)) {
    semArquivo.push(`${prefixo} -> ${nomeRouter} (arquivo nao encontrado)`);
    continue;
  }
  const fonte = fs.readFileSync(alvo, "utf8");
  const padrao = new RegExp(`\\b(?:${nomeRouter}|router)\\.(get|post|put|patch|delete)\\(\\s*["'\`]([^"'\`]*)`, "g");
  for (const m of fonte.matchAll(padrao)) {
    const sub = m[2] === "/" ? "" : m[2];
    rotasDoServidor.add(`${m[1].toUpperCase()} ${prefixo}${sub}`);
  }
}

// Um caminho do cliente casa com uma rota quando a parte FIXA bate. Parâmetros
// (`/:id`) viram curinga, e o cliente interpola valor ali.
function existeRota(metodoHttp, caminho) {
  const alvo = `${metodoHttp} ${caminho}`.replace(/\/$/, "");
  for (const rota of rotasDoServidor) {
    if (rota.replace(/\/$/, "") === alvo) return true;
    // Compara segmento a segmento, aceitando `:param` como curinga.
    const [mR, pR] = rota.split(" ");
    if (mR !== metodoHttp) continue;
    const segR = pR.split("/").filter(Boolean);
    const segC = caminho.split("/").filter(Boolean);
    if (segR.length !== segC.length) continue;
    if (segR.every((s, i) => s.startsWith(":") || s === segC[i])) return true;
    // O cliente pode ter cortado no `${`: aceita prefixo.
    if (segC.length < segR.length && segC.every((s, i) => s === segR[i])) return true;
  }
  return false;
}

const caminhosSemRota = [];
for (const { caminho, metodoHttp, linha } of caminhosPedidos) {
  const completo = caminho.startsWith("/api") ? caminho : `/api${caminho}`;
  const limpo = completo.split("?")[0].replace(/\/$/, "");
  // Caminho cortado numa interpolação (`/conversas/`) não dá para conferir: o
  // que sobrou não identifica rota nenhuma. Some do teste em vez de virar ruído.
  if (limpo.split("/").filter(Boolean).length < 2) continue;
  if (existeRota(metodoHttp, limpo)) continue;
  // Prefixo de uma rota mais longa também vale (interpolação cortada no meio).
  const ehPrefixo = [...rotasDoServidor].some(
    (r) => r.startsWith(`${metodoHttp} ${limpo}/`) || r.startsWith(`${metodoHttp} ${limpo}`)
  );
  if (ehPrefixo) continue;
  caminhosSemRota.push(`services/api.js:${linha}  ${metodoHttp} ${limpo} nao tem rota no servidor`);
}
check("nenhum caminho sem rota", caminhosSemRota);

// ---------------------------------------------------------------------------
titulo("3. O corpo que a tela manda sobrevive ao schema do servidor");

// ── A TERCEIRA FORMA DE METADE-DE-RECURSO ──────────────────────────────────
//
// As duas seções acima cobrem "o método não existe" e "a rota não existe". Falta
// a que não aparece em nenhuma das duas, porque os dois lados EXISTEM e mesmo
// assim o recurso não funciona: o campo que a tela manda no corpo não está
// declarado no schema Zod, e `validate` faz `req.body = schema.parse(req.body)`
// -- `z.object` DESCARTA chave desconhecida, calado, sem erro nenhum.
//
// Foi exatamente o que aconteceu com o "responder" da Central: ela mandava
// `respondendoAId` em toda resposta, a rota existia, o service sabia montar o
// `quoted`... e o campo era comido na porta. A resposta chegava ao cliente sem
// citar nada e a própria Central não desenhava o trecho citado -- sintoma de
// recurso quebrado no WhatsApp, causa a três camadas de distância.
//
// Um erro de validação é ruidoso e alguém conserta; uma chave apagada em
// silêncio sobrevive a um deploy inteiro. Por isso a conferência é sobre
// SOBREVIVÊNCIA da chave, e não sobre o schema aceitar o corpo.
const corposDaTela = [
  // rota                                  schema                    corpo montado em services/api.js
  ["POST /conversas/:id/mensagens",        "enviarMensagemSchema",   { texto: "oi", respondendoAId: "m-1" }],
  ["POST /conversas/:id/mensagens (sem citação)", "enviarMensagemSchema", { texto: "oi", respondendoAId: null }],
  ["PATCH /conversas/mensagens/:id",       "editarMensagemSchema",   { texto: "corrigido" }],
  ["POST /conversas/mensagens/encaminhar", "encaminharMensagemSchema", { mensagemId: "m-1", conversaDestinoId: "c-2" }],
  ["PATCH /conversas/:id/status",          "atualizarStatusSchema",  { status: "aberta" }],
  ["POST /conversas/:id/validar-cnpj",     "validarCnpjSchema",      { cnpj: "12345678000199" }],
];

const dto = require("./src/modules/conversas/conversa.dto");
const camposcomidos = [];
for (const [rota, nomeSchema, corpo] of corposDaTela) {
  const schema = dto[nomeSchema];
  if (!schema) { camposcomidos.push(`${rota}: schema ${nomeSchema} nao existe no dto`); continue; }
  const r = schema.safeParse(corpo);
  if (!r.success) {
    camposcomidos.push(`${rota}: o corpo da tela nao passa em ${nomeSchema} -- ${r.error.issues[0]?.message}`);
    continue;
  }
  // `null` sobrevive como null; o que não pode é a chave SUMIR.
  for (const chave of Object.keys(corpo)) {
    if (!(chave in r.data)) {
      camposcomidos.push(`${rota}: ${nomeSchema} descarta "${chave}" -- a tela manda e o servidor nunca ve`);
    }
  }
}
check("nenhum campo do corpo e descartado pelo schema", camposcomidos);

// ---------------------------------------------------------------------------
titulo("4. O mapa foi lido de verdade (senao os testes acima passam vazios)");

check("objetos de API encontrados", objetosApi.size > 0 ? [] : ["nenhum XxxAPI lido do api.js"]);
check("rotas do servidor encontradas", rotasDoServidor.size > 0 ? [] : ["nenhuma rota lida do servidor"]);
// Um router que o teste não conseguiu abrir some com TODAS as rotas dele, e aí
// a seção 2 passa por ignorância, não por acerto. Falha alto em vez de calar.
check("todo router montado foi lido", semArquivo);
console.log(`        (${objetosApi.size} objetos de API, ${rotasDoServidor.size} rotas, ${caminhosPedidos.length} chamadas)`);

console.log(
  "\n" + (erros.length
    ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ")
    : "CONTRATO DA API: TUDO CONFERE")
);
process.exit(erros.length ? 1 : 0);
