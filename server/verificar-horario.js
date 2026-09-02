// Verificacao do HORARIO DE ATENDIMENTO -- `node verificar-horario.js`.
//
// O modulo `chatbot.horario.js` e puro: nao ha banco, nao ha WhatsApp e nao ha
// sessao para montar. Isso o torna a parte do bot que da para provar caso a
// caso, e e o que este script faz -- incluindo os casos que motivaram cada
// pedaco da implementacao:
//
//   - a forma ANTIGA da configuracao (uma janela + lista de dias) continua
//     valendo, com a janela que atravessa a meia-noite;
//   - dia ligado/desligado individualmente;
//   - mais de um periodo no mesmo dia (o intervalo de almoco);
//   - fuso proprio (o container roda em UTC);
//   - feriado / horario especial numa data;
//   - typo na configuracao NAO bloqueia o atendimento;
//   - a mensagem usa os horarios da configuracao, nunca texto fixo;
//   - o aviso de fora de horario nao se repete a cada mensagem.
const h = require("./src/modules/chatbot/chatbot.horario");

const erros = [];
const check = (cond, msg) => {
  if (!cond) erros.push(msg);
  console.log(`  ${cond ? "OK   " : "FALHA"} ${msg}`);
};

// Instantes escritos COM O FUSO EXPLICITO (-03:00). Sem isso o resultado
// dependeria do fuso da maquina que roda o teste -- e o teste passaria aqui e
// falharia no container em UTC, que e exatamente a classe de defeito que o fuso
// configuravel existe para fechar.
const em = (iso) => new Date(iso);
const SEG_10H = em("2026-08-17T10:00:00-03:00"); // segunda
const SEG_13H = em("2026-08-17T13:00:00-03:00");
const SEG_20H = em("2026-08-17T20:00:00-03:00");
const SEG_23H30 = em("2026-08-17T23:30:00-03:00");
const TER_03H = em("2026-08-18T03:00:00-03:00");
const TER_12H = em("2026-08-18T12:00:00-03:00");
const SAB_10H = em("2026-08-22T10:00:00-03:00"); // sabado
const DOM_10H = em("2026-08-16T10:00:00-03:00"); // domingo

// ── 1. A CONFIGURACAO ANTIGA CONTINUA VALENDO ────────────────────────────────
//
// E o que esta gravado em `chatbot.horario` de quem ja usa o sistema. Se ela
// parasse de funcionar, o expediente sumiria no deploy sem ninguem mexer em
// nada.
console.log("\n=== forma antiga (uma janela + lista de dias) ===");
const legado = { ativo: true, inicio: "08:00", fim: "18:00", dias: [1, 2, 3, 4, 5] };
check(h.foraDoHorario(legado, SEG_10H) === false, "segunda 10h: dentro");
check(h.foraDoHorario(legado, SEG_20H) === true, "segunda 20h: fora");
check(h.foraDoHorario(legado, SAB_10H) === true, "sabado 10h: fora (dia nao listado)");
check(h.foraDoHorario(legado, DOM_10H) === true, "domingo 10h: fora");
check(
  h.foraDoHorario({ ...legado, ativo: false }, SEG_20H) === false,
  "regra desligada: atende a qualquer hora"
);
const plantao = { ativo: true, inicio: "22:00", fim: "06:00", dias: [1, 2, 3, 4, 5] };
check(h.foraDoHorario(plantao, SEG_23H30) === false, "plantao 22h-06h: 23h30 de segunda dentro");
check(h.foraDoHorario(plantao, TER_03H) === false, "plantao 22h-06h: 3h de terca dentro (virou o dia)");
check(h.foraDoHorario(plantao, TER_12H) === true, "plantao 22h-06h: meio-dia fora");

// ── 2. TYPO NA CONFIGURACAO NAO PODE CALAR O BOT ─────────────────────────────
console.log("\n=== configuracao ilegivel nao bloqueia ===");
check(
  h.foraDoHorario({ ativo: true, inicio: "xx:yy", fim: "18:00", dias: [1] }, SEG_20H) === false,
  "hora ilegivel: atende (nao bloqueia por typo)"
);
check(
  h.foraDoHorario({ ativo: true, inicio: "25:00", fim: "18:00", dias: [1] }, SEG_20H) === false,
  "hora fora da faixa: atende"
);
check(h.foraDoHorario(null, SEG_20H) === false, "configuracao ausente: atende");
check(h.foraDoHorario("texto solto", SEG_20H) === false, "configuracao com tipo errado: atende");
check(
  h.foraDoHorario({ ativo: true, timezone: "Fuso/Que/Nao/Existe", dias: { 1: { ativo: true, periodos: [{ inicio: "08:00", fim: "18:00" }] } } }, SEG_10H) === false,
  "fuso inexistente cai em Brasilia (segue funcionando)"
);
check(
  h.temAlgumPeriodo({ ativo: true, dias: {} }) === false,
  "regra ativa sem periodo nenhum: temAlgumPeriodo = false"
);

