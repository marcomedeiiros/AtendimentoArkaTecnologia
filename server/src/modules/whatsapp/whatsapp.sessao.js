// COFRE DA SESSAO DO WHATSAPP -- a rede de seguranca contra um bug da Evolution.
//
// POR QUE ISTO EXISTE
// -------------------
// Na Evolution 2.4.0-rc2 uma QUEDA TEMPORARIA apaga a credencial do pareamento.
// Nao e configuracao nossa nem defeito de storage: esta no codigo dela.
//
//   whatsapp.baileys.service.ts:490
//     codesToNotReconnect = [loggedOut, forbidden, 402, 406, 408]
//                                                            ^^^ novo na 2.4.0
//   ...e o ramo "nao reconectar" faz:
//     eventEmitter.emit('logout.instance', ...)
//   monitor.service.ts:425  -> cleaningUp(instanceName)
//   monitor.service.ts:175  ->   session.deleteMany({ where: { sessionId } })
//   monitor.service.ts:172  ->   rmSync(INSTANCE_DIR/<id>)
//
// `408` e `DisconnectReason.timedOut` -- o timeout de rede, a queda mais banal
// que existe. Na 2.3.7 a lista era `[loggedOut, forbidden, 402, 406]` e um 408
// simplesmente reconectava. Ou seja: e uma REGRESSAO da 2.4.0, e a 2.4.0-rc2 e
// a tag mais recente publicada -- nao ha versao corrigida para onde subir.
//
// Sem defesa, a conta e simples: um timeout de internet custa um QR novo.
//
// O QUE ELE GUARDA
// ----------------
// A sessao pareada vive em DOIS lugares (use-multi-file-auth-state-prisma.ts):
//
//   1. Postgres, tabela `Session`, coluna `creds` -- a IDENTIDADE do aparelho
//      (noiseKey, signedIdentityKey, registrationId, me, account...). E o que
//      permite logar sem QR.
//   2. Arquivos em `/evolution/instances/<instanceId>/*.json` -- as chaves do
//      Signal (pre-keys, sessoes por contato, app-state-sync). Sem elas a
//      conexao ate sobe, mas mensagens antigas ficam sem decifrar por um tempo.
//
// `cleaningUp` destroi os dois. O cofre copia os dois.
//
// A REGRA QUE ELE NUNCA QUEBRA
// ----------------------------
// O cofre so ESCREVE de volta quando o WhatsApp nao invalidou nada:
//
//   - a linha `Session` precisa estar AUSENTE (nada e sobrescrito, jamais);
//   - a linha `Instance` precisa continuar existindo;
//   - o `disconnectionReasonCode` NAO pode ser 401 nem 403.
//
// 401 (`loggedOut`) e 403 (`forbidden`) sao os dois unicos codigos em que o
// WhatsApp de fato derrubou o pareamento. Restaurar credencial nesses casos
// seria pior que inutil: renderia um loop de reconexao recusada. Nesses casos o
// cofre nao faz nada e o QR passa a ser realmente necessario.
//
// TUDO AQUI E BEST-EFFORT. Sem `EVOLUTION_DB_URL`, sem o pacote `pg` ou com o
// Postgres fora do ar, o modulo se declara indisponivel e devolve `null`
// ("nao sei") -- nunca `false` ("nao tem"). Quem consulta trata desconhecido
// como "assuma que a sessao e valida", que e o lado seguro: no maximo tentamos
// reconectar a toa; o lado errado pediria um QR desnecessario.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const logger = require("../../config/logger");

// Codigos em que o WhatsApp REALMENTE invalidou o pareamento. Restaurar a
// credencial aqui e proibido. Qualquer outro codigo -- 408, 428, 440, 500, 503,
// 515, ou nenhum -- e queda temporaria.
const CODIGOS_LOGOUT_REAL = [401, 403];

