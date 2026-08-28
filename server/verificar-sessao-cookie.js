/**
 * A SESSAO EM COOKIE HttpOnly, E O GUARD DE CSRF.
 *
 * ── POR QUE ESTE ARQUIVO EXISTE ────────────────────────────────────────────
 *
 * A sessao morava em `localStorage`, legivel por qualquer script da pagina. Um
 * XSS ali nao rouba uma requisicao: rouba a credencial de 30 dias e vai embora
 * com ela. `HttpOnly` fecha essa porta -- o navegador manda o cookie sozinho e
 * o JavaScript nao consegue le-lo.
 *
 * Mas trocar o lugar da sessao cria dois riscos novos, e sao eles que este
 * arquivo mede:
 *
 *   1. QUEBRAR O DEPLOY. Cookie no servidor + painel antigo mandando `Bearer`
 *      tem de conviver, senao todo mundo com a aba aberta e deslogado no
 *      instante da atualizacao. Este projeto ja derrubou o login em producao
 *      duas vezes exatamente assim, por subir metade de uma mudanca.
 *
 *   2. ABRIR O CSRF. Cookie o navegador manda SOZINHO -- um site qualquer passa
 *      a conseguir disparar acoes autenticadas em nome de quem esta logado. O
 *      guard fecha isso, e precisa fechar SEM barrar quem usa Bearer (que nao
 *      tem o vetor).
 *
 * Cria e apaga o proprio usuario. Nenhuma conta real e tocada.
 *
 *   cd server && node verificar-sessao-cookie.js
 */
process.env.TURNSTILE_SITE_KEY = "";
process.env.TURNSTILE_SECRET_KEY = "";

const bcrypt = require("bcryptjs");
const prisma = require("./src/infrastructure/database/prisma.client");
const createApp = require("./src/app");
const env = require("./src/config/env");

const MARCA = "teste-cookie";
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

// Guarda os cookies como um navegador guardaria, para poder devolve-los.
function lerCookies(r) {
  const mapa = {};
  for (const c of r.headers.getSetCookie?.() || []) {
    const [par, ...atributos] = c.split(";");
    const i = par.indexOf("=");
    mapa[par.slice(0, i).trim()] = {
      valor: par.slice(i + 1),
      atributos: atributos.map((a) => a.trim().toLowerCase()),
    };
  }
  return mapa;
}
const comoHeader = (mapa) =>
  Object.entries(mapa).map(([k, v]) => `${k}=${v.valor}`).join("; ");

async function pedir(caminho, { metodo = "GET", corpo, cookies, bearer, csrf, origem, comoProducao } = {}) {
  const h = { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.9, 10.0.0.1" };
  if (cookies) h.Cookie = comoHeader(cookies);
  if (bearer) h.Authorization = `Bearer ${bearer}`;
  if (csrf) h["X-CSRF-Token"] = csrf;
  if (origem) h.Origin = origem;
  // Reproduz a cadeia REAL de producao: a Cloudflare termina o HTTPS e fala
  // HTTP com o nginx, que repassa `X-Forwarded-Proto: http`. O navegador, do
  // outro lado, manda `Origin: https://...`.
  if (comoProducao) {
    h.Host = comoProducao;
    h["X-Forwarded-Host"] = comoProducao;
    h["X-Forwarded-Proto"] = "http";
  }
  const r = await fetch(base + caminho, {
    method: metodo, headers: h,
    ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
  });
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* nao-JSON */ }
  return { status: r.status, json, cookies: lerCookies(r), texto };
}

