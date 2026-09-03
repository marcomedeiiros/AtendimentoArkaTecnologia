// Verificacao de ABRIR CONVERSA SEM MENSAGEM -- `node verificar-conversa-sem-mensagem.js`.
//
// A funcionalidade se resume a uma promessa que precisa valer nos dois
// sentidos, e o teste existe para as duas metades:
//
//   com texto  -> cria/reabre o fio E MANDA a mensagem ao cliente;
//   sem texto  -> cria/reabre o fio E NAO MANDA NADA.
//
// A segunda metade e a que da errado calada. Um envio a mais nao aparece em
// lugar nenhum do painel como defeito -- aparece no WhatsApp do cliente, como
// uma mensagem que ninguem escreveu. Por isso o que este script mais observa
// nao e o retorno da funcao: e se `evolutionApi.sendText` foi chamado.
//
// Nao toca no banco nem na rede: troca os repositorios e o cliente da Evolution
// por dubles em `require.cache`, antes de o service ser carregado.
const path = require("path");
const Module = require("module");

const erros = [];
const check = (cond, msg) => {
  if (!cond) erros.push(msg);
  console.log(`  ${cond ? "OK   " : "FALHA"} ${msg}`);
};

// ── DUBLES ──────────────────────────────────────────────────────────────────
const chamadas = { sendText: [], mensagensGravadas: [], emitidas: [] };
let proximoId = 1;
let conversaExistente = null;
const banco = new Map();