const URL_BANCO = process.env.EVOLUTION_DB_URL || "";
// Volume `evolution_instances` montado tambem no container da API.
const DIR_CHAVES_EVOLUTION = process.env.EVOLUTION_INSTANCES_DIR || "";
// Fica junto do banco do Arka, no volume que o deploy/backup.sh ja copia.
const DIR_COFRE =
  process.env.WHATSAPP_COFRE_DIR ||
  path.join(path.dirname(process.env.MEDIA_DIR || "/data/midia"), "sessao-whatsapp");

let Pool = null;
let pool = null;
let motivoIndisponivel = null;

function _pool() {
  if (pool) return pool;
  if (motivoIndisponivel) return null;

  if (!URL_BANCO) {
    motivoIndisponivel = "EVOLUTION_DB_URL nao configurada";
    return null;
  }
  if (!Pool) {
    try {
      ({ Pool } = require("pg"));
    } catch {
      motivoIndisponivel = "pacote 'pg' nao instalado";
      return null;
    }
  }
  pool = new Pool({
    connectionString: URL_BANCO,
    max: 2,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30_000,
  });
  // Um erro num cliente ocioso do pool emite 'error' no pool; sem listener o
  // Node derruba o processo. A API inteira nao pode cair por causa do cofre.
  pool.on("error", (err) => {
    logger.warn("[Cofre] Erro no pool do Postgres da Evolution", { message: err.message });
  });
  return pool;
}

function disponivel() {
  return Boolean(_pool());
}

function porqueIndisponivel() {
  _pool();
  return motivoIndisponivel;
}

async function _consultar(sql, valores) {
  const p = _pool();
  if (!p) return null;
  try {
    return await p.query(sql, valores);
  } catch (err) {
    logger.warn("[Cofre] Consulta ao Postgres da Evolution falhou", { message: err.message });
    return null;
  }
}

// ── LEITURA DO ESTADO REAL ──────────────────────────────────────────────────

/**
 * A credencial do pareamento existe AGORA no banco da Evolution?
 *
 * `true` tem: a sessao e recuperavel, reconectar resolve, QR e desnecessario.
 * `false` nao tem: ou nunca pareou, ou algo apagou -- so o cofre ou o QR salvam.
 * `null` nao sei: Postgres fora do alcance. Trate como `true` (lado seguro).
 */
/**
 * A CREDENCIAL ESTA PAREADA? -- e nao apenas "tem bytes".
 *
 * O QUE ESTA CHECAGEM CUSTOU, medido em producao em 05/09/2026: o WhatsApp
 * ficou 6h30 fora do ar (02:56 -> 09:33) com o vigia jurando "credencial
 * intacta" em 396 tentativas seguidas.
 *
 * O que houve: a Evolution apagou a `Session` num 408, e o `/instance/connect`
 * seguinte fez o Baileys criar uma credencial NOVA E NAO PAREADA
 * (`initAuthCreds()`) -- 1249 bytes de chaves criptograficas com
 * `"registered": false`, sem `me`, sem `account`. Um casco. Ele tem bytes, e a
 * checagem antiga era `length(creds) > 0`, entao passava como sessao valida.
 *
 * O resultado e o pior dos dois mundos: o vigia se recusa a pedir QR (nao ha
 * 401, e "ha credencial") enquanto o Baileys emite um QR a cada ciclo que
 * ninguem escaneia, ate o timeout de 408 fechar o socket. Para sempre.
 *
 * `registered` e o campo que o Baileys vira para `true` quando o pareamento
 * conclui. E a unica pergunta que importa aqui.
 *
 * `true` pareada e recuperavel -- reconectar resolve, QR e desnecessario.
 * `false` sem pareamento utilizavel (ausente OU casco) -- so o QR resolve.
 * `null` nao sei: Postgres fora do alcance. Trate como `true` (lado seguro).
 */
