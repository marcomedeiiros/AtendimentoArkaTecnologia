/**
 * A ÚNICA VIA DE ENTRADA DE MENSAGEM NÃO PODE FALHAR EM SILÊNCIO.
 *
 * ── O QUE ACONTECEU EM 07/09/2026 ──────────────────────────────────────────
 *
 * O bot ficou horas mudo. Todo sinal de saúde dizia que estava tudo bem:
 * contêineres `healthy`, WhatsApp `CONNECTED`, painel abrindo. A Evolution
 * recebia as mensagens e não avisava a API.
 *
 * Duas falhas somadas, e as duas produziam o MESMO silêncio -- que é o que
 * tornou o diagnóstico caro:
 *
 *   WEBHOOK AUSENTE   ninguém conferia a única via de entrada de mensagem.
 *   401 MUDO          a recusa era um `AppError` sem `diagnostico`, e o
 *                     tratador de erros só registra os que têm. Cada mensagem
 *                     recusada saía com 401 sem uma linha no log.
 *
 * Não havia como distinguir "a Evolution não está chamando" de "está chamando e
 * sendo recusada" -- e as duas pedem conserto oposto.
 *
 * ── O QUE ESTÁ TRAVADO AQUI ────────────────────────────────────────────────
 *
 * Que a recusa apareça no log, que ela distinga token ausente de divergente,
 * que NÃO despeje o segredo, e que a conferência de boot reclame de webhook
 * ausente, desligado ou sem token.
 */
const path = require("path");

const erros = [];
function check(nome, problemas) {
  if (problemas.length) {
    erros.push(nome);
    console.log("  FALHA " + nome);
    for (const p of problemas) console.log("        " + p);
  } else {
    console.log("  OK   " + nome);
  }
}

// ── O logger, dublado, para ler o que foi registrado ─────────────────────────
const linhas = [];
const pLogger = require.resolve(path.join(__dirname, "src/config/logger"));
const loggerReal = require(pLogger);
require.cache[pLogger] = {
  id: pLogger,
  filename: pLogger,
  loaded: true,
  exports: new Proxy(loggerReal, {
    get(alvo, chave) {
      if (["warn", "error", "info", "debug"].includes(chave)) {
        return (msg, meta) => linhas.push({ nivel: chave, msg: String(msg), meta: meta || {} });
      }
      return alvo[chave];
    },
  }),
};

const env = require(path.join(__dirname, "src/config/env"));
const SEGREDO = env.webhookSecret;

const webhookAuth = require(path.join(__dirname, "src/shared/middlewares/webhook.middleware"));

const pedido = (token) => ({
  headers: token === undefined ? {} : { "x-webhook-token": token },
  query: {},
  body: { instance: "arka-wapi-oficial" },
  ip: "172.18.0.9",
});

function chamar(token) {
  return new Promise((resolve) => {
    webhookAuth(pedido(token), {}, (err) => resolve(err || null));
  });
}

console.log("=== Entrada do webhook ===");

