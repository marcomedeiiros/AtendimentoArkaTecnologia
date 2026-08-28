/**
 * ENVIO DE MIDIA: A REQUISICAO CHEGA A PASSAR PELA PORTA?
 *
 * ── O DEFEITO ──────────────────────────────────────────────────────────────
 *
 * "Falha ao enviar mídia: requisição sem confirmação de origem. Recarregue a
 * página." -- para imagem, video, audio, print, documento. Todos.
 *
 * Cinco sintomas, uma causa. Todo o painel fala com a API pelo `request()` do
 * services/api.js, que monta os cabecalhos com `cabecalhosDeSessao()` -- e e ali
 * que entra o `X-CSRF-Token`. O envio de midia NAO passa por `request()`: ele e
 * XHR cru, porque precisa de barra de progresso e de cancelamento. E montava os
 * cabecalhos A MAO.
 *
 * Quando a sessao mudou para cookie HttpOnly (commit 7db6f61), `request()`
 * ganhou o header de CSRF e este caminho ficou para tras. Pior: o
 * `Authorization` que ele montava tambem deixou de existir, porque a migracao
 * apaga o token do localStorage. Entao o XHR chegava assim:
 *
 *     cookie de sessao   SIM (o navegador manda sozinho)
 *     Authorization      nao (nao ha mais token guardado)
 *     X-CSRF-Token       nao (ninguem o colocou)
 *
 * que e exatamente o caso que o double submit recusa. A requisicao morria no
 * middleware -- antes do schema, antes do upload, antes do disco, antes da
 * Evolution. Nao havia um problema por tipo de midia; havia um, na porta.
 *
 * ── O QUE ESTE ARQUIVO MEDE ────────────────────────────────────────────────
 *
 * Usa SESSAO EM COOKIE de proposito. Com `Bearer` o guard nem morde (quem usa
 * header nao tem vetor de CSRF), e o teste passaria sem tocar no defeito.
 *
 *   1. sem o header -> 403. O guard continua fechado; nada foi afrouxado.
 *   2. com o header -> passa, para os CINCO tipos, cada um pelo seu caminho.
 *   3. o cliente usa `cabecalhosDeSessao` -- e a garantia de que isto nao
 *      volta a acontecer no proximo cabecalho de sessao que for criado.
 *
 * O QUE ELE NAO MEDE: a entrega no WhatsApp. Isso depende da Evolution API, que
 * nao roda aqui. O servico trata a falha dela marcando a bolha como "erro" e
 * respondendo 200 -- entao ate a criacao da mensagem esta coberto, e da
 * Evolution para a frente, nao.
 *
 * Cria e apaga a propria conta e conversa. Nada real e tocado.
 *
 *   cd server && node verificar-midia.js
 */
process.env.TURNSTILE_SITE_KEY = "";
process.env.TURNSTILE_SECRET_KEY = "";

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const prisma = require("./src/infrastructure/database/prisma.client");
const createApp = require("./src/app");

const MARCA = "teste-midia";
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

function lerCookies(r) {
  const mapa = {};
  for (const c of r.headers.getSetCookie?.() || []) {
    const [par] = c.split(";");
    const i = par.indexOf("=");
    mapa[par.slice(0, i).trim()] = par.slice(i + 1);
  }
  return mapa;
}
const comoHeader = (mapa) => Object.entries(mapa).map(([k, v]) => `${k}=${v}`).join("; ");

async function pedir(caminho, { metodo = "GET", corpo, cookies, csrf, origem } = {}) {
  const h = { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.7, 10.0.0.1" };
  if (cookies) h.Cookie = comoHeader(cookies);
  if (csrf) h["X-CSRF-Token"] = csrf;
  if (origem) h.Origin = origem;
  const r = await fetch(base + caminho, {
    method: metodo, headers: h,
    ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
  });
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* nao-JSON */ }
  return { status: r.status, json, cookies: lerCookies(r), texto };
}