async function credencialPresente(nomeInstancia) {
  const r = await _consultar(
    `SELECT s."sessionId", s.creds, length(s.creds) AS bytes
       FROM "Session" s JOIN "Instance" i ON i.id = s."sessionId"
      WHERE i.name = $1`,
    [nomeInstancia]
  );
  if (!r) return null;
  if (r.rowCount === 0 || !(Number(r.rows[0].bytes) > 0)) return false;
  return _pareada(r.rows[0].creds);
}

/**
 * O texto da credencial descreve um pareamento CONCLUIDO?
 *
 * A `creds` chega como JSON dentro de string JSON (dupla codificacao), entao as
 * aspas podem vir escapadas (`\"registered\":true`). A regex tolera as duas
 * formas de proposito -- normalizar antes daria a mesma resposta com mais
 * chance de erro no caminho.
 */
function _pareada(creds) {
  const texto = typeof creds === "string" ? creds : JSON.stringify(creds || "");
  if (!texto) return false;
  // `registered: true` e o carimbo do Baileys quando o pareamento fecha.
  if (/\\?"registered\\?"\s*:\s*true/.test(texto)) return true;
  // Cinto e suspensorio: uma credencial pareada sempre tem o proprio jid em
  // `me`. Se um dia o campo `registered` mudar de nome, isto ainda pega.
  return /\\?"me\\?"\s*:\s*\{[^}]*\\?"id\\?"\s*:\s*\\?"\d/.test(texto);
}

async function _instanceId(nomeInstancia) {
  const r = await _consultar(`SELECT id FROM "Instance" WHERE name = $1`, [nomeInstancia]);
  if (!r || r.rowCount === 0) return null;
  return r.rows[0].id;
}

// ── ESCRITA NO COFRE ────────────────────────────────────────────────────────

function _pasta(nomeInstancia) {
  return path.join(DIR_COFRE, nomeInstancia.replace(/[^\w.-]/g, "_"));
}

/**
 * Ja houve pareamento alguma vez? Sobrevive a restart do container -- e por
 * isso que substituiu o `jaEsteveConectado` em memoria do vigia, que nascia
 * `false` a cada reinicio e deixava a reconexao desarmada para sempre quando a
 * API subia com o WhatsApp ja fora do ar.
 */
function jaFoiPareado(nomeInstancia) {
  try {
    const arquivo = path.join(_pasta(nomeInstancia), "creds.json");
    if (!fs.existsSync(arquivo)) return false;
    // Nao basta o arquivo existir: um cofre envenenado (copia de uma credencial
    // nao pareada) responderia "ja pareou" e faria o vigia tratar uma
    // instalacao sem sessao como uma sessao caida -- que e justamente o estado
    // em que ele se recusa a pedir QR.
    return _pareada(fs.readFileSync(arquivo, "utf8"));
  } catch {
    return false;
  }
}

function _hash(texto) {
  return crypto.createHash("sha256").update(texto).digest("hex").slice(0, 16);
}

function _metaSalva(nomeInstancia) {
  try {
    return JSON.parse(fs.readFileSync(path.join(_pasta(nomeInstancia), "meta.json"), "utf8"));
  } catch {
    return null;
  }
}

/**
 * Copia a credencial e as chaves para o cofre. Chamado sempre que o vigia ve a
 * instancia em `open`; sai barato porque compara o hash antes de escrever -- a
 * `creds` muda de tempos em tempos (contador de pre-key), nao a cada segundo.
 *
 * Escrita atomica (tmp + rename): um restart no meio da copia nao pode deixar
 * no cofre um `creds.json` truncado, que seria pior que nao ter cofre nenhum.
 */
