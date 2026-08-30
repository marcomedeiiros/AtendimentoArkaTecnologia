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
    "id de botao segue extraido como fallback"
  );
  check(
    whats.extrairTexto({ data: { message: { buttonsResponseMessage: { selectedButtonId: "sup_2", selectedDisplayText: "Atendimento avulso" } } } }) === "Atendimento avulso",
    "texto legivel do botao e extraido com prioridade para exibicao no chat"
  );
  check(
    whats.extrairBotaoId({ data: { message: { buttonsResponseMessage: { selectedButtonId: "sup_2", selectedDisplayText: "Atendimento avulso" } } } }) === "sup_2",
    "id do botao e extraido separadamente para o motor"
  );

  titulo("9. O FLUXO REAL declara exibicao e rotulos dentro dos limites");

  const fluxo = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "docs", "fluxo-arka.json"), "utf8")
  );
  const passos = Object.fromEntries(fluxo.passos.map((p) => [p.id, p]));
  // Os CINCO menus em botao, inclusive os de 4 opcoes: a Evolution recusa 4
  // botoes numa mensagem ("Maximum of 3 reply buttons allowed", medido em
  // 29/08/2026 na 2.4.0-rc2), entao o motor entrega em bolhas de 3 -- 4 = 3 + 1.
  // A lista cabia 10, mas escondia tudo atras de "Ver opcoes".
  const ESPERADO = {
    "d70e3322-5760-49c6-98e9-c60550093310": "buttons",  // Boas Vindas (4 -> 3+1)
    "de723e94-ac45-4ed4-b9c8-4d9e71a6c84f": "buttons",  // SUPORTE (3)
    "14fe8be5-ffb5-47ee-b2cf-0475e2883554": "buttons",  // RESULTADO (4 -> 3+1)
    "8619e80e-47a4-4a05-80fd-be50e7649756": "buttons",  // C_AVULSO (3)
    "64b85687-198c-49ef-b7a7-827fdb8a456a": "buttons",  // COMERCIAL (3)
  };
  // Limite do WhatsApp: 20 caracteres no botao, 24 na linha da lista. Estourar
  // nao da erro -- o texto e CORTADO, e "SEGUIR COMO ATENDIMENTO AV" nao diz o
  // que a opcao faz. Por isso o teste cobra o limite em vez de confiar no olho.
  //
  // A CONTA E EM UTF-16 (`.length`), e nao em code points, porque e assim que o
  // motor corta (`titulo.slice(0, 20)`). Medir com `[...s].length` era mais
  // frouxo que a realidade: "🛠️ Setor Tecnico" da 16 em code points e 17 no
  // slice -- um rotulo podia passar no teste e chegar cortado no cliente.
  const LIMITE = { buttons: 20, list: 24 };
  for (const [id, exibicao] of Object.entries(ESPERADO)) {
    const no = passos[id];
    check(no?.config?.exibicao === exibicao, `${no?.titulo}: exibicao=${no?.config?.exibicao} (esperado ${exibicao})`);
    const opcoes = no?.config?.opcoes || [];
    const semRotulo = opcoes.filter((o) => !o.botao);
    check(semRotulo.length === 0, `${no?.titulo}: toda opcao tem rotulo de botao`);
    const longos = opcoes.filter((o) => String(o.botao || "").length > LIMITE[exibicao]);
    check(
      longos.length === 0,
      `${no?.titulo}: nenhum rotulo passa de ${LIMITE[exibicao]} (maior: ${Math.max(
        ...opcoes.map((o) => String(o.botao || "").length)
      )})`
    );
  }

  // E o texto numerado CONTINUA no fluxo -- ele e o fallback quando a Evolution
  // recusa o interativo. Limpar os "1️⃣-" deixaria o cliente sem opcao nenhuma.
  const comNumero = Object.keys(ESPERADO).filter((id) => /[1-9]️⃣/.test(passos[id]?.texto || ""));
  check(
    comNumero.length === Object.keys(ESPERADO).length,
    `os ${comNumero.length} menus mantem o texto numerado (fallback do interativo)`
  );

  titulo("10. QUATRO opcoes viram 3 + 1 bolhas, e o corpo perde a lista numerada");

  // O QUE ESTE TESTE DEFENDE, do ponto de vista do cliente:
  //
  //   1. quatro opcoes chegam como QUATRO BOTOES, nao como "Ver opcoes";
  //   2. em duas bolhas, porque a Evolution recusa 4 num sendButtons so
  //      ("Maximum of 3 reply buttons allowed", medido na 2.4.0-rc2);
  const enviados = [];
  const motorEnvio = new ChatbotEngine({
    evolutionApi: {
      sendButtons: async (numero, payload) => {
        enviados.push({ tipo: "buttons", payload });
        return { key: { id: "wa1" } };
      },
      sendPoll: async (numero, payload) => {
        enviados.push({ tipo: "poll", payload });
        return { key: { id: "wa-poll" } };
      },
      sendList: async (numero, payload) => {
        enviados.push({ tipo: "list", payload });
        return { key: { id: "wa2" } };
      },
      sendText: async (numero, texto) => {
        enviados.push({ tipo: "text", texto });
        return { key: { id: "wa3" } };
      },
    },
    conversaRepository: {
      addMensagem: async () => ({ id: "msg-1" }),
      vincularWaMessageId: async () => {},
      findByIdParaEvento: async () => null,
    },
    bus: { emitConversa: () => {} },
  });

  const MENU_REAL = passos["d70e3322-5760-49c6-98e9-c60550093310"];
  process.env.WHATSAPP_BOTOES_INTERATIVOS = "true";
  delete process.env.WHATSAPP_MENU_ENQUETE;
  await motorEnvio.enviarBotComOpcoes(
    "conv-1",
    "5541999999999",
    MENU_REAL.texto,
    MENU_REAL.config.opcoes,
    "inst",
    { exibicao: "buttons" }
  );

  const bolhas = enviados.filter((e) => e.tipo === "poll" || e.tipo === "buttons");
  check(bolhas.length === 1, `4 opcoes -> 1 card interativo unico com todos os botoes juntos (veio ${bolhas.length})`);
  const valoresEnquete = bolhas[0]?.payload.values || bolhas[0]?.payload.buttons?.map(b => b.displayText);
  check(valoresEnquete.length === 4, `card com todos os 4 botoes juntos (veio ${valoresEnquete.length})`);
  check(
    valoresEnquete.join(",") === "🛠️ Setor Técnico,💼 Comercial,💰 Adm/Financeiro,👋 Encerrar",
    `opcoes exatas e completas juntas: ${valoresEnquete.join(",")}`
  );

  const fazerMotor = (registro) =>
    new ChatbotEngine({
      evolutionApi: {
        sendButtons: async (n, payload) => { registro.push({ tipo: "buttons", payload }); return { key: { id: "b" } }; },
        sendPoll: async (n, payload) => { registro.push({ tipo: "poll", payload }); return { key: { id: "p" } }; },
        sendList: async (n, payload) => { registro.push({ tipo: "list", payload }); return { key: { id: "l" } }; },
        sendText: async (n, texto) => { registro.push({ tipo: "text", texto }); return { key: { id: "t" } }; },
      },
      conversaRepository: {
        addMensagem: async () => ({ id: "m" }),
        vincularWaMessageId: async () => {},
        findByIdParaEvento: async () => null,
      },
      bus: { emitConversa: () => {} },
    });

  const opcoesFalsas = (n) =>
    Array.from({ length: n }, (_, i) => ({ id: `op_${i + 1}`, botao: `Opção ${i + 1}`, palavrasChave: [String(i + 1)] }));

  for (const [n, esperado, bolhasEsperadas] of [[3, "buttons", 1], [4, "poll", 1], [6, "poll", 1], [13, "list", 1]]) {
    const reg = [];
    await fazerMotor(reg).enviarBotComOpcoes("c", "5541999999999", "Escolha:", opcoesFalsas(n), "inst");
    const tipos = [...new Set(reg.map((e) => e.tipo))];
    check(
      tipos.length === 1 && tipos[0] === esperado && reg.length === bolhasEsperadas,
      `auto com ${n} opcoes -> ${esperado} em ${bolhasEsperadas} (veio ${tipos.join("/")} em ${reg.length})`
    );
  }

  const regLista = [];
  await fazerMotor(regLista).enviarBotComOpcoes("c", "5541999999999", "Escolha:", opcoesFalsas(4), "inst", {
    exibicao: "list",
  });
  check(regLista.length === 1 && regLista[0].tipo === "list", "`list` explicito ainda manda lista (opt-in preservado)");

  const regTextoManual = [];
  await fazerMotor(regTextoManual).enviarBotComOpcoes("c", "5541999999999", "Escolha:\n1 - Opção 1", opcoesFalsas(4), "inst", {
    exibicao: "text",
  });
  check(regTextoManual.length === 1 && regTextoManual[0].tipo === "text", "`text` explicito manda mensagem de texto (falar/digitar preservado)");

  titulo("11. COMO O MENU ESTA ESCRITO nao pode mudar o que o cliente ve");

  // Este arquivo ja quebrou DUAS vezes por supor a escrita do menu:
  //
  //   1. exigindo traco depois do numero  -> "1️⃣ Tecnico" falhava;
  //   2. exigindo o digito no comeco      -> "*1️⃣ Tecnico*" falhava.
  //
  // O segundo e o que estava em PRODUCAO, e o cliente via duas coisas erradas
  // ao mesmo tempo: rotulo "tecnico" (minusculo, sem acento -- palavra-chave
  // usada como rotulo de tela) e a lista numerada repetida embaixo dos botoes.
  //
  // A matriz abaixo existe para a terceira variante de escrita nao virar um
  // terceiro incidente. Vale para as duas funcoes de uma vez.
  const K = "️⃣"; // os dois invisiveis do keycap
  const ESCRITAS = [
    ["cru", `1${K} Técnico`],
    ["negrito na linha inteira (producao)", `*1${K} Técnico*`],
    ["negrito so no rotulo", `1${K} *Técnico*`],
    ["italico", `_1${K} Técnico_`],
    ["traco", `1${K}- Técnico`],
    ["traco dentro do negrito", `*1${K}- Técnico*`],
    ["sem keycap", "1- Técnico"],
    ["ponto", "1. Técnico"],
    ["parentese", "1) Técnico"],
  ];
  const COM_NUM = { palavrasChave: ["1", "tecnico"], ordem: 0, rotulo: "1,tecnico" };
  const SEM_NUM = { palavrasChave: ["tecnico"], ordem: 0, rotulo: "tecnico" };
  for (const [comoEscreveu, linha] of ESCRITAS) {
    const texto = `Como podemos ajudar?\n\n${linha}`;
    check(engine._rotuloOpcao(COM_NUM, texto, 0) === "Técnico", `${comoEscreveu}: rotulo -> "Técnico"`);
    check(
      engine._rotuloOpcao(SEM_NUM, texto, 0) === "Técnico",
      `${comoEscreveu}: rotulo -> "Técnico" mesmo SEM palavra-chave numerica`
    );
    check(engine._corpoInterativo(texto) === "Como podemos ajudar?", `${comoEscreveu}: corpo sem a linha numerada`);
  }

  // E o limite do zelo: linha de CONTEUDO que comeca com numero nao e opcao.
  check(
    engine._corpoInterativo("Envie 2 vias do documento") === "Envie 2 vias do documento",
    "linha de conteudo comecando com numero NAO e removida"
  );
  check(
    engine._corpoInterativo(`Total: 3 itens\n\n*1${K} Sim*\n*2${K} Nao*`) === "Total: 3 itens",
    "conteudo e opcoes na mesma mensagem: sai so a opcao"
  );

  titulo("12. PERGUNTA DE RESPOSTA FIXA tambem vira botao (SIM/NAO e nota 1..5)");

  // Nem toda pergunta e menu. "O CNPJ continua sendo este?" e "de 1 a 5, que
  // nota voce da?" tinham resposta fechada e nasceram como TEXTO -- eram as
  // unicas coisas que ainda pediam digitacao no meio de uma conversa de botoes.
  //
  // O que este teste protege e a SACADA que fez isso caber sem tocar no
  // recebimento: o `id` do botao e o texto que o motor ja espera. Se alguem
  // "arrumar" os ids para `cnpj_sim`/`nota_3`, o cliente toca no botao e o bot
  // responde "nao entendi" -- e e isto que falha aqui primeiro.
  const regCnpj = [];
  await fazerMotor(regCnpj)._enviarComBotoesFixos(
    "c",
    "5541999999999",
    "O CNPJ continua sendo este?\n\n📄 05.832.287/0001-30\n\nResponda *SIM* para continuar ou *NÃO* para informar outro CNPJ.",
    "cnpj_confirma",
    "inst"
  );
  check(regCnpj.length === 1 && regCnpj[0].tipo === "buttons", `confirmacao de CNPJ em 1 bolha de botao (veio ${regCnpj.map((e) => e.tipo).join("/")})`);
  const btnCnpj = regCnpj[0]?.payload.buttons || [];
  check(btnCnpj.map((b) => b.id).join(",") === "SIM,NÃO", `ids do botao SAO o texto esperado (veio: ${btnCnpj.map((b) => b.id).join(",")})`);
  check(
    btnCnpj.every((b) => ["sim", "nao"].includes(engine.normalizarTexto(b.id))),
    "cada id, normalizado, cai no vocabulario que o motor ja aceita"
  );
  check(
    !/Responda/i.test(regCnpj[0]?.payload.description || ""),
    "a instrucao de DIGITAR sai do corpo quando ha botao"
  );
  check(
    /continua sendo este/.test(regCnpj[0]?.payload.description || ""),
    "a pergunta e o CNPJ continuam no corpo"
  );

  const regNota = [];
  await fazerMotor(regNota)._enviarComBotoesFixos(
    "c",
    "5541999999999",
    "De 1 a 5, qual nota?\n\n*1* = Péssimo\n*5* = Excelente\n\nDigite apenas uma nota.",
    "avaliacao_nota",
    "inst"
  );
  const btnNota = regNota[0]?.payload.values || regNota.flatMap((e) => e.payload.buttons || []);
  check(regNota.length === 1, `5 notas -> 1 card unico com todos os 5 botões juntos (veio ${regNota.length})`);
  check(
    btnNota.every((b, i) => engine.interpretarNota(b) === i + 1),
    "cada opcao volta como a nota certa por `interpretarNota`"
  );

  // Com os botoes desligados, tudo isto tem de voltar a ser texto puro.
  process.env.WHATSAPP_BOTOES_INTERATIVOS = "false";
  const regDesligado = [];
  await fazerMotor(regDesligado)._enviarComBotoesFixos("c", "5541999999999", "O CNPJ continua sendo este?", "cnpj_confirma", "inst");
  check(
    regDesligado.length === 1 && regDesligado[0].tipo === "text",
    `com a flag desligada volta a ser texto (veio ${regDesligado.map((e) => e.tipo).join("/")})`
  );
  process.env.WHATSAPP_BOTOES_INTERATIVOS = "true";

  // Estado sem botao definido (ex.: pedir o CNPJ digitado) segue texto.
  const regTexto = [];
  await fazerMotor(regTexto)._enviarComBotoesFixos("c", "5541999999999", "Informe o CNPJ:", "cnpj", "inst");
  check(regTexto.length === 1 && regTexto[0].tipo === "text", "estado sem botao definido continua texto");

  titulo("13. ROTULO CURTO nao pode comer palavra no meio");

  // O cliente viu "Tenho contrato com a", "Administrativo / Fin" e "Voltar ao
  // menu inici". Cortar por contagem cabe no limite e nao diz o que o botao faz.
  const CORTES = [
    ["Tenho contrato com a ARKA", 20, "Tenho contrato"],
    ["Administrativo / Financeiro", 20, "Administrativo"],
    ["Voltar ao menu inicial", 20, "Voltar ao menu"],
    ["Encerrar atendimento", 20, "Encerrar atendimento"],
    ["SEGUIR COMO ATENDIMENTO AVULSO", 20, "SEGUIR"],
    ["Atendimento avulso para novos clientes", 24, "Atendimento avulso"],
  ];
  for (const [entrada, limite, esperado] of CORTES) {
    const saida = engine._cortarRotulo(entrada, limite);
    check(saida === esperado, `"${entrada}" (${entrada.length}) -> "${saida}" (esperado "${esperado}")`);
  }
  check(engine._cortarRotulo("🛠️ Setor Técnico", 20) === "🛠️ Setor Técnico", "rotulo que ja cabe nao e tocado");
  // Palavra unica maior que o limite: nao ha fronteira, corta cru -- mas sem
  // partir par surrogado no meio, que viraria caractere invalido na tela.
  const semEspaco = engine._cortarRotulo("Palavradificilenormequenaotemespaco", 20);
  check(semEspaco.length <= 20 && semEspaco === "Palavradificilenorme", `palavra unica corta cru (veio "${semEspaco}")`);
  const soEmoji = engine._cortarRotulo("😀".repeat(15), 20);
  check(
    soEmoji.length <= 20 && !/[\uD800-\uDBFF]$/.test(soEmoji),
    `corte no meio de emoji nao deixa surrogado solto (veio ${soEmoji.length} unidades)`
  );

  console.log(
    "\n" + (erros.length ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ") : "BOTOES: TUDO CONFERE")
  );
  process.exit(erros.length ? 1 : 0);
})().catch((e) => { console.error("ERRO", e); process.exit(1); });
