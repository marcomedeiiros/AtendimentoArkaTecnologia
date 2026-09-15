/**
 * SOCKET ZUMBI, E O BOTÃO QUE DESTRUÍA O PAREAMENTO.
 *
 * Os dois defeitos que este arquivo cobra aconteceram no mesmo apagão, em
 * 15/09/2026, e um levou ao outro:
 *
 *   13:21  o websocket do Baileys morre por keep-alive.
 *   13:26  todo `sendText` volta 500 "Connection Closed" -- e ninguém reage:
 *          o vigia só olha `/instance/connectionState`, que respondia `open`.
 *          Ele chegou a logar "[WhatsApp] Online" no meio do apagão.
 *   13:34  o operador, diante de uma tela que dizia "Conectado" e de mensagens
 *          que não saíam, aperta Desconectar. Isso chama `logout` na Evolution,
 *          que APAGA a credencial. Uma queda recuperável vira repareamento
 *          por QR.
 *
 * As duas correções, e o que cada uma precisa garantir:
 *
 *   O ENVIO É SENSOR   um 500 com "Connection Closed" chega ao vigia e dispara
 *                      UMA reconexão -- nunca uma por mensagem que falhou, e
 *                      nunca com o pareamento já perdido.
 *   DESLOGAR PEDE LICENÇA  `desconectar` recusa enquanto a sessão for
 *                      recuperável, e só obedece com `forcar` explícito.
 *
 * Roda sem servidor e sem banco: as duas pontas de I/O são dubladas.
 *
 *   cd server && node verificar-socket-zumbi.js
 */
const evolutionApi = require("./src/infrastructure/external/evolution-api.client");
const reconexao = require("./src/modules/whatsapp/whatsapp.reconexao");
const whatsappService = require("./src/modules/whatsapp/whatsapp.service");