async function salvar(nomeInstancia) {
  const r = await _consultar(
    `SELECT i.id AS "instanceId", s.creds
       FROM "Instance" i JOIN "Session" s ON s."sessionId" = i.id
      WHERE i.name = $1`,
    [nomeInstancia]
  );
  if (!r || r.rowCount === 0) return { salvo: false, motivo: "sem_credencial_no_banco" };

  const { instanceId, creds } = r.rows[0];
  if (!creds) return { salvo: false, motivo: "credencial_vazia" };

  // NUNCA GUARDAR UM CASCO. Uma credencial nao pareada escrita por cima da
  // copia boa destroi a unica coisa que o cofre existe para proteger -- e foi
  // exatamente o que aconteceu em 05/09/2026: o cofre passou o dia
  // restaurando, fielmente, uma credencial que nunca esteve pareada.
  //
  // O cofre so guarda o que serve para logar sem QR. Se nao serve, a copia
  // antiga (se houver) continua valendo -- ela e melhor que esta.
  if (!_pareada(creds)) {
    logger.warn("[Cofre] Credencial NAO PAREADA no banco -- copia recusada", {
      instance: nomeInstancia,
      bytes: creds.length,
      copiaAnteriorPreservada: jaFoiPareado(nomeInstancia),
    });
    return { salvo: false, motivo: "credencial_nao_pareada" };
  }

  const hash = _hash(creds);
  const meta = _metaSalva(nomeInstancia);
  if (meta?.hash === hash) return { salvo: false, motivo: "sem_mudanca" };

  const destino = _pasta(nomeInstancia);
  try {
    fs.mkdirSync(destino, { recursive: true });

    const tmp = path.join(destino, "creds.json.tmp");
    fs.writeFileSync(tmp, creds, "utf8");
    fs.renameSync(tmp, path.join(destino, "creds.json"));

    // Chaves do Signal, quando o volume da Evolution esta montado aqui.
    let arquivos = 0;
    const origem = DIR_CHAVES_EVOLUTION
      ? path.join(DIR_CHAVES_EVOLUTION, instanceId)
      : null;
    if (origem && fs.existsSync(origem)) {
      const dirChaves = path.join(destino, "chaves");
      fs.rmSync(dirChaves, { recursive: true, force: true });
      fs.mkdirSync(dirChaves, { recursive: true });
      for (const arquivo of fs.readdirSync(origem)) {
        if (!arquivo.endsWith(".json")) continue;
        fs.copyFileSync(path.join(origem, arquivo), path.join(dirChaves, arquivo));
        arquivos += 1;
      }
    }

    fs.writeFileSync(
      path.join(destino, "meta.json"),
      JSON.stringify(
        { instanceId, hash, salvoEm: new Date().toISOString(), bytes: creds.length, chaves: arquivos },
        null,
        2
      ),
      "utf8"
    );

    logger.info("[Cofre] Credencial do WhatsApp copiada", {
      instance: nomeInstancia,
      bytes: creds.length,
      chaves: arquivos,
    });
    return { salvo: true, bytes: creds.length, chaves: arquivos };
  } catch (err) {
    logger.warn("[Cofre] Falha ao copiar a credencial", {
      instance: nomeInstancia,
      message: err.message,
    });
    return { salvo: false, motivo: "erro_escrita", erro: err.message };
  }
}

/**
 * Devolve a credencial ao banco da Evolution depois de uma queda que a apagou
 * sem que o WhatsApp tivesse deslogado nada.
 *
 * As guardas estao TODAS aqui, e nenhuma delas e opcional. Em particular a
 * checagem do `motivoCodigo`: quem chama passa o `disconnectionReasonCode` lido
 * da propria Evolution, e 401/403 aborta. Nao restauramos por otimismo.
 *
 * Nunca sobrescreve: se a linha `Session` existe, saimos sem tocar em nada.
 */