function resolver(rel) {
  return require.resolve(path.join(__dirname, rel));
}
function substituir(rel, exports) {
  const id = resolver(rel);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

substituir("src/infrastructure/external/evolution-api.client.js", {
  sendText: async (telefone, texto) => {
    chamadas.sendText.push({ telefone, texto });
    return { key: { id: `wa-${chamadas.sendText.length}` } };
  },
  fetchProfilePictureUrl: async () => null,
});

substituir("src/infrastructure/repositories/instancia.repository.js", {
  findByNome: async () => ({ id: "inst-1", nome: "arka-wapi-oficial" }),
});

substituir("src/infrastructure/repositories/conversa.repository.js", {
  findByTelefone: async () => conversaExistente,
  findById: async (id) => banco.get(id) || null,
  findByIdBasico: async (id) => banco.get(id) || null,
  // Leitura enxuta usada pelo `_emitirLeve` no caminho COM mensagem.
  findByIdParaEvento: async (id) => banco.get(id) || null,
  create: async (dados) => {
    const id = `conv-${proximoId++}`;
    const c = { id, mensagens: [], ...dados };
    banco.set(id, c);
    return c;
  },
  update: async (id, dados) => {
    const c = banco.get(id) || { id, mensagens: [] };
    Object.assign(c, dados);
    banco.set(id, c);
    return c;
  },
  addMensagem: async (id, de, texto) => {
    chamadas.mensagensGravadas.push({ id, de, texto });
    const c = banco.get(id);
    const m = { id: `msg-${chamadas.mensagensGravadas.length}`, de, texto };
    c.mensagens.push(m);
    return m;
  },
  garantirAtendimentoAberto: async () => {},
  atualizarAtendimentoAtual: async () => {},
  marcarStatusMensagem: async () => {},
  // Casa a bolha local com o id da Evolution (so o caminho COM mensagem usa).
  vincularWaMessageId: async () => {},
});

substituir("src/shared/events/event-bus.js", {
  emitConversa: (dto) => chamadas.emitidas.push(dto),
  emitMensagem: () => {},
  on: () => {},
  off: () => {},
});

// Alguns modulos do service so existem para efeitos colaterais que nao
// interessam aqui (parceiro/CNPJ). Neutralizados para o teste nao depender deles.
substituir("src/infrastructure/repositories/parceiro.repository.js", {
  findAtivoByCnpj: async () => null,
});

const service = require("./src/modules/conversas/conversa.service");
const { iniciarConversaSchema } = require("./src/modules/conversas/conversa.dto");

function zerar() {
  chamadas.sendText.length = 0;
  chamadas.mensagensGravadas.length = 0;
  chamadas.emitidas.length = 0;
  conversaExistente = null;
  banco.clear();
  proximoId = 1;
}

(async () => {
  // ── 1. O SCHEMA ACEITA OS DOIS MODOS ──────────────────────────────────────
  //
  // A tela manda `texto: ''` explicitamente no "Abrir sem enviar". Se o schema
  // exigisse `min(1)`, o pedido morreria em 400 na borda e nada disso rodaria.
  console.log("\n=== 1. o schema aceita mensagem vazia e ausente ===");
  const base = { telefone: "27999990000", setor: "Geral" };
  check(iniciarConversaSchema.safeParse({ ...base, texto: "oi" }).success, "com texto: aceito");
  check(iniciarConversaSchema.safeParse({ ...base, texto: "" }).success, "texto vazio: aceito");
  check(iniciarConversaSchema.safeParse({ ...base }).success, "sem o campo texto: aceito");
  check(
    iniciarConversaSchema.safeParse({ telefone: "123", texto: "oi" }).success === false,
    "numero curto continua sendo recusado"
  );

  // ── 2. COM TEXTO: MANDA ───────────────────────────────────────────────────
  console.log("\n=== 2. com mensagem, o cliente recebe ===");
  zerar();
  const comTexto = await service.iniciarConversa({
    telefone: "27999990000", nome: "Fulano", setor: "Geral", texto: "Bom dia!",
  });
  check(chamadas.sendText.length === 1, "mandou 1 mensagem pelo WhatsApp");
  check(chamadas.sendText[0]?.texto === "Bom dia!", "mandou exatamente o texto digitado");
  check(chamadas.mensagensGravadas.length === 1, "gravou a bolha na conversa");
  check(comTexto?.criada === true, "informa que a conversa e nova");

  // ── 3. SEM TEXTO: NAO MANDA NADA ──────────────────────────────────────────
  //
  // O coracao da funcionalidade. `sendText` em ZERO nao e detalhe: e a diferenca
  // entre preparar um atendimento e cutucar o cliente sem querer.
  console.log("\n=== 3. sem mensagem, NADA sai para o cliente ===");
  zerar();
  const semTexto = await service.iniciarConversa({
    telefone: "27999990000", nome: "Fulano", setor: "Geral", texto: "",
  });
  check(chamadas.sendText.length === 0, "NAO chamou o WhatsApp");
  check(chamadas.mensagensGravadas.length === 0, "NAO gravou bolha nenhuma");
  check(!!semTexto?.id, "mesmo assim devolveu a conversa");
  check(semTexto?.criada === true, "informa que a conversa e nova");
  check(semTexto?.statusAtendimento === "aberta", "nasce ABERTA, pronta para atender");
  check(chamadas.emitidas.length === 1, "avisou a tela pelo SSE");

  console.log("\n=== 3b. campo texto ausente equivale a vazio ===");
  zerar();
  const semCampo = await service.iniciarConversa({
    telefone: "27999990000", setor: "Geral",
  });
  check(chamadas.sendText.length === 0, "NAO chamou o WhatsApp");
  check(!!semCampo?.id, "devolveu a conversa");

  console.log("\n=== 3c. so espaco em branco tambem conta como vazio ===");
  zerar();
  await service.iniciarConversa({ telefone: "27999990000", setor: "Geral", texto: "   \n  " });
  check(chamadas.sendText.length === 0, "NAO chamou o WhatsApp");

  // ── 4. SEM NOME, O ROTULO E O NUMERO ──────────────────────────────────────
  console.log("\n=== 4. sem nome, a conversa entra com o numero ===");
  zerar();
  const semNome = await service.iniciarConversa({ telefone: "27999990000", setor: "Geral", texto: "" });
  check(
    String(semNome?.cliente || "").includes("999990000"),
    `usa o numero como rotulo (veio "${semNome?.cliente}")`
  );

  // ── 5. FIO QUE JA EXISTE E REAPROVEITADO, NAO DUPLICADO ───────────────────
  //
  // Abrir sem mensagem em cima de um atendimento fechado deve REABRIR o mesmo
  // fio. Criar outra linha partiria o historico do cliente em dois.
  console.log("\n=== 5. numero que ja tem conversa ===");
  zerar();
  conversaExistente = {
    id: "conv-antiga", mensagens: [], telefone: "5527999990000",
    statusAtendimento: "fechada", setor: "Geral", atendenteId: "outro-atendente",
  };
  banco.set("conv-antiga", conversaExistente);
  const reaberta = await service.iniciarConversa({ telefone: "27999990000", setor: "Geral", texto: "" });
  check(reaberta?.id === "conv-antiga", "reaproveitou o fio existente");
  check(reaberta?.criada === false, "informa que NAO e nova");
  check(reaberta?.statusAtendimento === "aberta", "reabriu o atendimento");
  check(chamadas.sendText.length === 0, "e continua sem mandar nada");
  check(
    banco.get("conv-antiga").atendenteId === "outro-atendente",
    "nao roubou a conversa de quem ja estava nela"
  );

  // ── 6. NUMERO INVALIDO CONTINUA BARRADO ───────────────────────────────────
  //
  // Tirar a exigencia da mensagem nao pode ter afrouxado o resto: sem numero
  // valido nao ha conversa, com ou sem texto.
  console.log("\n=== 6. o numero continua obrigatorio ===");
  zerar();
  let barrou = false;
  try {
    await service.iniciarConversa({ telefone: "abc", setor: "Geral", texto: "" });
  } catch (e) {
    barrou = e?.codigo === "TELEFONE_INVALIDO" || /numero/i.test(e?.message || "");
  }
  check(barrou, "numero invalido e recusado tambem no modo sem mensagem");
  check(chamadas.sendText.length === 0, "e nada foi enviado");

  console.log("\n" + "=".repeat(70));
  if (erros.length) {
    console.log(`${erros.length} FALHA(S):`);
    erros.forEach((e) => console.log(`  - ${e}`));
    process.exit(1);
  }
  console.log("Abrir conversa sem mensagem: tudo OK");
})().catch((e) => {
  console.error("Erro inesperado na verificacao:", e);
  process.exit(1);
});
