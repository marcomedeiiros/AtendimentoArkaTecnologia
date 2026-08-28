/**
 * CRIAR CONTA COM O "NAO SOU UM ROBO".
 *
 * ── O DEFEITO ──────────────────────────────────────────────────────────────
 *
 * "Nao foi possivel confirmar que voce nao e um robo. Recarregue a pagina e
 * tente de novo." -- em TODA tentativa de cadastro.
 *
 * E nao havia CAPTCHA falhando. Havia METADE de um CAPTCHA.
 *
 * A rota `POST /api/auth/cadastrar` sempre teve `exigirTurnstile`, igual ao
 * login. A LoginPage desenha o widget e manda o token. A CadastroPage NAO:
 * nunca importou o componente, nunca teve o estado, e `cadastrar()` mandava so
 * nome, e-mail, senha e codigo.
 *
 * Com as chaves configuradas, o servidor recebia `turnstileToken: undefined`,
 * o cliente devolvia `{ok:false, motivo:"token-ausente"}` e a resposta era 403.
 * O servidor estava certo o tempo todo; a tela e que nao produzia a prova que
 * ele cobrava.
 *
 * ── O QUE ESTE ARQUIVO MEDE ────────────────────────────────────────────────
 *
 * A parte mais importante e a que NAO deve mudar: com o desafio ligado, o
 * cadastro sem token continua sendo recusado. O conserto e a tela passar a
 * mandar o token -- e nao a rota parar de cobrar.
 *
 * O `verificar` da Cloudflare e substituido por um dublê, porque bater na
 * Cloudflare de verdade num teste exigiria uma chave e uma resposta humana. O
 * que fica coberto e o CONTRATO: quem manda o token, quem o recebe, e o que a
 * rota faz com a resposta de cada lado.
 *
 * Cria e apaga as proprias contas. Nada real e tocado.
 *
 *   cd server && node verificar-cadastro-turnstile.js
 */
const fs = require("fs");
const path = require("path");

// LIGADO de proposito -- e o unico jeito de exercitar o guard. Precisa vir
// antes de qualquer require que leia a configuracao.
process.env.TURNSTILE_SITE_KEY = "1x00000000000000000000AA";
process.env.TURNSTILE_SECRET_KEY = "1x0000000000000000000000000000000AA";

const prisma = require("./src/infrastructure/database/prisma.client");
const turnstile = require("./src/infrastructure/external/turnstile.client");
const createApp = require("./src/app");

const MARCA = "teste-turnstile";
const SENHA = "SenhaCerta#2026";
const erros = [];
let secao = "";
const titulo = (t) => { secao = t; console.log(`\n=== ${t} ===`); };
const check = (ok, rotulo) => {
  console.log(`  ${ok ? "OK  " : "FALHA"} ${rotulo}`);
  if (!ok) erros.push(`[${secao}] ${rotulo}`);
};

let base = "";
let servidor = null;

// ── DUBLÊ DA CLOUDFLARE ────────────────────────────────────────────────────
//
// Aceita um unico token magico e recusa o resto, com os mesmos motivos que a
// Cloudflare devolveria. Registra o que recebeu, para dar para afirmar que o
// token CHEGOU ao servidor -- que e metade da pergunta.
const TOKEN_BOM = "token-valido-de-teste";
const recebidos = [];
const usados = new Set();
const verificarReal = turnstile.verificar;
turnstile.verificar = async (token) => {
  recebidos.push(token);
  if (!token || typeof token !== "string") return { ok: false, motivo: "token-ausente" };
  // Uso unico, como a Cloudflare: reapresentar da `timeout-or-duplicate`.
  if (usados.has(token)) return { ok: false, motivo: "timeout-or-duplicate" };
  if (token !== TOKEN_BOM) return { ok: false, motivo: "invalid-input-response" };
  usados.add(token);
  return { ok: true };
};

async function pedir(caminho, { metodo = "GET", corpo } = {}) {
  const r = await fetch(base + caminho, {
    method: metodo,
    headers: { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.11, 10.0.0.1" },
    ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
  });
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* nao-JSON */ }
  return { status: r.status, json, texto };
}

const conta = (sufixo, extra = {}) => ({
  nome: `${MARCA} ${sufixo}`,
  email: `${MARCA}-${sufixo}@exemplo.test`,
  senha: SENHA,
  ...extra,
});