// ── 3. FORMA NOVA: dia a dia, com mais de um periodo ─────────────────────────
console.log("\n=== forma nova: por dia, com intervalo de almoco ===");
const comAlmoco = {
  ativo: true,
  timezone: "America/Sao_Paulo",
  dias: {
    0: { ativo: false, periodos: [] },
    1: { ativo: true, periodos: [{ inicio: "08:00", fim: "12:00" }, { inicio: "13:30", fim: "18:00" }] },
    2: { ativo: true, periodos: [{ inicio: "08:00", fim: "18:00" }] },
    3: { ativo: true, periodos: [{ inicio: "08:00", fim: "18:00" }] },
    4: { ativo: true, periodos: [{ inicio: "08:00", fim: "18:00" }] },
    5: { ativo: true, periodos: [{ inicio: "08:00", fim: "18:00" }] },
    6: { ativo: false, periodos: [] },
  },
};
check(h.foraDoHorario(comAlmoco, SEG_10H) === false, "segunda 10h: dentro do primeiro periodo");
check(h.foraDoHorario(comAlmoco, SEG_13H) === true, "segunda 13h: FORA (almoco 12:00-13:30)");
check(h.foraDoHorario(comAlmoco, em("2026-08-17T14:00:00-03:00")) === false, "segunda 14h: dentro do segundo periodo");
check(h.foraDoHorario(comAlmoco, SAB_10H) === true, "sabado: dia desligado");
check(h.temAlgumPeriodo(comAlmoco) === true, "temAlgumPeriodo = true");

// UM DIA LIGADO SEM PERIODO E UM DIA FECHADO, e nao um dia aberto 24h.
check(
  h.foraDoHorario({ ativo: true, dias: { 1: { ativo: true, periodos: [] } } }, SEG_10H) === true,
  "dia marcado como ativo mas sem periodo: fechado"
);

// ── 4. FUSO ──────────────────────────────────────────────────────────────────
//
// O container roda em UTC. As 20:00 de Brasilia sao 23:00 UTC -- com
// `getHours()` o expediente de 08:00-18:00 valia das 05:00 as 15:00 locais.
console.log("\n=== fuso horario ===");
check(
  h.foraDoHorario(comAlmoco, em("2026-08-17T13:00:00Z")) === false,
  "13:00 UTC = 10:00 em Brasilia: dentro"
);
check(
  h.foraDoHorario(comAlmoco, em("2026-08-17T23:00:00Z")) === true,
  "23:00 UTC = 20:00 em Brasilia: fora"
);
// O MESMO instante, com o fuso da configuracao trocado, da outra resposta -- e
// e isso que prova que o campo `timezone` esta sendo usado de verdade.
const emLisboa = { ...comAlmoco, timezone: "Europe/Lisbon" };
check(
  h.foraDoHorario(emLisboa, em("2026-08-17T13:00:00Z")) === false,
  "13:00 UTC = 14:00 em Lisboa: dentro (segundo periodo)"
);
// Lisboa em agosto e UTC+1: 12:20 UTC = 13:20, dentro do almoco (12:00-13:30).
// O MESMO instante em Brasilia (09:20) estaria em expediente -- e a diferenca de
// resposta e a prova de que o campo `timezone` decide.
check(
  h.foraDoHorario(emLisboa, em("2026-08-17T12:20:00Z")) === true,
  "12:20 UTC = 13:20 em Lisboa: cai no almoco, fora"
);
check(
  h.foraDoHorario(comAlmoco, em("2026-08-17T12:20:00Z")) === false,
  "o MESMO instante em Brasilia (09:20): dentro"
);

// ── 5. FERIADOS E EXCECOES ───────────────────────────────────────────────────
console.log("\n=== feriados e horario especial ===");
const comFeriado = {
  ...comAlmoco,
  excecoes: [
    { data: "2026-09-07", fechado: true, descricao: "Independência" },
    { data: "2026-12-24", periodos: [{ inicio: "08:00", fim: "12:00" }], descricao: "Véspera de Natal" },
    { data: "20261225", fechado: true, descricao: "data em formato errado" },
  ],
};
check(
  h.foraDoHorario(comFeriado, em("2026-09-07T10:00:00-03:00")) === true,
  "feriado numa segunda: fora, apesar do dia da semana estar aberto"
);
check(
  h.foraDoHorario(comFeriado, em("2026-12-24T10:00:00-03:00")) === false,
  "vespera com horario especial 08-12: 10h dentro"
);
check(
  h.foraDoHorario(comFeriado, em("2026-12-24T15:00:00-03:00")) === true,
  "vespera com horario especial 08-12: 15h fora"
);
check(
  h.normalizarHorario(comFeriado).excecoes.length === 2,
  "excecao com data em formato invalido e descartada (nao fica invisivel)"
);
// A DATA DA EXCECAO E RESOLVIDA NO FUSO DA CONFIGURACAO.
//
// 01:00 UTC de 25/12 sao 22:00 de 24/12 em Brasilia. Com a data tirada do fuso
// do processo, a excecao consultada seria a de 25/12 -- e o dia 24 perderia o
// horario especial na ultima hora da noite. Aqui: 22:00 esta fora do especial
// 08:00-12:00, entao "fora" e a resposta certa PELO MOTIVO certo.
check(
  h.foraDoHorario(comFeriado, em("2026-12-25T01:00:00Z")) === true,
  "22:00 de 24/12 em Brasilia: fora do horario especial 08-12 daquela data"
);
check(
  h.foraDoHorario(comFeriado, em("2026-12-24T13:00:00Z")) === false,
  "10:00 de 24/12 em Brasilia: dentro do horario especial daquela data"
);

