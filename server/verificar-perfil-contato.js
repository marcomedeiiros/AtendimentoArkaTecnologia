// Verificacao do PERFIL DO CONTATO -- `node verificar-perfil-contato.js`.
//
// O painel de perfil junta duas fontes com garantias MUITO diferentes:
//
//   o nosso banco   telefone, foto guardada, setor. Sempre existe.
//   o WhatsApp      recado, foto fresca, conta comercial. Pode nao vir.
//
// O defeito que este script existe para impedir e a segunda derrubar a
// primeira: a Evolution fora do ar nao pode virar erro na tela, nem fazer o
// perfil dizer "este contato nao tem recado" quando a verdade e "nao consegui
// perguntar". Sao frases diferentes e levam o operador a conclusoes diferentes
// sobre a pessoa do outro lado.
//
// Nao toca no banco nem na rede: dubles em `require.cache` antes de carregar o
// service.
const path = require("path");

const erros = [];
const check = (cond, msg) => {
  if (!cond) erros.push(msg);
  console.log(`  ${cond ? "OK   " : "FALHA"} ${msg}`);
};

let perfilDaEvolution = null;   // o que fetchPerfilContato devolve
let chamouEvolution = 0;
const updates = [];
const banco = new Map();

function substituir(rel, exports) {
  const id = require.resolve(path.join(__dirname, rel));
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

// A CLASSE REAL, capturada ANTES do duble entrar no lugar dela.
//
// O bloco 0 testa a normalizacao de texto do cliente de verdade -- se ele fosse
// lido depois da substituicao, o teste estaria conferindo o proprio duble e
// passaria para sempre, inclusive com a normalizacao quebrada.
const ClienteEvolutionReal =
  require("./src/infrastructure/external/evolution-api.client").constructor;

substituir("src/infrastructure/external/evolution-api.client.js", {
  fetchPerfilContato: async () => { chamouEvolution += 1; return perfilDaEvolution; },
  sendText: async () => ({ key: { id: "x" } }),
  fetchProfilePictureUrl: async () => null,
});
substituir("src/infrastructure/repositories/conversa.repository.js", {
  findByIdBasico: async (id) => banco.get(id) || null,
  findById: async (id) => banco.get(id) || null,
  update: async (id, dados) => {
    updates.push({ id, dados });
    Object.assign(banco.get(id) || {}, dados);
    return banco.get(id);
  },
});
substituir("src/shared/events/event-bus.js", {
  emitConversa: () => {}, emitMensagem: () => {}, on: () => {}, off: () => {},
});

const service = require("./src/modules/conversas/conversa.service");

function zerar(conversa = {}) {
  chamouEvolution = 0;
  updates.length = 0;
  banco.clear();
  banco.set("c1", {
    id: "c1", telefone: "5527999990000", setor: "Técnico",
    fotoUrl: null, cliente: "Fulano", ...conversa,
  });
}

const PERFIL_COMPLETO = {
  recado: "Disponível", foto: "https://x/foto-nova.jpg", nomeWhatsApp: "Fulano da Silva",
  existeNoWhatsApp: true, comercial: true, email: "a@b.com",
  site: "https://empresa.com", descricao: "Assistência técnica",
};

(async () => {
  // ── 0. TODO CAMPO DE TEXTO E STRING OU NULL, NUNCA OBJETO ─────────────────
  //
  // O bug que derrubou a Central em producao (03/09/2026): o recado chegou como
  // `{ status, setAt }` -- a forma que o Baileys usa -- e foi para o JSX. React
  // #31, "Objects are not valid as a React child", e tela preta.
  //
  // A Evolution TENTA desaninhar com `status?.status`; quando a versao do
  // Baileys aninha um nivel a mais, o desaninhamento fica pela metade. Confiar
  // que o outro lado entrega string foi o erro. Este bloco e a trava.
  console.log("\n=== 0. campos de texto nunca chegam como objeto ===");
  const t = ClienteEvolutionReal._texto;
  check(t("Disponível") === "Disponível", "string passa direto");
  check(t("  oi  ") === "oi", "string e aparada");
  check(t("") === null, "string vazia vira null");
  check(t(null) === null && t(undefined) === null, "null/undefined viram null");
  check(
    t({ status: "No trabalho", setAt: new Date() }) === "No trabalho",
    "{status,setAt} -- a forma EXATA que quebrou -- vira o texto"
  );
  check(
    t({ status: { status: "Aninhado", setAt: 1 } }) === "Aninhado",
    "aninhado a mais tambem e desembrulhado"
  );
  check(t({ value: "Por value" }) === "Por value", "{value} tambem e aceito");
  check(t({ coisa: 1 }) === null, "objeto de forma desconhecida vira null, nao vaza");
  check(t([1, 2]) === null, "array vira null");
  // Referencia circular: sem o teto de profundidade isto seria recursao infinita.
  const circular = {}; circular.status = circular;
  check(t(circular) === null, "referencia circular nao trava o processo");

  // ── 1. A EVOLUTION RESPONDEU ──────────────────────────────────────────────
  console.log("\n=== 1. perfil completo vindo do WhatsApp ===");
  zerar();
  perfilDaEvolution = PERFIL_COMPLETO;
  const r1 = await service.perfilContato("c1");
  check(r1.disponivel === true, "marca que a consulta funcionou");
  check(r1.recado === "Disponível", "traz o recado (o `status` do Baileys)");
  check(r1.fotoUrl === "https://x/foto-nova.jpg", "traz a foto fresca");
  check(r1.nomeWhatsApp === "Fulano da Silva", "traz o nome do perfil");
  check(r1.comercial === true, "identifica conta comercial");
  check(r1.email === "a@b.com" && r1.site === "https://empresa.com", "traz e-mail e site");
  check(r1.descricao === "Assistência técnica", "traz a descrição comercial");
  check(r1.telefone === "5527999990000", "traz o número, que vem do NOSSO banco");

  // ── 2. A FOTO FRESCA E GRAVADA ────────────────────────────────────────────
  //
  // O link do WhatsApp vence em dias e passa a devolver 403 -- calado, porque
  // quem leva o 403 e o navegador do operador. Ja que a foto acabou de ser
  // buscada, gravar conserta o avatar na hora em que alguem foi olhar.
  console.log("\n=== 2. a foto nova e persistida ===");
  check(updates.length === 1, "gravou uma vez");
  check(updates[0]?.dados?.fotoUrl === "https://x/foto-nova.jpg", "gravou a foto nova");

  console.log("\n=== 2b. foto igual NAO gera escrita ===");
  zerar({ fotoUrl: "https://x/foto-nova.jpg" });
  perfilDaEvolution = PERFIL_COMPLETO;
  await service.perfilContato("c1");
  check(updates.length === 0, "nao grava quando a foto nao mudou");

  // ── 3. A EVOLUTION FORA DO AR ─────────────────────────────────────────────
  //
  // O caso que mais importa. Nao pode estourar, e nao pode MENTIR dizendo que o
  // contato nao tem recado.
  console.log("\n=== 3. Evolution fora do ar ===");
  zerar({ fotoUrl: "https://x/foto-antiga.jpg" });
  perfilDaEvolution = null;
  let estourou = false;
  let r3 = null;
  try { r3 = await service.perfilContato("c1"); } catch { estourou = true; }
  check(!estourou, "NAO estoura");
  check(r3?.disponivel === false, "diz que a consulta falhou (`disponivel: false`)");
  check(r3?.recado === null, "recado vem nulo -- e a tela sabe distinguir pelo `disponivel`");
  check(r3?.telefone === "5527999990000", "o número continua vindo (é do nosso banco)");
  check(r3?.fotoUrl === "https://x/foto-antiga.jpg", "cai para a foto que ja tinhamos");
  check(updates.length === 0, "e nao apaga a foto guardada");

  // ── 4. CONTATO SEM RECADO x CONSULTA FALHA ────────────────────────────────
  //
  // As duas situacoes precisam ser distinguiveis no retorno, senao a tela nao
  // tem como escrever a frase certa.
  console.log("\n=== 4. contato sem recado e diferente de consulta falha ===");
  zerar();
  perfilDaEvolution = { ...PERFIL_COMPLETO, recado: null, foto: null };
  const r4 = await service.perfilContato("c1");
  check(r4.disponivel === true && r4.recado === null, "sem recado: disponivel=true, recado=null");
  check(r3.disponivel === false && r3.recado === null, "falha: disponivel=false, recado=null");
  check(r4.disponivel !== r3.disponivel, "os dois casos SAO distinguiveis");

  // ── 5. GUARDA DE SETOR ────────────────────────────────────────────────────
  //
  // O perfil expoe telefone e dados do contato: nao pode escapar da mesma regra
  // que ja protege a conversa. Um atendente de outro setor nao le a conversa --
  // nao pode ler o contato dela por uma porta lateral.
  console.log("\n=== 5. respeita o escopo de setor ===");
  zerar();
  perfilDaEvolution = PERFIL_COMPLETO;
  // A conversa e do "Técnico". Quem tem cargo "Financeiro" nao a le -- e, por
  // isso, tambem nao pode ler o contato dela por esta porta.
  // (Cargos como "Administrador" e "Atendente" enxergam todos os setores de
  // proposito -- ver podeAcessarSetor em setor.helper.js.)
  let barrou = false;
  try {
    await service.perfilContato("c1", { sub: "u1", cargo: "Financeiro" });
  } catch (e) {
    barrou = e?.statusCode === 403 || /permiss/i.test(e?.message || "");
  }
  check(barrou, "cargo de outro setor e barrado");
  check(chamouEvolution === 0, "e a Evolution nem chega a ser consultada");

  console.log("\n=== 5b. quem PODE ler o setor passa ===");
  zerar();
  perfilDaEvolution = PERFIL_COMPLETO;
  const r5b = await service.perfilContato("c1", { sub: "u2", cargo: "Técnico" });
  check(r5b?.disponivel === true, "cargo do proprio setor le normalmente");

  // ── 6. CONVERSA INEXISTENTE ───────────────────────────────────────────────
  console.log("\n=== 6. conversa que nao existe ===");
  zerar();
  let deu404 = false;
  try { await service.perfilContato("nao-existe"); }
  catch (e) { deu404 = e?.statusCode === 404; }
  check(deu404, "404, e nao 500");

  console.log("\n" + "=".repeat(70));
  if (erros.length) {
    console.log(`${erros.length} FALHA(S):`);
    erros.forEach((e) => console.log(`  - ${e}`));
    process.exit(1);
  }
  console.log("Perfil do contato: tudo OK");
})().catch((e) => {
  console.error("Erro inesperado na verificacao:", e);
  process.exit(1);
});
