/**
 * CABECALHOS DE SEGURANCA -- e a CSP nao pode quebrar o painel.
 *
 * ── POR QUE ESTE ARQUIVO EXISTE ────────────────────────────────────────────
 *
 * O app subia sem NENHUM cabecalho de seguranca, e o nginx tambem nao repunha.
 * Agora manda; este arquivo garante que continue mandando, e -- mais importante
 * -- que a CSP permita o que o painel de fato carrega.
 *
 * CSP quebra em silencio: o navegador bloqueia o recurso, escreve no console e
 * a pagina segue "funcionando" pela metade. Ninguem ve no servidor. Foi assim
 * que duas versoes do Turnstile ja foram para producao quebradas, e o defeito
 * so apareceu quando um usuario tentou entrar.
 *
 * Por isso os testes daqui nao conferem so a PRESENCA da CSP: conferem que ela
 * autoriza cada origem que o codigo do cliente realmente usa. As origens sao
 * LIDAS do cliente, e nao escritas a mao -- assim, alguem que adicione um
 * servico novo sem liberar na CSP quebra este teste, e nao a tela de login.
 *
 * Nao toca no banco: sobe o app em memoria e le as respostas.
 *
 *   cd server && node verificar-cabecalhos.js
 */
const fs = require("fs");
const path = require("path");

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