async function limpar() {
  await prisma.usuario.deleteMany({ where: { email: { startsWith: `${MARCA}-` } } });
}

async function main() {
  await limpar();

  const app = createApp();
  await new Promise((ok) => { servidor = app.listen(0, ok); });
  base = `http://127.0.0.1:${servidor.address().port}`;

  // ─────────────────────────────────────────────────────────────────────────
  titulo("1. A tela sabe QUE ha um desafio, e qual chave usar");

  const cfg = await pedir("/api/auth/turnstile");
  check(cfg.status === 200, `GET /auth/turnstile -> ${cfg.status}`);
  check(cfg.json?.data?.ativo === true, "o servidor diz que o desafio esta ativo");
  check(
    cfg.json?.data?.siteKey === process.env.TURNSTILE_SITE_KEY,
    "a site key (publica) vem do servidor -- o front nao precisa de variavel de build"
  );
  check(
    !JSON.stringify(cfg.json).includes(process.env.TURNSTILE_SECRET_KEY),
    "a SECRET nao aparece na resposta"
  );

  // ─────────────────────────────────────────────────────────────────────────
  titulo("2. SEM token o cadastro e recusado (o defeito relatado, e a regra que fica)");

  recebidos.length = 0;
  const semToken = await pedir("/api/auth/cadastrar", { metodo: "POST", corpo: conta("sem") });
  check(semToken.status === 403, `cadastro sem turnstileToken -> ${semToken.status} (esperado 403)`);
  check(semToken.json?.error?.code === "TURNSTILE_INVALIDO", "com o codigo TURNSTILE_INVALIDO");
  check(recebidos[0] === null || recebidos[0] === undefined, "o servidor viu 'sem token' -- era isso que a tela mandava");
  const criouAssim = await prisma.usuario.count({ where: { email: `${MARCA}-sem@exemplo.test` } });
  check(criouAssim === 0, "e nenhuma conta foi criada");

  // ─────────────────────────────────────────────────────────────────────────
  titulo("3. COM token valido o cadastro conclui");

  recebidos.length = 0;
  const comToken = await pedir("/api/auth/cadastrar", {
    metodo: "POST", corpo: conta("com", { turnstileToken: TOKEN_BOM }),
  });
  check(comToken.status === 201, `cadastro com token valido -> ${comToken.status} (esperado 201)`);
  check(recebidos[0] === TOKEN_BOM, "o token do formulario CHEGOU ao servidor (o Zod nao o descartou)");
  check(!!comToken.json?.data?.usuario?.id, "a resposta traz o usuario criado");
  check(!comToken.json?.data?.token, "e NAO traz sessao -- criar conta nao e entrar");

  const noBanco = await prisma.usuario.findUnique({ where: { email: `${MARCA}-com@exemplo.test` } });
  check(!!noBanco, "a conta existe no banco");
  check(noBanco?.cargo === "Técnico", `o cargo e o padrao seguro, nao um escolhido pelo cliente (${noBanco?.cargo})`);

  // ─────────────────────────────────────────────────────────────────────────
  titulo("4. Token forjado, vazio ou repetido continua sendo recusado");

  const forjado = await pedir("/api/auth/cadastrar", {
    metodo: "POST", corpo: conta("forjado", { turnstileToken: "sim" }),
  });
  check(forjado.status === 403, `token inventado -> ${forjado.status}`);

  const vazio = await pedir("/api/auth/cadastrar", {
    metodo: "POST", corpo: conta("vazio", { turnstileToken: "" }),
  });
  check(vazio.status === 403, `token vazio -> ${vazio.status}`);

  // Uso unico: e por isso que a tela precisa ZERAR o token depois de uma
  // tentativa falha. Sem isso, a segunda tentativa levaria "nao foi possivel
  // confirmar que voce nao e um robo" no lugar do erro de verdade.
  const repetido = await pedir("/api/auth/cadastrar", {
    metodo: "POST", corpo: conta("repetido", { turnstileToken: TOKEN_BOM }),
  });
  check(repetido.status === 403, `o MESMO token de novo -> ${repetido.status} (replay)`);

  const sobraram = await prisma.usuario.count({
    where: { email: { in: [`${MARCA}-forjado@exemplo.test`, `${MARCA}-vazio@exemplo.test`, `${MARCA}-repetido@exemplo.test`] } },
  });
  check(sobraram === 0, "nenhuma dessas tentativas criou conta");

  // ─────────────────────────────────────────────────────────────────────────
  titulo("5. O desafio roda ANTES do resto -- e a ordem importa");

  // Corpo invalido (senha curta) COM token bom: o 400 do schema tem de vir
  // primeiro, senao o token seria gasto a toa numa requisicao malformada.
  const corpoRuim = await pedir("/api/auth/cadastrar", {
    metodo: "POST", corpo: { nome: "x", email: "nao-e-email", senha: "123", turnstileToken: TOKEN_BOM },
  });
  check(corpoRuim.status === 400, `corpo malformado -> ${corpoRuim.status} (o schema vem antes do desafio)`);

  // ─────────────────────────────────────────────────────────────────────────
  titulo("6. A TELA de cadastro produz o token (a metade que faltava)");

  const cadastroJsx = fs.readFileSync(
    path.join(__dirname, "..", "client", "src", "pages", "CadastroPage.jsx"),
    "utf8"
  );
  check(/from '\.\.\/components\/Turnstile'/.test(cadastroJsx), "a CadastroPage importa o componente Turnstile");
  check(/<Turnstile\s+onToken=\{setTurnstileToken\}/.test(cadastroJsx), "e o renderiza, ligado ao estado");
  check(/turnstileToken\s*\?\s*\{\s*turnstileToken\s*\}/.test(cadastroJsx), "e manda o token no corpo do cadastro");
  check(/setTurnstileToken\(null\)/.test(cadastroJsx), "e o zera depois de uma tentativa falha (o token vale uma vez)");

  // O contrato do lado do cliente de API: o campo tem de sobreviver ate o fetch.
  const apiJs = fs.readFileSync(path.join(__dirname, "..", "client", "src", "services", "api.js"), "utf8");
  const trecho = apiJs.slice(apiJs.indexOf("cadastrar:"), apiJs.indexOf("eu: ()"));
  check(/publico\('\/auth\/cadastrar', dados\)/.test(trecho), "AuthAPI.cadastrar repassa o corpo inteiro, sem peneirar campos");

  // ─────────────────────────────────────────────────────────────────────────
  titulo("7. Sem chaves configuradas, as duas pontas ficam desligadas juntas");

  const semChave = await turnstile.__semChaves();
  check(semChave, "com a configuracao desligada, o verificador libera (fail-open declarado em config/env)");

  // ─────────────────────────────────────────────────────────────────────────
  titulo("limpeza");
  await limpar();
  const sobrou = await prisma.usuario.count({ where: { email: { startsWith: `${MARCA}-` } } });
  check(sobrou === 0, `limpeza completa (sobraram ${sobrou})`);
}

