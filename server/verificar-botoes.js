/**
 * BOTOES DO MENU: o que sai no botao, e o que volta quando o cliente toca.
 *
 * ── AS PERGUNTAS QUE ESTE ARQUIVO RESPONDE ─────────────────────────────────
 *
 * "Se eu reordenar as opcoes do menu no editor, o botao que o cliente ja
 *  recebeu continua significando a mesma coisa?"
 * "O texto do botao da para escrever, ou o sistema adivinha?"
 *
 * A primeira resposta era NAO. O id do botao vinha da palavra-chave numerica
 * (`_valorOpcao`), entao era "1", "2", "3" -- a POSICAO no menu. Trocar a ordem
 * das opcoes fazia o botao recebido antes da edicao voltar apontando para outra
 * coisa: o cliente toca em "Atendimento avulso" e cai no Financeiro. E o id que
 * volta do WhatsApp (`selectedButtonId`) nao era casado por id nenhum -- ele
 * caia no casamento por palavra-chave, que e o caminho do texto DIGITADO.
 *
 * Nao ha rede aqui: o WhatsApp devolve o id, e se o motor nao souber traduzi-lo
 * a escolha do cliente vira "nao entendi".
 *
 * Este teste NAO depende da integracao renderizar botao. Ele exercita o par
 * `_valorOpcao` (o que vai no botao) e `casarOpcao` (o que volta), que e onde a
 * traducao acontece -- e continua valendo o dia em que os botoes forem ligados.
 *
 *   cd server && node verificar-botoes.js
 */
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "error";

const fs = require("fs");
const path = require("path");
const { ChatbotEngine } = require("./src/modules/chatbot/chatbot.engine");

const erros = [];
function check(condicao, mensagem) {
  if (condicao) console.log(`  OK   ${mensagem}`);
  else { erros.push(mensagem); console.log(`  FALHA ${mensagem}`); }
}
const titulo = (t) => console.log(`\n=== ${t} ===`);

// Motor sem dependencia nenhuma: os dois metodos sob teste sao puros.
const engine = new ChatbotEngine({});

// O menu real do fluxo da ARKA (nomes e palavras-chave como estao no banco).
const SUPORTE = [
  { id: "sup_1", ordem: 0, esperaEscolha: true, rotulo: "1,contrato,tenho contrato", palavrasChave: ["1", "contrato", "tenho contrato"], acao: "ir", targetId: "cnpj" },
  { id: "sup_2", ordem: 1, esperaEscolha: true, rotulo: "2,cliente avulso,avulso", palavrasChave: ["2", "cliente avulso", "avulso"], acao: "ir", targetId: "avulso" },
  { id: "sup_3", ordem: 2, esperaEscolha: true, rotulo: "3,voltar,menu inicial", palavrasChave: ["3", "voltar", "menu inicial"], acao: "ir", targetId: "inicio" },
];
const TEXTO_MENU =
  "🔧 *Atendimento Técnico*\n\nComo podemos prosseguir?\n\n1️⃣- Tenho contrato com a ARKA\n2️⃣- Atendimento avulso\n3️⃣- Voltar ao menu inicial";