// ── OS BYTES PRECISAM SER DE VERDADE ───────────────────────────────────────
//
// O servidor nao acredita no mimetype declarado: `assinaturaImagemConfere` e
// `assinaturaFamiliaConfere` conferem os MAGIC BYTES do cabecalho, justamente
// para um .exe nao entrar disfarcado de PNG. Entao um base64 inventado e
// recusado com 400 -- corretamente -- e o teste passaria a medir outra coisa.
//
// A primeira versao deste arquivo caiu nessa: mandou texto qualquer como video,
// audio e PDF, levou 400 nos quatro, e o 400 estava CERTO. Abaixo vao cabecalhos
// reais, cada um com a assinatura que a tabela do dto procura.
const dataUrl = (mime, b64) => `data:${mime};base64,${b64}`;

// PNG 1x1 real.
const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// GIF87a 1x1 real.
const GIF_1x1 = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

// Cabecalho de MP4/MOV: os bytes 4..8 sao "ftyp" (a tabela procura exatamente
// isso). Preenche ate passar dos 12 bytes que `assinaturaFamiliaConfere` exige.
const MP4 = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from("ftypisom", "ascii"),
  Buffer.from([0x00, 0x00, 0x02, 0x00]),
  Buffer.from("isomiso2mp41", "ascii"),
]).toString("base64");

