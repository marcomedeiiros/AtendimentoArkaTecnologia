// Verificacao da RECONEXAO DO WHATSAPP -- `node verificar-reconexao-whatsapp.js`.
//
// O que este script prova, em uma frase: uma queda temporaria nunca vira pedido
// de QR, e um logout de verdade sempre vira.
//
// Ele nao fala com a Evolution nem com o Postgres. Substitui as duas
// dependencias do vigia (o cliente HTTP e o cofre da sessao) por dubles e
// observa QUAIS chamadas ele faz. E o unico jeito de exercitar os cenarios que
// importam -- timeout 408, logout 401, credencial apagada, dois reconnects
// simultaneos -- sem depender de derrubar a internet de verdade.
//
// A regressao que motivou o arquivo: `/instance/restart` era chamado com PUT,
// que a Evolution 2.4.0-rc2 nao registra (a rota so aceita POST), e ainda por
// cima em instancias `close`, que essa rota recusa. Toda reconexao automatica
// falhava em silencio. Nenhum teste existia para notar.
const path = require("path");

const erros = [];
const check = (cond, msg) => {
  if (!cond) erros.push(msg);
  console.log(`  ${cond ? "OK   " : "FALHA"} ${msg}`);
};

const CAMINHO_VIGIA = path.join(__dirname, "src/modules/whatsapp/whatsapp.reconexao.js");
const cliente = require("./src/infrastructure/external/evolution-api.client");
const cofre = require("./src/modules/whatsapp/whatsapp.sessao");
const env = require("./src/config/env");

const INSTANCIA = env.evolutionApi.instance;

// ── DUBLES ──────────────────────────────────────────────────────────────────
// Registram tudo o que o vigia pede, para podermos afirmar coisas do tipo
// "chamou connect, nao restart" e "nunca tentou restaurar num logout real".
let chamadas = [];
let cenario = {};

function montarDubles() {
  cliente.getConnectionState = async () => {
    chamadas.push("getConnectionState");
    if (cenario.evolutionForaDoAr) throw new Error("ECONNREFUSED");
    return { instance: { state: cenario.state } };
  };
  cliente.diagnosticoConexao = async () => {
    chamadas.push("diagnostico");
    return { conhecido: true, motivoCodigo: cenario.motivoCodigo ?? null };
  };
  cliente.connect = async () => {
    chamadas.push("connect");
    if (cenario.falharAcao) throw new Error("Evolution indisponivel");
    return { base64: "qr-fake" };
  };
  cliente.restartInstance = async () => {
    chamadas.push("restart");
    if (cenario.falharAcao) throw new Error("Evolution indisponivel");
    return { instance: { status: "connecting" } };
  };

  cofre.credencialPresente = async () => {
    chamadas.push("credencialPresente");
    return cenario.credencial; // true | false | null
  };
  cofre.jaFoiPareado = () => cenario.jaPareou !== false;
  cofre.salvar = async () => {
    chamadas.push("salvar");
    return { salvo: true };
  };
  cofre.restaurar = async (_i, motivoCodigo) => {
    chamadas.push("restaurar");
    // Reproduz a guarda real do cofre: 401/403 nunca restauram.
    if (cofre.CODIGOS_LOGOUT_REAL.includes(Number(motivoCodigo))) {
      return { restaurado: false, motivo: "logout_real" };
    }
    if (!cenario.temCofre) return { restaurado: false, motivo: "cofre_vazio" };
    cenario.credencial = true;
    return { restaurado: true };
  };
  cofre.estado = () => ({ disponivel: true, temCofre: !!cenario.temCofre });
  cofre.disponivel = () => true;
  cofre.porqueIndisponivel = () => null;
}
montarDubles();

/** Vigia zerado (o modulo guarda estado entre chamadas) + cenario novo. */
function novoVigia(config) {
  delete require.cache[require.resolve(CAMINHO_VIGIA)];
  chamadas = [];
  cenario = { state: "close", credencial: true, jaPareou: true, temCofre: true, ...config };
  return require(CAMINHO_VIGIA);
}

/** Deixa o backoff vencer sem esperar de verdade. */
function liberarBackoff(vigia) {
  const e = vigia.estado();
  if (e.proximaTentativaEm) vigia.notificarQueda("close");
}