(async () => {
  let usuario = null;
  try {
    const app = createApp();
    await new Promise((res) => { servidor = app.listen(0, "127.0.0.1", res); });
    base = `http://127.0.0.1:${servidor.address().port}`;

    usuario = await prisma.usuario.create({
      data: {
        nome: "Teste Cookie", email: `${MARCA}@exemplo.invalido`,
        senhaHash: await bcrypt.hash(SENHA, 10), cargo: "Administrador", ativo: true,
      },
    });

    // ─────────────────────────────────────────────────────────────────────
    titulo("1. O login grava a sessao em cookie HttpOnly");
    const login = await pedir("/api/auth/login", {
      metodo: "POST", corpo: { email: usuario.email, senha: SENHA },
    });
    check(login.status === 200, `login -> ${login.status}`);

    const c = login.cookies;
    const nomes = env.cookie;
    check(!!c[nomes.nomeAcesso], `cookie de acesso (${nomes.nomeAcesso}) veio`);
    check(!!c[nomes.nomeRefresh], `cookie de renovacao (${nomes.nomeRefresh}) veio`);
    check(!!c[nomes.nomeCsrf], `cookie de CSRF (${nomes.nomeCsrf}) veio`);

    // A garantia central: JavaScript NAO pode ler a sessao.
    check(c[nomes.nomeAcesso]?.atributos.includes("httponly"), "o cookie de acesso e HttpOnly");
    check(c[nomes.nomeRefresh]?.atributos.includes("httponly"), "o cookie de renovacao e HttpOnly");
    // E o de CSRF NAO pode ser HttpOnly -- o front precisa le-lo para devolver
    // no header. E essa assimetria que prova a origem da requisicao.
    check(!c[nomes.nomeCsrf]?.atributos.includes("httponly"), "o de CSRF e legivel pelo JS (de proposito)");
    check(c[nomes.nomeAcesso]?.atributos.some((a) => a.startsWith("samesite=lax")), "SameSite=Lax (1a camada anti-CSRF)");
    // O de renovacao nao precisa acompanhar toda requisicao: caminho estreito.
    check(c[nomes.nomeRefresh]?.atributos.some((a) => a === "path=/api/auth"), "o de renovacao so vai para /api/auth");

    // ─────────────────────────────────────────────────────────────────────
    titulo("2. So o cookie ja autentica (sem Authorization)");
    const eu = await pedir("/api/auth/me", { cookies: c });
    check(eu.status === 200, `GET /me so com cookie -> ${eu.status}`);
    check(eu.json?.data?.email === usuario.email, "e devolve a conta certa");

    // ─────────────────────────────────────────────────────────────────────
    titulo("3. Compatibilidade: o painel ANTIGO continua funcionando");
    // Este e o teste que impede o deploy de deslogar todo mundo. O cliente
    // antigo le o token do corpo e manda no header, sem cookie nenhum.
    const tokenDoCorpo = login.json?.data?.token;
    check(!!tokenDoCorpo, "o corpo ainda traz o token (modo de transicao)");
    const comBearer = await pedir("/api/auth/me", { bearer: tokenDoCorpo });
    check(comBearer.status === 200, `GET /me so com Bearer -> ${comBearer.status}`);

    // E ESCRITA com Bearer nao pode exigir CSRF -- ali nao existe o vetor.
    const escritaBearer = await pedir("/api/auth/perfil", {
      metodo: "PATCH", bearer: tokenDoCorpo, corpo: { nome: "Teste Cookie" },
    });
    check(escritaBearer.status === 200, `PATCH com Bearer, sem CSRF -> ${escritaBearer.status}`);

    // ─────────────────────────────────────────────────────────────────────
    titulo("4. CSRF: escrita por cookie EXIGE o header");
    const csrf = c[nomes.nomeCsrf].valor;

    const semHeader = await pedir("/api/auth/perfil", {
      metodo: "PATCH", cookies: c, corpo: { nome: "Invasor" },
    });
    check(semHeader.status === 403, `PATCH por cookie SEM X-CSRF-Token -> ${semHeader.status} (esperado 403)`);

    const comHeader = await pedir("/api/auth/perfil", {
      metodo: "PATCH", cookies: c, csrf, corpo: { nome: "Teste Cookie" },
    });
    check(comHeader.status === 200, `PATCH por cookie COM o header -> ${comHeader.status}`);

    const headerErrado = await pedir("/api/auth/perfil", {
      metodo: "PATCH", cookies: c, csrf: "valor-que-o-atacante-chutou", corpo: { nome: "Invasor" },
    });
    check(headerErrado.status === 403, `header com valor errado -> ${headerErrado.status}`);

    // Origem estranha e recusada mesmo com o header certo -- e a camada que
    // nao depende de o navegador respeitar SameSite.
    const origemEstranha = await pedir("/api/auth/perfil", {
      metodo: "PATCH", cookies: c, csrf, origem: "https://site-do-atacante.example",
      corpo: { nome: "Invasor" },
    });
    check(origemEstranha.status === 403, `origem externa -> ${origemEstranha.status}`);

    // LEITURA nao muda estado: nao pode exigir CSRF, senao o painel nem carrega.
    const leitura = await pedir("/api/auth/me", { cookies: c });
    check(leitura.status === 200, `GET por cookie sem CSRF continua liberado -> ${leitura.status}`);

    // ─────────────────────────────────────────────────────────────────────
    titulo("4b. A PORTA DE ENTRADA nunca pode ser trancada pelo CSRF");
    //
    // Defeito real, achado medindo no navegador: com um cookie de sessao antigo
    // guardado, o proprio `POST /auth/login` levava 403. O guard via o cookie,
    // nao via o header, e recusava -- deixando a pessoa SEM CONSEGUIR ENTRAR.
    // Basta o cookie de sessao sobreviver ao de CSRF para o painel virar uma
    // porta trancada por dentro.
    //
    // Aqui nao existe o que proteger: login e cadastro nao AGEM sobre uma
    // sessao, eles criam uma -- e so depois de conferir e-mail e senha.
    const cookieVelho = { [nomes.nomeAcesso]: { valor: "token-de-uma-sessao-antiga", atributos: [] } };

    const loginComCookieVelho = await pedir("/api/auth/login", {
      metodo: "POST", cookies: cookieVelho, origem: base,
      corpo: { email: usuario.email, senha: SENHA },
    });
    check(loginComCookieVelho.status === 200,
      `login com cookie antigo e SEM header CSRF -> ${loginComCookieVelho.status}`);

    const cadastroComCookieVelho = await pedir("/api/auth/cadastrar", {
      metodo: "POST", cookies: cookieVelho, origem: base,
      corpo: { nome: "x", email: `${MARCA}-2@exemplo.invalido`, senha: "SenhaQualquer#1" },
    });
    check(cadastroComCookieVelho.status !== 403,
      `cadastro tambem nao e barrado por CSRF -> ${cadastroComCookieVelho.status}`);

    // A dispensa e SO do double submit: origem estranha continua recusada,
    // senao um site externo poderia forcar login na conta dele (login CSRF).
    const entradaDeFora = await pedir("/api/auth/login", {
      metodo: "POST", cookies: cookieVelho, origem: "https://site-do-atacante.example",
      corpo: { email: usuario.email, senha: SENHA },
    });
    check(entradaDeFora.status === 403,
      `mas a entrada vinda de origem externa e recusada -> ${entradaDeFora.status}`);

    // ─────────────────────────────────────────────────────────────────────
    titulo("4c. Atras da Cloudflare: HTTPS fora, HTTP dentro");
    //
    // DEFEITO QUE CHEGOU AO USUARIO: a primeira versao comparava
    // `esquema://host` e recusava TODO login em producao com "Origem nao
    // permitida". A Cloudflare termina o HTTPS e fala HTTP com o nginx, que
    // repassa `X-Forwarded-Proto: http`; o navegador manda `Origin: https://...`.
    // O servidor comparava `http://dominio` com `https://dominio` e concluia
    // que era um site estranho.
    //
    // O esquema nao e a parte que protege -- o HOST e. Site de atacante tem
    // outro dominio, e isso nenhum proxy reescreve.
    const DOMINIO = "chat.exemplo.com";

    const comoNaVm = await pedir("/api/auth/login", {
      metodo: "POST", comoProducao: DOMINIO, origem: `https://${DOMINIO}`,
      corpo: { email: usuario.email, senha: SENHA },
    });
    check(comoNaVm.status === 200,
      `login com Origin https e X-Forwarded-Proto http -> ${comoNaVm.status}`);

    // E uma ESCRITA autenticada, no mesmo arranjo.
    const cookiesVm = comoNaVm.cookies;
    const escritaVm = await pedir("/api/auth/perfil", {
      metodo: "PATCH", comoProducao: DOMINIO, origem: `https://${DOMINIO}`,
      cookies: cookiesVm, csrf: cookiesVm[nomes.nomeCsrf]?.valor,
      corpo: { nome: "Teste Cookie" },
    });
    check(escritaVm.status === 200, `escrita autenticada atras do proxy -> ${escritaVm.status}`);

    // A defesa continua de pe: outro DOMINIO e recusado, mesmo com tudo o mais
    // parecendo certo.
    const outroDominio = await pedir("/api/auth/perfil", {
      metodo: "PATCH", comoProducao: DOMINIO, origem: "https://site-do-atacante.example",
      cookies: cookiesVm, csrf: cookiesVm[nomes.nomeCsrf]?.valor,
      corpo: { nome: "Invasor" },
    });
    check(outroDominio.status === 403, `dominio diferente continua barrado -> ${outroDominio.status}`);

    // ─────────────────────────────────────────────────────────────────────
    titulo("5. Renovar pelo cookie, sem mandar token no corpo");
    const renovado = await pedir("/api/auth/renovar", { metodo: "POST", cookies: c, csrf, corpo: {} });
    check(renovado.status === 200, `POST /renovar com corpo VAZIO -> ${renovado.status}`);
    check(!!renovado.cookies[nomes.nomeAcesso], "veio um cookie de acesso novo");
    // Rotacao: o refresh usado e queimado e sai outro no lugar.
    check(
      renovado.cookies[nomes.nomeRefresh]?.valor !== c[nomes.nomeRefresh].valor,
      "o cookie de renovacao ROTACIONOU (o antigo foi queimado)"
    );

    // ─────────────────────────────────────────────────────────────────────
    titulo("6. Sair apaga os cookies");
    const atual = { ...c, ...renovado.cookies };
    const csrfAtual = (renovado.cookies[nomes.nomeCsrf] || c[nomes.nomeCsrf]).valor;
    const saiu = await pedir("/api/auth/sair", { metodo: "POST", cookies: atual, csrf: csrfAtual, corpo: {} });
    check(saiu.status === 200, `POST /sair -> ${saiu.status}`);
    // Apagar = reenviar o cookie vazio/expirado. Sem isso o painel voltaria
    // sozinho no proximo F5.
    const apagou = (nome) => {
      const v = saiu.cookies[nome];
      return v && (v.valor === "" || v.atributos.some((a) => a.includes("expires=thu, 01 jan 1970")));
    };
    check(apagou(nomes.nomeAcesso), "o cookie de acesso foi apagado");
    check(apagou(nomes.nomeRefresh), "o cookie de renovacao foi apagado");
  } catch (e) {
    console.error("\nERRO NO TESTE:", e.stack || e.message);
    erros.push("excecao: " + e.message);
  } finally {
    if (servidor) servidor.close();
    const ids = (await prisma.usuario
      .findMany({ where: { email: { startsWith: MARCA } }, select: { id: true } })
      .catch(() => [])).map((u) => u.id);
    if (ids.length) await prisma.sessaoRefresh.deleteMany({ where: { usuarioId: { in: ids } } }).catch(() => {});
    await prisma.usuario.deleteMany({ where: { email: { startsWith: MARCA } } }).catch(() => {});
    const restou = await prisma.usuario.count({ where: { email: { startsWith: MARCA } } }).catch(() => -1);
    check(restou === 0, `limpeza completa (restaram ${restou})`);
    await prisma.$disconnect();
    console.log(
      "\n" + (erros.length
        ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ")
        : "SESSAO EM COOKIE + CSRF: TUDO CONFERE")
    );
    process.exit(erros.length ? 1 : 0);
  }
})();
