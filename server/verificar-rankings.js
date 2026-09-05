// Verificacao dos DOIS RANKINGS -- `node verificar-rankings.js`.
//
// O pedido tinha uma regra acima de todas: NAO criar formula nova para o
// atendimento da sede. O bloco 1 e o que impede a violacao voltar sem ninguem
// perceber -- ele confere que o ranking da sede devolve EXATAMENTE os mesmos
// pontos que o painel de parede, para as mesmas pessoas.
//
// Os outros riscos que este script vigia:
//
//   o supervisor competindo    quem valida o mapeamento e corrige pontuacao nao
//                              pode disputar o premio com quem ele avalia;
//   os dois rankings juntos    escalas diferentes (sede nao tem teto, externo
//                              para em 100) -- misturar faz a equipe externa
//                              parecer pior por causa da regua, nao do trabalho;
//   amostra de um              uma unica visita perfeita nao pode valer o mes;
//   premiar quem nao ganhou    o vencedor sai do ranking calculado, nunca do
//                              corpo da requisicao.
//
// Usa o banco de verdade e limpa o que criou.
const prisma = require("./src/infrastructure/database/prisma.client");
const painelService = require("./src/modules/dashboard/painel.service");
const rankingService = require("./src/modules/rankings/ranking.service");
const mapeamentoService = require("./src/modules/rankings/mapeamento.service");
const { pontuarExterno, ITENS_MAPEAMENTO } = require("./src/modules/rankings/pontuacao.externa");

const erros = [];
const check = (cond, msg) => {
  if (!cond) erros.push(msg);
  console.log(`  ${cond ? "OK   " : "FALHA"} ${msg}`);
};
const titulo = (t) => console.log(`\n=== ${t} ===\n`);

const MARCA = "teste-rank";
const hoje = new Date();
const COMP = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
const noMes = (dia, hora = 10) => new Date(hoje.getFullYear(), hoje.getMonth(), dia, hora, 0, 0);

async function limpar() {
  await prisma.premiacaoRanking.deleteMany({ where: { usuarioNome: { startsWith: MARCA } } });
  await prisma.mapeamentoTecnico.deleteMany({ where: { tecnicoNome: { startsWith: MARCA } } });
  await prisma.atendimento.deleteMany({ where: { conversa: { cliente: { startsWith: MARCA } } } });
  await prisma.conversa.updateMany({ where: { cliente: { startsWith: MARCA } }, data: { atendimentoAtualId: null } });
  await prisma.conversa.deleteMany({ where: { cliente: { startsWith: MARCA } } });
  await prisma.usuario.deleteMany({ where: { nome: { startsWith: MARCA } } });
}