(async () => {
  // ── 0. A LISTA DE CODIGOS ─────────────────────────────────────────────────
  //
  // O coracao da regra. Se 408 (timedOut) entrar aqui, uma queda de rede volta
  // a ser tratada como logout -- que e exatamente o bug da Evolution que este
  // sistema existe para contornar.
  console.log("\n=== 0. o que conta como logout real ===");
  const vigia0 = novoVigia({});
  check(
    JSON.stringify(vigia0.CODIGOS_LOGOUT_REAL) === JSON.stringify([401, 403]),
    "so 401 e 403 sao logout real"
  );
  for (const transitorio of [408, 428, 440, 500, 502, 503, 515]) {
    check(
      !vigia0.CODIGOS_LOGOUT_REAL.includes(transitorio),
      `${transitorio} NAO e logout -- e queda temporaria`
    );
  }

  // ── 1. CONECTADO ──────────────────────────────────────────────────────────
  console.log("\n=== 1. instancia online ===");
  const v1 = novoVigia({ state: "open" });
  const r1 = await v1.verificar();
  check(r1.situacao === "CONNECTED", "estado CONNECTED");
  check(r1.acao === "nenhuma", "nao mexe em nada quando esta online");
  check(chamadas.includes("salvar"), "aproveita para manter o cofre em dia");
  check(!chamadas.includes("connect") && !chamadas.includes("restart"), "nenhuma reconexao");

  // ── 2. TESTE 2/3: QUEDA TEMPORARIA COM CREDENCIAL INTACTA ─────────────────
  //
  // Socket fechado, rede caiu, container reiniciou -- para o vigia e tudo o
  // mesmo caso: a credencial esta la, entao religa e pronto.
  console.log("\n=== 2. queda com a sessao intacta (TESTE 2 e 3) ===");
  const v2 = novoVigia({ state: "close", motivoCodigo: 408, credencial: true });
  const r2 = await v2.verificar();
  // `classificacao` e o veredito sobre a queda; `situacao` e onde a conexao
  // esta agora. Depois de disparar o religamento, ela ja e RECONNECTING -- e o
  // veredito continua sendo "temporaria", que e o que nunca pode virar logout.
  check(r2.classificacao === "DISCONNECTED_TEMPORARY", "queda classificada como DISCONNECTED_TEMPORARY, nao LOGGED_OUT");
  check(r2.situacao === "RECONNECTING", "e a conexao passa a RECONNECTING");
  check(r2.acao === "connect", "usa /instance/connect (o unico que religa a partir de `close`)");
  check(!chamadas.includes("restart"), "NAO usa /instance/restart, que recusa instancia em `close`");
  check(v2.estado().precisaParear === false, "nao pede QR");
  check(!chamadas.includes("restaurar"), "nao mexe na credencial: ela esta intacta");

  // ── 3. HANDSHAKE EM ANDAMENTO ─────────────────────────────────────────────
  //
  // O erro classico: reconectar por cima de um `connecting` legitimo abre um
  // segundo socket com a mesma credencial e o WhatsApp mata os dois com
  // `conflict: replaced`.
  console.log("\n=== 3. `connecting` recente nao e queda ===");
  const v3 = novoVigia({ state: "connecting" });
  const r3 = await v3.verificar();
  check(r3.situacao === "RECONNECTING", "estado RECONNECTING");
  check(r3.acao === "aguardando_handshake", "espera o handshake terminar");
  check(!chamadas.includes("connect") && !chamadas.includes("restart"), "nao abre um segundo socket");

  // ── 4. TESTE 1/4: CREDENCIAL APAGADA POR QUEDA TEMPORARIA ─────────────────
  //
  // O bug da Evolution 2.4.0-rc2 em acao: statusCode 408 e a linha `Session`
  // sumiu. Sem o cofre isso viraria um QR. Com ele, nao vira.
  console.log("\n=== 4. a Evolution apagou a credencial num timeout (TESTE 1 e 4) ===");
  const v4 = novoVigia({ state: "close", motivoCodigo: 408, credencial: false, temCofre: true });
  const r4 = await v4.verificar();
  check(chamadas.includes("restaurar"), "tenta restaurar do cofre");
  check(r4.classificacao === "DISCONNECTED_TEMPORARY", "continua sendo queda temporaria");
  check(r4.acao === "connect", "religa depois de restaurar");
  check(v4.estado().precisaParear === false, "NAO pede QR");

  // ── 5. TESTE 5: LOGOUT REAL ───────────────────────────────────────────────
  console.log("\n=== 5. logout de verdade (TESTE 5) ===");
  const v5 = novoVigia({ state: "close", motivoCodigo: 401, credencial: false, temCofre: true });
  const r5 = await v5.verificar();
  check(v5.estado().situacao === "LOGGED_OUT", "estado LOGGED_OUT");
  check(v5.estado().precisaParear === true, "exige QR novo");
  check(r5.acao === "nenhuma", "para de tentar reconectar");
  check(!chamadas.includes("connect") && !chamadas.includes("restart"), "nao insiste no socket");
  check(
    !chamadas.includes("restaurar"),
    "nao restaura credencial em logout real (restaurar aqui daria loop)"
  );

  console.log("\n=== 5b. logout real por 403 ===");
  const v5b = novoVigia({ state: "close", motivoCodigo: 403, credencial: false });
  await v5b.verificar();
  check(v5b.estado().precisaParear === true, "403 tambem exige QR");

  console.log("\n=== 5c. credencial sumiu e nao ha copia no cofre ===");
  const v5c = novoVigia({ state: "close", motivoCodigo: null, credencial: false, temCofre: false });
  await v5c.verificar();
  check(v5c.estado().precisaParear === true, "sem credencial e sem cofre, so o QR resolve");

  // ── 6. TESTE 6: DOIS RECONNECTS AO MESMO TEMPO ────────────────────────────
  //
  // O timer e um clique no painel podem coincidir. Se as duas vias chamarem
  // `connect`, o Baileys abre dois sockets com a mesma credencial.
  console.log("\n=== 6. duas rotinas de reconexao simultaneas (TESTE 6) ===");
  const v6 = novoVigia({ state: "close", motivoCodigo: 408, credencial: true });
  const [a, b] = await Promise.all([v6.verificar(), v6.verificar()]);
  const quantosConnect = chamadas.filter((c) => c === "connect").length;
  check(quantosConnect === 1, `apenas UM socket aberto (foram ${quantosConnect} chamadas a connect)`);
  check(a === b, "a segunda chamada reaproveita a primeira em vez de duplicar");

  // ── 7. BACKOFF ────────────────────────────────────────────────────────────
  console.log("\n=== 7. backoff ===");
  const v7 = novoVigia({ state: "close", motivoCodigo: 408, credencial: true });
  check(
    JSON.stringify(v7.ESCADA_MS) === JSON.stringify([1000, 2000, 5000, 10000, 20000, 30000, 60000]),
    "escada 1s, 2s, 5s, 10s, 20s, 30s, 60s"
  );
  await v7.verificar();
  const espera1 = v7.estado().proximaTentativaEm - Date.now();
  check(espera1 > 0 && espera1 <= 1300, `a 1a espera fica perto de 1s (foi ${espera1}ms, com jitter)`);
  const segundaChamada = await v7.verificar();
  check(segundaChamada.acao === "aguardando_backoff", "respeita o backoff em vez de martelar");

  // NUNCA DESISTE. O modelo antigo parava em 6 tentativas (~31 min) e a tela
  // passava a pedir QR com a sessao valida -- o defeito exato que derrubava um
  // apagao de rede mais longo.
  console.log("\n=== 7b. nao ha teto de tentativas ===");
  const v7b = novoVigia({ state: "close", motivoCodigo: 408, credencial: true });
  for (let i = 0; i < 25; i += 1) {
    liberarBackoff(v7b);
    await v7b.verificar();
  }
  const e7b = v7b.estado();
  check(e7b.tentativa >= 20, `continua tentando depois de 25 rodadas (tentativa ${e7b.tentativa})`);
  check(e7b.precisaParear === false, "nunca desistiu nem pediu QR");
  check(e7b.situacao === "RECONNECTING" || e7b.situacao === "DISCONNECTED_TEMPORARY", "segue tentando");

  // ── 8. EVOLUTION FORA DO AR ───────────────────────────────────────────────
  //
  // A Evolution caida NAO e o WhatsApp deslogado. Confundir os dois faria um
  // `docker compose restart` pedir QR.
  console.log("\n=== 8. Evolution fora do ar ===");
  const v8 = novoVigia({ evolutionForaDoAr: true });
  const r8 = await v8.verificar();
  check(r8.situacao === "UNKNOWN", "estado UNKNOWN, nao LOGGED_OUT");
  check(v8.estado().precisaParear === false, "nao pede QR so porque a Evolution nao respondeu");

  // ── 9. FALHA NA TENTATIVA NAO INVALIDA A SESSAO ───────────────────────────
  console.log("\n=== 9. a tentativa de religar falhou ===");
  const v9 = novoVigia({ state: "close", motivoCodigo: 408, credencial: true, falharAcao: true });
  const r9 = await v9.verificar();
  check(r9.acao === "falhou", "registra a falha");
  check(v9.estado().precisaParear === false, "falhar em reconectar nao e motivo para pedir QR");

  // ── 10. QR PELO WEBHOOK ───────────────────────────────────────────────────
  //
  // "Veio QR" nao prova nada: `/instance/connect` devolve o qrCode que estiver
  // na memoria da instancia sem checar se e novo. Antes, esse evento congelava
  // a reconexao na hora.
  console.log("\n=== 10. qrcode.updated chegou pelo webhook ===");
  const v10 = novoVigia({ state: "close", motivoCodigo: 515, credencial: true });
  const q10 = await v10.avaliarQrRecebido();
  check(q10.conclusao === "qr_espurio", "com a credencial intacta, o QR e ignorado");
  check(v10.estado().precisaParear === false, "nao pede novo pareamento");

  const v10b = novoVigia({ state: "close", motivoCodigo: 401, credencial: false });
  const q10b = await v10b.avaliarQrRecebido();
  check(q10b.conclusao === "logout_real", "com 401 e credencial ausente, o QR e legitimo");

  const v10c = novoVigia({ state: "close", credencial: true });
  v10c.registrarPedidoDeQr();
  const q10c = await v10c.avaliarQrRecebido();
  check(q10c.conclusao === "qr_pedido", "QR que o operador pediu nao vira alarme");

  const v10d = novoVigia({ state: "close", jaPareou: false, credencial: false });
  const q10d = await v10d.avaliarQrRecebido();
  check(q10d.conclusao === "primeiro_pareamento", "instalacao nova: QR e o caminho normal");
  check(q10d.precisaParear === false, "e nao e anunciado como pareamento perdido");

  // ── 11. INSTALACAO NOVA NAO GERA RECONEXAO ────────────────────────────────
  console.log("\n=== 11. instancia que nunca pareou ===");
  const v11 = novoVigia({ state: "close", jaPareou: false, credencial: false });
  const r11 = await v11.verificar();
  check(r11.motivo === "nunca_pareado", "reconhece que nunca houve pareamento");
  check(!chamadas.includes("connect"), "nao tenta religar o que nunca existiu");

  // ── 12. O CLIENTE HTTP ────────────────────────────────────────────────────
  //
  // Os dois defeitos que faziam a reconexao falhar calada.
  console.log("\n=== 12. contrato do cliente com a Evolution ===");
  const fonte = require("fs").readFileSync(
    "./src/infrastructure/external/evolution-api.client.js",
    "utf8"
  );
  check(
    /restartInstance[\s\S]{0,200}?request\("POST", `\/instance\/restart/.test(fonte),
    "restart e POST (a 2.4.0-rc2 nao registra PUT nessa rota)"
  );
  check(
    /data\.error === true/.test(fonte),
    "trata HTTP 200 com `{error:true}` como falha, nao como sucesso"
  );

  // ── RESUMO ────────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(70));
  if (erros.length) {
    console.log(`${erros.length} FALHA(S):`);
    erros.forEach((e) => console.log(`  - ${e}`));
    process.exit(1);
  }
  console.log("Reconexao do WhatsApp: tudo OK");
})().catch((e) => {
  console.error("Erro inesperado na verificacao:", e);
  process.exit(1);
});