// ── 6. O EXPEDIENTE POR EXTENSO ──────────────────────────────────────────────
console.log("\n=== leitura por extenso (o {{horarios}} da mensagem) ===");
const resumoComercial = h.resumoHorario({
  ativo: true,
  dias: Object.fromEntries(
    [1, 2, 3, 4, 5].map((d) => [d, { ativo: true, periodos: [{ inicio: "08:00", fim: "18:00" }] }])
  ),
});
console.log(`  resumo: ${JSON.stringify(resumoComercial)}`);
check(
  resumoComercial === "Segunda-feira a sexta: 08:00 às 18:00",
  `agrupou os cinco dias iguais numa linha, veio "${resumoComercial}"`
);
const resumoAlmoco = h.resumoHorario(comAlmoco);
console.log(`  resumo com almoco:\n${resumoAlmoco.split("\n").map((l) => "    " + l).join("\n")}`);
check(
  resumoAlmoco.includes("08:00 às 12:00 e 13:30 às 18:00"),
  "os dois periodos do mesmo dia aparecem na mesma linha"
);
check(
  !resumoAlmoco.includes("fechado"),
  "dia fechado nao entra na mensagem do cliente (so em incluirFechados)"
);
check(
  h.resumoHorario(comAlmoco, { incluirFechados: true }).includes("fechado"),
  "incluirFechados mostra o dia fechado (para a tela de configuracao)"
);

// ── 7. A MENSAGEM NAO TEM HORARIO ESCRITO A MAO ──────────────────────────────
console.log("\n=== mensagem de fora do horario ===");
const msgPadrao = h.mensagemFora(comAlmoco);
console.log(msgPadrao.split("\n").map((l) => "    " + l).join("\n"));
check(msgPadrao.includes("08:00 às 12:00"), "a mensagem padrao traz os horarios CONFIGURADOS");
check(msgPadrao.includes("fora do horário"), "a mensagem padrao identifica o motivo");
check(!msgPadrao.includes("{{"), "nenhum placeholder vazou para o cliente");

const msgCustom = h.mensagemFora({
  ...comAlmoco,
  mensagem: "Estamos fechados. Atendemos:\n\n{{horarios}}\n\n{{excecao}}",
});
check(
  msgCustom.startsWith("Estamos fechados.") && msgCustom.includes("13:30 às 18:00"),
  "template proprio tambem recebe os horarios da configuracao"
);
check(!msgCustom.includes("{{"), "placeholder de excecao sem excecao hoje nao vaza");

// O template PADRAO nao pede {{excecao}}: a descricao do feriado e opcional e
// so entra em template que a peca. O padrao continua sendo a tabela de horarios.
const msgFeriadoPadrao = h.mensagemFora(comFeriado, em("2026-09-07T10:00:00-03:00"));
check(
  !msgFeriadoPadrao.includes("Independência") && msgFeriadoPadrao.includes("08:00 às 12:00"),
  "template padrao ignora a descricao da excecao e mostra a tabela"
);
check(
  h.mensagemFora(
    { ...comFeriado, mensagem: "{{excecao}} atendemos {{horarios}}" },
    em("2026-09-07T10:00:00-03:00")
  ).includes("Independência"),
  "template com {{excecao}} recebe a descricao do feriado do dia"
);

// ── 8. O AVISO NAO SE REPETE A CADA MENSAGEM ─────────────────────────────────
//
// O comportamento relatado: "oi" -> aviso, "alguem aí?" -> aviso, "preciso de
// ajuda" -> aviso. Tres bolhas iguais em trinta segundos.
console.log("\n=== nao repetir o aviso ===");
const agora = em("2026-08-17T22:00:00-03:00");
check(h.deveAvisar(comAlmoco, null, agora) === true, "primeira mensagem fora do horario: avisa");
check(
  h.deveAvisar(comAlmoco, em("2026-08-17T21:59:00-03:00"), agora) === false,
  "avisado 1 min atras: NAO repete"
);
check(
  h.deveAvisar(comAlmoco, em("2026-08-17T19:00:00-03:00"), agora) === true,
  "avisado 3h atras (padrao: 2h): avisa de novo"
);
check(
  h.deveAvisar({ ...comAlmoco, reavisarAposMin: 0 }, em("2026-08-17T21:59:00-03:00"), agora) === true,
  "reavisarAposMin: 0 volta a avisar sempre"
);
check(
  h.deveAvisar(comAlmoco, "data-invalida", agora) === true,
  "marca ilegivel na sessao: avisa (nao engole o aviso)"
);

console.log(
  "\n" + (erros.length ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ") : "HORARIO: TODAS AS VERIFICACOES PASSARAM")
);
process.exit(erros.length ? 1 : 0);