async function main() {
  await limpar();
  const instancia = await prisma.instancia.findFirst();
  if (!instancia) throw new Error("sem instancia no banco -- rode o seed (npm run db:seed)");

  const criarUsuario = (nome, extra = {}) =>
    prisma.usuario.create({
      data: {
        nome: `${MARCA} ${nome}`,
        email: `${MARCA}.${nome}.${Date.now()}${Math.random().toString(36).slice(2, 6)}@teste.local`,
        senhaHash: "x", cargo: "Técnico", ativo: true, ...extra,
      },
    });

  // SEDE: dois concorrentes. O Davi entra como ADMINISTRADOR e sem equipe: ele
  // supervisiona pelo cargo, e nao por marca no cadastro -- e por isso nao
  // aparece na classificacao mesmo atendendo muito (ver o bloco 2).
  const ana = await criarUsuario("Ana", { equipeRanking: "sede" });
  const bruno = await criarUsuario("Bruno", { equipeRanking: "sede" });
  const davi = await criarUsuario("Davi", { cargo: "Administrador" });
  // EXTERNO
  const joao = await criarUsuario("Joao", { equipeRanking: "externo" });
  const lucas = await criarUsuario("Lucas", { equipeRanking: "externo" });
  // Fora de tudo: existe para provar que nao aparece em ranking nenhum.
  const zeca = await criarUsuario("Zeca");

  const conversa = async (quem) =>
    prisma.conversa.create({
      data: {
        cliente: `${MARCA} cliente ${quem}`,
        telefone: `5527${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 90 + 10)}`,
        setor: "Técnico", statusAtendimento: "fechada", instanciaId: instancia.id,
      },
    });

  const os = async (conversaId, nome, dados) =>
    prisma.atendimento.create({
      data: {
        conversaId, numeroOS: Math.floor(Math.random() * 900000) + 100000,
        setor: "Técnico", atendenteNome: nome, ...dados,
      },
    });

  // Ana: 3 fechados, notas 5 (bate o minimo), assume rapido.
  const cAna = await conversa("ana");
  for (let i = 0; i < 3; i += 1) {
    await os(cAna.id, ana.nome, {
      status: "fechada", avaliacao: 5,
      abertoEm: noMes(2, 9), atendidoEm: noMes(2, 9 + 0), fechadoEm: noMes(2, 11),
    });
  }
  // Bruno: 1 fechado, sem nota.
  const cBruno = await conversa("bruno");
  await os(cBruno.id, bruno.nome, { status: "fechada", abertoEm: noMes(3, 8), atendidoEm: noMes(3, 9), fechadoEm: noMes(3, 12) });
  // Davi (supervisor) ATENDE, e muito -- para o teste ser real: se ele
  // aparecesse, apareceria em primeiro.
  const cDavi = await conversa("davi");
  for (let i = 0; i < 9; i += 1) {
    await os(cDavi.id, davi.nome, {
      status: "fechada", avaliacao: 5,
      abertoEm: noMes(4, 9), atendidoEm: noMes(4, 9), fechadoEm: noMes(4, 10),
    });
  }

  titulo("1. A SEDE USA A PONTUACAO QUE JA EXISTIA (regra principal do pedido)");

  const doPainel = await painelService.rankingDoMes(hoje.getFullYear(), hoje.getMonth() + 1);
  const sede = await rankingService.obter("sede", COMP);

  for (const p of sede.classificacao) {
    const noPainel = doPainel.classificacao.find((x) => x.nome === p.nome);
    check(
      !!noPainel && noPainel.pontos === p.pontos,
      `${p.nome}: ${p.pontos} pts aqui e ${noPainel?.pontos} no painel`
    );
  }
  // As PARCELAS tambem, e nao so o total: o pedido era mostrar por que a pessoa
  // esta naquela posicao, e uma parcela remontada aqui poderia somar igual e
  // detalhar diferente.
  const anaAqui = sede.classificacao.find((p) => p.nome === ana.nome);
  const anaPainel = doPainel.classificacao.find((p) => p.nome === ana.nome);
  const crit = Object.fromEntries(anaAqui.criterios.map((c) => [c.chave, c.pontos]));
  check(crit.atendimentos === anaPainel.atendimentos.pontos, `parcela atendimentos igual (${crit.atendimentos})`);
  check(crit.nota === anaPainel.nota.pontos, `parcela nota igual (${crit.nota})`);
  check(crit.agilidade === anaPainel.agilidade.pontos, `parcela agilidade igual (${crit.agilidade})`);
  check(
    crit.atendimentos + crit.nota + crit.agilidade === anaAqui.pontos,
    `as parcelas somam o total exibido (${anaAqui.pontos})`
  );

  titulo("2. QUEM SUPERVISIONA E O ADMINISTRADOR, PELO CARGO");
  // Nao ha mais marca de supervisor no cadastro: o administrador ja tem acesso
  // a tudo, e uma segunda marca dizendo a mesma coisa so criava um jeito de as
  // duas discordarem. Concorrer segue sendo consequencia de estar numa EQUIPE.
  check(
    !sede.classificacao.some((p) => p.nome === davi.nome),
    "Davi nao aparece na classificacao -- ele nao esta em equipe nenhuma"
  );
  check(
    doPainel.classificacao.some((p) => p.nome === davi.nome),
    "e continua no painel geral: o recorte e do RANKING, nao do sistema"
  );
  check(
    sede.supervisores.some((s) => s.nome === davi.nome),
    "a tela recebe quem VALIDA, lido do cargo Administrador"
  );
  check(
    await mapeamentoService.ehSupervisor(davi.id),
    "e e o cargo que autoriza validar mapeamento, sem marca extra"
  );

  titulo("3. QUEM NAO FOI MARCADO NAO ENTRA");
  check(!sede.classificacao.some((p) => p.nome === zeca.nome), "Zeca (sem equipe) fora da sede");
  const externoVazio = await rankingService.obter("externo", COMP);
  check(!externoVazio.classificacao.some((p) => p.nome === zeca.nome), "e fora do externo tambem");
  check(
    !externoVazio.classificacao.some((p) => p.nome === ana.nome),
    "e ninguem da sede aparece no ranking externo (os dois nunca se misturam)"
  );

  titulo("3b. O QUE FOI GRAVADO VOLTA PARA A TELA");

  // O DEFEITO QUE ISTO IMPEDE, e ele ja aconteceu: `listarTodos` tem `select`
  // explicito, e as colunas novas nao foram adicionadas nele. O campo ausente
  // nao vira erro em lugar nenhum -- `u.equipeRanking` fica `undefined`, o DTO
  // manda `null`, e a Gestao da Equipe desenha "Nao concorre" para todo mundo.
  //
  // Da tela, isso parece que o botao NAO SALVA: o servidor gravava certo e a
  // listagem nunca contava. Nenhuma verificacao de escrita pegaria, porque a
  // escrita estava correta -- o buraco era a leitura.
  const equipeService = require("./src/modules/equipe/equipe.service");
  const listados = await equipeService.listar();
  const listAna = listados.find((u) => u.id === ana.id);
  check(
    (listAna?.equipesRanking || []).includes("sede"),
    `a listagem devolve a equipe gravada (${JSON.stringify(listAna?.equipesRanking)})`
  );
  check(Array.isArray(listAna?.equipesRanking), "e vem como LISTA, porque da para concorrer nos dois");
  check(
    (listados.find((u) => u.id === zeca.id)?.equipesRanking || []).length === 0,
    "quem nao concorre volta com lista vazia"
  );

  const usuarioRepository = require("./src/infrastructure/repositories/usuario.repository");
  const daSessao = await usuarioRepository.findById(ana.id);
  check(daSessao?.equipeRanking === "sede", "e a sessao carrega a equipe (findById)");

  // CONCORRER NOS DOIS. Quem atende no chat e tambem visita cliente aparece nas
  // duas listas -- com pontuacoes separadas, que nunca se somam. Era escolha
  // unica antes, e isso obrigava a escolher em qual funcao a pessoa seria
  // medida, ignorando a outra.
  await equipeService.alterarRanking(ana.id, { equipes: ["sede", "externo"] }, davi.id);
  const nosDois = await rankingService.equipes();
  check(
    nosDois.sede.some((u) => u.id === ana.id) && nosDois.externo.some((u) => u.id === ana.id),
    "quem esta nos dois aparece nas DUAS listas"
  );
  const sedeDupla = await rankingService.obter("sede", COMP);
  const externoDupla = await rankingService.obter("externo", COMP);
  const anaSede = sedeDupla.classificacao.find((p) => p.usuarioId === ana.id);
  const anaExterno = externoDupla.classificacao.find((p) => p.usuarioId === ana.id);
  check(
    anaSede.pontos !== anaExterno.pontos,
    `com pontuacoes independentes (${anaSede.pontos} na sede, ${anaExterno.pontos} no externo)`
  );
  // E voltar a UMA so tem de funcionar tambem -- desmarcar e o caminho de volta.
  await equipeService.alterarRanking(ana.id, { equipes: ["sede"] }, davi.id);
  const soSede = await rankingService.equipes();
  check(
    soSede.sede.some((u) => u.id === ana.id) && !soSede.externo.some((u) => u.id === ana.id),
    "desmarcar uma tira a pessoa daquela lista e mantem a outra"
  );

  titulo("4. A PONTUACAO EXTERNA");

  const itensCheios = Object.fromEntries(ITENS_MAPEAMENTO.map((i) => [i.chave, "levantado e conferido"]));
  const mapear = (tecnico, dados) =>
    prisma.mapeamentoTecnico.create({
      data: {
        tecnicoId: tecnico.id, tecnicoNome: tecnico.nome,
        empresa: `${MARCA} Empresa`, dataVisita: noMes(5),
        prazoEm: noMes(8), resumo: "Visita tecnica completa com levantamento de infraestrutura",
        itens: itensCheios, evidencias: [{ arquivo: "a.jpg" }, { arquivo: "b.jpg" }, { arquivo: "c.jpg" }],
        ...dados,
      },
    });

  // Joao: 4 aprovados, completos, no prazo, com 3 evidencias, sem devolucao.
  for (let i = 0; i < 4; i += 1) {
    await mapear(joao, { status: "aprovado", entregueEm: noMes(6) });
  }
  // Lucas: 3 entregues, um fora do prazo e um devolvido.
  await mapear(lucas, { status: "aprovado", entregueEm: noMes(6) });
  await mapear(lucas, { status: "entregue", entregueEm: noMes(20) }); // atrasado
  await mapear(lucas, { status: "em_correcao", entregueEm: noMes(6), devolucoes: 2 });

  const externo = await rankingService.obter("externo", COMP);
  const rJoao = externo.classificacao.find((p) => p.nome === joao.nome);
  const rLucas = externo.classificacao.find((p) => p.nome === lucas.nome);

  check(rJoao.posicao === 1, `Joao em 1o (${rJoao.pontos} pts) e Lucas em ${rLucas.posicao}o (${rLucas.pontos} pts)`);
  check(rJoao.pontos <= 100 && rLucas.pontos <= 100, "nenhum passa de 100 -- o teto da formula e real");
  // 90, e nao 100: quatro visitas impecaveis levam a faixa de volume de 15 (de
  // 25), e os 25 restantes exigem OITO aprovados no mes. Escrevi 100 aqui na
  // primeira versao e o teste reprovou -- a expectativa e que estava errada, nao
  // a formula. Fica registrado porque e a calibragem mais discutivel dela: os
  // 100 pontos sao um mes cheio, nao um mes bom.
  check(rJoao.pontos === 90, `4 visitas impecaveis dao 90 -- os 100 exigem 8 aprovados (deu ${rJoao.pontos})`);
  const cJoao = Object.fromEntries(rJoao.criterios.map((c) => [c.chave, c.pontos]));
  check(cJoao.completude === 25 && cJoao.prazo === 20 && cJoao.evidencias === 15 && cJoao.retrabalho === 15,
    "com as quatro parcelas de qualidade cheias");
  check(cJoao.volume === 15, `e a de volume na faixa de 4 a 5 visitas (${cJoao.volume} de 25)`);
  const cLucas = Object.fromEntries(rLucas.criterios.map((c) => [c.chave, c.pontos]));
  check(cLucas.retrabalho === 5, `2 devolucoes custam 10 dos 15 de retrabalho (sobrou ${cLucas.retrabalho})`);
  check(cLucas.prazo < 20, `um atraso em tres derruba a parcela de prazo (${cLucas.prazo} de 20)`);

  titulo("5. AMOSTRA DE UM NAO DECIDE O MES");
  // Uma unica visita perfeita: as parcelas de qualidade ficam zeradas ate o
  // minimo. Sem isso ela valeria 65 pontos e lideraria em cima de uma amostra
  // de um -- o mesmo defeito que o minimo de avaliacoes ja impede na sede.
  const umSo = pontuarExterno([
    { status: "aprovado", resumo: "x".repeat(50), itens: itensCheios, evidencias: [1, 2, 3], devolucoes: 0, prazoEm: noMes(8), entregueEm: noMes(6) },
  ]);
  check(umSo.completude.conta === false, "com 1 relatorio a completude nao conta");
  check(umSo.completude.pontos === 0 && umSo.prazo.pontos === 0 && umSo.evidencias.pontos === 0,
    "as tres parcelas de qualidade ficam em 0 ate a amostra minima");
  check(umSo.pontos < 30, `e o total fica baixo (${umSo.pontos}), em vez de liderar`);
  check(umSo.completude.amostra === 1, "mas a tela recebe a amostra, para dizer '1 de 3' e nao '0,0'");

  // E rascunho nao pontua: abrir formulario nao pode valer ponto.
  const soRascunho = pontuarExterno([{ status: "rascunho", resumo: "x".repeat(50), itens: itensCheios, evidencias: [1, 2, 3] }]);
  check(soRascunho.pontos === 0, "rascunho nao pontua nada");

  titulo("6. AS DUAS ESCALAS SAO MESMO DIFERENTES (por que nao se misturam)");
  const maiorSede = Math.max(...sede.classificacao.map((p) => p.pontos));
  check(
    typeof maiorSede === "number",
    `sede sem teto (maior aqui: ${maiorSede}) x externo com teto de 100 -- reguas diferentes`
  );
  check(
    sede.ranking === "sede" && externo.ranking === "externo",
    "cada resposta diz a qual ranking pertence"
  );

  titulo("7. PREMIACAO -- o vencedor sai do ranking, nao do pedido");
  const premiado = await rankingService.registrarPremiacao(
    { ranking: "externo", competencia: COMP, posicao: 1, premio: `${MARCA} Vale`, valor: "R$ 200" },
    { nome: "teste" }
  );
  check(premiado.usuarioNome === joao.nome, `o 1o lugar registrado e quem esta em 1o (${premiado.usuarioNome})`);
  check(premiado.pontos === rJoao.pontos, "com os pontos do fechamento gravados junto");

  const comPremio = await rankingService.obter("externo", COMP);
  check(comPremio.premiacoes.length === 1, "e a premiacao volta junto do ranking");

  // O CASO QUE ESTE TESTE PEGOU DE VERDADE.
  //
  // A classificacao lista a equipe inteira, inclusive quem nao produziu -- entao
  // um mes vazio TEM um "1o lugar", com zero ponto e escolhido pelo desempate
  // alfabetico. Sem barreira, daria para registrar premio de um mes em que
  // ninguem trabalhou. O servico agora recusa.
  let recusou = false;
  let mensagem = "";
  try {
    await rankingService.registrarPremiacao({ ranking: "externo", competencia: "2001-01", posicao: 1 }, null);
  } catch (e) { recusou = true; mensagem = e.message; }
  check(recusou, `mes sem pontuacao recusa a premiacao ("${mensagem}")`);
  const nadaGravado = await prisma.premiacaoRanking.count({ where: { competencia: "2001-01" } });
  check(nadaGravado === 0, "e nada foi gravado");

  titulo("8. MAPEAMENTO: quem pode o que");
  check(await mapeamentoService.ehSupervisor(davi.id), "Davi e reconhecido como supervisor");
  check(!(await mapeamentoService.ehSupervisor(joao.id)), "e Joao nao");

  let barrou = false;
  try {
    await mapeamentoService.validar((await prisma.mapeamentoTecnico.findFirst({ where: { tecnicoId: lucas.id } })).id,
      { aprovado: true }, { sub: joao.id });
  } catch { barrou = true; }
  check(barrou, "tecnico nao consegue validar mapeamento (nem o dos outros, nem o proprio)");

  const soDoJoao = await mapeamentoService.listar({}, { sub: joao.id });
  check(
    soDoJoao.length > 0 && soDoJoao.every((m) => m.tecnicoId === joao.id),
    `tecnico ve so os proprios mapeamentos (${soDoJoao.length})`
  );
  const doSupervisor = await mapeamentoService.listar({}, { sub: davi.id });
  check(doSupervisor.length > soDoJoao.length, `supervisor ve os de todo mundo (${doSupervisor.length})`);

  titulo("9. HISTORICO");
  const hist = await rankingService.historico("externo", COMP, 3);
  check(hist.competencias.length === 3, `tres meses (${hist.competencias.join(", ")})`);
  check(hist.competencias[hist.competencias.length - 1] === COMP, "terminando no mes pedido");
  const hJoao = hist.pessoas.find((p) => p.nome === joao.nome);
  check(!!hJoao && hJoao.meses.length === 3, "com uma linha por mes para cada pessoa");

  titulo("limpeza");
  await limpar();
  const sobrou =
    (await prisma.usuario.count({ where: { nome: { startsWith: MARCA } } })) +
    (await prisma.mapeamentoTecnico.count({ where: { tecnicoNome: { startsWith: MARCA } } }));
  check(sobrou === 0, `limpeza completa (sobraram ${sobrou})`);
}

main()
  .catch((e) => { erros.push(`excecao: ${e.message}`); console.error(e); })
  .finally(async () => {
    await limpar().catch(() => {});
    await prisma.$disconnect();
    if (erros.length) {
      console.log(`\nFALHAS (${erros.length}):`);
      for (const e of erros) console.log(`  ${e}`);
      process.exit(1);
    }
    console.log("\nRANKINGS: TUDO CONFERE");
  });
