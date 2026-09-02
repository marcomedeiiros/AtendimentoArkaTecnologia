// MATRIZ DE TESTES DO FLUXO DA ARKA -- `node verificar-fluxo-arka.js`.
//
// Nao valida JSON: CONVERSA com o motor. Cada cenario abaixo entra pelo mesmo
// `processarMensagemEntrada` que o webhook do WhatsApp chama, com os
// repositorios em memoria do `chatbot.simulador` -- a logica exercitada e byte a
// byte a que atende o cliente.
//
// E o fluxo testado e o publicado em `docs/fluxo-arka.json`, convertido pelo
// MESMO import que o navegador usa (`client/.../fluxoJson.js`). Testar uma copia
// montada aqui provaria que o teste concorda consigo mesmo.
//
// As duas invariantes que o pedido chama de regra final:
//
//   1. quando o bot faz uma pergunta que exige resposta, ele PARA e ESPERA;
//   2. quando o bot apresenta opcoes, sao no maximo 3 botoes -- e um bloco de
//      resposta livre nao tem botao nenhum.
const path = require("path");
const { readFileSync } = require("fs");

const raiz = path.join(__dirname, "src");
const simulador = require(path.join(raiz, "modules/chatbot/chatbot.simulador"));
const { ChatbotEngine, AGUARDANDO, MAX_BOTOES_POR_MENSAGEM } = require(
  path.join(raiz, "modules/chatbot/chatbot.engine")
);
const { paramsTempos, resumoAutomacoes } = require(path.join(raiz, "modules/fluxos/fluxo.automacao"));

// ── o fluxo, convertido pelo import do front (modulo ES avaliado aqui) ───────
const fonte = readFileSync(
  path.join(__dirname, "..", "client", "src", "components", "flow", "fluxoJson.js"),
  "utf8"
);
const mod = {};
new Function(
  "exports",
  "const hojeISO = () => '1970-01-01';\n" +
    fonte
      .replace(/^\s*import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, "")
      .replace(/export /g, "") +
    "\n;exports.extrair = extrairFluxosImportados;"
)(mod);
const [convertido] = mod.extrair(
  JSON.parse(readFileSync(path.join(__dirname, "..", "docs", "fluxo-arka.json"), "utf8"))
);

const fluxo = {
  id: "f-arka",
  nome: convertido.nome,
  gatilho: convertido.gatilho,
  ativo: true,
  passos: convertido.passos.map((p) => ({
    id: p.id,
    tipo: p.tipo,
    titulo: p.titulo,
    descricao: p.desc,
    texto: p.texto || null,
    config: p.config || null,
    targetId: p.targetId,
    ordem: p.ordem,
  })),
};

const FILAS = { 33: "Técnico", 35: "Comercial" };

const erros = [];
const check = (cond, msg) => { if (!cond) erros.push(msg); return !!cond; };
const linha1 = (t) => String(t || "").split("\n")[0].slice(0, 62);
const tudoQueOBotFalou = (r) => r.turnos.flatMap((t) => t.respostas).join("\n");

function mostrar(titulo, r) {
  console.log(`\n── ${titulo} ${"─".repeat(Math.max(0, 60 - titulo.length))}`);
  for (const t of r.turnos) {
    console.log(`  cliente: "${t.entrada}"`);
    t.respostas.forEach((x) => console.log(`     bot: ${linha1(x)}`));
    if (!t.respostas.length) console.log("     bot: (silencio)");
    console.log(
      "     [" +
        [
          t.passoAtualTitulo && `em=${t.passoAtualTitulo}`,
          t.aguardando && `aguardando=${t.aguardando}`,
          `status=${t.status}`,
          t.setor && t.setor !== "Geral" && `setor=${t.setor}`,
          t.filaId != null && `fila=${t.filaId}`,
          t.transferido && "TRANSFERIDO",
          t.encerrado && "ENCERRADO",
        ].filter(Boolean).join(" ") +
        "]"
    );
  }
}

// ── UMA PERGUNTA POR TURNO ───────────────────────────────────────────────────
//
// O defeito relatado tinha uma assinatura exata: o bot despejava
// "Identificação", "Descreva sua solicitação" e a confirmacao em sequencia, sem
// esperar nada. Um turno com DUAS perguntas e a prova disso -- entao ele e
// checado em todos os cenarios, e nao so no do relato.
//
// Confirmacao ("Solicitação recebida") + entrega no mesmo turno e legitimo: e
// UMA fala, e o desfecho.
const CABECALHOS_DE_PERGUNTA = [
  "Como podemos ajudar?",
  "Confirmação do cadastro",
  "Identificação",
  "Descreva sua solicitação",
  "Seus dados",
  "Atendimento Comercial",
  "Administrativo / Financeiro",
  "Podemos seguir",
];
function perguntasNoTurno(turno) {
  return turno.respostas.filter((r) =>
    CABECALHOS_DE_PERGUNTA.some((c) => String(r || "").includes(c))
  ).length;
}
function conferirUmaPerguntaPorTurno(rotulo, r) {
  r.turnos.forEach((t, i) => {
    const n = perguntasNoTurno(t);
    check(
      n <= 1,
      `${rotulo}: turno ${i + 1} ("${t.entrada}") fez ${n} perguntas de uma vez -- ` +
        `o bot nao esperou a resposta: ${t.respostas.map(linha1).join(" | ")}`
    );
  });
}

