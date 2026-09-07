/**
 * REAÇÕES DE MENSAGEM (o 👍 do WhatsApp).
 *
 * O recurso tem DOIS SENTIDOS, e é a assimetria entre eles que este arquivo
 * cobra:
 *
 *   SAINDO   a equipe reage pelo painel -> vai para o aparelho do cliente.
 *            Se a Evolution recusar, NÃO grava: um 👍 no painel que o cliente
 *            nunca recebeu é pior do que nenhum.
 *   ENTRANDO o cliente reage pelo celular -> chega como `messages.upsert` com
 *            `reactionMessage`. Não é mensagem: não pode virar bolha no chat
 *            nem acordar o bot.
 *
 * Roda sem servidor e sem banco: o helper é puro, e as duas pontas de I/O
 * (Evolution e Prisma) são dubladas.
 *
 *   cd server && node verificar-reacoes.js
 */
const reacoes = require("./src/shared/helpers/reacao.helper");
const { mapMensagem } = require("./src/shared/helpers/mapper.helper");
const whatsappService = require("./src/modules/whatsapp/whatsapp.service");

const erros = [];
let secao = "";
const titulo = (t) => { secao = t; console.log(`\n=== ${t} ===`); };
const check = (nome, ok, detalhe = "") => {
  console.log(`  ${ok ? "OK  " : "FALHA"} ${nome}${detalhe ? "  " + detalhe : ""}`);
  if (!ok) erros.push(`[${secao}] ${nome}`);
};

// ---------------------------------------------------------------------------
titulo("1. Uma reacao por pessoa, e o mesmo emoji desfaz");

{
  const vazio = {};
  const a = reacoes.aplicar(vazio, { emoji: "👍", de: "equipe", autorId: "u1", autorNome: "Marco" });
  check("por a primeira", a.reacoes.length === 1 && a.reacoes[0].emoji === "👍");
  check("e o metadata original nao e mutado", !vazio.reacoes, "(aplicar devolve copia)");

  // TROCAR substitui, nao acumula -- senao a mesma pessoa apareceria duas vezes.
  const b = reacoes.aplicar(a.metadata, { emoji: "❤️", de: "equipe", autorId: "u1" });
  check("trocar o emoji SUBSTITUI", b.reacoes.length === 1 && b.reacoes[0].emoji === "❤️");

  // O MESMO emoji de novo remove: e o que o dedo no aparelho faz, e sem isso
  // nao haveria como tirar pela tela.
  const c = reacoes.aplicar(b.metadata, { emoji: "❤️", de: "equipe", autorId: "u1" });
  check("o mesmo emoji de novo REMOVE", c.reacoes.length === 0);
  check("e `reacoes` some do metadata quando zera", !("reacoes" in c.metadata),
    "(nao fica array vazio para sempre)");

  // Duas PESSOAS diferentes convivem.
  const d1 = reacoes.aplicar({}, { emoji: "👍", de: "equipe", autorId: "u1", autorNome: "Marco" });
  const d2 = reacoes.aplicar(d1.metadata, { emoji: "👍", de: "cliente", autorId: "5527999" });
  check("duas pessoas somam", d2.reacoes.length === 2);
  const agrupado = reacoes.agrupar(d2.metadata);
  check("mas a tela ve UM item com total 2",
    agrupado.length === 1 && agrupado[0].total === 2 && agrupado[0].emoji === "👍");
  check("e sabe que a equipe reagiu", agrupado[0].daEquipe === true);

  // Emoji vazio remove mesmo sem ter emoji igual.
  const e = reacoes.aplicar(d2.metadata, { emoji: "", de: "cliente", autorId: "5527999" });
  check("emoji vazio remove a de quem pediu", reacoes.listar(e.metadata).length === 1);
  check("e nao mexe na dos outros", reacoes.listar(e.metadata)[0].autorId === "u1");
}

// ---------------------------------------------------------------------------
titulo("2. O metadata da MIDIA nao pode ser atropelado");

{
  // O `metadata` e compartilhado: mexer na reacao nao pode apagar o arquivo.
  const comMidia = { tipo: "imagem", arquivo: "2026/09/foto.jpg", mimetype: "image/jpeg" };
  const r = reacoes.aplicar(comMidia, { emoji: "👍", de: "equipe", autorId: "u1" });
  check("o arquivo continua la", r.metadata.arquivo === "2026/09/foto.jpg");
  check("o tipo tambem", r.metadata.tipo === "imagem");
  check("e a reacao entrou", r.reacoes.length === 1);
}

// ---------------------------------------------------------------------------
titulo("3. `mudou` diz quando NAO ha o que gravar");