async function restaurar(nomeInstancia, motivoCodigo) {
  if (CODIGOS_LOGOUT_REAL.includes(Number(motivoCodigo))) {
    logger.warn("[Cofre] Restauracao RECUSADA -- o WhatsApp invalidou a sessao", {
      instance: nomeInstancia,
      motivoCodigo,
    });
    return { restaurado: false, motivo: "logout_real" };
  }

  const destino = _pasta(nomeInstancia);
  const arquivoCreds = path.join(destino, "creds.json");
  if (!fs.existsSync(arquivoCreds)) {
    return { restaurado: false, motivo: "cofre_vazio" };
  }

  // COFRE ENVENENADO: a copia existe mas nao e um pareamento. Devolve-la ao
  // banco nao reconecta nada -- so faz o vigia acreditar que ha sessao e adiar
  // para sempre o QR que resolveria.
  //
  // Esta checagem vem ANTES de qualquer ida ao Postgres de proposito: julgar a
  // nossa propria copia nao depende do banco da Evolution, e deixar o banco na
  // frente escondia este veredito atras de um "instancia_inexistente".
  const credsCofre = fs.readFileSync(arquivoCreds, "utf8");
  if (!_pareada(credsCofre)) {
    logger.warn("[Cofre] A copia guardada NAO esta pareada -- restauracao recusada", {
      instance: nomeInstancia,
      bytes: credsCofre.length,
    });
    return { restaurado: false, motivo: "cofre_nao_pareado" };
  }

  const instanceId = await _instanceId(nomeInstancia);
  if (!instanceId) return { restaurado: false, motivo: "instancia_inexistente" };

  const presente = await credencialPresente(nomeInstancia);
  if (presente !== false) {
    // `true` = ha credencial, nada a fazer. `null` = nao consegui ler; escrever
    // as cegas poderia sobrescrever uma credencial mais nova que a do cofre.
    return { restaurado: false, motivo: presente === null ? "estado_desconhecido" : "ja_existe" };
  }

  const creds = credsCofre;
  const r = await _consultar(
    `INSERT INTO "Session" ("id", "sessionId", "creds", "createdAt")
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT ("sessionId") DO NOTHING`,
    // `Session.id` e um varchar com default cuid() do lado da Evolution; como
    // inserimos por SQL cru, o default nao roda e precisamos gerar um. O
    // conteudo nao importa, so a unicidade -- quem identifica a sessao e o
    // `sessionId`, que tem o UNIQUE de verdade.
    [`arka-${crypto.randomUUID()}`, instanceId, creds]
  );
  if (!r) return { restaurado: false, motivo: "erro_insert" };
  if (r.rowCount === 0) return { restaurado: false, motivo: "corrida_ja_existe" };

  // Chaves do Signal de volta ao lugar, quando temos o volume montado.
  let chaves = 0;
  try {
    const dirChaves = path.join(destino, "chaves");
    if (DIR_CHAVES_EVOLUTION && fs.existsSync(dirChaves)) {
      const alvo = path.join(DIR_CHAVES_EVOLUTION, instanceId);
      fs.mkdirSync(alvo, { recursive: true });
      for (const arquivo of fs.readdirSync(dirChaves)) {
        fs.copyFileSync(path.join(dirChaves, arquivo), path.join(alvo, arquivo));
        chaves += 1;
      }
    }
  } catch (err) {
    // A credencial ja voltou -- a conexao sobe mesmo sem as chaves do Signal.
    logger.warn("[Cofre] Credencial restaurada, mas as chaves do Signal falharam", {
      instance: nomeInstancia,
      message: err.message,
    });
  }

  logger.warn("[Cofre] CREDENCIAL RESTAURADA -- a sessao foi salva, nao havera QR", {
    instance: nomeInstancia,
    motivoCodigo: motivoCodigo ?? null,
    bytes: creds.length,
    chaves,
  });
  return { restaurado: true, bytes: creds.length, chaves };
}

function estado(nomeInstancia) {
  const meta = _metaSalva(nomeInstancia);
  return {
    disponivel: disponivel(),
    motivoIndisponivel: porqueIndisponivel(),
    temCofre: jaFoiPareado(nomeInstancia),
    salvoEm: meta?.salvoEm || null,
    chaves: meta?.chaves ?? null,
  };
}

module.exports = {
  CODIGOS_LOGOUT_REAL,
  disponivel,
  porqueIndisponivel,
  credencialPresente,
  jaFoiPareado,
  salvar,
  restaurar,
  estado,
};