const erros = [];
let secao = "";
const titulo = (t) => { secao = t; console.log(`\n=== ${t} ===`); };
const check = (nome, ok, detalhe = "") => {
  console.log(`  ${ok ? "OK  " : "FALHA"} ${nome}${detalhe ? "  " + detalhe : ""}`);
  if (!ok) erros.push(`[${secao}] ${nome}`);
};
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // ─────────────────────────────────────────────────────────────────────────
  titulo("1. Reconhecer a assinatura do socket morto");

  const ehSocketMorto = evolutionApi.__ehSocketMorto;

  // O caso real, copiado do log de produção.
  check("500 + 'Connection Closed' e socket morto",
    ehSocketMorto(500, "Connection Closed") === true);
  check("a frase e procurada sem depender de caixa",
    ehSocketMorto(500, "connection closed") === true);
  check("frase no meio de um texto maior tambem conta",
    ehSocketMorto(500, 'Internal Server Error: {"message":"Connection Closed"}') === true);
  check("'Connection Terminated' idem",
    ehSocketMorto(500, "Connection Terminated") === true);

  // O QUE NÃO PODE VIRAR RECONEXÃO. Cada um destes, tratado como socket morto,
  // faria o sistema religar a sessão por causa de um erro de digitação do
  // chamador -- e religar não é barato.
  check("400 de validacao NAO e socket morto",
    ehSocketMorto(400, "number must be a string") === false);
  check("404 de instancia inexistente NAO e socket morto",
    ehSocketMorto(404, "The x instance does not exist") === false);
  check("500 generico, sem a frase, NAO e socket morto",
    ehSocketMorto(500, "Internal Server Error") === false,
    "(500 sozinho nao prova que o fio caiu)");
  check("500 sem detalhe nenhum NAO e socket morto",
    ehSocketMorto(500, null) === false);

  // ─────────────────────────────────────────────────────────────────────────
  titulo("2. O envio acorda o vigia -- uma vez, nao uma por mensagem");

  // NAO dublamos `reconexao.reconectarAgora`: `notificarSocketMorto` chama a
  // funcao interna do modulo, nao a exportada, entao trocar o export nao
  // interceptaria nada -- e o teste passaria a medir a si mesmo. Dublamos a
  // ponta de verdade, o `fetch`, e contamos as batidas na Evolution. E o que
  // realmente importa saber: quantos sockets estamos jogando na sessao.
  let batidas = [];
  const fetchOriginal = global.fetch;
  global.fetch = async (url) => {
    batidas.push(String(url));
    return {
      ok: true,
      status: 200,
      // `close` mantem o vigia no caminho de religar (`/instance/connect`),
      // que e o cenario deste teste.
      text: async () => JSON.stringify({ instance: { state: "close" } }),
    };
  };

  try {
    const r1 = await reconexao.notificarSocketMorto({
      endpoint: "/message/sendText/arka-wapi-oficial",
      detalhe: "Connection Closed",
    });
    check("o primeiro aviso religa", r1.agiu === true && batidas.length > 0,
      `(${batidas.length} chamadas a Evolution)`);

    // AS MENSAGENS EM VOO CAEM TODAS JUNTAS. Em 15/09 foram 12 falhas; num
    // horario cheio seriam dezenas em segundos. Sem o freio, cada uma abriria a
    // sua reconexao -- exatamente o empilhamento de sockets que o vigia inteiro
    // existe para evitar.
    const seguintes = [];
    for (let i = 0; i < 10; i += 1) {
      seguintes.push(await reconexao.notificarSocketMorto({ detalhe: "Connection Closed" }));
    }
    check("os dez avisos seguintes NAO religam de novo", religadas === 1,
      `(religadas=${religadas})`);
    check("e dizem por que ficaram quietos",
      seguintes.every((r) => r.agiu === false && r.motivo === "debounce"));

    // ── COM O PAREAMENTO PERDIDO, RELIGAR NAO E SO INUTIL ───────────────────
    // E o caminho pelo qual um erro de envio viraria pedido de QR. O vigia ja
    // concluiu, COM EVIDENCIA, que so o celular resolve: um 500 de sendText nao
    // acrescenta nada a isso.
    religadas = 0;
    reconexao.marcarPrecisaParear("teste: logout real simulado", { motivoCodigo: 401 });
    const r2 = await reconexao.notificarSocketMorto({ detalhe: "Connection Closed" });
    check("com pareamento perdido, NAO religa",
      r2.agiu === false && r2.motivo === "pareamento_perdido" && religadas === 0);
  } finally {
    reconexao.reconectarAgora = reconectarOriginal;
  }

  // ─────────────────────────────────────────────────────────────────────────
  titulo("3. O client grita, e quem escuta e o vigia");

  {
    // O client NAO pode importar o vigia (o vigia ja importa o client). O
    // contrato entre os dois e este canal -- se ele se perder, o socket zumbi
    // volta a passar despercebido e nada no resto da suite acusaria.
    check("o client expoe o canal", typeof evolutionApi.observarSocketMorto === "function");

    let recebido = null;
    evolutionApi.observarSocketMorto((d) => { recebido = d; });

    // Duble de `fetch`: a Evolution respondendo exatamente o que respondeu em
    // producao as 13:26.
    const fetchOriginal = global.fetch;
    global.fetch = async () => ({
      ok: false,
      status: 500,
      text: async () =>
        JSON.stringify({
          status: 500,
          error: "Internal Server Error",
          response: { message: "Connection Closed" },
        }),
    });

    try {
      let erroDoEnvio = null;
      try {
        await evolutionApi.sendText("5527999999999", "oi", "arka-wapi-oficial");
      } catch (e) {
        erroDoEnvio = e;
      }

      check("o envio continua falhando para quem chamou", erroDoEnvio != null,
        "(o aviso nao pode engolir o erro)");
      check("e o erro descreve o motivo",
        /connection closed/i.test(erroDoEnvio?.message || ""));

      // O aviso e fire-and-forget: sai por `Promise.resolve`, entao chega no
      // proximo tick, nao dentro do `await` acima.
      await dormir(10);
      check("o ouvinte foi avisado", recebido != null);
      check("e recebeu o endpoint que falhou",
        /message\/sendText/.test(recebido?.endpoint || ""));
      check("marcado como socketMorto", recebido?.socketMorto === true);
    } finally {
      global.fetch = fetchOriginal;
      evolutionApi.observarSocketMorto(null);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  titulo("4. Deslogar pede licenca");

  {
    // `obterStatus` e o veredito que autoriza (ou nao) destruir o pareamento --
    // o mesmo que ja autorizava o QR. Dublado aqui para escrever cada cenario.
    const statusOriginal = whatsappService.obterStatus;
    let deslogou = 0;
    const logoutOriginal = evolutionApi.logout;
    evolutionApi.logout = async () => { deslogou += 1; return {}; };

    try {
      // ── SESSAO VIVA: o cenario de 15/09 ──────────────────────────────────
      whatsappService.obterStatus = async () => ({
        podeMostrarQr: false, conectado: true, state: "open", situacao: "CONNECTED",
      });

      let recusa = null;
      try {
        await whatsappService.desconectar("arka-wapi-oficial");
      } catch (e) {
        recusa = e;
      }
      check("com a sessao valida, RECUSA", recusa != null && deslogou === 0);
      check("com 409 e codigo proprio",
        recusa?.statusCode === 409 && recusa?.code === "LOGOUT_DESNECESSARIO");
      check("e aponta o botao certo",
        /reconectar/i.test(recusa?.message || ""),
        "(a mensagem tem de dizer o que fazer, nao so o que nao fazer)");

      // ── CAIDA MAS RECUPERAVEL: o vigia esta religando ────────────────────
      deslogou = 0;
      whatsappService.obterStatus = async () => ({
        podeMostrarQr: false, conectado: false, state: "close",
        situacao: "DISCONNECTED_TEMPORARY",
      });
      let recusa2 = null;
      try {
        await whatsappService.desconectar("arka-wapi-oficial");
      } catch (e) {
        recusa2 = e;
      }
      check("caida mas recuperavel, tambem RECUSA",
        recusa2?.code === "LOGOUT_DESNECESSARIO" && deslogou === 0,
        "(o cofre atravessa isto sozinho)");

      // ── `forcar`: a saida consciente ─────────────────────────────────────
      deslogou = 0;
      await whatsappService.desconectar("arka-wapi-oficial", { forcar: true });
      check("com `forcar`, obedece", deslogou === 1);

      // ── PAREAMENTO JA PERDIDO: nao ha o que destruir ─────────────────────
      //
      // Aqui deslogar e ate util: leva a instancia para `close`, o unico estado
      // em que a Evolution emite QR e codigo novos. Recusar aqui fecharia a
      // unica saida -- e foi um beco assim que custou 4h30 em 01/09/2026.
      deslogou = 0;
      whatsappService.obterStatus = async () => ({
        podeMostrarQr: true, conectado: false, state: "close", situacao: "LOGGED_OUT",
      });
      await whatsappService.desconectar("arka-wapi-oficial");
      check("com o pareamento ja perdido, obedece sem `forcar`", deslogou === 1);
    } finally {
      whatsappService.obterStatus = statusOriginal;
      evolutionApi.logout = logoutOriginal;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  titulo("5. A tela nao desloga sem perguntar");

  {
    const fs = require("fs");
    const pagina = fs.readFileSync("../client/src/pages/WhatsAppPage.jsx", "utf8");
    const api = fs.readFileSync("../client/src/services/api.js", "utf8");

    // O toggle "Desconectar WhatsApp" chamava `desconectar` DIRETO, sem
    // confirmacao -- enquanto o aviso duro vivia num botao secundario que so
    // aparecia DESCONECTADO. Ou seja: a tela avisava quando nao havia o que
    // perder, e calava quando havia.
    const alternar = pagina.slice(
      pagina.indexOf("async function alternarConexao()"),
      pagina.indexOf("async function reconectar()")
    );
    check("o toggle nao chama `desconectar` direto",
      !/WhatsAppAPI\.desconectar\(/.test(alternar),
      "(tem de passar por `encerrarSessao`, que confirma)");
    check("ele passa por `encerrarSessao`", /encerrarSessao\(\)/.test(alternar));

    // `forcar` e o que distingue um clique confirmado de uma chamada acidental:
    // sem ele o servidor devolve 409.
    check("a camada de API aceita `forcar`",
      /desconectar:\s*\(instance,\s*forcar/.test(api));
    check("e o unico ponto que desloga manda `forcar`",
      /WhatsAppAPI\.desconectar\(instancia,\s*true\)/.test(pagina));

    // O texto do dialogo e o que o operador de verdade le as 13h34 de uma
    // terca. Ele precisa cobrir o caso CONECTADO -- que era o unico que o texto
    // antigo nao previa, e justamente o que aconteceu.
    check("o aviso cobre a instancia CONECTADA",
      /CONECTADA agora/.test(pagina));
    check("e desfaz a confusao que causou o incidente",
      /não estão saindo mas a tela diz/.test(pagina),
      '("mensagens nao saem" + "Conectado" -> Reconectar, nao Encerrar)');
  }

  console.log(
    "\n" + (erros.length
      ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ")
      : "SOCKET ZUMBI: TUDO CONFERE")
  );
  process.exit(erros.length ? 1 : 0);
})();