// Pequeno auxiliar: pergunta ao cliente REAL (nao ao dublê) o que ele faz sem
// chaves configuradas. Fica aqui, e nao no cliente, para nao acrescentar
// superficie de teste ao codigo de producao.
//
// `ativo` e um GETTER derivado de siteKey+secretKey (config/env.js) -- atribuir
// nele nao faz nada. Quem se apaga sao as chaves. (A primeira versao deste
// arquivo escrevia `env.turnstile.ativo = false`, o assignment sumia em
// silencio, e o teste media o desafio LIGADO achando que estava desligado.)
turnstile.__semChaves = async () => {
  const env = require("./src/config/env");
  const { siteKey, secretKey } = env.turnstile;
  env.turnstile.siteKey = "";
  env.turnstile.secretKey = "";
  try {
    if (env.turnstile.ativo) return false; // a premissa do teste nao vale
    const r = await verificarReal(null);
    return r.ok === true && r.motivo === "desligado";
  } finally {
    env.turnstile.siteKey = siteKey;
    env.turnstile.secretKey = secretKey;
  }
};

main()
  .catch((e) => { erros.push(`excecao: ${e.message}`); console.error(e); })
  .finally(async () => {
    await limpar().catch(() => {});
    if (servidor) servidor.close();
    await prisma.$disconnect();
    if (erros.length) {
      console.log(`\nFALHAS (${erros.length}):`);
      for (const e of erros) console.log(`  ${e}`);
      process.exit(1);
    }
    console.log("\nCADASTRO COM TURNSTILE: TUDO CONFERE");
  });
