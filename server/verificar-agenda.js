/**
 * AGENDA: RESPONSÁVEL, REMARCAR E A LISTA DE PESSOAS.
 *
 * ── O QUE ESTE ARQUIVO PROTEGE ──────────────────────────────────────────────
 *
 * A Agenda ganhou o modelo de tarefa atribuída, e com ele três regras que, se
 * quebrarem, quebram em silêncio -- a tela continua desenhando, só que errado:
 *
 *   1. RESPONSÁVEL ≠ AUTOR. `usuarioId` guarda quem CRIOU; `responsavelId`,
 *      quem TEM DE FAZER. Quem marca a reunião quase nunca é quem vai nela, e
 *      antes as duas perguntas respondiam com o mesmo dado -- "os meus
 *      compromissos" devolvia a lista errada sem avisar.
 *
 *   2. O NOME DO RESPONSÁVEL É RESOLVIDO NO SERVIDOR. O painel manda só o id.
 *      Se o nome viesse do corpo, a tela poderia gravar um nome que o cadastro
 *      de usuários desmente, e ninguém cruzaria os dois para descobrir.
 *
 *   3. REMARCAR NÃO SOBRESCREVE O RESTO. O arrastar do calendário usa uma rota
 *      estreita; um PUT com o objeto da lista (que pode estar velho) gravaria
 *      de volta um título que outra pessoa acabou de mudar.
 *
 * Roda contra o BANCO, porque as três vivem na gravação.
 *
 *   cd server && node verificar-agenda.js
 */
const path = require("path");

const prisma = require(path.join(__dirname, "src/infrastructure/database/prisma.client"));
const service = require(path.join(__dirname, "src/modules/agenda/agenda.service"));
const { criarCompromissoSchema, remarcarSchema, CORES } = require(path.join(__dirname, "src/modules/agenda/agenda.dto"));

const erros = [];
function check(ok, nome) {
  console.log(`  ${ok ? "OK   " : "FALHA"} ${nome}`);
  if (!ok) erros.push(nome);
}
const titulo = (t) => console.log("\n=== " + t + " ===\n");

const MARCA = "teste-agenda";

async function limpar() {
  await prisma.compromisso.deleteMany({ where: { titulo: { startsWith: MARCA } } });
  await prisma.usuario.deleteMany({ where: { nome: { startsWith: MARCA } } });
}