(async () => {
  if (!SEGREDO) {
    check("ha um WEBHOOK_SECRET para comparar", ["`env.webhookSecret` esta vazio neste ambiente"]);
  }

  // ── Token certo passa ──────────────────────────────────────────────────────
  {
    linhas.length = 0;
    const err = await chamar(SEGREDO);
    check("o token correto passa, e em silencio", [
      ...(err ? ["o token correto foi recusado: " + err.message] : []),
      ...(linhas.length ? ["registrou " + linhas.length + " linha(s) num caso normal -- isso inunda o log"] : []),
    ]);
  }

  // ── AUSENTE e DIFERENTE sao coisas diferentes ──────────────────────────────
  //
  // Um aponta para webhook mal configurado; o outro, para os segredos terem
  // divergido entre a API e o contêiner da Evolution. O conserto nao e o mesmo,
  // entao a mensagem nao pode ser.
  {
    linhas.length = 0;
    const err = await chamar(undefined);
    const aviso = linhas.find((l) => /RECUSADO/i.test(l.msg));
    check("token AUSENTE e recusado e registrado", [
      ...(err?.statusCode === 401 ? [] : ["deveria recusar com 401, veio " + err?.statusCode]),
      ...(aviso ? [] : ["a recusa nao deixou linha no log -- e o defeito de origem"]),
      ...(aviso?.nivel === "warn" || aviso?.nivel === "error"
        ? []
        : ["registrado como `" + aviso?.nivel + "`; em producao o nivel e info e a linha sumiria"]),
      ...(aviso?.meta?.motivo === "token ausente"
        ? []
        : ["o motivo deveria ser `token ausente`, veio " + JSON.stringify(aviso?.meta?.motivo)]),
    ]);
  }

  {
    // Janela de log: a chamada anterior ja gastou o minuto. Zerar o modulo para
    // medir esta em separado -- senao o teste mediria o silenciador, e nao a
    // recusa.
    delete require.cache[require.resolve(path.join(__dirname, "src/shared/middlewares/webhook.middleware"))];
    const auth2 = require(path.join(__dirname, "src/shared/middlewares/webhook.middleware"));
    linhas.length = 0;
    const err = await new Promise((r) => auth2(pedido("token-de-outra-epoca"), {}, (e) => r(e || null)));
    const aviso = linhas.find((l) => /RECUSADO/i.test(l.msg));
    check("token DIFERENTE e recusado, com outro motivo", [
      ...(err?.statusCode === 401 ? [] : ["deveria recusar com 401, veio " + err?.statusCode]),
      ...(aviso?.meta?.motivo === "token diferente"
        ? []
        : ["o motivo deveria ser `token diferente`, veio " + JSON.stringify(aviso?.meta?.motivo)]),
      ...(String(aviso?.meta?.dica || "").length > 20 ? [] : ["a dica de conserto sumiu"]),
    ]);

    // ── O SEGREDO NAO PODE APARECER NO LOG ───────────────────────────────────
    //
    // Log vai para lugares que o `.env` nao vai. Nem o esperado nem o recebido
    // podem ser escritos -- so o TAMANHO, que ja separa vazio de divergente.
    const texto = JSON.stringify(linhas);
    check("o segredo nao vaza para o log", [
      ...(SEGREDO && texto.includes(SEGREDO) ? ["o WEBHOOK_SECRET foi escrito no log"] : []),
      ...(texto.includes("token-de-outra-epoca") ? ["o token recebido foi escrito no log"] : []),
      ...(aviso?.meta?.tamanhoDoTokenRecebido === "token-de-outra-epoca".length
        ? []
        : ["o tamanho do token recebido deveria ser registrado, para separar ausente de divergente"]),
    ]);
  }

  // ── A conferencia de boot ──────────────────────────────────────────────────
  //
  // Executada de verdade, com a Evolution dublada nos tres desfechos que
  // importam. Um webhook ausente TEM de gritar: era a peca que ninguem conferia.
  {
    const pCli = require.resolve(path.join(__dirname, "src/infrastructure/external/evolution-api.client"));
    const cliReal = require(pCli);
    let resposta = null;
    require.cache[pCli] = {
      id: pCli,
      filename: pCli,
      loaded: true,
      exports: new Proxy(cliReal, {
        get: (a, k) => (k === "findWebhook" ? async () => resposta : a[k]),
      }),
    };
    const conferencia = require(path.join(__dirname, "src/modules/whatsapp/whatsapp.conferirWebhook"));

    const casos = [
      [null, true, "webhook ausente (o caso de 07/09)"],
      [{ enabled: false, url: "http://api:3000/api/webhook/v1/whatsapp?token=x" }, true, "webhook desligado"],
      [{ enabled: true, url: "http://api:3000/api/webhook/v1/whatsapp" }, true, "webhook sem token"],
      [{ enabled: true, url: "http://api:3000/api/webhook/v1/whatsapp?token=x", events: ["A"] }, false, "webhook saudavel"],
    ];

    const problemas = [];
    for (const [cfg, deveGritar, rotulo] of casos) {
      resposta = cfg;
      linhas.length = 0;
      await conferencia.conferir();
      const gritou = linhas.some((l) => l.nivel === "error");
      if (gritou !== deveGritar) {
        problemas.push(
          `${rotulo}: ${deveGritar ? "deveria gritar e ficou quieto" : "gritou sem motivo"}`
        );
      }
      if (deveGritar && gritou) {
        const l = linhas.find((x) => x.nivel === "error");
        if (!String(l.meta?.conserto || "").includes("Integracao WhatsApp")) {
          problemas.push(`${rotulo}: o aviso nao diz como consertar`);
        }
      }
    }
    check("a conferencia de boot grita quando o webhook nao serve", problemas);

    // E nao pode despejar o token na linha saudavel.
    resposta = { enabled: true, url: "http://api:3000/api/webhook/v1/whatsapp?token=SEGREDO-AQUI", events: ["A"] };
    linhas.length = 0;
    await conferencia.conferir();
    check("a conferencia nao escreve o token no log", [
      ...(JSON.stringify(linhas).includes("SEGREDO-AQUI") ? ["o token apareceu no log"] : []),
    ]);
  }

  // ── A CITAÇÃO RECEBIDA (o "responder" do WhatsApp) ────────────────────────
  //
  // Quando o cliente responde citando, a bolha precisa mostrar O QUE ele citou.
  // Isso depende inteiramente de LER o `contextInfo` do payload -- e essa
  // ingestão nunca tinha sido exercitada por nenhum teste. O que se prova aqui
  // é que ela reconhece o `contextInfo` em cada nó de tipo onde o Baileys o
  // pendura, e que o retrato nunca sai vazio.
  //
  // O caso que faltava: MÍDIA CITADA SEM LEGENDA. `extrairTexto` devolve a
  // legenda, e foto/áudio/PDF quase nunca têm uma -- o retrato saía vazio e a
  // bolha voltava a mostrar a resposta solta, sem pista do que era. Agora o
  // retrato guarda o TIPO quando não há texto.
  {
    const svc = require(path.join(__dirname, "src/modules/whatsapp/whatsapp.service"));

    // O payload como a Evolution entrega: `contextInfo` DENTRO do nó do tipo.
    const comCitacao = (no, conteudo, ctxExtra = {}) => ({
      data: {
        key: { remoteJid: "5527999999999@s.whatsapp.net", fromMe: false, id: "3AAA" },
        message: {
          [no]: { ...conteudo, contextInfo: { stanzaId: "BAE5F1", ...ctxExtra } },
        },
      },
    });

    const problemas = [];
    const conferir = (rotulo, payload, esperado) => {
      const c = svc.extrairCitacao(payload);
      const veio = { texto: c?.texto ?? null, tipo: c?.tipo ?? null };
      if (JSON.stringify(veio) !== JSON.stringify(esperado)) {
        problemas.push(`${rotulo}: esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(veio)}`);
      }
      if (c && c.stanzaId !== "BAE5F1") problemas.push(`${rotulo}: stanzaId perdido (${c.stanzaId})`);
    };

    // Resposta de TEXTO citando TEXTO -- o caso comum, que já funcionava.
    conferir(
      "texto citando texto",
      comCitacao("extendedTextMessage", { text: "sim, é esse" }, {
        quotedMessage: { conversation: "Podemos agendar para amanhã?" },
      }),
      { texto: "Podemos agendar para amanhã?", tipo: null }
    );

    // Resposta de MÍDIA citando texto: o `contextInfo` vem no nó da imagem.
    conferir(
      "imagem citando texto",
      comCitacao("imageMessage", { caption: "olha o erro", mimetype: "image/jpeg" }, {
        quotedMessage: { conversation: "manda um print" },
      }),
      { texto: "manda um print", tipo: null }
    );

    // Citando IMAGEM SEM LEGENDA -- era aqui que o retrato saía vazio.
    conferir(
      "citando imagem sem legenda",
      comCitacao("extendedTextMessage", { text: "é essa" }, {
        quotedMessage: { imageMessage: { mimetype: "image/jpeg" } },
      }),
      { texto: null, tipo: "imagem" }
    );
    conferir(
      "citando áudio",
      comCitacao("extendedTextMessage", { text: "não deu pra ouvir" }, {
        quotedMessage: { audioMessage: { mimetype: "audio/ogg", ptt: true } },
      }),
      { texto: null, tipo: "audio" }
    );
    conferir(
      "citando documento",
      comCitacao("extendedTextMessage", { text: "recebi" }, {
        quotedMessage: { documentMessage: { mimetype: "application/pdf", fileName: "nota.pdf" } },
      }),
      { texto: null, tipo: "documento" }
    );
    // Legenda VENCE o tipo: havendo texto, é ele que a bolha mostra.
    conferir(
      "citando imagem COM legenda",
      comCitacao("extendedTextMessage", { text: "essa mesma" }, {
        quotedMessage: { imageMessage: { mimetype: "image/jpeg", caption: "print do erro" } },
      }),
      { texto: "print do erro", tipo: null }
    );

    // Mensagem que NÃO é resposta não pode virar citação de nada.
    const semCtx = svc.extrairCitacao({
      data: { key: { id: "1" }, message: { conversation: "oi" } },
    });
    if (semCtx !== null) problemas.push(`mensagem sem contextInfo virou citação: ${JSON.stringify(semCtx)}`);

    // ENCAMINHADA não é citação: o `contextInfo` é o mesmo objeto, e confundir
    // os dois faria toda mensagem encaminhada aparecer citando algo.
    const encaminhada = svc.extrairCitacao(
      comCitacao("extendedTextMessage", { text: "olha isso" }, { isForwarded: true, stanzaId: undefined })
    );
    if (encaminhada) problemas.push(`encaminhada sem citação virou citação: ${JSON.stringify(encaminhada)}`);

    check("a citação recebida é lida do contextInfo, em qualquer tipo", problemas);

    // O RETRATO SOBREVIVE ATÉ A TELA. O mapper é a última ponte: `citacao` com
    // só o tipo não pode ser descartada ali (era o `meta.citacao?.texto` que
    // decidia sozinho se o campo existia).
    const mapper = require(path.join(__dirname, "src/shared/helpers/mapper.helper"));
    const mapeadas = [
      [{ citacao: { tipo: "imagem" } }, { texto: null, tipo: "imagem" }],
      [{ citacao: { texto: "oi" } }, { texto: "oi", tipo: null }],
      [{}, null],
    ];
    const pMapper = [];
    for (const [meta, esperado] of mapeadas) {
      const c = mapper.mapMensagem({ id: "m1", origem: "cliente", texto: "x", metadata: meta }).citacao;
      if (JSON.stringify(c) !== JSON.stringify(esperado)) {
        pMapper.push(`metadata ${JSON.stringify(meta)}: esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(c)}`);
      }
    }
    check("o retrato da citação chega à tela (mapper)", pMapper);
  }

  console.log(
    "\n" +
      (erros.length
        ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ")
        : "ENTRADA DO WEBHOOK: TUDO CONFERE")
  );
  process.exit(erros.length ? 1 : 0);
})();
