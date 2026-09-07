/**
 * A MÍDIA DO HISTÓRICO IMPORTADO PRECISA DE UMA SEGUNDA CHANCE.
 *
 * ── O DEFEITO ──────────────────────────────────────────────────────────────
 *
 * O histórico importado aparecia como "[Imagem]", "[Áudio]", "[Documento]" --
 * o rótulo, sem o arquivo. E ficava assim para sempre.
 *
 * A causa não é uma só, são duas somadas:
 *
 *   ORDEM      O laço de importação insere do mais ANTIGO para o mais novo e
 *              tenta a mídia na mesma ordem. Mídia antiga é justamente a que o
 *              WhatsApp já apagou dos servidores dele, então as primeiras
 *              tentativas são as mais propensas a falhar.
 *   DESISTÊNCIA Oito falhas seguidas e o laço para de tentar pelo resto da
 *              importação. Como as oito primeiras eram as mais velhas, tudo o
 *              que vinha depois -- inclusive mídia recente, que baixaria sem
 *              problema -- era marcado indisponível SEM UMA TENTATIVA.
 *
 * E não havia volta: a segunda importação pula a mensagem pelo `waMessageId`,
 * então a mídia nunca ganhava outra chance.
 *
 * ── O QUE ESTÁ TRAVADO AQUI ────────────────────────────────────────────────
 *
 * Que exista a passada de recuperação, que ela vá da mais NOVA para a mais
 * velha, que a marca saia da mensagem recuperada (senão ela volta à fila para
 * sempre) e que a consulta que acha as pendentes case com o texto que o Prisma
 * de fato grava -- um espaço a mais no JSON e o `LIKE` não encontra nada, em
 * silêncio.
 */
const path = require("path");

const ALVO = path.resolve(__dirname, "src/modules/whatsapp");

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

// ── As dobras: só a Evolution e o banco ──────────────────────────────────────
//
// Três pendentes, da mais nova para a mais velha. A do meio não volta (o
// WhatsApp já apagou os bytes); as outras duas voltam.
const PENDENTES = [
  { id: "nova", waMessageId: "wa-nova", origem: "cliente" },
  { id: "media", waMessageId: "wa-media", origem: "equipe" },
  { id: "velha", waMessageId: "wa-velha", origem: "cliente" },
];
const BAIXA = { "wa-nova": true, "wa-media": false, "wa-velha": true };

const metadatas = {
  nova: { tipo: "imagem", midiaIndisponivel: true },
  media: { tipo: "audio", midiaIndisponivel: true },
  // Legenda preservada: recuperar a mídia não pode apagar o resto do metadata.
  velha: { tipo: "documento", midiaIndisponivel: true, caption: "contrato.pdf" },
};
const gravados = {};
const chavesPedidas = [];

function dobra(rel, exports) {
  const p = require.resolve(path.join(ALVO, rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

dobra("../../infrastructure/external/evolution-api.client", {
  findMessages: async () => ({ registros: [], total: 0, paginas: 1 }),
  findChats: async () => [],
  getBase64FromMediaMessage: async (key) => {
    chavesPedidas.push(key);
    return BAIXA[key.id] ? { base64: "AAAA", mimetype: "image/jpeg" } : null;
  },
});
dobra("../../infrastructure/repositories/conversa.repository", {
  midiasPendentes: async () => PENDENTES,
  metadataDaMensagem: async (id) => metadatas[id] || null,
  gravarMetadata: async (id, metadata) => {
    gravados[id] = metadata;
  },
});
dobra("../../infrastructure/repositories/instancia.repository", { findById: async () => ({ nome: "arka" }) });
dobra("../../infrastructure/storage/midia.storage", {
  salvarDataUrl: async () => ({ arquivo: "abc.jpg" }),
});

const historico = require(path.join(ALVO, "historico.service"));

(async () => {
  console.log("=== Midia do historico importado ===");

  const { recuperadas, tentadas } = await historico._recuperarMidias(
    { id: "c1" },
    "5511999@s.whatsapp.net",
    "arka"
  );

  check("as que ainda existem no WhatsApp voltam", [
    ...(recuperadas === 2 ? [] : ["deveria recuperar 2, recuperou " + recuperadas]),
    ...(gravados.nova?.arquivo ? [] : ["a mais recente nao foi gravada com o arquivo"]),
    ...(gravados.velha?.arquivo ? [] : ["a terceira nao foi tentada -- uma falha no meio nao pode parar tudo"]),
  ]);

  // "0 de 14" e uma resposta; "nada aconteceu" nao e. Sem o denominador a tela
  // nao distingue arquivo que o WhatsApp apagou de tentativa que nem ocorreu.
  check("conta quantas TENTOU, e nao so quantas voltaram", [
    ...(tentadas === 3 ? [] : ["deveria ter tentado as 3 pendentes, tentou " + tentadas]),
  ]);

  check("a marca de indisponivel sai de quem voltou", [
    ...("midiaIndisponivel" in (gravados.nova || {})
      ? ["`midiaIndisponivel` ficou no metadata: a mensagem volta a fila para sempre"]
      : []),
    ...(gravados.media ? ["a que falhou foi gravada; ela tem de continuar como esta"] : []),
  ]);

  check("o resto do metadata sobrevive", [
    ...(gravados.velha?.caption === "contrato.pdf"
      ? []
      : ["a legenda se perdeu ao gravar o arquivo: " + JSON.stringify(gravados.velha)]),
    ...(gravados.velha?.tipo === "documento" ? [] : ["o tipo se perdeu"]),
  ]);

  check("tenta da mais NOVA para a mais velha", [
    ...(chavesPedidas[0]?.id === "wa-nova"
      ? []
      : ["comecou por " + JSON.stringify(chavesPedidas[0]?.id) + " -- a ordem decrescente e o que faz a desistencia significar algo"]),
  ]);

  check("o `fromMe` da chave e de quem MANDOU a mensagem", [
    ...(chavesPedidas.find((k) => k.id === "wa-media")?.fromMe === true
      ? []
      : ["origem `equipe` deveria virar fromMe true"]),
    ...(chavesPedidas.find((k) => k.id === "wa-nova")?.fromMe === false
      ? []
      : ["origem `cliente` deveria virar fromMe false"]),
  ]);

  // ── A consulta e o que o Prisma grava tem de casar ─────────────────────────
  //
  // `midiasPendentes` acha as pendentes com um LIKE sobre o texto do JSON. Se o
  // Prisma gravasse com espacos (`"midiaIndisponivel": true`), o LIKE nao
  // acharia NADA -- sem erro, sem log: a recuperacao simplesmente nunca rodaria.
  {
    const fs = require("fs");
    const repo = fs.readFileSync(
      path.resolve(__dirname, "src/infrastructure/repositories/conversa.repository.js"),
      "utf8"
    );
    const padrao = /LIKE '%(.+?)%'/.exec(repo)?.[1];
    const comoOPrismaGrava = JSON.stringify({ tipo: "imagem", midiaIndisponivel: true });

    check("o LIKE casa com o JSON que o Prisma escreve", [
      ...(padrao ? [] : ["nao achei o padrao do LIKE em conversa.repository.js"]),
      ...(padrao && !comoOPrismaGrava.includes(padrao)
        ? [`o LIKE procura ${JSON.stringify(padrao)}, e o JSON gravado e ${comoOPrismaGrava}`]
        : []),
    ]);
  }

  console.log(
    "\n" +
      (erros.length
        ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ")
        : "MIDIA DO HISTORICO: TUDO CONFERE")
  );
  process.exit(erros.length ? 1 : 0);
})();