function subir(nodeEnv) {
  for (const k of Object.keys(require.cache)) {
    if (k.includes(`${path.sep}src${path.sep}`)) delete require.cache[k];
  }
  const anterior = process.env.NODE_ENV;
  process.env.NODE_ENV = nodeEnv;
  const guardados = {};
  for (const s of ["JWT_SECRET", "WEBHOOK_SECRET", "EVOLUTION_API_KEY"]) {
    guardados[s] = process.env[s];
    if (!process.env[s]) process.env[s] = "segredo-so-para-este-teste-nao-usar";
  }
  const app = require("./src/app")();
  return {
    app,
    restaurar: () => {
      process.env.NODE_ENV = anterior || "development";
      for (const [k, v] of Object.entries(guardados)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    },
  };
}

const ouvir = (app) => new Promise((res) => {
  const s = app.listen(0, "127.0.0.1", () => res({ s, base: `http://127.0.0.1:${s.address().port}` }));
});

// A CSP vem como texto; virar mapa para poder perguntar por diretiva.
function lerCsp(texto) {
  const mapa = {};
  for (const parte of String(texto || "").split(";")) {
    const [nome, ...valores] = parte.trim().split(/\s+/);
    if (nome) mapa[nome] = valores;
  }
  return mapa;
}

(async () => {
  const { app, restaurar } = subir("production");
  const { s, base } = await ouvir(app);
  const r = await fetch(base + "/health");
  const h = Object.fromEntries(r.headers.entries());
  const csp = lerCsp(h["content-security-policy"]);

  // ─────────────────────────────────────────────────────────────────────────
  titulo("1. Os cabecalhos existem em producao");
  check("Content-Security-Policy presente", !!h["content-security-policy"], true);
  check("Strict-Transport-Security presente", !!h["strict-transport-security"], true);
  check("X-Content-Type-Options: nosniff", h["x-content-type-options"], "nosniff");
  check("Referrer-Policy definido", h["referrer-policy"], "strict-origin-when-cross-origin");
  // O helmet remove a assinatura do Express, que entrega a tecnologia de graca.
  check("X-Powered-By removido", h["x-powered-by"], undefined);

  // ─────────────────────────────────────────────────────────────────────────
  titulo("2. As garantias que a CSP precisa dar");
  check("script-src NAO tem 'unsafe-inline'", (csp["script-src"] || []).includes("'unsafe-inline'"), false);
  check("script-src NAO tem 'unsafe-eval'", (csp["script-src"] || []).includes("'unsafe-eval'"), false);
  // Clickjacking: sem isto, o painel pode ser enquadrado num site isca.
  check("frame-ancestors 'none' (nao da para enquadrar)", csp["frame-ancestors"], ["'none'"]);
  check("object-src 'none'", csp["object-src"], ["'none'"]);
  check("base-uri 'self'", csp["base-uri"], ["'self'"]);

  // ─────────────────────────────────────────────────────────────────────────
  titulo("3. A CSP autoriza o que o CLIENTE realmente carrega");

  // As origens sao lidas do codigo do cliente. Um servico novo entra aqui
  // sozinho, e quebra o teste em vez de quebrar a tela.
  const RAIZ_CLIENTE = path.join(__dirname, "..", "client");
  const html = fs.readFileSync(path.join(RAIZ_CLIENTE, "index.html"), "utf8");

  const listar = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return listar(p);
    return /\.jsx?$/.test(e.name) ? [p] : [];
  });
  const fonteCliente = listar(path.join(RAIZ_CLIENTE, "src")).map((f) => fs.readFileSync(f, "utf8")).join("\n");

  const autoriza = (diretiva, origem) => {
    const valores = csp[diretiva] || csp["default-src"] || [];
    return valores.includes(origem) || valores.includes("https:");
  };

  // O <link> de fonte do index.html.
  if (/fonts\.googleapis\.com/.test(html)) {
    check("style-src libera o Google Fonts", autoriza("style-src", "https://fonts.googleapis.com"), true);
    check("font-src libera o gstatic (o arquivo da fonte)", autoriza("font-src", "https://fonts.gstatic.com"), true);
  }

  // O Turnstile carrega um SCRIPT, e nao so um iframe -- foi o erro que quase
  // subiu: declarar `frame-src` e esquecer o `script-src` derruba o login.
  if (/challenges\.cloudflare\.com/.test(fonteCliente)) {
    const cf = "https://challenges.cloudflare.com";
    check("script-src libera o script do Turnstile", autoriza("script-src", cf), true);
    check("frame-src libera o iframe do Turnstile", autoriza("frame-src", cf), true);
    check("connect-src libera o Turnstile", autoriza("connect-src", cf), true);
  }

  // A foto de perfil do cliente e uma URL externa da WhatsApp (`fotoUrl`).
  if (/fotoUrl/.test(fonteCliente)) {
    check("img-src permite a foto de perfil externa", autoriza("img-src", "https:"), true);
  }
  // Midia local: preview de anexo, audio gravado, QR em base64.
  check("img-src permite data: e blob:", ["data:", "blob:"].every((v) => (csp["img-src"] || []).includes(v)), true);

  s.close(); restaurar();

  // ─────────────────────────────────────────────────────────────────────────
  titulo("4. Em desenvolvimento, o HSTS fica DESLIGADO");
  // Ligado, ele grava no navegador de quem trabalha no projeto que este host so
  // responde por HTTPS -- e o http://localhost para de abrir, inclusive depois
  // de desligar. Custa uma tarde para descobrir.
  {
    const { app: appDev, restaurar: restDev } = subir("development");
    const { s: sd, base: bd } = await ouvir(appDev);
    const hd = Object.fromEntries((await fetch(bd + "/health")).headers.entries());
    check("sem Strict-Transport-Security fora de producao", hd["strict-transport-security"], undefined);
    check("mas a CSP continua valendo", !!hd["content-security-policy"], true);
    sd.close(); restDev();
  }

  // ─────────────────────────────────────────────────────────────────────────
  titulo("5. A CSP do nginx e a do Express dizem a MESMA coisa");

  // Sao duas listas escritas a mao, em linguagens diferentes, e as duas
  // precisam valer -- o nginx entrega o HTML, o Express entrega a API. Duas
  // copias de uma regra e como uma delas comeca a mentir: alguem libera um
  // servico novo de um lado e esquece o outro, e o defeito aparece so em
  // producao, so no caminho que ninguem testou.
  const nginxConf = fs.readFileSync(path.join(RAIZ_CLIENTE, "seguranca-headers.conf"), "utf8");
  const linhaCsp = (nginxConf.match(/add_header\s+Content-Security-Policy\s+"([^"]+)"/) || [])[1];
  check("o nginx declara uma CSP", !!linhaCsp, true);

  if (linhaCsp) {
    const cspNginx = lerCsp(linhaCsp);
    const cspExpress = csp;
    const diretivas = new Set([...Object.keys(cspNginx), ...Object.keys(cspExpress)]);
    const divergem = [];
    for (const d of diretivas) {
      const a = (cspNginx[d] || []).slice().sort().join(" ");
      const b = (cspExpress[d] || []).slice().sort().join(" ");
      if (a !== b) divergem.push(`${d}: nginx=[${a || "ausente"}] express=[${b || "ausente"}]`);
    }
    check("nenhuma diretiva divergente", divergem, []);
  }

  // O `always` faz o cabecalho valer tambem em resposta de erro. Sem ele, uma
  // pagina 404 sairia sem CSP -- e 404 e justamente onde conteudo inesperado
  // costuma aparecer.
  // Linha a linha, e ignorando comentario: o proprio arquivo EXPLICA a regra
  // citando `add_header`, e o valor do HSTS tem um `;` dentro das aspas -- as
  // duas coisas enganam um casamento por expressao mais folgada.
  const semAlways = nginxConf
    .split("\n")
    .filter((l) => /^\s*add_header\b/.test(l))
    .filter((l) => !/\balways\s*;/.test(l))
    .map((l) => l.trim().slice(0, 60) + "...");
  check("todo add_header do nginx usa `always`", semAlways, []);

  // ── TODO BLOCO COM add_header PROPRIO REPOE OS CABECALHOS DE SEGURANCA ────
  //
  // A regra do nginx: declarar um `add_header` dentro de um `location` DESCARTA
  // todos os herdados do `server`. Um bloco que poe o seu Cache-Control e
  // esquece o include serve o painel sem CSP, sem HSTS e sem protecao contra
  // enquadramento -- e nada avisa.
  //
  // Este teste contava includes e exigia exatamente 2. Quando o
  // `location = /index.html` nasceu (com o seu proprio Cache-Control E o
  // include, ou seja, CERTO), a contagem virou 3 e o teste reprovou uma
  // configuracao correta. Numero magico responde "quantos?"; a pergunta util e
  // "algum bloco esqueceu?".
  const nginxPrincipal = fs.readFileSync(path.join(RAIZ_CLIENTE, "nginx.conf"), "utf8");

  const temIncludeNoServer = /^\s*include\s+.*seguranca-headers\.conf/m.test(
    nginxPrincipal.split(/location\s/)[0]
  );
  check("o server declara o include (base herdada por quem nao redefine)", temIncludeNoServer, true);

  const blocos = nginxPrincipal.split(/^\s*location\s/m).slice(1);
  const esquecidos = blocos
    .filter((b) => /add_header/.test(b) && !/seguranca-headers\.conf/.test(b))
    // O `split` consome a palavra `location`, entao o bloco comeca no caminho.
    .map((b) => "location " + b.split("{")[0].trim());
  check(
    "todo location que declara add_header repoe os cabecalhos de seguranca",
    esquecidos,
    []
  );

  // Sanidade estrutural. Nao substitui o `nginx -t` (que roda no deploy, ver
  // deploy/atualizar.sh) -- pega o engano grosseiro aqui, onde e barato, em vez
  // de na hora em que o container novo se recusa a subir e o painel cai.
  const semComentario = (t) => t.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  for (const [nome, texto] of [["nginx.conf", nginxPrincipal], ["seguranca-headers.conf", nginxConf]]) {
    const limpo = semComentario(texto);
    const abre = (limpo.match(/\{/g) || []).length;
    const fecha = (limpo.match(/\}/g) || []).length;
    check(`${nome}: chaves equilibradas`, abre, fecha);
    check(`${nome}: aspas em numero par`, (limpo.match(/"/g) || []).length % 2, 0);
    const semPontoEVirgula = limpo
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^(add_header|include|proxy_pass|expires|listen|root)\b/.test(l))
      .filter((l) => !l.endsWith(";"));
    check(`${nome}: toda diretiva termina em ;`, semPontoEVirgula, []);
  }

  // O caminho do include tem de bater com o destino do COPY no Dockerfile --
  // errar isso so aparece quando o container nao sobe.
  const dockerfile = fs.readFileSync(path.join(RAIZ_CLIENTE, "Dockerfile"), "utf8");
  const destino = (nginxPrincipal.match(/include\s+(\S+seguranca-headers\.conf)/) || [])[1];
  check(
    `o Dockerfile copia o arquivo para ${destino}`,
    new RegExp(`COPY\\s+seguranca-headers\\.conf\\s+${destino.replace(/[/.]/g, "\\$&")}`).test(dockerfile),
    true
  );

  console.log(
    "\n" + (erros.length
      ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ")
      : "CABECALHOS: TUDO CONFERE")
  );
  process.exit(erros.length ? 1 : 0);
})();