async function main() {
  await limpar();

  const criarUsuario = (nome, ativo = true) =>
    prisma.usuario.create({
      data: {
        nome: `${MARCA} ${nome}`,
        email: `${MARCA}.${nome}.${Date.now()}${Math.random().toString(36).slice(2, 6)}@teste.local`,
        senhaHash: "x",
        cargo: "Técnico",
        ativo,
      },
    });

  const ana = await criarUsuario("Ana");
  const bruno = await criarUsuario("Bruno");
  const desligado = await criarUsuario("Desligado", false);

  const base = {
    titulo: `${MARCA} reuniao`,
    data: "2026-10-05",
    hora: "14:00",
    tipo: "reuniao",
    prioridade: "alta",
    descricao: "combinado original",
    contato: "Cliente X",
    concluido: false,
  };

  titulo("1. QUEM CRIOU E QUEM TEM DE FAZER SAO PESSOAS DIFERENTES");

  // A Ana cria, mas quem vai a reuniao e o Bruno.
  const comp = await service.criar({ ...base, responsavelId: bruno.id }, { sub: ana.id, nome: ana.nome });

  check(comp.responsavelNome === bruno.nome, `o responsavel e o Bruno (${comp.responsavelNome})`);
  check(comp.usuarioNome === ana.nome, `e quem criou continua sendo a Ana (${comp.usuarioNome})`);
  check(comp.responsavelId === bruno.id, "o id do responsavel vai para a tela (e por ele que ela filtra)");

  titulo("2. O NOME DO RESPONSAVEL SAI DO CADASTRO, NAO DO CORPO");

  // O DTO e a allowlist: um `responsavelNome` enviado pelo painel nem chega ao
  // service. Se chegasse, a tela poderia escrever "Diretoria" no lugar de um
  // nome real -- e o banco de usuarios nunca seria consultado para desmentir.
  const comCampoProibido = criarCompromissoSchema.parse({
    ...base,
    responsavelId: bruno.id,
    responsavelNome: "Nome Inventado",
  });
  check(
    !("responsavelNome" in comCampoProibido),
    "o DTO descarta `responsavelNome` vindo do painel"
  );

  const forjado = await service.criar(
    { ...base, responsavelId: bruno.id, responsavelNome: "Nome Inventado" },
    { sub: ana.id, nome: ana.nome }
  );
  check(
    forjado.responsavelNome === bruno.nome,
    `e mesmo se passar direto, vence o cadastro (${forjado.responsavelNome})`
  );

  titulo("3. RESPONSAVEL INEXISTENTE E RECUSADO, NAO GRAVADO");

  // Gravar um id que nao existe deixaria a tela com um ponteiro para lugar
  // nenhum: nome vazio, filtro que nunca casa, e nada indicando o defeito.
  let recusou = false;
  try {
    await service.criar(
      { ...base, responsavelId: "00000000-0000-4000-8000-000000000000" },
      { sub: ana.id, nome: ana.nome }
    );
  } catch (e) {
    recusou = e.codigo === "RESPONSAVEL_INVALIDO" || e.code === "RESPONSAVEL_INVALIDO";
  }
  check(recusou, "id que nao existe na equipe e recusado com 400");

  titulo("4. SEM RESPONSAVEL E UM ESTADO LEGITIMO");

  // Lembrete do time inteiro nao tem dono, e isso e diferente de "esqueceram
  // de preencher": a tela escreve "do time" em vez de um traco mudo.
  const semDono = await service.atualizar(comp.id, { ...base, responsavelId: null });
  check(
    semDono.responsavelId === null && semDono.responsavelNome === null,
    "null limpa os dois campos"
  );

  // E NAO mexer no campo e diferente de limpa-lo: um update que nem menciona o
  // responsavel tem de deixar quem estava.
  await service.atualizar(comp.id, { ...base, responsavelId: ana.id });
  const semMencionar = await service.atualizar(comp.id, { ...base });
  check(
    semMencionar.responsavelNome === ana.nome,
    `update sem o campo preserva o responsavel (${semMencionar.responsavelNome})`
  );

  titulo("5. REMARCAR MUDA A DATA, E SO ELA");

  // O cenario do arraste: a tela tem em maos um objeto VELHO (alguem editou o
  // titulo enquanto ela estava aberta). Um PUT gravaria o titulo velho de
  // volta; a rota estreita nao tem como.
  await prisma.compromisso.update({
    where: { id: comp.id },
    data: { titulo: `${MARCA} titulo NOVO de outra pessoa` },
  });

  const remarcado = await service.remarcar(comp.id, { data: "2026-10-09" });
  check(remarcado.data === "2026-10-09", `a data mudou (${remarcado.data})`);
  check(remarcado.hora === "14:00", `a hora foi preservada (${remarcado.hora})`);
  check(
    remarcado.titulo.includes("NOVO de outra pessoa"),
    "e o titulo que a outra pessoa gravou continua la"
  );
  check(remarcado.descricao === "combinado original", "a descricao tambem");

  // A allowlist da rota: mandar outros campos nao os faz passar.
  const soDataEHora = remarcarSchema.parse({
    data: "2026-10-10",
    hora: "08:30",
    titulo: "tentativa de sobrescrever",
    concluido: true,
  });
  check(
    !("titulo" in soDataEHora) && !("concluido" in soDataEHora),
    "o schema de remarcar descarta qualquer outro campo"
  );

  titulo("6. A QUEM DA PARA ATRIBUIR");

  const pessoas = await service.pessoasAtribuiveis();
  const nomes = pessoas.map((p) => p.nome);
  check(nomes.includes(ana.nome) && nomes.includes(bruno.nome), "os ativos aparecem");
  check(
    !nomes.includes(desligado.nome),
    "quem esta inativo NAO aparece -- nao se atribui trabalho a quem nao entra mais"
  );

  // Menos e mais: esta rota vive sob o modulo "agenda", e quem a tem quase
  // nunca tem o modulo "equipe". Entregar e-mail e cargo aqui ampliaria o que
  // vaza se ela um dia escapar -- e nada disso e preciso para escolher um nome.
  const campos = Object.keys(pessoas[0] || {});
  check(
    campos.length === 2 && campos.includes("id") && campos.includes("nome"),
    `devolve so id e nome (veio: ${campos.join(", ")})`
  );

  titulo("6b. A COR ESCOLHIDA A MAO E UM CONJUNTO FECHADO");

  // Hex livre vindo do painel entregaria cor ilegivel (texto escuro sobre fundo
  // escuro), cor que so funciona num dos dois temas, e texto livre num campo
  // onde ninguem espera texto livre. A lista fechada e o que impede os tres.
  const comCor = await service.criar({ ...base, cor: "roxo" }, { sub: ana.id, nome: ana.nome });
  check(comCor.cor === "roxo", `a cor escolhida e gravada pelo NOME (${comCor.cor})`);

  const semCor = await service.atualizar(comCor.id, { ...base, cor: null });
  check(semCor.cor === null, "null volta para a cor automatica");

  // O DTO barra na borda...
  let barrouNaBorda = false;
  try {
    criarCompromissoSchema.parse({ ...base, cor: "#ff0000" });
  } catch {
    barrouNaBorda = true;
  }
  check(barrouNaBorda, "o DTO recusa hex cru (#ff0000)");

  // ...e o servico reconfere, porque nem toda chamada vem por HTTP (script de
  // manutencao, importacao, um caminho novo ligado direto no service).
  const forcado = await service.atualizar(comCor.id, { ...base, cor: "#ff0000" });
  check(forcado.cor === null, "e o service reconfere: cor fora da lista vira automatica");

  const naoMexeu = await service.atualizar(comCor.id, { ...base });
  check(naoMexeu.cor === null, "update sem o campo nao mexe na cor");

  // Guardar o NOME, e nao o hex, e o que deixa a paleta ser retocada depois sem
  // deixar cor velha presa no banco.
  const fs2 = require("fs");
  const tela2 = fs2.readFileSync(path.join(__dirname, "../client/src/components/pages/Agenda.jsx"), "utf8");
  check(
    /const PALETA = \{[\s\S]*?azul:\s*\{ hex:/.test(tela2),
    "quem traduz nome em cor e a TELA (PALETA), que conhece o tema"
  );
  for (const nome of CORES) {
    if (!new RegExp(`\\b${nome}:\\s*\\{ hex:`).test(tela2)) {
      check(false, `a cor "${nome}" existe no servidor mas nao na paleta da tela`);
    }
  }
  check(true, `as ${CORES.length} cores do servidor existem na paleta da tela`);

  await service.remover(comCor.id);

  titulo("6c. O COMPROMISSO QUE ATRAVESSA DIAS");

  const longo = await service.criar(
    { ...base, data: "2026-11-10", dataFim: "2026-11-13" },
    { sub: ana.id, nome: ana.nome }
  );
  check(longo.dataFim === "2026-11-13", `o fim e gravado (${longo.dataFim})`);

  // "Nulo = de um dia so" e o invariante. Guardar fim IGUAL ao inicio criaria
  // duas formas de dizer a mesma coisa, e toda leitura teria de comparar os
  // dois campos antes de saber se o compromisso e longo.
  const umDia = await service.atualizar(longo.id, { ...base, data: "2026-11-10", dataFim: "2026-11-10" });
  check(umDia.dataFim === null, "fim igual ao inicio vira null (de um dia so)");

  // ARRASTAR UM LONGO MOVE A BARRA INTEIRA.
  //
  // Uma migracao de 10 a 13 arrastada para o dia 20 vira 20 a 23. Quem arrasta
  // esta dizendo "isto acontece mais tarde", nao "isto agora dura menos" -- e a
  // duracao e o dado que ninguem espera perder num gesto de mover.
  await service.atualizar(longo.id, { ...base, data: "2026-11-10", dataFim: "2026-11-13" });
  const movido = await service.remarcar(longo.id, { data: "2026-11-20" });
  check(movido.data === "2026-11-20", `arrastado para 20 (${movido.data})`);
  check(movido.dataFim === "2026-11-23", `e o fim andou junto, preservando 4 dias (${movido.dataFim})`);

  // ESTICAR muda SO o fim: o inicio fica onde esta.
  const esticado = await service.esticar(longo.id, { dataFim: "2026-11-27" });
  check(esticado.data === "2026-11-20", `esticar nao mexe no inicio (${esticado.data})`);
  check(esticado.dataFim === "2026-11-27", `e leva o fim para onde soltou (${esticado.dataFim})`);

  const encurtado = await service.esticar(longo.id, { dataFim: "2026-11-20" });
  check(encurtado.dataFim === null, "esticar de volta ao dia de inicio devolve um compromisso de um dia");

  // Fim antes do inicio: barrado na borda E no service.
  let bordaBarrou = false;
  try {
    criarCompromissoSchema.parse({ ...base, data: "2026-11-10", dataFim: "2026-11-01" });
  } catch {
    bordaBarrou = true;
  }
  check(bordaBarrou, "o DTO recusa fim antes do inicio");

  let serviceBarrou = false;
  try {
    await service.criar({ ...base, data: "2026-11-10", dataFim: "2026-11-01" }, { sub: ana.id, nome: ana.nome });
  } catch (e) {
    serviceBarrou = (e.codigo || e.code) === "DATA_FIM_INVALIDA";
  }
  check(serviceBarrou, "e o service reconfere -- senao o item nao desenharia barra e sumiria da tela");

  await service.remover(longo.id);

  titulo("7. A TELA ESTA LIGADA NO CAMINHO CERTO");

  const fs = require("fs");
  const tela = fs.readFileSync(path.join(__dirname, "../client/src/components/pages/Agenda.jsx"), "utf8");
  const api = fs.readFileSync(path.join(__dirname, "../client/src/services/api.js"), "utf8");

  check(/AgendaAPI\.remarcar\(/.test(tela), "o arrastar chama `remarcar`, e nao `atualizar`");
  check(
    /remarcar:\s*\(id, data, hora\)[^\n]*\/agenda\/\$\{id\}\/data/.test(api),
    "e `remarcar` aponta para PATCH /agenda/:id/data"
  );
  check(/AgendaAPI\.pessoas\(\)/.test(tela), "o seletor de responsavel usa a rota da agenda");
  check(
    !/EquipeAPI/.test(tela),
    "e NAO a rota de equipe, que exige um modulo que quem tem agenda nao tem"
  );
  check(
    /responsavelId:\s*responsavelId \|\| null/.test(tela),
    "o painel manda `null` (e nao string vazia) quando nao ha responsavel"
  );
  // ── O CONTRATO DO ARRASTE, CONFERIDO ──────────────────────────────────────
  //
  // Isto existe por causa de um defeito real: quando as barras de varios dias
  // entraram, o drop passou a esperar `{ comp, modo }` e a chamada da PILULA
  // ficou para tras mandando so o `comp`. `alvo.comp` virava undefined, o drop
  // estourava em silencio, e arrastar parou de funcionar sem nada aparecer na
  // tela -- o tipo de quebra que so o uso descobre.
  //
  // Todo `onArrastar(` tem de mandar o objeto com `comp` e `modo`. Se alguem
  // acrescentar um terceiro lugar que arrasta e esquecer, o teste diz.
  const chamadas = tela.match(/onArrastar\(([^)]*)\)/g) || [];
  const forasDoContrato = chamadas.filter((c) => !/\{\s*comp\s*,\s*modo:/.test(c));
  check(
    chamadas.length >= 3 && forasDoContrato.length === 0,
    `todo arraste manda { comp, modo } (${chamadas.length} chamadas${forasDoContrato.length ? ", fora: " + forasDoContrato.join(" ") : ""})`
  );
  check(
    /if \(alvo\.modo === ['"]esticar['"]\)/.test(tela),
    "e o drop decide pelo `modo` -- mover ou esticar"
  );

  check(/AgendaAPI\.esticar\(/.test(tela), "a alcinha da barra chama `esticar`");
  check(
    /esticar:\s*\(id, dataFim\)[^\n]*\/agenda\/\$\{id\}\/fim/.test(api),
    "e `esticar` aponta para PATCH /agenda/:id/fim"
  );
  // A cor escolhida a mao vence o criterio -- foi o pedido depois de a primeira
  // versao fazer dela um criterio a mais, e o bloco nao mudar ao escolher cor.
  check(
    /function corDoCompromisso[\s\S]{0,220}if \(comp\.cor && PALETA\[comp\.cor\]\) return/.test(tela),
    "a cor escolhida a mao vence o criterio do calendario"
  );

  titulo("limpeza");
  await limpar();
  const sobrou =
    (await prisma.compromisso.count({ where: { titulo: { startsWith: MARCA } } })) +
    (await prisma.usuario.count({ where: { nome: { startsWith: MARCA } } }));
  check(sobrou === 0, `limpeza completa (sobraram ${sobrou})`);
}

main()
  .catch((e) => {
    erros.push(`excecao: ${e.message}`);
    console.error(e);
  })
  .finally(async () => {
    await limpar().catch(() => {});
    await prisma.$disconnect().catch(() => {});
    console.log(
      "\n" +
        (erros.length
          ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ")
          : "AGENDA: TUDO CONFERE")
    );
    process.exit(erros.length ? 1 : 0);
  });
