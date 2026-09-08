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

    // ── A FORMA ACHATADA: `contextInfo` AO LADO DE `message` ────────────────
    //
    // Era ESTE o ponto cego. `_contextos` varria só os nós dentro de `message`,
    // e a Evolution v2 também entrega o `contextInfo` um nível acima, irmão de
    // `message` (`data.contextInfo`) -- junto de `messageType` e `pushName`. A
    // citação recebida simplesmente não existia nesse formato: o cliente
    // respondia citando e a mensagem dele aparecia solta, enquanto a NOSSA
    // resposta citada aparecia certinha (aquela vem do `respondendoAId` da tela
    // e nunca passa por aqui). Era a assimetria relatada.
    //
    // `encaminhada` sai do MESMO objeto, então o selo tinha o mesmo ponto cego.
    const pAchatado = [];
    const achatado = (ctx, message = { conversation: "tem como?" }) => ({
      event: "messages.upsert",
      data: {
        key: { remoteJid: "5527999999999@s.whatsapp.net", fromMe: false, id: "3AAA" },
        pushName: "Rangel",
        messageType: "conversation",
        message,
        contextInfo: ctx,
      },
    });

    const cAchatada = svc.extrairCitacao(
      achatado({ stanzaId: "BAE5F1", quotedMessage: { conversation: "alo" } })
    );
    if (cAchatada?.texto !== "alo" || cAchatada?.stanzaId !== "BAE5F1") {
      pAchatado.push(`data.contextInfo ignorado: ${JSON.stringify(cAchatada)}`);
    }

    const eAchatada = svc.extrairEncaminhada(achatado({ isForwarded: true, forwardingScore: 7 }));
    if (eAchatada?.encaminhadaVezes !== 7) {
      pAchatado.push(`selo Encaminhada perdido na forma achatada: ${JSON.stringify(eAchatada)}`);
    }
    // Encaminhada achatada NÃO é citação (o objeto é o mesmo).
    if (svc.extrairCitacao(achatado({ isForwarded: true, forwardingScore: 7 })) !== null) {
      pAchatado.push("encaminhada achatada virou citação");
    }

    // AS DUAS FORMAS no mesmo payload: a de dentro do nó é a mais específica.
    const duas = achatado(
      { stanzaId: "ACHATADO", quotedMessage: { conversation: "o outro" } },
      { extendedTextMessage: { text: "tem como?", contextInfo: { stanzaId: "DO_NO", quotedMessage: { conversation: "o certo" } } } }
    );
    const cDuas = svc.extrairCitacao(duas);
    if (cDuas?.stanzaId !== "DO_NO") {
      pAchatado.push(`com as duas formas, a do nó deveria vencer: ${JSON.stringify(cDuas)}`);
    }

    check("o contextInfo achatado (data.contextInfo) também é lido", pAchatado);

    // ── A BUSCA É ESTRUTURAL: ACHA ONDE ESTIVER ─────────────────────────────
    //
    // A varredura procura pela ASSINATURA do `contextInfo`, não por uma lista de
    // lugares. É o que fecha a classe do problema: a Evolution move esse objeto
    // entre versões (foi assim que a forma achatada passou batida), e um tipo
    // novo de mensagem não pode voltar a quebrar a citação em silêncio.
    const pEstrutural = [];

    // Um tipo que NINGUÉM enumerou -- é o caso "versão nova da Evolution".
    const tipoDesconhecido = svc.extrairCitacao({
      data: {
        key: { id: "3DDD" },
        message: {
          algumTipoNovoMessage: {
            text: "responde isso",
            contextInfo: { stanzaId: "BAE9", quotedMessage: { conversation: "o original" } },
          },
        },
      },
    });
    if (tipoDesconhecido?.texto !== "o original") {
      pEstrutural.push(`tipo não enumerado ficou invisível: ${JSON.stringify(tipoDesconhecido)}`);
    }

    // ── RESPOSTA DE UMA RESPOSTA: mostra a citação DESTA mensagem ───────────
    //
    // `quotedMessage` carrega a mensagem citada, que pode ela mesma ter sido uma
    // resposta -- e traz o `contextInfo` da citação ANTERIOR dentro. Entrar ali
    // faria a bolha mostrar o trecho errado: o que o cliente citou na mensagem
    // passada, e não nesta. A varredura não entra em `quotedMessage`.
    const respostaDeResposta = svc.extrairCitacao({
      data: {
        key: { id: "3EEE" },
        message: {
          extendedTextMessage: {
            text: "e isso?",
            contextInfo: {
              stanzaId: "AGORA",
              quotedMessage: {
                extendedTextMessage: {
                  text: "a citada",
                  contextInfo: { stanzaId: "ANTES", quotedMessage: { conversation: "a de trás" } },
                },
              },
            },
          },
        },
      },
    });
    if (respostaDeResposta?.stanzaId !== "AGORA") {
      pEstrutural.push(`pegou a citação de trás: ${JSON.stringify(respostaDeResposta)}`);
    }
    if (respostaDeResposta?.texto === "a de trás") {
      pEstrutural.push("mostrou o trecho da citação anterior, não o desta mensagem");
    }

    // BASE64 GIGANTE não pode ser percorrido nem atrapalhar: mídia recebida
    // chega com megabytes de string no mesmo payload.
    const inicio = Date.now();
    const comBase64 = svc.extrairCitacao({
      data: {
        key: { id: "3FFF" },
        base64: "A".repeat(2 * 1024 * 1024),
        message: {
          imageMessage: {
            mimetype: "image/jpeg",
            base64: "B".repeat(2 * 1024 * 1024),
            contextInfo: { stanzaId: "BAE10", quotedMessage: { conversation: "o print" } },
          },
        },
      },
    });
    const gastou = Date.now() - inicio;
    if (comBase64?.texto !== "o print") {
      pEstrutural.push(`payload com base64 perdeu a citação: ${JSON.stringify(comBase64)}`);
    }
    if (gastou > 200) pEstrutural.push(`a varredura demorou ${gastou}ms num payload com base64`);

    // Payload torto não pode estourar: a entrada vem de fora.
    for (const torto of [null, undefined, {}, { data: null }, { data: { message: "texto" } },
      { data: { message: { conversation: "oi" } } }, { data: [] }]) {
      try {
        svc.extrairCitacao(torto);
        svc.extrairEncaminhada(torto);
      } catch (e) {
        pEstrutural.push(`estourou em ${JSON.stringify(torto)}: ${e.message}`);
      }
    }

    check("a busca do contextInfo é estrutural e não estoura", pEstrutural);

    // ── TOQUE EM BOTÃO NÃO É CITAÇÃO ────────────────────────────────────────
    //
    // Medido no banco da instalação: das 188.250 mensagens, 793 têm
    // `contextInfo.stanzaId` -- e NENHUMA é o "responder" do WhatsApp. São
    // `buttonsResponseMessage`, `listResponseMessage` e
    // `templateButtonReplyMessage`: o toque em botão chega como uma resposta que
    // REFERENCIA a mensagem onde os botões estavam, com `stanzaId` e
    // `quotedMessage` iguaizinhos aos de uma citação de verdade.
    //
    // Tratar isso como citação faz cada escolha de menu aparecer com uma caixa
    // citando o texto do menu do bot -- ruído em cima da conversa inteira. A
    // lista fixa de nós que existia antes escapava por acidente; a varredura
    // estrutural precisa recusar explicitamente, e é isso que está travado aqui.
    const pBotao = [];
    const toque = (no, conteudo) => ({
      data: {
        key: { remoteJid: "5527999999999@s.whatsapp.net", fromMe: false, id: "3AAA" },
        messageType: no,
        message: {
          messageContextInfo: { deviceListMetadata: {}, messageSecret: "x" },
          [no]: {
            ...conteudo,
            contextInfo: {
              stanzaId: "3EB086B334146292B0FD37",
              participant: "552721030070@s.whatsapp.net",
              quotedMessage: { conversation: "Escolha uma opção:\n1 - Técnico" },
            },
          },
        },
      },
    });
    for (const [no, conteudo] of [
      ["templateButtonReplyMessage", { selectedDisplayText: "Técnico", selectedId: "1" }],
      ["buttonsResponseMessage", { selectedDisplayText: "Técnico", selectedButtonId: "1" }],
      ["listResponseMessage", { title: "Técnico", singleSelectReply: { selectedRowId: "1" } }],
    ]) {
      const p = toque(no, conteudo);
      const c = svc.extrairCitacao(p);
      if (c !== null) pBotao.push(`${no}: virou citação (${JSON.stringify(c)})`);
      // E o toque continua sendo lido normalmente -- o rótulo e o id do botão.
      if (svc.extrairTexto(p) !== "Técnico") {
        pBotao.push(`${no}: perdeu o rótulo do botão (${svc.extrairTexto(p)})`);
      }
      if (svc.extrairBotaoId(p) !== "1") {
        pBotao.push(`${no}: perdeu o id do botão (${svc.extrairBotaoId(p)})`);
      }
    }
    check("toque em botão/lista não vira citação (mas segue sendo lido)", pBotao);

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
