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

function montarDubles(alvoCofre = cofre) {
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

  alvoCofre.credencialPresente = async () => {
    chamadas.push("credencialPresente");
    return cenario.credencial; // true | false | null
  };
  alvoCofre.jaFoiPareado = () => cenario.jaPareou !== false;
  alvoCofre.salvar = async () => {
    chamadas.push("salvar");
    return { salvo: true };
  };
  alvoCofre.restaurar = async (_i, motivoCodigo) => {
    chamadas.push("restaurar");
    // Reproduz a guarda real do cofre: 401/403 nunca restauram.
    if (cofre.CODIGOS_LOGOUT_REAL.includes(Number(motivoCodigo))) {
      return { restaurado: false, motivo: "logout_real" };
    }
    if (!cenario.temCofre) return { restaurado: false, motivo: "cofre_vazio" };
    cenario.credencial = true;
    return { restaurado: true };
  };
  alvoCofre.estado = () => ({ disponivel: true, temCofre: !!cenario.temCofre });
  alvoCofre.disponivel = () => true;
  alvoCofre.porqueIndisponivel = () => null;
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

  // ── 13. O ERRO CHEGA LEGIVEL NA TELA ──────────────────────────────────────
  //
  // "[object Object]" no painel nao era cosmetico: era a mensagem da Evolution
  // sendo DESTRUIDA no caminho, e sem ela nao havia diagnostico possivel. A
  // v2 responde `response.message` como LISTA, as vezes de objetos; o `join`
  // antigo transformava cada objeto na string "[object Object]".
  console.log("\n=== 13. o erro da Evolution chega legivel ===");
  const AppError = require("./src/shared/errors/AppError");

  check(
    !/\[object Object\]/.test(new AppError([{ property: "x" }, { property: "y" }]).message),
    "AppError com lista de objetos nao vira '[object Object]'"
  );
  check(
    new AppError({ response: { message: ["numero invalido"] } }).message.includes("numero invalido"),
    "AppError preserva o texto aninhado em vez de descartar"
  );
  check(
    new AppError("texto normal").message === "texto normal",
    "AppError nao mexe em mensagem que ja e string"
  );

  // O caminho real: uma resposta de erro da Evolution atravessando o cliente.
  // `request` cru, e nao `getConnectionState`: os dubles do bloco anterior
  // substituiram os metodos de alto nivel deste MESMO singleton, e chamar um
  // deles aqui testaria o duble em vez do cliente de verdade.
  const clienteReal = require("./src/infrastructure/external/evolution-api.client");
  const fetchOriginal = global.fetch;
  const respostaFalsa = (corpo, status) => async () => ({
    ok: status < 400,
    status,
    text: async () => JSON.stringify(corpo),
  });

  // class-validator: `message` e lista de OBJETOS. Era este o caso da tela.
  global.fetch = respostaFalsa(
    { status: 400, error: "Bad Request", response: { message: [{ constraints: { isString: "instanceName deve ser texto" } }] } },
    400
  );
  let capturado = null;
  try { await clienteReal.request("GET", `/instance/connectionState/${INSTANCIA}`); } catch (e) { capturado = e; }
  check(
    capturado && !/\[object Object\]/.test(capturado.message),
    "erro 400 da Evolution nao chega como '[object Object]'"
  );
  check(
    capturado && capturado.message.includes("instanceName deve ser texto"),
    "a frase real da Evolution sobrevive ate a mensagem de erro"
  );
  check(
    capturado?.diagnostico?.httpStatus === 400 &&
      String(capturado?.diagnostico?.endpoint || "").includes("/instance/connectionState/"),
    "o diagnostico carrega endpoint e HTTP da chamada que falhou"
  );

  // Corpo que nem e JSON (502 do nginx, HTML de erro): antes o JSON.parse
  // estourava e virava "Evolution indisponivel" -- escondendo que ela
  // RESPONDEU, e o que respondeu.
  global.fetch = async () => ({ ok: false, status: 502, text: async () => "<html>502 Bad Gateway</html>" });
  capturado = null;
  try { await clienteReal.request("GET", `/instance/connectionState/${INSTANCIA}`); } catch (e) { capturado = e; }
  check(
    capturado?.codigo !== "EVOLUTION_API_UNAVAILABLE" || capturado?.code !== "EVOLUTION_API_UNAVAILABLE",
    "resposta nao-JSON nao e confundida com 'API fora do ar'"
  );
  check(
    String(capturado?.diagnostico?.resposta || "").includes("502"),
    "o corpo nao-JSON e preservado no diagnostico"
  );

  global.fetch = fetchOriginal;

  // ── 14. QR SO COM AUTORIZACAO DO SERVIDOR ─────────────────────────────────
  //
  // A regra central do pedido, e ela precisa valer no BACK-END: a tela nao pode
  // ser a unica barreira. Com QRCODE_LIMIT=3, um QR pedido a toa termina em
  // `client.logout()` na Evolution -- ou seja, pedir QR sem precisar DESTROI o
  // pareamento que estava de pe.
  console.log("\n=== 14. o QR depende de evidencia, nao da tela ===");
  const servico = require("./src/modules/whatsapp/whatsapp.service");
  const rotulo = (state, perdeu, situacao) => servico._rotuloStatus(state, perdeu, situacao);

  check(
    rotulo("unavailable", false, "UNKNOWN") === "Evolution indisponível",
    "Evolution sem resposta nao aparece como 'Offline' nem 'Conectando'"
  );
  check(
    rotulo("close", false, "DISCONNECTED_TEMPORARY") === "Reconectando",
    "queda temporaria aparece como 'Reconectando', nao 'Conectando'"
  );
  check(
    rotulo("close", true, "LOGGED_OUT") === "Reescaneie o QR",
    "logout real continua sendo o unico que manda reescanear"
  );

  // O gate propriamente dito, com o status forjado pelos tres cenarios.
  const statusOriginal = servico.obterStatus.bind(servico);
  const comStatus = async (falso, opcoes) => {
    servico.obterStatus = async () => falso;
    try {
      await servico.obterQrcode(INSTANCIA, opcoes);
      return null;
    } catch (e) {
      return e;
    } finally {
      servico.obterStatus = statusOriginal;
    }
  };

  let recusa = await comStatus({
    conectado: false, evolutionOnline: true, podeMostrarQr: false,
    situacao: "DISCONNECTED_TEMPORARY", state: "close",
  });
  check(recusa?.code === "QR_DESNECESSARIO", "sessao valida: o servidor RECUSA gerar QR");

  recusa = await comStatus({
    conectado: false, evolutionOnline: false, podeMostrarQr: false,
    situacao: "UNKNOWN", state: "unavailable",
  });
  check(
    recusa?.code === "EVOLUTION_API_UNAVAILABLE",
    "Evolution fora do ar: recusa dizendo isso, e nao pedindo QR"
  );

  recusa = await comStatus({
    conectado: true, evolutionOnline: true, podeMostrarQr: false,
    situacao: "CONNECTED", state: "open",
  });
  check(recusa?.code === "QR_DESNECESSARIO_CONECTADO", "ja conectado: recusa em vez de derrubar a sessao");

  // ── 15. O BOTAO "RECONECTAR" NAO DESTROI NADA ─────────────────────────────
  console.log("\n=== 15. o botao Reconectar recupera, nao recria ===");
  const fonteServico = require("fs").readFileSync(
    "./src/modules/whatsapp/whatsapp.service.js",
    "utf8"
  );
  const corpoReiniciar = fonteServico.slice(
    fonteServico.indexOf("async reiniciar("),
    fonteServico.indexOf("async excluir(")
  );
  check(
    /reconexao\.reconectarAgora\(\)/.test(corpoReiniciar),
    "Reconectar entra no vigia (que escolhe connect/restart pelo estado)"
  );
  check(
    !/deleteInstance|createInstance|logout/.test(corpoReiniciar),
    "Reconectar nao apaga, nao recria e nao desloga a instancia"
  );

  const fonteTela = require("fs").readFileSync(
    "../client/src/pages/WhatsAppPage.jsx",
    "utf8"
  );
  check(
    /podeMostrarQr/.test(fonteTela),
    "a tela obedece ao `podeMostrarQr` do servidor em vez de decidir sozinha"
  );
  check(
    /!conectado \|\| !qrcode \|\| !podeMostrarQr/.test(fonteTela) ||
      /if \(conectado \|\| !qrcode \|\| !podeMostrarQr\) return/.test(fonteTela),
    "a renovacao automatica do QR para quando o QR deixa de ser legitimo"
  );

  // ── 16. CREDENCIAL COM BYTES MAS SEM PAREAMENTO ───────────────────────────
  //
  // O incidente de 05/09/2026, que custou 6h30 de WhatsApp fora do ar.
  //
  // A Evolution apagou a `Session` num 408; o `/instance/connect` seguinte fez
  // o Baileys criar uma credencial NOVA E NAO PAREADA (`initAuthCreds()`):
  // 1249 bytes de chaves com `"registered": false`, sem `me`. A checagem de
  // entao era `length(creds) > 0`, entao esse casco passou como "credencial
  // intacta" -- e o vigia se recusou a pedir QR por 396 tentativas seguidas
  // enquanto o Baileys emitia um QR por ciclo que ninguem escaneava.
  //
  // Um casco NAO e sessao. Tem de valer como logout.
  console.log("\n=== 16. casco de credencial nao vale como sessao ===");
  const fsMod = require("fs");
  const osMod = require("os");
  const pathMod = require("path");

  // O texto real colhido da VM (abreviado), com a dupla codificacao que o
  // Postgres da Evolution entrega: JSON dentro de string JSON.
  const CASCO = '"{\\"noiseKey\\":{},\\"registrationId\\":97,\\"registered\\":false}"';
  const PAREADA =
    '"{\\"noiseKey\\":{},\\"me\\":{\\"id\\":\\"552721030070:12@s.whatsapp.net\\"},\\"registered\\":true}"';

  const dirCofre = fsMod.mkdtempSync(pathMod.join(osMod.tmpdir(), "arka-cofre-"));
  process.env.WHATSAPP_COFRE_DIR = dirCofre;
  const CAMINHO_COFRE = pathMod.join(__dirname, "src/modules/whatsapp/whatsapp.sessao.js");
  delete require.cache[require.resolve(CAMINHO_COFRE)];
  const cofreReal = require(CAMINHO_COFRE);

  const pastaCofre = pathMod.join(dirCofre, INSTANCIA.replace(/[^\w.-]/g, "_"));
  fsMod.mkdirSync(pastaCofre, { recursive: true });
  const arquivoCofre = pathMod.join(pastaCofre, "creds.json");

  fsMod.writeFileSync(arquivoCofre, CASCO);
  check(
    cofreReal.jaFoiPareado(INSTANCIA) === false,
    "cofre com casco NAO conta como pareamento anterior"
  );
  const recusaCofre = await cofreReal.restaurar(INSTANCIA, 408);
  check(
    recusaCofre.restaurado === false && recusaCofre.motivo === "cofre_nao_pareado",
    "restauracao recusada quando a copia do cofre e um casco"
  );

  fsMod.writeFileSync(arquivoCofre, PAREADA);
  check(
    cofreReal.jaFoiPareado(INSTANCIA) === true,
    "cofre com credencial pareada continua contando como pareamento"
  );
  fsMod.rmSync(dirCofre, { recursive: true, force: true });

  // Medido o arquivo real, o vigia volta a rodar sobre dubles -- mas agora
  // sobre ESTA instancia do modulo, que e a que ele vai receber.
  montarDubles(cofreReal);

  // E o veredito do vigia: casco no banco = LOGGED_OUT, com QR liberado.
  const v16 = novoVigia({
    state: "close",
    motivoCodigo: 408,
    credencial: false, // o casco agora responde `false` -- e o ponto do fix
    temCofre: false, // e o cofre nao tem copia boa para devolver
    jaPareou: true,
  });
  const r16 = await v16.verificar();
  check(
    v16.estado().precisaParear === true,
    "casco no banco sem cofre bom -> LOGGED_OUT (o QR passa a ser legitimo)"
  );
  check(
    r16.acao !== "connect" && r16.acao !== "restart",
    "e o vigia PARA de tentar reconectar em vez de repetir 396 vezes"
  );

  // A defesa em profundidade: o cofre nunca guarda um casco por cima da copia
  // boa. Foi assim que a unica copia valida se perdeu.
  const fonteCofre = fsMod.readFileSync(CAMINHO_COFRE, "utf8");
  check(
    /if \(!_pareada\(creds\)\) \{[\s\S]{0,400}?credencial_nao_pareada/.test(fonteCofre),
    "salvar() recusa gravar credencial nao pareada sobre a copia boa"
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
