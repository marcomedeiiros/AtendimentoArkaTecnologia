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

    // ── O CASO `null` MUDOU DE VEREDITO, E DE PROPOSITO ─────────────────────
    //
    // Ele exigia `error` ("WEBHOOK AUSENTE"). Mas nesta topologia quem entrega e
    // o webhook GLOBAL, que NAO aparece em `/webhook/find` -- entao `null` e o
    // estado NORMAL da VM, e o alarme saia a cada boot com tudo funcionando.
    //
    // A checagem nao foi apagada, foi INVERTIDA: `null` agora tem de sair em
    // `warn`, nunca em `error`. Apagar deixaria o caminho livre para alguem
    // "consertar" o alarme de volta na proxima leitura apressada do log -- e o
    // custo de gritar todo dia e perder o alarme no dia em que importa.
    //
    // O que continua sendo `error` e so o afirmavel: webhook que EXISTE e esta
    // desligado, ou que existe sem token.
    const casos = [
      [null, false, "sem webhook por instancia (o normal com o global)"],
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

    // ...E NAO GRITA quando a ausencia e a normalidade. A linha precisa existir
    // (alguem tem de saber que nao ha webhook por instancia), mas em `warn`.
    resposta = null;
    linhas.length = 0;
    await conferencia.conferir();
    const semInstancia = linhas.filter((l) => l.nivel === "warn");
    check("sem webhook por instancia: avisa em warn, nunca em error", [
      ...(linhas.some((l) => l.nivel === "error") ? ["saiu como error -- o alarme volta a gritar todo boot"] : []),
      ...(semInstancia.length === 0 ? ["nao avisou nada -- a ausencia precisa aparecer em algum lugar"] : []),
      ...(semInstancia.some((l) => /global/i.test(JSON.stringify(l))) ? [] : ["o aviso nao explica que o global e quem entrega"]),
    ]);

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

    // ── TOQUE EM BOTÃO É CITAÇÃO -- E ESTA ASSERTIVA FOI INVERTIDA ──────────
    //
    // Aqui estava travado o oposto: `buttonsResponseMessage`,
    // `listResponseMessage` e `templateButtonReplyMessage` NÃO podiam virar
    // citação. O argumento estava medido e era bom -- das 188.250 mensagens da
    // instalação, 793 tinham `contextInfo.stanzaId` e nenhuma era o "responder"
    // do WhatsApp, então cada escolha de menu ganharia uma caixa citando o texto
    // do menu do bot.
    //
    // O que derrubou o argumento foi ver a conversa nas DUAS telas, lado a lado:
    // no WhatsApp, tocar em "Técnico" produz uma bolha que CITA o menu, e na
    // Central aparecia "🔧 Técnico" solto. Quem atende lê a mesma conversa que o
    // cliente está lendo, e as duas discordavam -- num fio com três menus
    // (principal, técnico, contrato) não há como saber a qual pergunta aquele
    // "Técnico" responde sem contar as bolhas para cima.
    //
    // Decisão do dono do produto, tomada olhando o print das duas telas. O que
    // esta assertiva trava agora é o novo contrato -- e ela continua exigindo o
    // que já exigia antes: o toque segue sendo LIDO como escolha (rótulo e id),
    // porque citação e roteamento são coisas independentes e quebrar o segundo
    // para ganhar o primeiro seria uma troca ruim.
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
      if (!c) {
        pBotao.push(`${no}: não virou citação, e agora tem de virar`);
      } else {
        // O `stanzaId` é a ligação com a mensagem do bot: é por ele que
        // `respondendoAId` acha a original no banco.
        if (c.stanzaId !== "3EB086B334146292B0FD37") {
          pBotao.push(`${no}: stanzaId errado (${c.stanzaId})`);
        }
        // E o RETRATO do menu citado, que é o plano B quando a original não
        // está na janela carregada na tela.
        if (!String(c.texto || "").includes("Escolha uma opção")) {
          pBotao.push(`${no}: perdeu o retrato do menu citado (${JSON.stringify(c.texto)})`);
        }
      }
      // O toque continua sendo lido normalmente -- o rótulo e o id do botão.
      // Citação e roteamento são independentes: ganhar um não pode custar o outro.
      if (svc.extrairTexto(p) !== "Técnico") {
        pBotao.push(`${no}: perdeu o rótulo do botão (${svc.extrairTexto(p)})`);
      }
      if (svc.extrairBotaoId(p) !== "1") {
        pBotao.push(`${no}: perdeu o id do botão (${svc.extrairBotaoId(p)})`);
      }
      // E NÃO pode virar selo de encaminhamento: o contextInfo do toque não tem
      // `isForwarded` nem `forwardingScore`, e era esse o único outro leitor da
      // lista de exclusão que saiu.
      if (svc.extrairEncaminhada(p)) {
        pBotao.push(`${no}: virou encaminhamento (${JSON.stringify(svc.extrairEncaminhada(p))})`);
      }
    }
    check("toque em botão/lista vira citação, sem perder o roteamento nem virar encaminhamento", pBotao);

    // O RETRATO SOBREVIVE ATÉ A TELA. O mapper é a última ponte: `citacao` com
    // só o tipo não pode ser descartada ali (era o `meta.citacao?.texto` que
    // decidia sozinho se o campo existia).
    //
    // TRÊS ESTADOS, e o terceiro é novo: `desconhecida` marca "o cliente
    // respondeu algo que não temos" (mensagem anterior à integração, ou saída
    // do celular fora da Central). Sem ele, essa situação chegava na tela como
    // ausência -- exatamente igual a "não respondeu nada" -- e a bolha aparecia
    // solta. Um "isso" solto é incompreensível para quem atende.
    const mapper = require(path.join(__dirname, "src/shared/helpers/mapper.helper"));
    // `derivada` distingue o retrato que veio do APARELHO daquele que a Central
    // montou a partir da pergunta que o bot deixou em aberto -- a bolha desenha
    // os dois iguais, e é justamente por isso que a origem precisa sobreviver no
    // dado. Falso em tudo que veio do WhatsApp.
    const mapeadas = [
      [{ citacao: { tipo: "imagem" } }, { texto: null, tipo: "imagem", desconhecida: false, derivada: false }],
      [{ citacao: { texto: "oi" } }, { texto: "oi", tipo: null, desconhecida: false, derivada: false }],
      [{ citacao: { desconhecida: true } }, { texto: null, tipo: null, desconhecida: true, derivada: false }],
      [
        { citacao: { texto: "Como podemos ajudar?", derivada: true } },
        { texto: "Como podemos ajudar?", tipo: null, desconhecida: false, derivada: true },
      ],
      // E o campo continua NULO quando não houve citação nenhuma: a marca não
      // pode vazar para a conversa inteira.
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

  // ── O ROTEADOR PRECISA RECONHECER O "APAGAR" EM TODAS AS FORMAS ───────────
  //
  // A exclusao feita pelo cliente chega de tres jeitos conforme a versao, e ate
  // 11/09 so UM era tratado -- o que vem embrulhado em `protocolMessage`. Os
  // outros dois morriam em "Webhook recebido e nao roteado", sem log em
  // producao. Ver docs/auditoria-perda-mensagens-11-09.md §4.
  //
  // O teste dubla os `_processar*` e olha SO para onde o evento foi parar: o que
  // se trava aqui e o roteamento, e nao o efeito no banco (esse tem dono em
  // `_processarProtocolo`, ja coberto).
  {
    const svc = require(path.join(__dirname, "src/modules/whatsapp/whatsapp.service"));
    const JID = "5527998189226@s.whatsapp.net";
    let visto = [];
    const originais = {};
    for (const m of ["_processarProtocolo", "_processarMensagem", "_processarAck"]) {
      originais[m] = svc[m];
      svc[m] = async (arg) => {
        visto.push({ metodo: m, arg });
        return { recebido: true, processado: true };
      };
    }

    const rotear = async (body) => {
      visto = [];
      await svc.processarWebhook(body, "i");
      return visto;
    };

    const formas = {
      "chave crua": { event: "messages.delete", data: { id: "ALVO1", remoteJid: JID, fromMe: false } },
      "chave embrulhada": { event: "messages.delete", data: { key: { id: "ALVO1", remoteJid: JID, fromMe: false } } },
      "protocolMessage REVOKE": {
        event: "messages.delete",
        data: { key: { id: "X", remoteJid: JID }, message: { protocolMessage: { key: { id: "ALVO1" }, type: "REVOKE" } } },
      },
      "MAIUSCULAS": { event: "MESSAGES_DELETE", data: { id: "ALVO1", remoteJid: JID, fromMe: false } },
    };

    const pApagar = [];
    for (const [nome, body] of Object.entries(formas)) {
      const t = await rotear(body);
      const foi = t.find((x) => x.metodo === "_processarProtocolo");
      if (!foi) pApagar.push(`${nome}: nao chegou em _processarProtocolo (foi para ${t.map((x) => x.metodo).join(",") || "lugar nenhum"})`);
      else if (foi.arg?.acao !== "apagar") pApagar.push(`${nome}: acao ${foi.arg?.acao}, esperado "apagar"`);
      else if (foi.arg?.waMessageId !== "ALVO1") pApagar.push(`${nome}: alvo ${foi.arg?.waMessageId}, esperado ALVO1`);
    }
    check("o 'apagar' do cliente e reconhecido nas quatro formas", pApagar);

    // LOTE: o cliente que seleciona varias mensagens e apaga de uma vez.
    const lote = await rotear({
      event: "messages.delete",
      data: [{ key: { id: "A1" } }, { key: { id: "A2" } }, { key: { id: "A1" } }],
    });
    const alvos = lote.filter((x) => x.metodo === "_processarProtocolo").map((x) => x.arg.waMessageId);
    check("lote apaga cada mensagem uma unica vez", JSON.stringify(alvos) === '["A1","A2"]' ? [] : [`alvos: ${JSON.stringify(alvos)}`]);

    // ── A EDICAO, pelas duas vias que tem nome de evento ─────────────────────
    const edicoes = {
      "achatada (o payload E a mensagem)": {
        event: "messages.edited",
        data: { key: { id: "ALVO1", remoteJid: JID, fromMe: false }, message: { conversation: "texto corrigido" } },
      },
      "com protocolMessage": {
        event: "messages.edited",
        data: {
          key: { id: "X", remoteJid: JID },
          message: { protocolMessage: { key: { id: "ALVO1" }, type: 14, editedMessage: { conversation: "texto corrigido" } } },
        },
      },
      "MAIUSCULAS": {
        event: "MESSAGES_EDITED",
        data: { key: { id: "ALVO1", remoteJid: JID, fromMe: false }, message: { conversation: "texto corrigido" } },
      },
    };
    const pEditar = [];
    for (const [nome, body] of Object.entries(edicoes)) {
      const t = await rotear(body);
      const foi = t.find((x) => x.metodo === "_processarProtocolo");
      if (!foi) pEditar.push(`${nome}: nao chegou em _processarProtocolo`);
      else if (foi.arg?.acao !== "editar") pEditar.push(`${nome}: acao ${foi.arg?.acao}, esperado "editar"`);
      else if (foi.arg?.waMessageId !== "ALVO1") pEditar.push(`${nome}: alvo ${foi.arg?.waMessageId}`);
      else if (foi.arg?.texto !== "texto corrigido") pEditar.push(`${nome}: texto "${foi.arg?.texto}"`);
    }
    check("a edicao do cliente e reconhecida nas tres formas com nome de evento", pEditar);

    // MIDIA SEM LEGENDA: melhor nao tocar na bolha do que esvazia-la.
    const semTexto = await rotear({
      event: "messages.edited",
      data: { key: { id: "ALVO1", remoteJid: JID }, message: { imageMessage: { mimetype: "image/jpeg" } } },
    });
    check(
      "edicao sem texto legivel NAO sobrescreve a bolha",
      semTexto.some((x) => x.metodo === "_processarProtocolo") ? ["chamou _processarProtocolo sem texto"] : []
    );

    // ── ENVELOPES: o conteudo real embrulhado ────────────────────────────────
    //
    // Mensagem temporaria e visualizacao unica nao mudam o conteudo -- embrulham.
    // Sem desembrulhar, TODA mensagem de um cliente com o recurso ligado cai em
    // `dados_incompletos`: a conversa inteira some, em silencio.
    const envelopados = [
      ["temporaria (ephemeralMessage)", { ephemeralMessage: { message: { conversation: "sou temporaria" } } }, "texto"],
      ["visualizacao unica v2", { viewOnceMessageV2: { message: { imageMessage: { mimetype: "image/jpeg" } } } }, "midia"],
      ["visualizacao unica v1", { viewOnceMessage: { message: { imageMessage: { mimetype: "image/jpeg" } } } }, "midia"],
      ["foto de album (associatedChild)", { associatedChildMessage: { message: { imageMessage: { mimetype: "image/jpeg" } } } }, "midia"],
      ["empilhado (unica DENTRO de temporaria)", { ephemeralMessage: { message: { viewOnceMessageV2: { message: { conversation: "oi" } } } } }, "texto"],
    ];
    const pEnvelope = [];
    for (const [nome, message, esperado] of envelopados) {
      const p = { data: { key: { id: "M1", remoteJid: JID, fromMe: false }, message } };
      const achou = esperado === "texto" ? svc.extrairTexto(p) : svc.extrairMidia(p)?.tipo;
      if (!achou) pEnvelope.push(`${nome}: nada extraido (cairia em dados_incompletos)`);
    }
    check("envelopes sao abertos: a mensagem de dentro e lida", pEnvelope);

    // E o que NAO pode acontecer: uma mensagem comum virar exclusao.
    const comum = await rotear({
      event: "messages.upsert",
      data: { key: { id: "M1", remoteJid: JID, fromMe: false }, message: { conversation: "bom dia" } },
    });
    check(
      "mensagem comum continua indo para _processarMensagem",
      comum.length === 1 && comum[0].metodo === "_processarMensagem" ? [] : [`foi para ${JSON.stringify(comum.map((x) => x.metodo))}`]
    );

    for (const [m, fn] of Object.entries(originais)) svc[m] = fn;

    // ── A EDICAO QUE CHEGA CIFRADA ──────────────────────────────────────────
    //
    // Medido em producao (11/09/2026): o cliente editou "teste um" e chegou um
    // `secretEncryptedMessage` com `secretEncType: 2` e o `targetMessageKey`
    // apontando para a mensagem dele. O conteudo novo vem cifrado; o ALVO vem em
    // claro. Ate entao isso morria em `dados_incompletos`, e a bolha seguia
    // mostrando o texto antigo sem nenhum sinal.
    //
    // Aqui roda o `_processarMensagem` DE VERDADE (o desvio mora nele), com so
    // o tratamento final dublado -- entao nada toca o banco.
    const originalCifrada = svc._processarEdicaoCifrada;
    let alvosMarcados = [];
    svc._processarEdicaoCifrada = async (no) => {
      alvosMarcados.push(no?.targetMessageKey?.id || null);
      return { recebido: true, processado: true, motivo: "edicao_cifrada" };
    };

    const cifrado = (tipo) => ({
      event: "messages.upsert",
      data: {
        key: { id: "EV1", remoteJid: JID, fromMe: false },
        messageType: "secretEncryptedMessage",
        message: {
          messageContextInfo: {},
          secretEncryptedMessage: {
            secretEncType: tipo,
            encIv: "x",
            encPayload: "y",
            targetMessageKey: { id: "ALVO-EDITADO", fromMe: true, remoteJid: "46038257807430@lid" },
          },
        },
      },
    });

    alvosMarcados = [];
    await svc.processarWebhook(cifrado(2), "i");
    check(
      "edicao cifrada (secretEncType 2) marca a mensagem alvo",
      JSON.stringify(alvosMarcados) === '["ALVO-EDITADO"]' ? [] : [`alvos: ${JSON.stringify(alvosMarcados)}`]
    );

    // SO O TIPO 2. Este envelope carrega mais de um tipo de evento, e tratar
    // tudo como edicao carimbaria "editada" numa mensagem que ninguem editou.
    alvosMarcados = [];
    const r1 = await svc.processarWebhook(cifrado(1), "i");
    const r5 = await svc.processarWebhook(cifrado(5), "i");
    check("outros secretEncType NAO viram edicao", [
      ...(alvosMarcados.length ? [`marcou indevidamente: ${JSON.stringify(alvosMarcados)}`] : []),
      // Continuam no aviso de payload ilegivel -- e onde aparecem para serem
      // identificados, que foi exatamente como o tipo 2 apareceu.
      ...(r1?.motivo === "dados_incompletos" && r5?.motivo === "dados_incompletos"
        ? []
        : [`motivos: ${r1?.motivo} / ${r5?.motivo}`]),
    ]);

    svc._processarEdicaoCifrada = originalCifrada;
  }

  // ── A DECIFRACAO DA EDICAO ────────────────────────────────────────────────
  //
  // O esquema foi confirmado com dado real de producao em 11/09/2026 (o cliente
  // editou para "123" e a derivacao devolveu "123"). O que este teste trava e o
  // nosso lado: a derivacao HKDF, o GCM e o passeio pelo protobuf.
  //
  // Cifra aqui do mesmo jeito que o WhatsApp cifra, e exige que o helper leia de
  // volta. Se alguem trocar o `info`, a ordem dos JIDs ou o caminho no protobuf,
  // isto quebra -- que e o unico jeito de perceber, ja que a falha real e muda
  // (a bolha volta a mostrar o texto velho, e ninguem estranha).
  {
    const cripto = require("crypto");
    const { decifrarEdicao } = require(path.join(__dirname, "src/shared/helpers/edicaoCifrada.helper"));

    // Protobuf na mao: so campos de comprimento delimitado, todos < 128 bytes.
    const campo = (n, buf) => Buffer.concat([Buffer.from([(n << 3) | 2]), Buffer.from([buf.length]), buf]);
    const texto = (s) => Buffer.from(s, "utf8");

    const ALVO = "3EB09064A99A61B8643CC9";
    const JID = "152188055777283@lid";
    const segredo = cripto.randomBytes(32);

    const cifrar = (corpoDaMensagem, jidUsado = JID) => {
      // Message.protocolMessage(12) { key(1), editedMessage(14) { ... } }
      const plano = campo(12, Buffer.concat([campo(1, texto("chave")), campo(14, corpoDaMensagem)]));
      const info = Buffer.concat([texto(ALVO), texto(jidUsado), texto(jidUsado), texto("Message Edit")]);
      const chave = Buffer.from(cripto.hkdfSync("sha256", segredo, Buffer.alloc(0), info, 32));
      const iv = cripto.randomBytes(12);
      const c = cripto.createCipheriv("aes-256-gcm", chave, iv);
      const corpo = Buffer.concat([c.update(plano), c.final()]);
      return { encIv: iv.toString("base64"), encPayload: Buffer.concat([corpo, c.getAuthTag()]).toString("base64") };
    };

    const ler = (extra = {}) =>
      decifrarEdicao({ segredo: segredo.toString("base64"), alvoId: ALVO, jids: [JID], ...extra });

    // Mensagem simples: Message.conversation(1)
    const simples = cifrar(campo(1, texto("123")));
    check("a edicao cifrada e decifrada e o texto novo sai inteiro", [
      ...(ler(simples) === "123" ? [] : [`veio ${JSON.stringify(ler(simples))}, esperado "123"`]),
    ]);

    // Com formatacao/link: Message.extendedTextMessage(2) { text(1) }
    const formatada = cifrar(campo(2, campo(1, texto("olha o *link* aqui"))));
    check("edicao com formatacao/link tambem e lida", [
      ...(ler(formatada) === "olha o *link* aqui" ? [] : [`veio ${JSON.stringify(ler(formatada))}`]),
    ]);

    // O JID certo esta no meio de candidatos errados -- e o caso real, porque a
    // instalacao mistura @lid e @s.whatsapp.net para o mesmo contato.
    check("acha o JID certo no meio dos candidatos", [
      ...(ler({ ...simples, jids: ["5527997819294@s.whatsapp.net", null, JID] }) === "123"
        ? []
        : ["nao achou com o jid certo em segundo lugar"]),
    ]);

    // E O QUE NAO PODE ACONTECER: chave errada devolvendo texto. A tag do GCM e
    // quem garante -- sem ela, uma derivacao errada viraria lixo na bolha.
    check("chave errada NAO produz texto", [
      ...(decifrarEdicao({ ...simples, segredo: cripto.randomBytes(32).toString("base64"), alvoId: ALVO, jids: [JID] }) === null
        ? []
        : ["decifrou com a chave errada"]),
      ...(ler({ ...simples, jids: ["outro@lid"] }) === null ? [] : ["decifrou com o jid errado"]),
      ...(ler({ ...simples, segredo: null }) === null ? [] : ["decifrou sem segredo"]),
    ]);
  }

  // A marca precisa CHEGAR na tela: sem ela a bolha diz so "editada", que afirma
  // que o texto ao lado e a versao nova -- justamente o que nao e.
  {
    const mapper = require(path.join(__dirname, "src/shared/helpers/mapper.helper"));
    const linha = (meta) => mapper.mapMensagem({ id: "m1", origem: "cliente", texto: "x", metadata: meta, editadaEm: new Date() });
    check("a edicao ilegivel chega a tela separada da edicao normal", [
      ...(linha({ edicaoIlegivel: true }).edicaoIlegivel === true ? [] : ["nao marcou a ilegivel"]),
      ...(linha({}).edicaoIlegivel === false ? [] : ["marcou uma edicao normal como ilegivel"]),
      ...(linha({ edicaoIlegivel: true }).editada === true ? [] : ["perdeu o 'editada' no caminho"]),
    ]);
  }

  console.log(
    "\n" +
      (erros.length
        ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ")
        : "ENTRADA DO WEBHOOK: TUDO CONFERE")
  );
  process.exit(erros.length ? 1 : 0);
})();
