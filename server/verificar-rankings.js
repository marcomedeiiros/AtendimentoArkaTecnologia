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
//   os dois rankings juntos    os dois vao de 0 a 100, mas medem trabalhos
//                              diferentes -- misturar faz a equipe externa
//                              parecer pior por causa do criterio, nao do trabalho;
//   amostra de um              uma unica visita perfeita nao pode valer o mes;
//   premiar quem nao ganhou    o vencedor sai do ranking calculado, nunca do
//                              corpo da requisicao.
//
// Usa o banco de verdade e limpa o que criou.
const prisma = require("./src/infrastructure/database/prisma.client");
const painelService = require("./src/modules/dashboard/painel.service");
const rankingService = require("./src/modules/rankings/ranking.service");
const mapeamentoService = require("./src/modules/rankings/mapeamento.service");
const midiaStorage = require("./src/infrastructure/storage/midia.storage");
const { pontuarExterno, ITENS_MAPEAMENTO } = require("./src/modules/rankings/pontuacao.externa");
const fs = require("fs");
const path = require("path");

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
  // O PDF DE TESTE SAI DO DISCO TAMBEM, e nao so a linha do banco.
  //
  // Apagar so a linha deixa o arquivo orfao em `dados/midia`: ninguem aponta
  // para ele, ninguem sabe que existe, e ele fica ocupando espaco para sempre.
  // Aconteceu de verdade -- seis PDFs de teste chegaram a entrar num commit.
  const comArquivo = await prisma.mapeamentoTecnico.findMany({
    where: { tecnicoNome: { startsWith: MARCA }, NOT: { arquivoPath: null } },
    select: { arquivoPath: true },
  });
  for (const m of comArquivo) await midiaStorage.remover(m.arquivoPath).catch(() => {});
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
    // AUSENTE VALE ZERO, e nao "erro": desde que so pontua atendimento
    // avaliado, quem fechou o mes inteiro sem receber nota nenhuma nao vira
    // linha no painel. Nas duas telas ele soma zero -- que e a igualdade que
    // esta secao existe para provar.
    const noPainel = doPainel.classificacao.find((x) => x.nome === p.nome);
    check(
      (noPainel?.pontos ?? 0) === p.pontos,
      `${p.nome}: ${p.pontos} pts aqui e ${noPainel?.pontos ?? 0} no painel`
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

  /**
   * 1a. AS TRES PARCELAS, E A BASE DE ONDE ELAS SAEM.
   *
   * A pontuacao foi reequilibrada porque a antiga premiava atender POUCO e bem:
   * volume valia 1 ponto por atendimento (13% do total) contra 40 da nota e 20
   * da agilidade. Agora e 35 / 35 / 30, e as tres saem da MESMA base -- os
   * atendimentos fechados que o cliente avaliou.
   *
   * Estes numeros sao a regra escrita em teste. Mudar um peso sem passar por
   * aqui e mudar quem leva a premiacao sem ninguem perceber.
   */
  titulo("1a. AS TRES PARCELAS SOMAM ATE 100, DA MESMA BASE");

  const anaCrit = Object.fromEntries(
    sede.classificacao.find((p) => p.nome === ana.nome).criterios.map((c) => [c.chave, c])
  );
  // Ana: 3 fechados AVALIADOS com nota 5, assumidos na hora.
  check(anaCrit.atendimentos.valor === 3, `volume conta os avaliados (${anaCrit.atendimentos.valor})`);
  check(anaCrit.atendimentos.pontos === 9, `3 avaliados = 9 pts de volume (${anaCrit.atendimentos.pontos})`);
  check(anaCrit.nota.pontos === 35, `nota 5,0 x 7 = 35 pts, o teto da parcela (${anaCrit.nota.pontos})`);
  check(anaCrit.agilidade.pontos === 30, `assumir na hora = 30 pts, o teto (${anaCrit.agilidade.pontos})`);
  check(
    anaCrit.atendimentos.pontos + anaCrit.nota.pontos + anaCrit.agilidade.pontos === 74,
    "as parcelas somam o total (9 + 35 + 30 = 74)"
  );
  // O TETO existe e e 100: sem ele a soma nao teria significado nenhum.
  check(
    doPainel.pesos.tetos.atendimentos + doPainel.pesos.tetos.nota + doPainel.pesos.tetos.agilidade === 100,
    `os tres tetos somam 100 (${doPainel.pesos.tetos.atendimentos} + ${doPainel.pesos.tetos.nota} + ${doPainel.pesos.tetos.agilidade})`
  );

  // FECHAR SEM AVALIACAO NAO PONTUA -- o pedido, e o que mais muda na pratica.
  const brunoSede = sede.classificacao.find((p) => p.nome === bruno.nome);
  const brunoCrit = Object.fromEntries(brunoSede.criterios.map((c) => [c.chave, c]));
  check(brunoSede.pontos === 0, `1 atendimento fechado SEM avaliacao vale 0 (${brunoSede.pontos} pts)`);
  check(brunoCrit.atendimentos.valor === 0, "e nem conta como volume: o nao avaliado nao entra na base");
  check(
    !doPainel.classificacao.some((p) => p.nome === bruno.nome),
    "e ele nao vira linha no painel de parede"
  );
  // Ainda aparece na tabela da Visao Geral, com zero: sumir da lista faria
  // parecer que a pessoa nao existe, quando o que faltou foi avaliacao.
  check(!!brunoSede, "mas continua na tabela da Visao Geral, com zero");

  // A MEDIANA no lugar da media: uma conversa esquecida nao derruba o mes.
  // Sete atendimentos assumidos em 60 s e um em 6 h dao media de ~45 min
  // (8 pts) e mediana de 60 s (30 pts).
  const cMediana = await conversa("mediana");
  const zoe = await criarUsuario("Zoe", { equipeRanking: "sede" });
  for (let i = 0; i < 7; i += 1) {
    await os(cMediana.id, zoe.nome, {
      status: "fechada", avaliacao: 5,
      abertoEm: noMes(5, 9), atendidoEm: new Date(noMes(5, 9).getTime() + 60_000), fechadoEm: noMes(5, 11),
    });
  }
  await os(cMediana.id, zoe.nome, {
    status: "fechada", avaliacao: 5,
    abertoEm: noMes(5, 9), atendidoEm: new Date(noMes(5, 9).getTime() + 6 * 3600_000), fechadoEm: noMes(5, 16),
  });
  const comOutlier = await painelService.rankingDoMes(hoje.getFullYear(), hoje.getMonth() + 1);
  const zoeP = comOutlier.classificacao.find((p) => p.nome === zoe.nome);
  check(
    zoeP?.agilidade.pontos === 30,
    `uma conversa esquecida nao derruba o mes: ${zoeP?.agilidade.medioSeg}s tipicos, ${zoeP?.agilidade.pontos} pts`
  );

  /**
   * 1b. A PAREDE MOSTRA O MESMO RANKING QUE A VISAO GERAL.
   *
   * O defeito que isto tranca: a TV coroava "Davi" como lider do mes -- 9
   * atendimentos, nota 5 -- enquanto a tabela da Visao Geral, na sala ao lado,
   * mostrava outro primeiro colocado. Davi nao esta inscrito em ranking nenhum;
   * o recorte por equipe existia so no modulo de rankings, e a parede somava
   * todo mundo que tivesse fechado uma OS.
   *
   * Duas telas com a mesma pontuacao e podios diferentes e pior do que nao ter
   * ranking: a equipe acredita na que esta pendurada na parede.
   */
  titulo("1b. A PAREDE E A VISAO GERAL MOSTRAM O MESMO PODIO");

  // Releitura: a secao 1a criou mais gente depois que `sede` foi calculado, e
  // comparar as duas telas com retratos de instantes diferentes provaria nada.
  const sedeAgora = await rankingService.obter("sede", COMP);
  const parede = await painelService.obter();
  const nomesNaParede = parede.ranking.classificacao.map((p) => p.nome);
  check(
    !nomesNaParede.includes(davi.nome),
    `quem nao esta inscrito fica fora da parede (${davi.nome} nao aparece)`
  );
  check(
    !parede.ranking.aCaminho.some((p) => p.nome === davi.nome),
    "e tambem fora do 'a caminho da nota', que sai do mesmo agrupamento"
  );
  check(
    nomesNaParede.every((n) => sedeAgora.classificacao.some((p) => p.nome === n)),
    `todo nome da parede esta no ranking da sede (${nomesNaParede.join(", ")})`
  );
  // O PODIO, na ordem: nao basta serem as mesmas pessoas.
  const topSede = sedeAgora.classificacao.filter((p) => p.pontos > 0).slice(0, 3).map((p) => p.nome);
  check(
    JSON.stringify(nomesNaParede) === JSON.stringify(topSede),
    `mesma ordem nas duas telas (parede: ${nomesNaParede.join(" > ")})`
  );
  const lider = parede.ranking.classificacao[0];
  const liderNaVisao = sedeAgora.classificacao.find((p) => p.nome === lider?.nome);
  check(
    !!lider && lider.pontos === liderNaVisao?.pontos,
    `e o lider tem os mesmos pontos nas duas (${lider?.nome}: ${lider?.pontos})`
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

  titulo("3c. A ABA 'RELATORIOS' SEGUE A EQUIPE DA PESSOA");

  // Relatorio de mapeamento e a entrega de quem VISITA cliente. Para quem so
  // atende no chat, o item de menu nunca seria clicado -- e menu cheio de item
  // inutil e menu que ninguem le.
  //
  // A leitura mora num arquivo so (client/src/utils/equipeRanking.js) porque
  // duas telas decidem a partir dela: a barra esconde o item, e a propria tela
  // explica quando alguem chega por um link antigo. Duas copias dariam um menu
  // que mostra uma tela que a tela recusa a abrir.
  const vm = require("vm");
  const fonte = fs.readFileSync(
    path.join(__dirname, "..", "client", "src", "utils", "equipeRanking.js"),
    "utf8"
  ).replace(/^export\s+/gm, "");
  const caixa = {};
  vm.createContext(caixa);
  vm.runInContext(`${fonte}; this.ehDaEquipeExterna = ehDaEquipeExterna;`, caixa);
  const { ehDaEquipeExterna } = caixa;

  check(ehDaEquipeExterna({ equipeRanking: "externo" }) === true, "quem e da equipe externa ve Relatorios");
  check(ehDaEquipeExterna({ equipeRanking: "sede" }) === false, "quem so atende na sede NAO ve (o pedido)");
  check(ehDaEquipeExterna({ equipeRanking: "sede,externo" }) === true, "quem faz as duas coisas ve");
  check(ehDaEquipeExterna({ equipeRanking: "externo,sede" }) === true, "e a ordem no texto nao importa");
  check(ehDaEquipeExterna({ equipeRanking: "sede, externo" }) === true, "espaco depois da virgula nao quebra");
  // Ausencia nao pode virar acesso: sessao antiga, campo nao selecionado ou
  // valor estragado no banco tem de cair no lado fechado.
  for (const [rotulo, u] of [
    ["nao concorre", { equipeRanking: null }],
    ["campo ausente", {}],
    ["usuario nulo", null],
    ["valor invalido", { equipeRanking: "externa" }],
  ]) {
    check(ehDaEquipeExterna(u) === false, `${rotulo} -> nao ve`);
  }

  // E o campo precisa CHEGAR na sessao, senao a regra acima decide sobre nada e
  // o item some para todo mundo.
  const sessaoJoao = await usuarioRepository.findById(joao.id);
  check(
    ehDaEquipeExterna(sessaoJoao) === true,
    "e a sessao real de um tecnico externo passa na regra (findById traz o campo)"
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

  titulo("6. OS DOIS RANKINGS NAO SE MISTURAM");
  // Os dois tem o MESMO teto agora, e por isso a checagem mudou de alvo: o que
  // separa os rankings nao e mais a escala, e sim o criterio. O risco real
  // passou a ser um endpoint devolver os dois na mesma lista -- e e isso que se
  // confere aqui e logo abaixo.
  const maiorSede = Math.max(...sede.classificacao.map((p) => p.pontos));
  check(
    maiorSede <= 100,
    `a sede tambem para em 100 (maior aqui: ${maiorSede}) -- tetos iguais, criterios diferentes`
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

  /**
   * 8b. O PDF DO RELATORIO -- e o buraco que ele poderia abrir.
   *
   * A listagem esconde o relatorio dos outros, mas o ARQUIVO tem endereco
   * proprio: `/mapeamentos/<id>/arquivo`. Se a permissao fosse so da listagem,
   * bastaria ter um id para baixar o relatorio de qualquer tecnico -- e id
   * aparece em log, em URL e no corpo de outras respostas.
   *
   * Por isso a checagem e refeita no `arquivoDe`, e por isso ela e testada aqui
   * com um tecnico pedindo o arquivo do outro.
   */
  {
    titulo("8b. O PDF DO RELATORIO: quem baixa o que");

    // Um PDF minimo, de verdade -- comeca com "%PDF-", que e o que o servidor
    // confere. O teste tem de passar pela mesma porta que o arquivo real.
    const pdfDeVerdade =
      "data:application/pdf;base64," +
      Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF").toString("base64");

    const doJoao = await mapeamentoService.criar(
      {
        empresa: `${MARCA} Empresa PDF`, dataVisita: noMes(6).toISOString(), prazoEm: noMes(9).toISOString(),
        resumo: "x".repeat(60), itens: {}, evidencias: [],
        arquivo: { conteudo: pdfDeVerdade, nome: "Relatorio_Mapeamento.pdf" },
      },
      { sub: joao.id, nome: joao.nome }
    );
    check(!!doJoao.arquivo, `o PDF fica anexado ao relatorio (${doJoao.arquivo?.nome})`);
    check(doJoao.arquivo?.bytes > 0, `com o tamanho gravado (${doJoao.arquivo?.bytes} bytes)`);
    // O CAMINHO em disco nao pode vazar no DTO: com ele, quem tem a listagem
    // montaria o endereco do arquivo por fora da rota que confere permissao.
    check(!JSON.stringify(doJoao).includes("arquivoPath"), "e o caminho em disco nao sai na resposta");

    check(!!(await mapeamentoService.arquivoDe(doJoao.id, { sub: joao.id })), "o dono baixa o proprio PDF");
    check(!!(await mapeamentoService.arquivoDe(doJoao.id, { sub: davi.id })), "o administrador baixa o de qualquer um");

    let negouOutro = false;
    try {
      await mapeamentoService.arquivoDe(doJoao.id, { sub: lucas.id });
    } catch (e) {
      negouOutro = e.statusCode === 403;
    }
    check(negouOutro, "OUTRO TECNICO NAO baixa o PDF, mesmo tendo o id (403)");

    // Nao e PDF: recusado pelos BYTES, e nao pela extensao. Um executavel
    // renomeado para .pdf ficaria guardado e seria servido de volta para a
    // empresa inteira.
    let recusouFalso = false;
    try {
      await mapeamentoService.criar(
        {
          empresa: `${MARCA} Empresa Falsa`, dataVisita: noMes(6).toISOString(), prazoEm: noMes(9).toISOString(),
          resumo: "x".repeat(60), itens: {}, evidencias: [],
          arquivo: {
            conteudo: "data:application/pdf;base64," + Buffer.from("MZ isto nao e pdf").toString("base64"),
            nome: "virus.pdf",
          },
        },
        { sub: joao.id, nome: joao.nome }
      );
    } catch (e) {
      recusouFalso = e.code === "ARQUIVO_NAO_PDF";
    }
    check(recusouFalso, "arquivo que so tem nome de PDF e recusado pelos bytes");

    // Salvar o formulario de novo NAO pode apagar o PDF: `arquivo` ausente quer
    // dizer "nao mexi nisso".
    const depois = await mapeamentoService.atualizar(doJoao.id, { resumo: "y".repeat(60) }, { sub: joao.id });
    check(!!depois.arquivo, "salvar o relatorio de novo nao apaga o PDF ja enviado");
    // ARQUIVO ORFAO: o defeito que este bloco encontrou de verdade.
    //
    // Remover o PDF limpava a coluna e deixava o arquivo no disco -- sem nada
    // apontando para ele, sem ninguem saber que existe, e com dado de cliente
    // dentro. A checagem olha o DISCO, e nao o banco: e no disco que o lixo
    // fica.
    const noDisco = () =>
      fs.existsSync(path.join(midiaStorage.BASE_DIR, ...caminhoDoPdf.split("/")));
    const linhaAntes = await prisma.mapeamentoTecnico.findUnique({ where: { id: doJoao.id } });
    const caminhoDoPdf = linhaAntes.arquivoPath;
    check(noDisco(), "o PDF esta em disco enquanto o relatorio o referencia");

    const semPdf = await mapeamentoService.atualizar(doJoao.id, { arquivo: null }, { sub: joao.id });
    check(!semPdf.arquivo, "e mandar `arquivo: null` remove de proposito");
    check(!noDisco(), "removendo o PDF, o arquivo sai do DISCO tambem (nada de orfao)");
  }

  titulo("9. HISTORICO");
  const hist = await rankingService.historico("externo", COMP, 3);
  check(hist.competencias.length === 3, `tres meses (${hist.competencias.join(", ")})`);
  check(hist.competencias[hist.competencias.length - 1] === COMP, "terminando no mes pedido");
  const hJoao = hist.pessoas.find((p) => p.nome === joao.nome);
  check(!!hJoao && hJoao.meses.length === 3, "com uma linha por mes para cada pessoa");

  /**
   * 10. LIMPAR E RESTAURAR -- um marco por ranking.
   *
   * O que se verifica aqui e o que ja deu errado uma vez: um botao de limpar so,
   * que zerava a sede mesmo com a outra aba aberta, e -- pior -- sem nenhum
   * botao de voltar, o que deixou o painel da equipe vazio sem caminho de volta.
   *
   * Os testes rodam sobre a configuracao REAL, entao guardam o que estava la e
   * devolvem no fim: rodar a verificacao nao pode zerar o painel de ninguem.
   */
  titulo("10. LIMPAR E RESTAURAR");
  const CHAVES_ZERAGEM = ["painel.zeradoEm", "painel.zeradoEm.sede", "painel.zeradoEm.externo"];
  const antesDaLimpeza = await prisma.configuracao.findMany({ where: { chave: { in: CHAVES_ZERAGEM } } });
  await prisma.configuracao.deleteMany({ where: { chave: { in: CHAVES_ZERAGEM } } });
  try {
    await painelService.limparPainel("sede", { nome: MARCA });
    let marcos = await painelService.marcosDeZeragem();
    check(!!marcos.sede, "limpar a sede grava o marco da sede");
    check(marcos.externo === null, "limpar a sede NAO zera o ranking externo");

    await painelService.limparPainel("externo", { nome: MARCA });
    marcos = await painelService.marcosDeZeragem();
    check(!!marcos.externo, "limpar o externo grava o marco do externo");

    // O piso: limpar e RECOMECAR A CONTAR, nao apagar o passado. Um mes fechado
    // antes do marco tem de continuar inteiro -- senao a premiacao de julho
    // apontaria para um ranking que a tela nao consegue mais mostrar.
    const marco = new Date(marcos.sede);
    const mesDoMarco = { i: new Date(marco.getFullYear(), marco.getMonth(), 1), f: new Date(marco.getFullYear(), marco.getMonth() + 1, 1) };
    const mesAntes = { i: new Date(marco.getFullYear(), marco.getMonth() - 2, 1), f: new Date(marco.getFullYear(), marco.getMonth() - 1, 1) };
    const mesDepois = { i: new Date(marco.getFullYear(), marco.getMonth() + 1, 1), f: new Date(marco.getFullYear(), marco.getMonth() + 2, 1) };
    check(
      painelService.pisoDoMes(mesAntes.i, mesAntes.f, marco).getTime() === mesAntes.i.getTime(),
      "mes ja fechado ANTES do marco continua inteiro"
    );
    check(
      painelService.pisoDoMes(mesDoMarco.i, mesDoMarco.f, marco).getTime() === marco.getTime(),
      "o mes que contem o marco recomeca no marco"
    );
    check(
      painelService.pisoDoMes(mesDepois.i, mesDepois.f, marco).getTime() === mesDepois.i.getTime(),
      "mes seguinte ao marco conta o mes inteiro"
    );

    await painelService.restaurarPainel("sede", { nome: MARCA });
    marcos = await painelService.marcosDeZeragem();
    check(marcos.sede === null, "restaurar a sede desfaz a limpeza");
    check(!!marcos.externo, "restaurar a sede NAO restaura o externo");
    await painelService.restaurarPainel("externo", { nome: MARCA });
    marcos = await painelService.marcosDeZeragem();
    check(marcos.externo === null, "restaurar o externo desfaz a limpeza");

    // A chave da primeira versao, quando havia um marco so: quem limpou antes
    // desta mudanca continua com o painel zerado, e o botao de restaurar tem de
    // dar conta dela -- senao o clique nao surtiria efeito nenhum.
    const valorAntigo = new Date().toISOString();
    await prisma.configuracao.create({ data: { chave: "painel.zeradoEm", valor: valorAntigo } });
    marcos = await painelService.marcosDeZeragem();
    check(marcos.sede === valorAntigo, "a chave antiga (painel.zeradoEm) ainda vale para a sede");
    check(marcos.externo === null, "a chave antiga NAO vale para o externo");
    await painelService.restaurarPainel("sede", { nome: MARCA });
    marcos = await painelService.marcosDeZeragem();
    check(marcos.sede === null, "restaurar apaga tambem a chave antiga");

    let recusou = false;
    try { await painelService.limparPainel("qualquer-coisa", { nome: MARCA }); } catch { recusou = true; }
    check(recusou, "ranking desconhecido e recusado (nao cai na sede por engano)");
  } finally {
    await prisma.configuracao.deleteMany({ where: { chave: { in: CHAVES_ZERAGEM } } });
    for (const c of antesDaLimpeza) {
      await prisma.configuracao.create({ data: { chave: c.chave, valor: c.valor } });
    }
  }

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