// Cabecalho de OGG: comeca com "OggS".
const OGG = Buffer.concat([
  Buffer.from("OggS", "ascii"),
  Buffer.from([0x00, 0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  Buffer.from("OpusHead", "ascii"),
]).toString("base64");

// PDF: comeca com "%PDF".
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n").toString("base64");

const CASOS = [
  { nome: "imagem (foto/print)", payload: { tipo: "imagem", media: dataUrl("image/png", PNG_1x1), mimetype: "image/png", fileName: "print.png" } },
  { nome: "imagem com legenda", payload: { tipo: "imagem", media: dataUrl("image/png", PNG_1x1), mimetype: "image/png", fileName: "foto.png", caption: "segue o print" } },
  { nome: "video", payload: { tipo: "video", media: dataUrl("video/mp4", MP4), mimetype: "video/mp4", fileName: "clipe.mp4" } },
  { nome: "audio (gravacao)", payload: { tipo: "audio", media: dataUrl("audio/ogg", OGG), mimetype: "audio/ogg; codecs=opus", fileName: "audio.ogg" } },
  { nome: "documento (pdf)", payload: { tipo: "documento", media: dataUrl("application/pdf", PDF), mimetype: "application/pdf", fileName: "orcamento.pdf" } },
  { nome: "gif (vai como documento)", payload: { tipo: "imagem", media: dataUrl("image/gif", GIF_1x1), mimetype: "image/gif", fileName: "animacao.gif" } },
  { nome: "localizacao", payload: { tipo: "localizacao", latitude: -23.5, longitude: -46.6, name: "Arka", address: "Sao Paulo" } },
];

async function limpar() {
  await prisma.mensagem.deleteMany({ where: { conversa: { cliente: { startsWith: MARCA } } } });
  await prisma.atendimento.deleteMany({ where: { conversa: { cliente: { startsWith: MARCA } } } });
  await prisma.conversa.updateMany({ where: { cliente: { startsWith: MARCA } }, data: { atendimentoAtualId: null } });
  await prisma.conversa.deleteMany({ where: { cliente: { startsWith: MARCA } } });
  await prisma.usuario.deleteMany({ where: { email: { startsWith: `${MARCA}-` } } });
}

async function main() {
  await limpar();

  const instancia = await prisma.instancia.findFirst();
  if (!instancia) throw new Error("sem instancia no banco -- rode o seed (npm run db:seed)");

  const app = createApp();
  await new Promise((ok) => { servidor = app.listen(0, ok); });
  base = `http://127.0.0.1:${servidor.address().port}`;

  const usuario = await prisma.usuario.create({
    data: {
      nome: `${MARCA} operador`,
      email: `${MARCA}-op@exemplo.test`,
      senhaHash: await bcrypt.hash(SENHA, 10),
      cargo: "Administrador",
      ativo: true,
    },
  });

  // ─────────────────────────────────────────────────────────────────────────
  titulo("0. Sessao em COOKIE (e nao Bearer -- e o cookie que ativa o guard)");

  const login = await pedir("/api/auth/login", {
    metodo: "POST", corpo: { email: usuario.email, senha: SENHA },
  });
  check(login.status === 200, `login -> ${login.status}`);
  const cookies = login.cookies;
  const csrf = cookies.arka_csrf;
  check(!!cookies.arka_sessao, "o servidor gravou o cookie de sessao (HttpOnly)");
  check(!!csrf, "e o cookie legivel de CSRF, que o cliente copia para o header");

  const conversa = await prisma.conversa.create({
    data: {
      telefone: `55119${String(Date.now()).slice(-8)}`,
      cliente: `${MARCA} cliente`,
      setor: "Geral",
      statusAtendimento: "aberta",
      instanciaId: instancia.id,
    },
  });

  // ─────────────────────────────────────────────────────────────────────────
  titulo("1. SEM o header de CSRF -> 403 (o guard continua fechado)");

  const semHeader = await pedir(`/api/conversas/${conversa.id}/midia`, {
    metodo: "POST", cookies, corpo: CASOS[0].payload,
  });
  check(semHeader.status === 403, `POST /midia sem X-CSRF-Token -> ${semHeader.status} (esperado 403)`);
  check(
    semHeader.json?.error?.code === "CSRF_TOKEN",
    `e o 403 do double submit -- exatamente a mensagem que aparecia na tela: "${semHeader.json?.error?.message || ""}"`
  );

  const headerErrado = await pedir(`/api/conversas/${conversa.id}/midia`, {
    metodo: "POST", cookies, csrf: "valor-inventado", corpo: CASOS[0].payload,
  });
  check(headerErrado.status === 403, `com um X-CSRF-Token forjado -> ${headerErrado.status}`);

  const origemEstranha = await pedir(`/api/conversas/${conversa.id}/midia`, {
    metodo: "POST", cookies, csrf, origem: "https://site-do-atacante.example", corpo: CASOS[0].payload,
  });
  check(origemEstranha.status === 403, `de outra origem, mesmo com o token certo -> ${origemEstranha.status}`);

  // ─────────────────────────────────────────────────────────────────────────
  titulo("2. COM o header -> passa. Cada tipo pelo seu caminho.");

  const antes = await prisma.mensagem.count({ where: { conversaId: conversa.id } });
  for (const caso of CASOS) {
    const r = await pedir(`/api/conversas/${conversa.id}/midia`, {
      metodo: "POST", cookies, csrf, corpo: caso.payload,
    });
    check(
      r.status === 200,
      `${caso.nome} -> ${r.status}${r.status !== 200 ? ` (${r.json?.error?.message || r.texto.slice(0, 80)})` : ""}`
    );
  }

  const depois = await prisma.mensagem.count({ where: { conversaId: conversa.id } });
  check(
    depois - antes === CASOS.length,
    `cada envio criou UMA mensagem (${depois - antes} para ${CASOS.length} envios)`
  );

  // ─────────────────────────────────────────────────────────────────────────
  titulo("3. O que foi gravado bate com o que foi mandado");

  const msgs = await prisma.mensagem.findMany({
    where: { conversaId: conversa.id },
    orderBy: { criadoEm: "asc" },
  });
  const porTipo = {};
  for (const m of msgs) {
    const t = m.metadata?.tipo;
    if (t) porTipo[t] = (porTipo[t] || 0) + 1;
  }
  check(porTipo.imagem === 3, `3 imagens gravadas (inclusive o GIF, que sai como documento no WhatsApp) -- ${porTipo.imagem}`);
  check(porTipo.video === 1, `1 video -- ${porTipo.video}`);
  check(porTipo.audio === 1, `1 audio -- ${porTipo.audio}`);
  check(porTipo.documento === 1, `1 documento -- ${porTipo.documento}`);
  check(porTipo.localizacao === 1, `1 localizacao -- ${porTipo.localizacao}`);

  const comLegenda = msgs.find((m) => m.metadata?.caption === "segue o print");
  check(!!comLegenda, "a legenda da imagem foi gravada");

  const audio = msgs.find((m) => m.metadata?.tipo === "audio");
  check(!audio?.metadata?.caption, "audio NAO tem legenda (o WhatsApp nao mostra, e o servico zera)");

  // Os BYTES vao para o disco; o banco guarda o caminho.
  const naoLocal = msgs.filter((m) => m.metadata?.tipo && m.metadata.tipo !== "localizacao");
  const comArquivo = naoLocal.filter((m) => m.metadata?.arquivo);
  check(
    comArquivo.length === naoLocal.length,
    `os bytes foram para o disco, e o banco guardou o caminho (${comArquivo.length}/${naoLocal.length})`
  );
  const pastaMidia = path.join(__dirname, "dados", "midia");
  const primeiro = comArquivo[0]?.metadata?.arquivo;
  check(
    !!primeiro && fs.existsSync(path.join(pastaMidia, primeiro)),
    `o arquivo existe mesmo em dados/midia (${primeiro || "-"})`
  );

  // ─────────────────────────────────────────────────────────────────────────
  titulo("4. Validacao continua valendo (nada foi afrouxado para 'fazer funcionar')");

  const semMedia = await pedir(`/api/conversas/${conversa.id}/midia`, {
    metodo: "POST", cookies, csrf, corpo: { tipo: "imagem" },
  });
  check(semMedia.status === 400, `imagem sem o campo media -> ${semMedia.status}`);

  const tipoDesconhecido = await pedir(`/api/conversas/${conversa.id}/midia`, {
    metodo: "POST", cookies, csrf, corpo: { tipo: "planilha", media: dataUrl("image/png", PNG_1x1) },
  });
  check(tipoDesconhecido.status === 400, `tipo fora da lista -> ${tipoDesconhecido.status}`);

  const localSemCoordenada = await pedir(`/api/conversas/${conversa.id}/midia`, {
    metodo: "POST", cookies, csrf, corpo: { tipo: "localizacao", latitude: -23.5 },
  });
  check(localSemCoordenada.status === 400, `localizacao sem longitude -> ${localSemCoordenada.status}`);

  const semSessao = await pedir(`/api/conversas/${conversa.id}/midia`, {
    metodo: "POST", corpo: CASOS[0].payload,
  });
  check(semSessao.status === 401, `sem sessao nenhuma -> ${semSessao.status}`);

  // ─────────────────────────────────────────────────────────────────────────
  titulo("5. O CLIENTE nao pode voltar a montar cabecalho a mao");

  // Esta e a checagem que impede a regressao de acontecer de novo: o defeito
  // nao foi "esqueceram um header", foi "existe um caminho que monta os
  // cabecalhos por conta propria". Enquanto o XHR usar `cabecalhosDeSessao`,
  // todo cabecalho de sessao futuro vale aqui automaticamente.
  const apiJs = fs.readFileSync(
    path.join(__dirname, "..", "client", "src", "services", "api.js"),
    "utf8"
  );
  const trecho = apiJs.slice(apiJs.indexOf("enviarMidia:"), apiJs.indexOf("// ── Campanhas"));
  check(
    /cabecalhosDeSessao\(\)/.test(trecho),
    "o envio de midia monta os cabecalhos com cabecalhosDeSessao(), a mesma funcao do request()"
  );
  check(
    !/setRequestHeader\(\s*['"]Content-Type/.test(trecho),
    "e nao ha mais Content-Type montado a mao no XHR"
  );

  // ─────────────────────────────────────────────────────────────────────────
  titulo("limpeza");
  // Os arquivos gravados em dados/midia sao deste teste: apaga.
  for (const m of comArquivo) {
    const alvo = path.join(pastaMidia, m.metadata.arquivo);
    try { fs.unlinkSync(alvo); } catch { /* ja apagado */ }
  }
  await limpar();
  const sobrou = await prisma.usuario.count({ where: { email: { startsWith: `${MARCA}-` } } });
  check(sobrou === 0, `limpeza completa (sobraram ${sobrou} registros)`);
}

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
    console.log("\nENVIO DE MIDIA: TUDO CONFERE");
  });
