/**
 * O QUE O SERVIDOR ENTREGA A QUEM NAO PEDIU LICENCA.
 *
 * ── POR QUE ESTE ARQUIVO EXISTE ────────────────────────────────────────────
 *
 * Autorizacao de rota protege o DADO. Este arquivo cuida de outra coisa: o que
 * o servidor conta sobre si mesmo antes de qualquer login.
 *
 * O caso que originou o teste: `/api-docs` (Swagger) estava montado sem nenhuma
 * condicao, e o nginx o publica para a internet (client/nginx.conf). Qualquer
 * pessoa lia a lista completa de rotas, parametros e formatos de corpo -- o
 * mapa do sistema, pronto. Isso nao derruba a autorizacao de nada, mas poupa a
 * quem ataca justamente a parte demorada, que e descobrir o que existe.
 *
 * O teste sobe o app DUAS VEZES, uma como producao e outra como
 * desenvolvimento, porque a unica forma de provar "fechado em producao" e
 * mostrar que em desenvolvimento continua aberto. Um teste que so verificasse
 * "esta fechado" passaria tambem se alguem tivesse apagado o Swagger inteiro --
 * e aí a comodidade de quem desenvolve teria sido perdida em silencio.
 *
 * Nao toca no banco: so sobe o app e faz requisicoes HTTP.
 *
 *   cd server && node verificar-exposicao.js
 */
const erros = [];
let secao = "";
const titulo = (t) => { secao = t; console.log(`\n=== ${t} ===`); };
const check = (rotulo, obtido, esperado) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  console.log(`  ${ok ? "OK  " : "FALHA"} ${rotulo}`);
  if (!ok) {
    console.log(`        obtido:   ${JSON.stringify(obtido)}`);
    console.log(`        esperado: ${JSON.stringify(esperado)}`);
    erros.push(`[${secao}] ${rotulo}`);
  }
};

// O app le `NODE_ENV` na carga do modulo (config/env.js), entao trocar o
// ambiente exige recarregar tudo -- por isso o cache do require e limpo.
function subirCom(nodeEnv, extras = {}) {
  for (const k of Object.keys(require.cache)) {
    if (k.includes(`${require("path").sep}src${require("path").sep}`)) delete require.cache[k];
  }
  const anterior = { NODE_ENV: process.env.NODE_ENV, ...extras };
  process.env.NODE_ENV = nodeEnv;
  for (const [k, v] of Object.entries(extras)) process.env[k] = v;

  // Em producao o env.js EXIGE os segredos; sem isso o app nem carrega e o
  // teste falharia por motivo errado.
  const guardados = {};
  for (const s of ["JWT_SECRET", "WEBHOOK_SECRET", "EVOLUTION_API_KEY"]) {
    guardados[s] = process.env[s];
    if (!process.env[s]) process.env[s] = "segredo-so-para-este-teste-nao-usar";
  }

  const app = require("./src/app")();
  return { app, restaurar: () => {
    process.env.NODE_ENV = anterior.NODE_ENV || "development";
    for (const k of Object.keys(extras)) delete process.env[k];
    for (const [k, v] of Object.entries(guardados)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  } };
}

function ouvir(app) {
  return new Promise((res) => {
    const s = app.listen(0, "127.0.0.1", () => res({ s, base: `http://127.0.0.1:${s.address().port}` }));
  });
}

async function status(base, caminho) {
  try { return (await fetch(base + caminho)).status; } catch { return 0; }
}

(async () => {
  // ── Producao: o indice fica fechado ──────────────────────────────────────
  {
    const { app, restaurar } = subirCom("production");
    const { s, base } = await ouvir(app);
    titulo("1. Em producao, a documentacao da API nao e publica");
    check("GET /api-docs -> 404", await status(base, "/api-docs/"), 404);
    check("GET /api-docs.json -> 404", await status(base, "/api-docs.json"), 404);
    // O que continua de pe: o `/health` e proposital (o compose usa para saber
    // se o container subiu), e as rotas reais seguem respondendo.
    check("GET /health continua respondendo", await status(base, "/health"), 200);
    check("rota protegida responde 401, e nao 404 (a API esta viva)",
      await status(base, "/api/conversas"), 401);
    s.close(); restaurar();
  }

  // ── Producao com a porta reaberta de proposito ───────────────────────────
  {
    const { app, restaurar } = subirCom("production", { API_DOCS: "1" });
    const { s, base } = await ouvir(app);
    titulo("2. API_DOCS=1 reabre, para quando for uma decisao consciente");
    check("GET /api-docs.json -> 200", await status(base, "/api-docs.json"), 200);
    s.close(); restaurar();
  }

  // ── Desenvolvimento: a comodidade continua ───────────────────────────────
  {
    const { app, restaurar } = subirCom("development");
    const { s, base } = await ouvir(app);
    titulo("3. Em desenvolvimento nada foi tirado de quem trabalha no projeto");
    check("GET /api-docs.json -> 200", await status(base, "/api-docs.json"), 200);
    s.close(); restaurar();
  }

  console.log(
    "\n" + (erros.length
      ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ")
      : "EXPOSICAO: TUDO CONFERE")
  );
  process.exit(erros.length ? 1 : 0);
})();