(async () => {
  titulo("1. O VALOR DO BOTAO e o id do no, nao a posicao no menu");

  for (const op of SUPORTE) {
    check(engine._valorOpcao(op) === op.id, `${op.id} -> valor "${engine._valorOpcao(op)}"`);
  }
  // Fluxo antigo, cujas opcoes nao tem id: continua usando a palavra-chave.
  check(
    engine._valorOpcao({ palavrasChave: ["2", "avulso"], rotulo: "2,avulso" }) === "2",
    "opcao SEM id cai na palavra-chave numerica (fluxo antigo segue funcionando)"
  );

  titulo("2. O QUE VOLTA do WhatsApp resolve a opcao certa");

  // `extrairTexto` entrega o selectedButtonId como se fosse a mensagem.
  for (const op of SUPORTE) {
    const casada = engine.casarOpcao(op.id, SUPORTE);
    check(casada?.id === op.id, `toque no botao "${op.id}" -> opcao ${casada?.id}`);
  }

  titulo("3. E O DIGITADO continua funcionando (nada foi trancado)");

  check(engine.casarOpcao("1", SUPORTE)?.id === "sup_1", 'digitar "1" -> sup_1');
  check(engine.casarOpcao("2", SUPORTE)?.id === "sup_2", 'digitar "2" -> sup_2');
  check(engine.casarOpcao("avulso", SUPORTE)?.id === "sup_2", 'digitar "avulso" -> sup_2');
  check(engine.casarOpcao("menu inicial", SUPORTE)?.id === "sup_3", 'digitar "menu inicial" -> sup_3');
  check(engine.casarOpcao("xpto", SUPORTE) === null, 'texto sem relacao -> null (cai no "nao entendi")');

  titulo("4. REORDENAR O MENU nao troca o significado do botao");

  // Mesmas opcoes, ordem invertida e numeros trocados -- como ficaria depois de
  // uma edicao no editor de fluxos.
  const REORDENADO = [
    { ...SUPORTE[1], ordem: 0, rotulo: "1,cliente avulso,avulso", palavrasChave: ["1", "cliente avulso", "avulso"] },
    { ...SUPORTE[0], ordem: 1, rotulo: "2,contrato,tenho contrato", palavrasChave: ["2", "contrato", "tenho contrato"] },
    { ...SUPORTE[2], ordem: 2, rotulo: "3,voltar,menu inicial", palavrasChave: ["3", "voltar", "menu inicial"] },
  ];
  // O botao que o cliente recebeu ANTES da edicao dizia sup_2 (avulso).
  check(
    engine.casarOpcao("sup_2", REORDENADO)?.targetId === "avulso",
    "botao antigo sup_2 continua indo para avulso depois da reordenacao"
  );
  // Enquanto o NUMERO, que era o id antes desta correcao, aponta para outra coisa.
  check(
    engine.casarOpcao("2", REORDENADO)?.targetId === "cnpj",
    'e o numero "2" agora significa contrato -- por isso o id nao pode ser a posicao'
  );

  titulo("5. O TEXTO DO BOTAO da para escrever no fluxo");

  check(
    engine._rotuloOpcao({ id: "sup_1", botao: "✋ Tenho contrato", palavrasChave: ["1"] }, TEXTO_MENU) === "✋ Tenho contrato",
    "`opcao.botao` manda quando existe (com emoji)"
  );
  // Sem o campo, segue extraindo da linha do menu -- comportamento anterior.
  check(
    engine._rotuloOpcao(SUPORTE[0], TEXTO_MENU) === "Tenho contrato com a ARKA",
    `sem o campo, extrai da linha do menu ("${engine._rotuloOpcao(SUPORTE[0], TEXTO_MENU)}")`
  );
  check(
    engine._rotuloOpcao({ palavrasChave: [], rotulo: "" }, "") === "Opção",
    "e nunca devolve vazio (o WhatsApp recusa botao sem texto)"
  );

  titulo("6. O limite do WhatsApp e respeitado");

  // O envio corta em 20 (botao) e 24 (linha de lista); o rotulo do fluxo da ARKA
  // passa de 20, e e por isso que `opcao.botao` existe.
  const longo = engine._rotuloOpcao(SUPORTE[0], TEXTO_MENU);
  check(longo.length > 20, `o rotulo extraido tem ${longo.length} caracteres (cortaria no botao)`);
  check(
    engine._rotuloOpcao({ botao: "✋ Tenho contrato" }, TEXTO_MENU).length <= 20,
    "o rotulo escrito a mao cabe no botao"
  );

  titulo("6b. O SEPARADOR do menu e opcional (o bug dos rotulos minusculos)");

  // Menu de producao (29/08): numero em emoji de teclado, negrito, SEM traco.
  // Com a exigencia de traco, a extracao falhava e o rotulo caia na
  // palavra-chave -- "tecnico" em vez de "Técnico" dentro do botao.
  const MENU_SEM_TRACO =
    "👋 *Olá, Marco!*\n\nBem-vindo(a) à *ARKA Tecnologia*.\n\nComo podemos ajudar você hoje?\n\n1️⃣ *Técnico*\n2️⃣ *Comercial*\n3️⃣ *Administrativo / Financeiro*\n4️⃣ *Encerrar atendimento*";
  const MENU_PRINCIPAL = [
    { id: "mp_1", palavrasChave: ["1", "tecnico"], rotulo: "1,tecnico" },
    { id: "mp_2", palavrasChave: ["2", "comercial"], rotulo: "2,comercial" },
    { id: "mp_3", palavrasChave: ["3", "financeiro"], rotulo: "3,financeiro" },
    { id: "mp_4", palavrasChave: ["4", "encerrar"], rotulo: "4,encerrar" },
  ];
  const esperados = ["Técnico", "Comercial", "Administrativo / Financeiro", "Encerrar atendimento"];
  MENU_PRINCIPAL.forEach((op, i) => {
    const rot = engine._rotuloOpcao(op, MENU_SEM_TRACO);
    check(rot === esperados[i], `"1️⃣ *Técnico*" -> ${JSON.stringify(rot)} (esperado ${JSON.stringify(esperados[i])})`);
  });

  // E o formato COM traco (fluxo antigo) continua funcionando.
  check(
    engine._rotuloOpcao(SUPORTE[0], TEXTO_MENU) === "Tenho contrato com a ARKA",
    "formato com traco segue extraido"
  );

  titulo("7. ENQUETE: o voto volta pelo ROTULO, nao por id");

  // A enquete nao carrega id -- o WhatsApp devolve o NOME da opcao votada, que e
  // exatamente o texto que foi enviado. Por isso `casarOpcao` casa por rotulo.
  const COM_BOTAO = SUPORTE.map((o, i) => ({
    ...o,
    botao: ["✋ Tenho contrato", "👤 Atendimento avulso", "🏠 Voltar ao Menu"][i],
  }));
  for (const op of COM_BOTAO) {
    const casada = engine.casarOpcao(op.botao, COM_BOTAO);
    check(casada?.id === op.id, `voto "${op.botao}" -> opcao ${casada?.id}`);
  }
  // Sem `botao`, o rotulo e o que foi extraido da linha do menu.
  check(
    engine.casarOpcao("Tenho contrato com a ARKA", SUPORTE)?.id === "sup_1",
    "voto pelo rotulo extraido do menu tambem casa"
  );
  // Casamento EXATO: o rotulo nao pode casar por PEDACO. "menu" nao e palavra-
  // chave de nenhuma opcao (a de voltar tem "menu inicial") e nao pode ser
  // aceito so por aparecer dentro de "🏠 Voltar ao Menu" -- senao a palavra
  // solta roubaria a opcao. Devolver null e o certo: o motor trata "menu" como
  // comando global (chatbot.config.palavrasChave), nao como escolha do menu.
  check(
    engine.casarOpcao("menu", COM_BOTAO) === null,
    '"menu" nao casa por pedaco do rotulo (devolve null, como deve)'
  );

  titulo("8. ENQUETE: o extrator do webhook reconhece o voto");

  const whats = require("./src/modules/whatsapp/whatsapp.service");
  const formatos = [
    ["selectedOptions[].name", { data: { message: { pollUpdateMessage: { vote: { selectedOptions: [{ name: "👤 Atendimento avulso" }] } } } } }],
    ["selectedName", { data: { message: { pollUpdateMessage: { selectedName: "✋ Tenho contrato" } } } }],
    ["pollUpdates[].vote.name", { data: { pollUpdates: [{ vote: { name: "🏠 Voltar ao Menu" } }] } }],
  ];
  for (const [nome, payload] of formatos) {
    const t = whats.extrairTexto(payload);
    check(!!t, `formato "${nome}" -> ${JSON.stringify(t)}`);
  }

  // Voto CRIPTOGRAFADO (o risco conhecido do Baileys): devolve null em vez de
  // inventar, e o formato bruto vai para o log -- e o que faz o primeiro voto
  // real dizer o que esta instalacao manda, em vez de falhar em silencio.
  check(
    whats.extrairTexto({ data: { message: { pollUpdateMessage: { vote: { encPayload: "AAAA" } } } } }) === null,
    "voto criptografado/desconhecido -> null (e o formato e registrado)"
  );

  // E nada disso pode ter quebrado o caminho normal.
  check(whats.extrairTexto({ data: { message: { conversation: "oi" } } }) === "oi", "texto normal segue extraido");
  check(
    whats.extrairTexto({ data: { message: { buttonsResponseMessage: { selectedButtonId: "sup_2" } } } }) === "sup_2",
    "id de botao segue extraido"
  );

  titulo("9. O FLUXO REAL declara exibicao e rotulos dentro dos limites");

  const fluxo = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "docs", "fluxo-arka.json"), "utf8")
  );
  const passos = Object.fromEntries(fluxo.passos.map((p) => [p.id, p]));
  const ESPERADO = {
    "d70e3322-5760-49c6-98e9-c60550093310": "list",     // Boas Vindas (4)
    "de723e94-ac45-4ed4-b9c8-4d9e71a6c84f": "buttons",  // SUPORTE (3)
    "14fe8be5-ffb5-47ee-b2cf-0475e2883554": "list",     // RESULTADO (4)
    "8619e80e-47a4-4a05-80fd-be50e7649756": "buttons",  // C_AVULSO (3)
    "64b85687-198c-49ef-b7a7-827fdb8a456a": "buttons",  // COMERCIAL (3)
  };
  // Limite do WhatsApp: 20 caracteres no botao, 24 na linha da lista. Estourar
  // nao da erro -- o texto e CORTADO, e "SEGUIR COMO ATENDIMENTO AV" nao diz o
  // que a opcao faz. Por isso o teste cobra o limite em vez de confiar no olho.
  const LIMITE = { buttons: 20, list: 24 };
  for (const [id, exibicao] of Object.entries(ESPERADO)) {
    const no = passos[id];
    check(no?.config?.exibicao === exibicao, `${no?.titulo}: exibicao=${no?.config?.exibicao} (esperado ${exibicao})`);
    const semRotulo = (no?.config?.opcoes || []).filter((o) => !o.botao);
    check(semRotulo.length === 0, `${no?.titulo}: toda opcao tem rotulo de botao`);
    const longos = (no?.config?.opcoes || []).filter((o) => [...String(o.botao || "")].length > LIMITE[exibicao]);
    check(longos.length === 0, `${no?.titulo}: nenhum rotulo passa de ${LIMITE[exibicao]} chars`);
  }

  // E o texto numerado CONTINUA no fluxo -- ele e o fallback quando a Evolution
  // recusa o interativo. Limpar os "1️⃣-" deixaria o cliente sem opcao nenhuma.
  const comNumero = Object.keys(ESPERADO).filter((id) => /[1-9]️⃣/.test(passos[id]?.texto || ""));
  check(
    comNumero.length === Object.keys(ESPERADO).length,
    `os ${comNumero.length} menus mantem o texto numerado (fallback do interativo)`
  );

  console.log(
    "\n" + (erros.length ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ") : "BOTOES: TUDO CONFERE")
  );
  process.exit(erros.length ? 1 : 0);
})().catch((e) => { console.error("ERRO", e); process.exit(1); });