(async () => {
  const engine = new ChatbotEngine();
  const passoPor = (titulo) => fluxo.passos.find((p) => p.titulo === titulo);
  const opcoesDe = (titulo) => engine.opcoesDoPasso(passoPor(titulo));

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n╔══ 1. ESTRUTURA: BOTOES x TEXTO LIVRE ═══════════════════════");
  // ══════════════════════════════════════════════════════════════════════════
  //
  // Conferido no DESENHO antes de conversar, porque uma violacao aqui e uma
  // mensagem que a Evolution recusa (400) ou um botao debaixo de uma pergunta
  // aberta -- os dois defeitos relatados.

  // Blocos que USAM botao, com a contagem exigida.
  for (const [titulo, esperado] of [
    ["MENU PRINCIPAL", 3],
    ["TÉCNICO", 3],
    ["CONFIRMA CNPJ", 2],
    ["AVULSO — VALORES", 3],
  ]) {
    const ops = opcoesDe(titulo);
    const escolhas = ops.filter((o) => engine._opcaoEhEscolha(o));
    check(escolhas.length === esperado, `"${titulo}": ${escolhas.length} botoes, esperado ${esperado}`);
    check(
      escolhas.length <= MAX_BOTOES_POR_MENSAGEM,
      `"${titulo}": ${escolhas.length} botoes estoura o teto de ${MAX_BOTOES_POR_MENSAGEM}`
    );
    console.log(
      `  ${escolhas.length === esperado ? "OK   " : "FALHA"} "${titulo}" -> ${escolhas.length} botoes: ` +
        escolhas.map((o) => o.botao || o.id).join(" | ")
    );
  }

  // NENHUM bloco do fluxo pode estourar o teto -- incluindo os que este teste
  // nao nomeia (um bloco novo entra na conta sozinho).
  for (const p of fluxo.passos) {
    const escolhas = engine.opcoesDoPasso(p).filter((o) => engine._opcaoEhEscolha(o));
    check(
      escolhas.length <= MAX_BOTOES_POR_MENSAGEM,
      `"${p.titulo}": ${escolhas.length} botoes estoura o teto de ${MAX_BOTOES_POR_MENSAGEM}`
    );
  }

  // MENU PRINCIPAL: exatamente os tres setores, e NENHUM "encerrar".
  const menu = opcoesDe("MENU PRINCIPAL");
  check(
    menu.map((o) => o.setor).join(",") === "Técnico,Comercial,Financeiro",
    `menu principal declara os setores errados: ${menu.map((o) => o.setor).join(",")}`
  );
  check(
    !menu.some((o) => o.acao === "encerrar"),
    "o menu principal voltou a ter uma opcao de encerrar (o layout so tem 3 vagas)"
  );
  console.log(`  OK    menu principal sem opcao de encerrar (mecanismo global cobre isso)`);

  // Blocos de TEXTO LIVRE: declaram `aguardar: "texto"` e NAO tem opcao de
  // escolha nenhuma -- e o que garante que nenhum botao seja montado.
  for (const titulo of [
    "IDENTIFICAÇÃO",
    "DESCRIÇÃO DA SOLICITAÇÃO",
    "AVULSO — DADOS",
    "COMERCIAL — DADOS",
    "FINANCEIRO — DADOS",
  ]) {
    const p = passoPor(titulo);
    const ok =
      check(!!p, `bloco "${titulo}" nao existe no fluxo`) &&
      check(engine.passoAguardaTexto(p), `"${titulo}" nao declara aguardar: "texto"`) &&
      check(
        engine.opcoesDoPasso(p).length === 0,
        `"${titulo}" tem opcoes -- elas virariam botao debaixo da pergunta`
      ) &&
      check(!!p.targetId, `"${titulo}" nao tem para onde seguir depois da resposta`);
    console.log(`  ${ok ? "OK   " : "FALHA"} "${titulo}" -> TEXTO LIVRE, sem opcao, segue para ${p?.targetId ? passoPor2(p.targetId) : "?"}`);
  }
  function passoPor2(id) {
    return fluxo.passos.find((p) => p.id === id)?.titulo || id;
  }

  // O bloco de CNPJ tambem e texto livre (o cliente digita), pelo mecanismo
  // proprio do motor.
  const passoCnpj = passoPor("CNPJ");
  check(engine.passoAguardaCnpj(passoCnpj), "o bloco de CNPJ nao declara aguardar: cnpj");
  check(
    engine.opcoesDoPasso(passoCnpj).length === 0,
    "o bloco de CNPJ tem opcoes -- viraria botao debaixo do pedido do CNPJ"
  );
  check(
    passoCnpj.config?.targetIdNaoCadastrado === passoPor("AVULSO — VALORES")?.id,
    "CNPJ nao cadastrado nao aponta para o caminho avulso"
  );
  console.log("  OK    \"CNPJ\" -> TEXTO LIVRE, e o nao-cadastrado sai para o caminho avulso");

  // Blocos de ENTREGA: declaram que nao aguardam nada, e transferem.
  for (const [titulo, setor, fila] of [
    ["FILA TÉCNICA", "Técnico", 33],
    ["FILA COMERCIAL", "Comercial", 35],
    ["FILA FINANCEIRO", "Financeiro", null],
  ]) {
    const p = passoPor(titulo);
    const op = engine.opcoesDoPasso(p)[0];
    const ok =
      check(engine.passoNaoAguarda(p), `"${titulo}" nao declara aguardar: "nada" -- o bot ficaria parado nele`) &&
      check(op?.acao === "transferir", `"${titulo}" nao transfere`) &&
      check(op?.setor === setor, `"${titulo}" declara setor ${op?.setor}, esperado ${setor}`) &&
      check(
        (op?.filaId ?? null) === fila,
        `"${titulo}" declara filaId ${op?.filaId ?? null}, esperado ${fila}`
      );
    console.log(`  ${ok ? "OK   " : "FALHA"} "${titulo}" -> transfere para ${setor}${fila ? ` (fila ${fila})` : " (sem filaId declarada)"}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n╔══ 2. TÉCNICO COM CONTRATO ══════════════════════════════════");
  // ══════════════════════════════════════════════════════════════════════════
  //
  // O caminho completo, um passo por resposta:
  // menu -> Tecnico -> tenho contrato -> CNPJ -> confirma o cadastro ->
  // nome/setor -> descricao -> fila tecnica.
  //
  // `parceiro` e um cadastro inventado pelo cenario: e o que faz este CNPJ ser
  // reconhecido como CLIENTE e o fluxo seguir para a confirmacao do cadastro, em
  // vez de cair no caminho avulso.
  const CNPJ_CLIENTE = "11.222.333/0001-81";
  const PARCEIRO = { cnpj: "11222333000181", razaoSocial: "METALURGICA HORIZONTE LTDA" };

  let r = await simulador.simular(
    fluxo,
    ["oi", "1", "1", CNPJ_CLIENTE, "1", "David TI", "Meu computador não consegue acessar o sistema."],
    { nomeCliente: "David", filas: FILAS, parceiro: PARCEIRO }
  );
  mostrar("tecnico com contrato: CNPJ cadastrado -> confirma -> identifica -> descreve", r);
  conferirUmaPerguntaPorTurno("tecnico/contrato", r);
  check(
    r.turnos[2].aguardando === AGUARDANDO.CNPJ,
    `depois de "tenho contrato" o bot deveria PEDIR o CNPJ, veio ${r.turnos[2].aguardando}`
  );
  check(
    r.turnos[2].respostas.length === 1 && /Confirmação do cadastro/.test(r.turnos[2].respostas[0]),
    `o pedido do CNPJ deveria ser UMA mensagem: ${r.turnos[2].respostas.map(linha1).join(" | ")}`
  );
  // ── A CONFIRMACAO DO CADASTRO: dois botoes, com CNPJ e empresa preenchidos ──
  const confirmacao = r.turnos[3].respostas.join("\n");
  check(
    r.turnos[3].passoAtualTitulo === "CONFIRMA CNPJ" && r.turnos[3].aguardando === AGUARDANDO.OPCAO,
    `CNPJ cadastrado deveria parar na confirmacao, parou em ${r.turnos[3].passoAtualTitulo}/${r.turnos[3].aguardando}`
  );
  check(
    /11\.222\.333\/0001-81/.test(confirmacao),
    `a confirmacao nao mostrou o CNPJ formatado: ${confirmacao}`
  );
  // `{{empresa.nome}}` era `""` FIXO no motor: a linha da empresa saia vazia.
  check(
    /METALURGICA HORIZONTE LTDA/.test(confirmacao),
    `a confirmacao nao mostrou a razao social (interpolacao de empresa.nome): ${confirmacao}`
  );
  // ── O CORACAO DO RELATO ──────────────────────────────────────────────────
  //
  // A identificacao pergunta e PARA. `aguardando: "texto"` e a prova, e a
  // assercao de UMA mensagem no turno e o que reprova a regressao relatada
  // (identificacao + descricao + confirmacao despejadas de uma vez).
  check(
    r.turnos[4].aguardando === AGUARDANDO.TEXTO,
    `apos confirmar o CNPJ o bot deveria PARAR na identificacao (aguardando=texto), veio ${r.turnos[4].aguardando}`
  );
  check(
    r.turnos[4].passoAtualTitulo === "IDENTIFICAÇÃO",
    `parou em ${r.turnos[4].passoAtualTitulo}, esperado IDENTIFICAÇÃO`
  );
  check(
    r.turnos[4].respostas.length === 1 && /Identificação/.test(r.turnos[4].respostas[0]),
    `a identificacao deveria ser UMA mensagem: ${r.turnos[4].respostas.map(linha1).join(" | ")}`
  );
  check(
    !/Descreva sua solicitação/.test(r.turnos[4].respostas.join("\n")),
    "a descricao foi enviada JUNTO com a identificacao -- o bot nao esperou"
  );
  // Respondida a identificacao, a descricao pergunta e PARA.
  check(
    r.turnos[5].aguardando === AGUARDANDO.TEXTO &&
      r.turnos[5].passoAtualTitulo === "DESCRIÇÃO DA SOLICITAÇÃO",
    `apos "David TI" deveria parar na descricao, veio ${r.turnos[5].passoAtualTitulo}/${r.turnos[5].aguardando}`
  );
  check(
    r.turnos[5].respostas.length === 1,
    `a descricao deveria ser UMA mensagem: ${r.turnos[5].respostas.map(linha1).join(" | ")}`
  );
  // So depois da descricao: chamado aberto e fila tecnica.
  const fimTec = r.turnos[6];
  check(fimTec.transferido, "nao transferiu depois da descricao");
  check(fimTec.setor === "Técnico", `setor=${fimTec.setor}, esperado Técnico`);
  check(fimTec.filaId === 33, `filaId=${fimTec.filaId}, esperado 33`);
  check(
    /Solicitação recebida/.test(fimTec.respostas.join("\n")) &&
      /equipe técnica/.test(fimTec.respostas.join("\n")),
    `a confirmacao da fila tecnica nao saiu: ${fimTec.respostas.map(linha1).join(" | ")}`
  );
  // O log interno da consulta de CNPJ nao vaza (regressao ja corrigida antes).
  check(
    !/Cliente identificado/.test(tudoQueOBotFalou(r)),
    "vazou o log interno da validacao de CNPJ para o cliente"
  );

  // ── CNPJ NAO CADASTRADO -> CAMINHO AVULSO (item 5 da especificacao) ───────
  //
  // Mesmo roteiro, SEM parceiro: o CNPJ e valido nos digitos e nao esta na lista
  // de clientes. O cliente e avisado e segue pelo caminho avulso -- e nao pela
  // confirmacao de cadastro, que e de quem tem contrato.
  r = await simulador.simular(
    fluxo,
    ["oi", "1", "1", CNPJ_CLIENTE, "1", "David, o notebook não liga."],
    { nomeCliente: "David", filas: FILAS }
  );
  mostrar("CNPJ valido fora da base de clientes -> caminho avulso", r);
  conferirUmaPerguntaPorTurno("tecnico/nao-cadastrado", r);
  check(
    /Não encontramos esse CPF\/CNPJ/.test(tudoQueOBotFalou(r)),
    "CNPJ fora da base nao avisou o cliente"
  );
  check(
    r.turnos[3].passoAtualTitulo === "AVULSO — VALORES",
    `CNPJ fora da base deveria cair em AVULSO — VALORES, caiu em ${r.turnos[3].passoAtualTitulo}`
  );
  check(
    r.turnos[4].passoAtualTitulo === "AVULSO — DADOS" && r.turnos[4].aguardando === AGUARDANDO.TEXTO,
    `apos aceitar os valores deveria parar nos dados do avulso, veio ${r.turnos[4].passoAtualTitulo}`
  );
  check(
    r.turnos[5].transferido && r.turnos[5].setor === "Técnico",
    `o avulso vindo do CNPJ nao cadastrado deveria terminar na fila tecnica, veio ${r.turnos[5].setor}`
  );

  // ══════════════════════════════════════════════════════════════════════════
  //  MEMÓRIA DO PERFIL: quem tem o número no cadastro não digita o CNPJ
  // ══════════════════════════════════════════════════════════════════════════
  //
  // `memoriaCnpj: "fluxo"` liga as duas coisas que precisavam caber juntas:
  //
  //   - o cliente reconhecido pelo TELEFONE não digita o CNPJ;
  //   - a confirmação acontece UMA vez, no bloco CONFIRMA CNPJ do desenho.
  //
  // Com `true` (o modo histórico) o motor confirmaria com os botões fixos DELE e
  // o bloco seguinte perguntaria a mesma coisa -- duas confirmações seguidas.
  const PARCEIRO_COM_TEL = { ...PARCEIRO, telefones: "(27)99999-8888" };
  const TEL_DO_CADASTRO = "5527999998888";

  r = await simulador.simular(
    fluxo,
    ["oi", "1", "1", "1", "David TI", "Impressora sem rede."],
    { nomeCliente: "David", filas: FILAS, parceiro: PARCEIRO_COM_TEL, telefone: TEL_DO_CADASTRO }
  );
  mostrar("memoria do perfil: telefone no cadastro -> nao pede CNPJ", r);
  conferirUmaPerguntaPorTurno("memoria/cadastro", r);

  // O PULO DO GATO: depois de "Tenho contrato" o bot NÃO pede o CNPJ -- ele já
  // sabe, e vai direto para a confirmação do cadastro.
  check(
    r.turnos[2].passoAtualTitulo === "CONFIRMA CNPJ",
    `com o telefone no cadastro, "Tenho contrato" deveria ir direto para a confirmação; foi para ${r.turnos[2].passoAtualTitulo}`
  );
  check(
    r.turnos[2].aguardando === AGUARDANDO.OPCAO,
    `deveria aguardar a escolha dos 2 botões, veio ${r.turnos[2].aguardando}`
  );
  check(
    !/informe o CPF ou CNPJ do titular/i.test(tudoQueOBotFalou(r)),
    "o bot pediu o CNPJ apesar de o telefone estar no cadastro"
  );
  // E a confirmação mostra o cadastro que ele encontrou.
  const confirmaMemoria = r.turnos[2].respostas.join("\n");
  check(
    /11\.222\.333\/0001-81/.test(confirmaMemoria) && /METALURGICA HORIZONTE LTDA/.test(confirmaMemoria),
    `a confirmação não mostrou CNPJ e empresa do cadastro: ${confirmaMemoria}`
  );
  // UMA confirmação em toda a conversa.
  const confirmacoesMemoria = r.turnos.filter((t) =>
    t.respostas.some((x) => /O documento continua sendo este\?/.test(x))
  ).length;
  check(
    confirmacoesMemoria === 1,
    `o cliente recebeu ${confirmacoesMemoria} confirmações de cadastro, esperado 1`
  );
  // E o caminho segue normalmente até a fila.
  check(
    r.turnos[3].passoAtualTitulo === "IDENTIFICAÇÃO" && r.turnos[3].aguardando === AGUARDANDO.TEXTO,
    `após confirmar deveria ir para a identificação, foi para ${r.turnos[3].passoAtualTitulo}`
  );
  check(
    r.turnos[5].transferido && r.turnos[5].setor === "Técnico" && r.turnos[5].filaId === 33,
    `deveria terminar na fila técnica, veio setor=${r.turnos[5].setor} fila=${r.turnos[5].filaId}`
  );
  console.log("  OK    telefone no cadastro -> confirma o cadastro sem pedir o CNPJ");

  // ── O NÚMERO NÃO ESTÁ NO CADASTRO: pede o CNPJ, como antes ────────────────
  //
  // O outro lado da regra. A memória é um atalho para quem ela reconhece; quem
  // não é reconhecido cai no bloco de texto livre, sem botão nenhum.
  r = await simulador.simular(
    fluxo,
    ["oi", "1", "1", CNPJ_CLIENTE, "1", "David TI", "Impressora sem rede."],
    { nomeCliente: "David", filas: FILAS, parceiro: PARCEIRO_COM_TEL, telefone: "5511777776666" }
  );
  mostrar("telefone fora do cadastro: pede o CNPJ (texto livre)", r);
  conferirUmaPerguntaPorTurno("memoria/desconhecido", r);
  check(
    r.turnos[2].aguardando === AGUARDANDO.CNPJ,
    `telefone desconhecido deveria PEDIR o CNPJ, veio ${r.turnos[2].aguardando}`
  );
  check(
    /informe o CPF ou CNPJ do titular/i.test(r.turnos[2].respostas.join("\n")),
    `o pedido do CNPJ não saiu: ${r.turnos[2].respostas.map(linha1).join(" | ")}`
  );
  console.log("  OK    telefone desconhecido -> pede o CNPJ por texto livre");

  // ── DOCUMENTO LEMBRADO QUE NÃO É CLIENTE: PERGUNTA DE NOVO ────────────────
  //
  // Caso real, e caro. O cliente clicou em "Tenho contrato" e o bot respondeu na
  // hora "não encontramos esse documento -- você será atendido como avulso", sem
  // nunca ter perguntado nada. A conversa tinha um documento verificado de um
  // atendimento anterior, ele não estava na base, e com `memoriaCnpj: "fluxo"` o
  // motor o adotava em silêncio e despachava pelo `targetIdNaoCadastrado`.
  //
  // O efeito era uma porta trancada: quem informou o documento errado uma vez --
  // o próprio CPF, quando o contrato está no CNPJ da empresa -- ia para o
  // caminho avulso em TODO contato seguinte, sem nenhum momento em que pudesse
  // corrigir. E do lado de cá parecia que o cliente tinha escolhido ser avulso.
  //
  // O teste chama `_adotarCnpjLembrado` DIRETO, e não o bloco que o antecede:
  // a primeira versão desta verificação passava pelo motivo errado -- ela
  // montava um cenário em que a memória nem chegava a ser oferecida, então
  // "pediu digitado" não provava nada sobre a adoção.
  {
    const passoCnpj = { id: "p-cnpj", tipo: "condicao", config: { memoriaCnpj: "fluxo" } };
    const fluxoFake = { id: "f", passos: [passoCnpj] };

    const montar = (parceiro) => {
      const eng = new ChatbotEngine({
        parceiroRepository: { findAtivoByCnpj: async () => parceiro, findAtivoByTelefone: async () => null },
        conversaRepository: {
          update: async () => ({}),
          findById: async () => ({ id: "c", telefone: "5527900000000" }),
        },
      });
      const conversa = { id: "c", telefone: "5527900000000", cnpj: null, cnpjVerificado: false };
      return { eng, contexto: { conversa, fluxo: fluxoFake } };
    };

    // Um CPF válido que a base não conhece -- exatamente o valor do caso real.
    const a = montar(null);
    const foraDaBase = await a.eng._adotarCnpjLembrado("10421248769", passoCnpj, a.contexto);
    check(
      foraDaBase.pedirDigitado === true,
      `documento lembrado fora da base deveria PEDIR digitado, veio ${JSON.stringify(foraDaBase)}`
    );

    // E o outro lado: lembrado E cadastrado continua sendo adotado, senão a
    // correção teria trocado um atalho quebrado por nenhum atalho.
    const b = montar(PARCEIRO);
    const cadastrado = await b.eng._adotarCnpjLembrado(PARCEIRO.cnpj, passoCnpj, b.contexto);
    check(
      !cadastrado.pedirDigitado,
      `documento lembrado E cadastrado deveria ser adotado, veio ${JSON.stringify(cadastrado)}`
    );
    console.log("  OK    lembrado fora da base -> pergunta de novo; lembrado e cadastrado -> adota");
  }

  // ── MESMO NÚMERO EM DUAS EMPRESAS: não adivinha ───────────────────────────
  //
  // Caso real (contador, matriz e filial). Escolher uma seria abrir o chamado no
  // CNPJ errado, e o atendente só descobriria depois. O repositório devolve null
  // quando há mais de um, e o fluxo pede o CNPJ -- a pergunta certa nesse caso.
  {
    const eng = new ChatbotEngine();
    const repo = {
      findAtivoByCnpj: async () => null,
      findAtivoByTelefone: async () => null, // é o que o repo real faz no ambíguo
    };
    const conversa = { id: "c", telefone: TEL_DO_CADASTRO, cnpj: null, cnpjVerificado: false };
    const engAmb = new ChatbotEngine({
      parceiroRepository: repo,
      conversaRepository: { ultimoCnpjDoTelefone: async () => null },
    });
    const pedido = await engAmb._pedirOuConfirmarCnpj(conversa, "informe o CNPJ", {
      config: { memoriaCnpj: "fluxo" },
    });
    check(
      pedido.aguardando === AGUARDANDO.CNPJ && !pedido.adotar,
      `telefone ambíguo deveria pedir o CNPJ digitado, veio ${JSON.stringify(pedido)}`
    );
    console.log("  OK    número em mais de uma empresa -> pede o CNPJ, não escolhe");
  }

  // ── A RECUSA NÃO VIRA LAÇO ────────────────────────────────────────────────
  //
  // "Não, outro CNPJ" desassocia a conversa -- mas não pode apagar o telefone do
  // CADASTRO. Sem a marca de recusa, o bloco de CNPJ consultaria o cadastro de
  // novo, acharia o MESMO parceiro e ofereceria outra vez, para sempre.
  r = await simulador.simular(
    fluxo,
    ["oi", "1", "1", "2", "22.333.444/0001-55"],
    { nomeCliente: "David", filas: FILAS, parceiro: PARCEIRO_COM_TEL, telefone: TEL_DO_CADASTRO }
  );
  mostrar("recusa o cadastro lembrado -> pede digitado, e NAO reoferece", r);
  check(
    r.turnos[3].aguardando === AGUARDANDO.CNPJ,
    `"Não, outro CNPJ" deveria pedir o número digitado, veio ${r.turnos[3].aguardando}`
  );
  check(
    !/Encontramos este cadastro/.test(r.turnos[3].respostas.join("\n")),
    "a memória reofereceu o cadastro que o cliente acabou de recusar (laço)"
  );
  const ofertas = r.turnos.filter((t) =>
    t.respostas.some((x) => /O documento continua sendo este\?/.test(x))
  ).length;
  check(ofertas === 1, `o cadastro foi oferecido ${ofertas} vezes, esperado 1`);
  console.log("  OK    recusa -> pede digitado, e o cadastro não é oferecido de novo");

  // ── "NÃO, OUTRO CNPJ" -> volta a pedir o CNPJ ─────────────────────────────
  //
  // O botao de recusa da confirmacao desassocia o CNPJ desta conversa (o
  // cadastro da empresa NAO e tocado) e devolve o cliente ao bloco que pede o
  // numero. Sem o `limparCnpj`, o bloco reofereceria o mesmo CNPJ recusado.
  r = await simulador.simular(
    fluxo,
    ["oi", "1", "1", CNPJ_CLIENTE, "2", "22.333.444/0001-55"],
    { filas: FILAS, parceiro: PARCEIRO }
  );
  mostrar("confirmacao recusada -> pede outro CNPJ", r);
  check(
    r.turnos[4].passoAtualTitulo === "CNPJ" && r.turnos[4].aguardando === AGUARDANDO.CNPJ,
    `"Não, outro CNPJ" deveria voltar a pedir o numero, foi para ${r.turnos[4].passoAtualTitulo}/${r.turnos[4].aguardando}`
  );

  // ── CNPJ INVALIDO duas vezes -> segue como avulso ─────────────────────────
  r = await simulador.simular(fluxo, ["oi", "1", "1", "12345678901234", "98765432109876"], {
    filas: FILAS,
  });
  mostrar("CNPJ invalido duas vezes -> avulso", r);
  const ultCnpj = r.turnos[r.turnos.length - 1];
  check(
    ultCnpj.respostas.length > 0,
    "handoff MUDO: o cliente foi para a fila sem nenhuma mensagem"
  );
  check(
    /cliente avulso/i.test(tudoQueOBotFalou(r)),
    `esgotadas as tentativas, o cliente deveria ser avisado do avulso: ${tudoQueOBotFalou(r)}`
  );

  // ── "VOLTAR AO MENU" do Tecnico ───────────────────────────────────────────
  r = await simulador.simular(fluxo, ["oi", "1", "3"], { filas: FILAS });
  mostrar("tecnico -> voltar ao menu", r);
  check(
    r.turnos[2].passoAtualTitulo === "MENU PRINCIPAL",
    `"voltar" deveria retornar ao menu, foi para ${r.turnos[2].passoAtualTitulo}`
  );

  // ── SELECAO INVALIDA no menu ──────────────────────────────────────────────
  r = await simulador.simular(fluxo, ["oi", "9"], { filas: FILAS });
  mostrar("selecao invalida no menu", r);
  check(
    /não consegui entender/i.test(r.turnos[1].respostas.join("\n")),
    `selecao invalida deveria repetir o menu com o texto do fluxo: ${r.turnos[1].respostas.map(linha1).join(" | ")}`
  );
  check(
    r.turnos[1].aguardando === AGUARDANDO.OPCAO,
    "selecao invalida nao pode tirar o cliente do menu"
  );

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n╔══ 3. TÉCNICO AVULSO ════════════════════════════════════════");
  // ══════════════════════════════════════════════════════════════════════════
  r = await simulador.simular(
    fluxo,
    ["oi", "1", "2", "1", "David, preciso de suporte em um computador que não está conectando na rede."],
    { filas: FILAS }
  );
  mostrar("avulso: valores -> dados -> fila tecnica", r);
  conferirUmaPerguntaPorTurno("avulso", r);
  check(
    /Atendimento remoto: R\$ 120,00/.test(tudoQueOBotFalou(r)),
    "os valores do atendimento avulso nao foram apresentados"
  );
  check(
    r.turnos[3].aguardando === AGUARDANDO.TEXTO && r.turnos[3].passoAtualTitulo === "AVULSO — DADOS",
    `apos aceitar os valores deveria parar nos dados, veio ${r.turnos[3].passoAtualTitulo}/${r.turnos[3].aguardando}`
  );
  const fimAvulso = r.turnos[4];
  check(fimAvulso.transferido, "avulso nao transferiu");
  check(fimAvulso.setor === "Técnico", `avulso foi para ${fimAvulso.setor}, esperado Técnico`);
  check(fimAvulso.filaId === 33, `avulso foi para a fila ${fimAvulso.filaId}, esperado 33`);

  // Recusar os valores encerra com a despedida do fluxo.
  r = await simulador.simular(fluxo, ["oi", "1", "2", "2"], { filas: FILAS, pesquisaSatisfacao: false });
  mostrar("avulso: recusa os valores -> encerra", r);
  check(
    /agradecemos seu contato/i.test(r.turnos[3].respostas.join("\n")),
    `a recusa deveria despedir-se: ${r.turnos[3].respostas.map(linha1).join(" | ")}`
  );

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n╔══ 4. COMERCIAL ═════════════════════════════════════════════");
  // ══════════════════════════════════════════════════════════════════════════
  //
  // Sem submenu Produtos/Servicos: entrada -> texto livre -> fila comercial.
  r = await simulador.simular(fluxo, ["ola", "2", "David, preciso de um orçamento para 10 notebooks."], {
    filas: FILAS,
  });
  mostrar("comercial: dados -> fila comercial", r);
  conferirUmaPerguntaPorTurno("comercial", r);
  check(
    r.turnos[1].aguardando === AGUARDANDO.TEXTO,
    `o Comercial deveria PARAR esperando o texto do cliente, veio ${r.turnos[1].aguardando}`
  );
  check(
    r.turnos[1].passoAtualTitulo === "COMERCIAL — DADOS",
    `parou em ${r.turnos[1].passoAtualTitulo}, esperado COMERCIAL — DADOS`
  );
  check(
    !/PRODUTOS|SERVIÇOS/i.test(tudoQueOBotFalou(r)),
    "o submenu Produtos/Serviços voltou a aparecer no Comercial"
  );
  const fimCom = r.turnos[2];
  check(fimCom.transferido, "comercial nao transferiu");
  check(fimCom.setor === "Comercial", `setor=${fimCom.setor}`);
  check(fimCom.filaId === 35, `filaId=${fimCom.filaId}, esperado 35`);
  check(
    /equipe comercial/.test(fimCom.respostas.join("\n")),
    `a confirmacao da fila comercial nao saiu: ${fimCom.respostas.map(linha1).join(" | ")}`
  );

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n╔══ 5. FINANCEIRO ════════════════════════════════════════════");
  // ══════════════════════════════════════════════════════════════════════════
  r = await simulador.simular(fluxo, ["ola", "3", "Ana, segunda via do boleto de agosto."], {
    filas: FILAS,
  });
  mostrar("financeiro: dados -> fila financeiro", r);
  conferirUmaPerguntaPorTurno("financeiro", r);
  check(
    r.turnos[1].aguardando === AGUARDANDO.TEXTO,
    `o Financeiro deveria PARAR esperando o texto do cliente, veio ${r.turnos[1].aguardando}`
  );
  const fimFin = r.turnos[2];
  check(fimFin.transferido, "financeiro nao transferiu");
  // O SETOR DECLARADO VENCE O MAPA DE FILAS. Aqui esta a prova de que a cobranca
  // nao cai no Comercial: o bloco financeiro nao declara filaId nenhuma, e o
  // mapa `{33: Técnico, 35: Comercial}` nao tem como interferir.
  check(fimFin.setor === "Financeiro", `setor=${fimFin.setor}, esperado Financeiro`);
  check(fimFin.filaId === null, `o bloco financeiro nao deveria declarar fila, veio ${fimFin.filaId}`);
  check(
    /administrativa\/financeira/.test(fimFin.respostas.join("\n")),
    `a confirmacao da fila financeira nao saiu: ${fimFin.respostas.map(linha1).join(" | ")}`
  );

  // Mapa de filas com nome FORA da lista canonica nao rebaixa o setor escolhido.
  r = await simulador.simular(fluxo, ["oi", "1", "2", "1", "impressora travada"], {
    filas: { 33: "Suporte" },
  });
  check(
    r.turnos[r.turnos.length - 1].setor === "Técnico",
    `mapa de filas invalido rebaixou o setor para ${r.turnos[r.turnos.length - 1].setor}`
  );
  console.log('  OK    mapa de filas com "Suporte" (fora da lista) nao rebaixa o setor escolhido');

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n╔══ 6. ATENDIMENTO HUMANO: O BOT NAO REINICIA ════════════════");
  // ══════════════════════════════════════════════════════════════════════════
  //
  // Entregue a conversa, "Obrigado" / "Ok" / "Entendi" nao podem reabrir o menu
  // por causa do gatilho curinga. O simulador para no handoff (o bot nao
  // responde mais), entao a prova aqui e que ele PARA -- e o cenario do TTL
  // vencido esta em verificar-tudo.js/verificar-inatividade.js.
  r = await simulador.simular(
    fluxo,
    ["ola", "3", "Ana, segunda via do boleto", "Obrigado", "Ok", "Entendi"],
    { filas: FILAS }
  );
  mostrar("depois do handoff o bot cala a boca", r);
  check(
    r.turnos.length === 3,
    `deveria parar em 3 turnos (a conversa e do atendente), veio ${r.turnos.length}`
  );
  check(r.turnos[2].transferido, "o terceiro turno deveria ser o handoff");

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n╔══ 7. TIMEOUT: UM RELOGIO, UM VALOR ════════════════════════");
  // ══════════════════════════════════════════════════════════════════════════
  //
  // A auditoria pedida: nao pode haver "global diz 10, bloco diz 2" sem saber
  // qual manda. A precedencia e bloco do canvas > configuracoesGlobais > legado
  // > padrao do sistema (fluxo.automacao.paramsTempos). Este fluxo declara o
  // MESMO valor nos dois lugares de proposito, para o painel e o desenho nunca
  // discordarem -- e e isso que se confere aqui.
  const tempos = paramsTempos(fluxo);
  const blocoSem = fluxo.passos.find((p) => p.tipo === "espera" && p.config?.modo === "sem_resposta");
  const blocoFila = fluxo.passos.find((p) => p.tipo === "espera" && p.config?.modo === "fila_pendentes");
  const globais = fluxo.passos.find((p) => p.config?.configuracoesGlobais)?.config?.configuracoesGlobais;

  console.log(`  sem resposta  : bloco=${blocoSem?.config?.minutos} min  globais=${globais?.semResposta?.minutos} min  EFETIVO=${tempos.semResposta.minutos} min (${tempos.semResposta.acao})`);
  console.log(`  espera na fila: bloco=${blocoFila?.config?.minutos} min  globais=${globais?.filaPendentes?.minutos} min  EFETIVO=${tempos.filaPendentes.minutos} min`);
  check(tempos.semResposta.minutos === 5, `sem resposta efetivo=${tempos.semResposta.minutos}, esperado 5`);
  check(tempos.semResposta.acao === "encerrar", `acao=${tempos.semResposta.acao}, esperado encerrar`);
  check(!!tempos.semResposta.passoId, "o bloco de espera 'sem resposta' nao foi encontrado no canvas");
  check(tempos.filaPendentes.minutos === 10, `espera na fila efetivo=${tempos.filaPendentes.minutos}, esperado 10`);
  check(!!tempos.filaPendentes.passoId, "o bloco de espera 'fila pendentes' nao foi encontrado no canvas");
  // As DUAS fontes concordam: se divergirem, quem manda e o bloco -- e o painel
  // mostraria um numero que o campo escondido contradiz.
  check(
    blocoSem?.config?.minutos === globais?.semResposta?.minutos,
    `o bloco diz ${blocoSem?.config?.minutos} min e as configuracoes globais dizem ${globais?.semResposta?.minutos} min: alinhe os dois`
  );
  check(
    blocoFila?.config?.minutos === globais?.filaPendentes?.minutos,
    `fila: bloco ${blocoFila?.config?.minutos} min x globais ${globais?.filaPendentes?.minutos} min`
  );
  check(
    !globais?.notResponseMessage,
    "o campo legado notResponseMessage voltou ao fluxo: ele cria uma segunda fonte para o mesmo prazo"
  );

  // O TIMEOUT ALCANCA A RESPOSTA LIVRE. O bot perguntou "descreva sua
  // solicitacao" e o cliente sumiu: e uma pergunta em aberto como qualquer
  // outra, e o prazo tem de valer.
  const enviadas = [];
  const conversaT = { id: "c-timeout", cliente: "David", telefone: "5527999", statusAtendimento: "pendente" };
  let sessaoT = null;
  const engineT = new ChatbotEngine({
    fluxoRepository: { findById: async () => fluxo, createLog: async () => {} },
    conversaRepository: {
      findById: async () => conversaT,
      addMensagem: async (_i, origem, texto) => { if (origem === "bot") enviadas.push(texto); return { id: "m" }; },
      vincularWaMessageId: async () => {},
      update: async (_i, d) => Object.assign(conversaT, d),
      atualizarAtendimentoAtual: async () => null,
      atualizarAtendimento: async () => null,
      garantirAtendimentoAberto: async () => ({ atendimento: null, nova: false }),
      // Este roteiro nao tem OS nenhuma (atendimento: null), entao o real
      // devolveria 0 aqui -- "nenhuma linha casou". O que importa e o metodo
      // EXISTIR: sem ele o fechamento por timeout estourava TypeError.
      definirMotivoAtualSeVazio: async () => 0,
      respondeuDepoisDe: async () => false,
    },
    sessaoRepository: {
      findByConversa: async () => sessaoT,
      upsert: async () => ({}),
      update: async () => ({}),
      reivindicarInatividade: async () => {
        if (!sessaoT || sessaoT.inatividadeEm) return { count: 0 };
        sessaoT.inatividadeEm = new Date();
        return { count: 1 };
      },
    },
    evolutionApi: { sendText: async () => ({ key: { id: "x" } }) },
    configuracaoService: { pesquisaSatisfacao: async () => ({ ativo: false }) },
    bus: { emitConversa: () => {} },
  });
  const desde = new Date(Date.now() - 6 * 60 * 1000); // 6 min > 5 min do bloco
  sessaoT = {
    id: "s-timeout", ativo: true, fluxoAtualId: fluxo.id, telefone: conversaT.telefone,
    aguardando: AGUARDANDO.TEXTO, aguardandoDesde: desde, atualizadoEm: desde,
  };
  const resT = await engineT.aplicarInatividade(sessaoT, {
    conversa: conversaT, instanciaId: "i", instanceName: "arka",
  });
  console.log(`  resposta livre parada 6 min -> ${resT ? "encerrou" : "nada"} | bot: ${linha1(enviadas[0])}`);
  check(resT?.encerrado === true, "resposta livre abandonada nao expirou pelo prazo do fluxo");
  check(
    /abra um chamado novamente/i.test(enviadas[0] || ""),
    `o texto do timeout deveria vir do bloco de espera: ${enviadas[0]}`
  );

  // Quem JA foi entregue a fila nao expira -- `concluidoEm` preenchido.
  conversaT.statusAtendimento = "pendente";
  sessaoT = { ...sessaoT, inatividadeEm: null, concluidoEm: new Date(), aguardando: AGUARDANDO.TEXTO };
  const resConcluida = await engineT.aplicarInatividade(sessaoT, {
    conversa: conversaT, instanciaId: "i", instanceName: "arka",
  });
  check(resConcluida === null, "expirou uma automacao JA CONCLUIDA (entregue a fila)");
  console.log("  OK    automacao concluida (entregue a fila) nao expira");

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n╔══ 8. HORÁRIO DE ATENDIMENTO ════════════════════════════════");
  // ══════════════════════════════════════════════════════════════════════════
  //
  // A regra em si esta provada caso a caso em verificar-horario.js. Aqui o que
  // se prova e a INTEGRACAO: o bot nao inicia fluxo fora do expediente, avisa
  // com os horarios CONFIGURADOS, preserva o atendimento na fila -- e nao repete
  // o aviso a cada mensagem.
  const expediente = {
    ativo: true,
    timezone: "America/Sao_Paulo",
    dias: Object.fromEntries(
      [1, 2, 3, 4, 5].map((d) => [d, { ativo: true, periodos: [{ inicio: "08:00", fim: "18:00" }] }])
    ),
    excecoes: [{ data: "2026-09-07", fechado: true, descricao: "Independência" }],
  };

  // DENTRO do horario: o fluxo roda normalmente.
  r = await simulador.simular(fluxo, ["oi"], {
    respeitarHorario: true,
    horario: expediente,
    agora: new Date("2026-08-17T10:00:00-03:00"),
    filas: FILAS,
  });
  check(
    /Seja bem-vindo à ARKA/.test(r.turnos[0].respostas.join("\n")),
    `dentro do horario o menu deveria abrir: ${r.turnos[0].respostas.map(linha1).join(" | ")}`
  );
  console.log("  OK    segunda 10h: o fluxo abre normalmente");

  // O simulador reproduz a conversa desde o inicio a cada chamada e para no
  // handoff, entao a nao-repeticao do aviso e provada direto no motor -- com a
  // marca `foraHorarioEm` viajando na sessao, como em producao.
  const foraCfg = { ...expediente };
  const enviadasFora = [];
  const conversaF = { id: "c-fora", cliente: "David", telefone: "5527888", statusAtendimento: "pendente" };
  let sessaoF = null;
  const engineF = new ChatbotEngine({
    fluxoRepository: { findAtivos: async () => [fluxo], findById: async () => fluxo, createLog: async () => {} },
    conversaRepository: {
      findByTelefoneParaMotor: async () => conversaF,
      findByTelefone: async () => conversaF,
      findById: async () => conversaF,
      findByIdParaEvento: async () => conversaF,
      existeMensagemWa: async () => false,
      addMensagem: async (_i, origem, texto) => { if (origem === "bot") enviadasFora.push(texto); return { id: "m" }; },
      vincularWaMessageId: async () => {},
      update: async (_i, d) => Object.assign(conversaF, d),
      atualizarAtendimentoAtual: async () => null,
      garantirAtendimentoAberto: async () => ({ atendimento: null, nova: false }),
      // Sem OS neste roteiro: o real devolveria 0. Ver a nota no stub do timeout.
      definirMotivoAtualSeVazio: async () => 0,
      ultimoCnpjDoTelefone: async () => null,
    },
    sessaoRepository: {
      findByTelefone: async () => sessaoF,
      findByConversa: async () => sessaoF,
      upsert: async (instanciaId, conversaId, telefone, dados) => {
        sessaoF = { id: "s-fora", instanciaId, conversaId, telefone, ...(sessaoF || {}), ...dados, atualizadoEm: new Date() };
        return sessaoF;
      },
      update: async (_i, d) => { sessaoF = { ...sessaoF, ...d }; return sessaoF; },
    },
    parceiroRepository: { findAtivoByCnpj: async () => null },
    evolutionApi: { sendText: async () => ({ key: { id: "x" } }), fetchProfilePictureUrl: async () => null },
    configuracaoService: {
      modoAtendimento: async () => "local",
      horarioAtendimento: async () => foraCfg,
      filasParaSetor: async () => FILAS,
      pesquisaSatisfacao: async () => ({ ativo: false }),
    },
    bus: { emitConversa: () => {} },
  });

  const receber = (texto, id) =>
    engineF.processarMensagemEntrada({
      instanciaId: "i", instanceName: "arka", telefone: conversaF.telefone,
      texto, nomeCliente: "David", waMessageId: id,
    });

  // O motor usa `new Date()` para decidir o expediente, entao o teste precisa
  // que AGORA esteja fora dele. Sabado e domingo estao fechados na configuracao
  // acima; se o teste rodar num dia de semana as 10h, forcamos o fechamento
  // marcando a data de HOJE como excecao. Assim o cenario vale a qualquer hora
  // em que alguem rode o script -- um teste que so passa de madrugada nao e teste.
  const hojeISO = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  foraCfg.excecoes = [{ data: hojeISO, fechado: true, descricao: "fechado para o teste" }];

  const r1 = await receber("Oi", "wa-1");
  const r2 = await receber("Ainda preciso de ajuda.", "wa-2");
  const r3 = await receber("Alguém aí?", "wa-3");

  console.log(`  mensagens do bot apos 3 mensagens do cliente fora do horario: ${enviadasFora.length}`);
  enviadasFora.forEach((t) => console.log(`     bot: ${linha1(t)}`));
  check(
    enviadasFora.length === 1,
    `o aviso de fora do horario deveria sair UMA vez, saiu ${enviadasFora.length}`
  );
  check(
    /fora do horário/i.test(enviadasFora[0] || ""),
    `o aviso nao identifica o motivo: ${enviadasFora[0]}`
  );
  // Os horarios vem da CONFIGURACAO, e nao de texto fixo no fluxo.
  check(
    /08:00 às 18:00/.test(enviadasFora[0] || ""),
    `o aviso nao trouxe os horarios configurados: ${enviadasFora[0]}`
  );
  check(
    !/Seja bem-vindo à ARKA/.test(enviadasFora.join("\n")),
    "fora do horario o bot abriu o menu do fluxo"
  );
  // O ATENDIMENTO E PRESERVADO: a conversa fica na fila de Pendentes, que e a
  // estrutura que a Central ja usa para "chegou e ninguem assumiu".
  check(r1?.transferido === true, "fora do horario a conversa deveria ser preservada na fila");
  check(conversaF.statusAtendimento === "pendente", `status=${conversaF.statusAtendimento}, esperado pendente`);
  check(
    r2?.motivo === "fora_do_horario" && r3?.motivo === "fora_do_horario",
    `as mensagens seguintes deveriam seguir tratadas como fora do horario: ${r2?.motivo}/${r3?.motivo}`
  );
  check(
    !!sessaoF?.contexto?.foraHorarioEm,
    "a marca do aviso nao ficou na sessao: sem ela o aviso repete a cada mensagem"
  );

  // ── UMA FOTO ÀS 22H TAMBÉM É UM CLIENTE ESPERANDO ──────────────────────────
  //
  // O `return` de "midia_recebida" ficava ANTES da regra de expediente. Não é
  // uma ordem inocente: metade dos chamados de suporte começa com o print do
  // erro, e essa foto saía do motor antes de o horário ser sequer lido. O mesmo
  // cliente, na mesma hora, recebia o aviso se escrevesse "meu sistema travou" e
  // recebia SILÊNCIO se mandasse a tela travada. O expediente é da empresa, não
  // do formato da mensagem.
  //
  // A marca é zerada porque `deveAvisar` já viu um aviso há segundos: sem isto o
  // teste mediria a não-repetição (que a checagem acima já cobre), e não o
  // caminho da mídia.
  sessaoF.contexto = { ...(sessaoF.contexto || {}), foraHorarioEm: null };
  const antesDaFoto = enviadasFora.length;
  const rFoto = await engineF.processarMensagemEntrada({
    instanciaId: "i", instanceName: "arka", telefone: conversaF.telefone,
    texto: "", nomeCliente: "David", waMessageId: "wa-foto",
    midia: { tipo: "imagem", mimetype: "image/jpeg" },
  });
  const avisoDaFoto = enviadasFora.slice(antesDaFoto);
  const okFoto =
    check(
      avisoDaFoto.length === 1,
      `foto fora do horario deveria receber o mesmo aviso, saiu ${avisoDaFoto.length} mensagem(ns) do bot`
    ) &
    check(
      /fora do horário/i.test(avisoDaFoto[0] || ""),
      `o aviso da foto nao identifica o motivo: ${avisoDaFoto[0]}`
    ) &
    check(
      rFoto?.motivo === "fora_do_horario",
      `foto fora do horario deveria ser tratada como fora do horario, veio ${rFoto?.motivo}`
    );
  console.log(`  ${okFoto ? "OK   " : "FALHA"} foto fora do horario recebe o mesmo aviso que o texto`);

  // ── QUEM JÁ ESTÁ COM UMA PESSOA NÃO LEVA O AVISO NA CARA ───────────────────
  //
  // O plantão das 19h era o pior dos mundos: o atendente respondia, o cliente
  // respondia de volta, e o bot atropelava a conversa com "estamos fora do
  // horário" -- e pior, o handoff logo abaixo devolvia a conversa para Pendentes,
  // tirando-a da tela de quem estava atendendo. O guard de `aberta` que existe
  // mais adiante no motor nunca era alcançado, porque este bloco retorna antes.
  sessaoF.contexto = { ...(sessaoF.contexto || {}), foraHorarioEm: null };
  conversaF.statusAtendimento = "aberta";
  const antesDoAtendente = enviadasFora.length;
  const rAberta = await receber("Obrigado, era isso mesmo", "wa-aberta");
  const okAberta =
    check(
      enviadasFora.length === antesDoAtendente,
      `conversa em atendimento humano recebeu ${enviadasFora.length - antesDoAtendente} aviso(s) de fora do horario`
    ) &
    check(
      rAberta?.motivo === "atendimento_humano",
      `com atendente na conversa o motivo deveria ser atendimento_humano, veio ${rAberta?.motivo}`
    ) &
    check(
      conversaF.statusAtendimento === "aberta",
      `o bot devolveu para Pendentes uma conversa que um atendente conduzia (status=${conversaF.statusAtendimento})`
    );
  console.log(
    `  ${okAberta ? "OK   " : "FALHA"} conversa com atendente nao e interrompida nem volta para Pendentes`
  );
  conversaF.statusAtendimento = "pendente";

  // Trocado o expediente, o MESMO fluxo passa a atender: a regra e da
  // configuracao, e nao do desenho.
  foraCfg.ativo = false;
  const r4 = await receber("Oi de novo", "wa-4");
  check(
    r4?.motivo !== "fora_do_horario",
    "desligada a regra de horario, o bot deveria voltar a atender"
  );
  console.log("  OK    desligada a regra, o mesmo fluxo volta a atender");

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n╔══ 9. ENCERRAMENTO E PALAVRAS DE CONTROLE ═══════════════════");
  // ══════════════════════════════════════════════════════════════════════════
  //
  // O menu não tem mais o botão "4 — Encerrar atendimento" (as três vagas são
  // dos setores). Quem encerra é o mecanismo GLOBAL do motor: as palavras de
  // `chatbot.config.palavrasChave.sair` (sair / cancelar / encerrar / parar /
  // tchau), liberadas pelo fluxo em `permitirComandosGlobais`.
  //
  // Este bloco prova as duas metades da mesma regra -- e a segunda é a que
  // importa mais.

  // METADE 1: fora de uma etapa que espera resposta, "encerrar" encerra.
  r = await simulador.simular(fluxo, ["encerrar"], { filas: FILAS, pesquisaSatisfacao: false });
  mostrar('"encerrar" na primeira mensagem', r);
  check(
    r.turnos[0].encerrado === true || r.turnos[0].status === "fechada",
    `"encerrar" deveria encerrar o atendimento, veio status=${r.turnos[0].status}`
  );

  // ── METADE 2: DENTRO DE UMA RESPOSTA LIVRE, A PALAVRA É DADO ──────────────
  //
  // Aqui estava um defeito que a resposta livre criou e que só apareceu quando
  // se mediu: `detectarComando` casa por palavra inteira em QUALQUER posição da
  // frase, e o cliente do Financeiro escreve exatamente isto:
  //
  //   "Preciso encerrar meu contrato de internet"  -> comando "sair"
  //   "quero cancelar um pedido"                   -> comando "sair"
  //   "preciso voltar a usar o sistema antigo"     -> comando "menu"
  //
  // Sem o guard, o bot pedia "descreva sua solicitação", o cliente descrevia, e
  // a descrição ENCERRAVA o atendimento. Ver `respostaEhDoFluxo` no motor.
  const FRASES_ARMADILHA = [
    ["Preciso encerrar meu contrato de internet", "Financeiro"],
    ["quero cancelar um pedido que fiz ontem", "Financeiro"],
    ["preciso voltar a usar o sistema antigo", "Financeiro"],
  ];
  for (const [frase, setorEsperado] of FRASES_ARMADILHA) {
    r = await simulador.simular(fluxo, ["ola", "3", frase], { filas: FILAS });
    const ultimo = r.turnos[r.turnos.length - 1];
    const ok =
      check(
        r.turnos.length === 3,
        `"${frase}": a conversa deveria ter 3 turnos, teve ${r.turnos.length}`
      ) &&
      check(
        ultimo.transferido === true && !ultimo.encerrado,
        `"${frase}" foi tratada como COMANDO: o atendimento ${ultimo.encerrado ? "encerrou" : "não foi entregue"} em vez de coletar a descrição`
      ) &&
      check(
        ultimo.setor === setorEsperado,
        `"${frase}": setor=${ultimo.setor}, esperado ${setorEsperado}`
      );
    console.log(`  ${ok ? "OK   " : "FALHA"} "${frase.slice(0, 44)}"  ->  coletada e entregue ao ${ultimo.setor}`);
  }

  // E o pedido EXPLÍCITO de atendente continua atravessando o fluxo -- quem pede
  // uma pessoa deve conseguir uma pessoa.
  r = await simulador.simular(fluxo, ["ola", "3", "quero falar com um atendente"], { filas: FILAS });
  const pediuAtendente = r.turnos[2];
  check(
    pediuAtendente.transferido === true,
    `o pedido explícito de atendente deveria transferir, veio ${JSON.stringify(pediuAtendente.motivo)}`
  );
  console.log(`  OK    "quero falar com um atendente"  ->  transferido (motivo: ${pediuAtendente.motivo})`);

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n╔══ 10. PESQUISA DE SATISFAÇÃO NO MOMENTO CERTO ══════════════");
  // ══════════════════════════════════════════════════════════════════════════
  //
  // O bloco de avaliação NÃO é ligado a nada no canvas, e isso é de propósito --
  // ele não é um passo da conversa, é a CONFIGURAÇÃO da pesquisa. Quem a dispara
  // é o ENCERRAMENTO do atendimento (`encerrarAtendimento` ->
  // `iniciarPesquisaSatisfacao`), que lê a config deste bloco pelo fluxo ativo.
  //
  // "Bloco órfão" seria um bloco que ninguém alcança E ninguém lê. Este é lido;
  // o que se prova aqui é isso.
  const passoAval = fluxo.passos.find((p) => p.tipo === "avaliacao");
  check(!!passoAval, "o fluxo não tem bloco de Pesquisa de Satisfação");
  check(
    !fluxo.passos.some(
      (p) =>
        p.targetId === passoAval?.id ||
        (p.config?.opcoes || []).some((o) => o?.targetId === passoAval?.id)
    ),
    "o bloco de avaliação está ligado no canvas: ele é disparado pelo encerramento, não por ligação"
  );

  // O ENCERRAMENTO PELO FLUXO ABRE A PESQUISA. Caminho: avulso -> "Não, obrigado"
  // -> despedida -> pesquisa.
  r = await simulador.simular(fluxo, ["oi", "1", "2", "2", "5", "foi rápido"], { filas: FILAS });
  mostrar("encerrar pelo fluxo -> pesquisa -> nota -> comentário", r);
  const despedida = r.turnos[3];
  check(
    /de 1 a 5/.test(despedida.respostas.join("\n")),
    `o encerramento deveria abrir a pesquisa: ${despedida.respostas.map(linha1).join(" | ")}`
  );
  check(
    despedida.aguardando === "avaliacao_nota",
    `deveria aguardar a nota, veio ${despedida.aguardando}`
  );
  check(despedida.status === "fechada", `a OS deveria fechar na hora, veio ${despedida.status}`);
  check(
    r.turnos[4]?.aguardando === "avaliacao_comentario",
    `depois da nota deveria pedir o comentário, veio ${r.turnos[4]?.aguardando}`
  );
  check(
    /avaliação foi registrada/i.test(r.turnos[5]?.respostas.join("\n") || ""),
    `o agradecimento não saiu: ${r.turnos[5]?.respostas.map(linha1).join(" | ")}`
  );
  console.log("  OK    encerramento -> nota -> comentário -> agradecimento");

  // A PESQUISA NÃO ATRAPALHA O ATENDIMENTO HUMANO: quem foi ENTREGUE à fila não
  // recebe pesquisa (não houve atendimento para avaliar ainda -- ela vem quando
  // o atendente encerrar).
  r = await simulador.simular(fluxo, ["ola", "3", "Ana, segunda via do boleto"], { filas: FILAS });
  check(
    !/de 1 a 5/.test(tudoQueOBotFalou(r)),
    "a pesquisa foi disparada na ENTREGA para a fila; ela pertence ao encerramento"
  );
  console.log("  OK    entrega para a fila NÃO dispara pesquisa (o atendente ainda vai atender)");

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n╔══ 11. DUAS PERGUNTAS LIVRES SEGUIDAS, E A RESPOSTA GUARDADA ═");
  // ══════════════════════════════════════════════════════════════════════════
  //
  // Duas coisas de uma vez, num fluxo mínimo montado aqui (e não no da ARKA) para
  // isolar o mecanismo:
  //
  //   1. DUAS perguntas livres em sequência. É a forma do caminho técnico
  //      (identificação -> descrição) e era exatamente onde o bot despejava as
  //      duas de uma vez. Aqui cada uma tem de esperar a sua resposta.
  //
  //   2. A resposta fica GUARDADA sob o nome que o bloco declarou
  //      (`config.variavel`) e pode ser citada adiante com
  //      {{resposta.<nome>}}. O campo `variavel` existia desde o import do
  //      editor de origem e NADA no motor o lia -- viajava do JSON para o banco
  //      e morria ali.
  //
  // A prova é o TEXTO que o cliente recebe: se a captura falhar, a interpolação
  // devolve string vazia e a mensagem sai truncada.
  {
    const passosMin = [
      { id: "g", tipo: "gatilho", titulo: "Início", targetId: "p1", ordem: 0 },
      {
        id: "p1", tipo: "mensagem", titulo: "Nome", texto: "Qual seu nome?",
        config: { aguardar: "texto", variavel: "nome" }, targetId: "p2", ordem: 1,
      },
      {
        id: "p2", tipo: "mensagem", titulo: "Problema",
        texto: "Obrigado, {{resposta.nome}}! Agora descreva o problema.",
        config: { aguardar: "texto", variavel: "problema" }, targetId: "p3", ordem: 2,
      },
      {
        id: "p3", tipo: "mensagem", titulo: "Fim",
        texto: "Recebido: {{resposta.problema}} (de {{resposta.nome}})",
        config: {
          aguardar: "nada",
          opcoes: [{ id: "t", esperaEscolha: false, palavrasChave: [], acao: "transferir", setor: "Técnico" }],
        },
        ordem: 3,
      },
    ];
    const fluxoMin = { id: "f-min", nome: "duas perguntas", gatilho: "*", ativo: true, passos: passosMin };

    const rm = await simulador.simular(fluxoMin, ["oi", "David", "o notebook não liga"], {});
    mostrar("duas perguntas livres seguidas", rm);

    check(
      rm.turnos[0].aguardando === AGUARDANDO.TEXTO && rm.turnos[0].respostas.length === 1,
      `a primeira pergunta deveria parar sozinha: ${rm.turnos[0].respostas.map(linha1).join(" | ")}`
    );
    check(
      rm.turnos[1].aguardando === AGUARDANDO.TEXTO && rm.turnos[1].respostas.length === 1,
      `a segunda pergunta deveria parar sozinha: ${rm.turnos[1].respostas.map(linha1).join(" | ")}`
    );
    // A CAPTURA: o nome informado no turno 1 aparece no texto do turno 2.
    check(
      /Obrigado, David!/.test(rm.turnos[1].respostas.join("\n")),
      `{{resposta.nome}} não foi interpolado: ${rm.turnos[1].respostas.map(linha1).join(" | ")}`
    );
    // E as DUAS respostas sobrevivem até o passo final.
    check(
      /Recebido: o notebook não liga \(de David\)/.test(rm.turnos[2].respostas.join("\n")),
      `as respostas guardadas não chegaram ao passo final: ${rm.turnos[2].respostas.map(linha1).join(" | ")}`
    );
    check(rm.turnos[2].transferido === true, "o passo final deveria entregar para a equipe");
    console.log("  OK    duas perguntas, duas paradas, e as respostas citadas adiante");

    // ── UM BLOCO DE TEXTO LIVRE SEM SAÍDA NÃO DEIXA O CLIENTE NO VÁCUO ──────
    //
    // O cliente acabou de escrever. Calar aqui seria o pior desfecho possível --
    // um atendente resolve. Mesmo tratamento de `ramificacao_sem_destino`.
    const semSaida = {
      ...fluxoMin,
      id: "f-sem-saida",
      passos: [
        { id: "g", tipo: "gatilho", titulo: "Início", targetId: "p1", ordem: 0 },
        {
          id: "p1", tipo: "mensagem", titulo: "Pergunta solta", texto: "Descreva o problema.",
          config: { aguardar: "texto", variavel: "x" }, targetId: null, ordem: 1,
        },
      ],
    };
    const rs = await simulador.simular(semSaida, ["oi", "não liga"], {});
    check(
      rs.turnos[1].transferido === true,
      `bloco de texto livre sem saída deveria entregar para a fila, veio ${JSON.stringify(rs.turnos[1].motivo)}`
    );
    check(
      rs.turnos[1].respostas.length > 0,
      "o cliente escreveu e o bot ficou MUDO: entregou para a fila em silêncio"
    );
    console.log(
      `  OK    texto livre sem saída  ->  entregue à fila com aviso (motivo: ${rs.turnos[1].motivo})`
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n╔══ 12. PAINEL DE AUTOMAÇÕES ═════════════════════════════════");
  // ══════════════════════════════════════════════════════════════════════════
  //
  // O painel do editor e onde o operador LE as regras sem abrir codigo. Se ele
  // nao enxergar a coleta por texto livre e a entrega de cada fila, o fluxo volta
  // a ser uma caixa preta.
  const resumo = resumoAutomacoes(fluxo);
  const grupos = resumo.itens.map((i) => i.grupo);
  console.log("  grupos: " + grupos.join(" | "));
  for (const esperado of [
    // "Identificação por CNPJ" ate o passo passar a aceitar CPF tambem.
    "Identificação por CPF/CNPJ",
    "Triagem por setor",
    "Entrega para a fila",
    "Respostas livres do cliente",
    "Pesquisa de satisfação",
    "Cliente não responde ao bot",
    "Espera na fila de Pendentes",
  ]) {
    check(grupos.includes(esperado), `o painel nao mostra o grupo "${esperado}"`);
  }
  // Os cinco blocos de texto livre nomeados no painel. Conferidos por NOME, e
  // nao por contagem: o grupo tem uma linha de explicacao no topo, e contar
  // linhas faria o teste falhar por causa dela.
  const livres = resumo.itens.find((i) => i.grupo === "Respostas livres do cliente");
  const textoDoPainel = (livres?.regras || []).map((r) => r.rotulo).join(" ");
  for (const titulo of [
    "IDENTIFICAÇÃO",
    "DESCRIÇÃO DA SOLICITAÇÃO",
    "AVULSO — DADOS",
    "COMERCIAL — DADOS",
    "FINANCEIRO — DADOS",
  ]) {
    check(textoDoPainel.includes(titulo), `o painel nao lista "${titulo}" entre as respostas livres`);
  }
  // E nenhum deles pode aparecer com o aviso de "ainda tem opcoes no config" --
  // esse aviso existe para o bloco meio-convertido, e o fluxo nao tem nenhum.
  check(
    !(livres?.regras || []).some((r) => /ATENÇÃO/.test(r.valor)),
    "algum bloco de texto livre ainda carrega opcoes no config"
  );
  // O painel tambem nao pode acusar bloco acima do limite de botoes.
  check(
    !resumo.itens.some((i) => i.grupo === "Limite de botões"),
    "o painel acusou um bloco com mais de 3 opcoes"
  );
  const entregas = resumo.itens.find((i) => i.grupo === "Entrega para a fila");
  check(
    (entregas?.regras?.length || 0) === 3,
    `o painel deveria listar as 3 entregas de fila, listou ${entregas?.regras?.length}`
  );

  console.log(
    "\n" +
      (erros.length
        ? `FALHAS (${erros.length}):\n  - ` + erros.join("\n  - ")
        : "FLUXO ARKA: TODAS AS VERIFICACOES PASSARAM")
  );
  process.exit(erros.length ? 1 : 0);
})().catch((e) => { console.error("ERRO", e); process.exit(1); });