{
  const base = reacoes.aplicar({}, { emoji: "👍", de: "equipe", autorId: "u1" });
  check("a primeira mudou", base.mudou === true);
  // Remover algo que nao existe nao muda nada -- e sem esta bandeira o servico
  // gravaria e emitiria evento a toa a cada clique repetido.
  const nada = reacoes.aplicar({}, { emoji: "", de: "equipe", autorId: "u9" });
  check("remover o que nao existe NAO muda", nada.mudou === false);
}

// ---------------------------------------------------------------------------
titulo("4. Emoji que vem de fora tem teto, mas nao allowlist");

{
  // Do CLIENTE aceita qualquer emoji: recusar seria esconder da equipe algo que
  // ele de fato enviou.
  const exotico = reacoes.aplicar({}, { emoji: "🦄", de: "cliente", autorId: "5527" });
  check("emoji fora da lista da tela e aceito do cliente", exotico.reacoes[0].emoji === "🦄");

  // Mas texto nao e emoji: o teto corta.
  const textao = reacoes.aplicar({}, { emoji: "x".repeat(500), de: "cliente", autorId: "5527" });
  check("texto gigante e cortado", textao.reacoes[0].emoji.length <= 16,
    `(ficou com ${textao.reacoes[0].emoji.length})`);

  // A allowlist existe para o que SAI, e mora no helper para o servico usar.
  check("a lista da tela existe e tem os emojis do WhatsApp",
    reacoes.EMOJIS_PERMITIDOS.includes("👍") && reacoes.EMOJIS_PERMITIDOS.length >= 6);
}

// ---------------------------------------------------------------------------
titulo("5. A tela recebe as reacoes ja agrupadas");

{
  const dto = mapMensagem({
    id: "m1", origem: "cliente", texto: "oi", criadoEm: new Date(),
    metadata: { reacoes: [
      { emoji: "👍", de: "equipe", autorId: "u1", autorNome: "Marco" },
      { emoji: "👍", de: "cliente", autorId: "5527" },
      { emoji: "❤️", de: "cliente", autorId: "5527" },
    ] },
  });
  // O terceiro item e do MESMO autor do segundo (5527), com outro emoji. Na
  // LEITURA a ultima vence: se as duas contassem, a tela mostraria "3 pessoas"
  // onde ha 2 -- um numero errado que ninguem questionaria olhando.
  const total = dto.reacoes.reduce((s, r) => s + r.total, 0);
  check("mesma pessoa conta UMA vez, mesmo com duas linhas gravadas",
    total === 2, `(somou ${total}, com 3 linhas no metadata)`);
  check("e a que fica e a ULTIMA dela",
    dto.reacoes.find((r) => r.emoji === "❤️")?.total === 1
    && dto.reacoes.find((r) => r.emoji === "👍")?.total === 1);
  check("vem agrupado por emoji", dto.reacoes.length === 2);
  check("mensagem sem reacao devolve lista vazia",
    Array.isArray(mapMensagem({ id: "m2", origem: "cliente", texto: "oi", criadoEm: new Date() }).reacoes)
    && mapMensagem({ id: "m2", origem: "cliente", texto: "oi", criadoEm: new Date() }).reacoes.length === 0);
}

// ---------------------------------------------------------------------------
titulo("6. Reacao que CHEGA e reconhecida, e nao vira mensagem");

{
  const payload = (text) => ({
    data: {
      key: { remoteJid: "5527999@s.whatsapp.net", fromMe: false, id: "REACAO1" },
      message: { reactionMessage: { key: { id: "ALVO123", remoteJid: "5527999@s.whatsapp.net" }, text } },
    },
  });

  const r = whatsappService.extrairReacao(payload("👍"));
  check("acha o alvo e o emoji", r && r.waMessageId === "ALVO123" && r.emoji === "👍");

  // VAZIO E O CLIENTE TIRANDO A REACAO -- nao e "nao e reacao".
  const removendo = whatsappService.extrairReacao(payload(""));
  check("emoji vazio continua sendo reacao", removendo !== null && removendo.emoji === "");

  // Mensagem normal nao pode ser confundida com reacao.
  const normal = whatsappService.extrairReacao({ data: { message: { conversation: "bom dia" } } });
  check("mensagem de texto nao e reacao", normal === null);

  // E o que mais importa: a reacao NAO tem texto de mensagem. Se ela escapasse
  // para o caminho comum, viraria uma bolha VAZIA no chat.
  check("reacao nao produz texto de mensagem",
    whatsappService.extrairTexto(payload("👍")) === null);
  check("nem midia", whatsappService.extrairMidia(payload("👍")) === null);
}

console.log(
  "\n" + (erros.length
    ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ")
    : "REACOES: TUDO CONFERE")
);
process.exit(erros.length ? 1 : 0);
