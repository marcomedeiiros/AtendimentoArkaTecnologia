// Verificacao do RANKING DO TIME -- `node verificar-ranking-equipe.js`.
//
// A aba nova da Visao Geral mostra o time inteiro com medalha e colocacao. O
// risco que este script existe para impedir nao e o desenho -- e a lista
// DISCORDAR do painel de parede sobre quem esta em primeiro. As duas telas ficam
// abertas ao mesmo tempo, uma na sala e outra na mesa, e medalhas diferentes
// para a mesma pessoa no mesmo minuto destroem a confianca nas duas.
//
// Por isso as duas passam pela MESMA funcao de pontuacao, e o bloco 1 confere
// exatamente isso: mesma ordem, mesmos pontos.
//
// O segundo risco e o "ultimo atendimento" mentir. Ele e ordenado por
// `atualizadoEm` de proposito: quem esta com uma OS ABERTA agora nao tem
// `fechadoEm`, e ordenar por um campo nulo joga essas linhas para uma ponta
// qualquer da lista -- o "ultimo atendimento" apareceria como um de semanas
// atras justamente para quem esta atendendo neste instante.
//
// Usa o banco de verdade e limpa o que criou.
const prisma = require("./src/infrastructure/database/prisma.client");
const painelService = require("./src/modules/dashboard/painel.service");

const erros = [];
const check = (cond, msg) => {
  if (!cond) erros.push(msg);
  console.log(`  ${cond ? "OK   " : "FALHA"} ${msg}`);
};
const titulo = (t) => console.log(`\n=== ${t} ===\n`);

const MARCA = "teste-ranking";
const agora = Date.now();
const min = (m) => new Date(agora - m * 60000);

async function limpar() {
  await prisma.atendimento.deleteMany({ where: { conversa: { cliente: { startsWith: MARCA } } } });
  await prisma.conversa.updateMany({
    where: { cliente: { startsWith: MARCA } },
    data: { atendimentoAtualId: null },
  });
  await prisma.conversa.deleteMany({ where: { cliente: { startsWith: MARCA } } });
  await prisma.parceiro.deleteMany({ where: { razaoSocial: { startsWith: MARCA } } });
}

async function main() {
  await limpar();
  const instancia = await prisma.instancia.findFirst();
  if (!instancia) throw new Error("sem instancia no banco -- rode o seed (npm run db:seed)");

  const conversa = async (cliente, empresa) =>
    prisma.conversa.create({
      data: {
        cliente: `${MARCA} ${cliente}`,
        empresa,
        telefone: `5527${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 90 + 10)}`,
        setor: "Técnico",
        statusAtendimento: "fechada",
        instanciaId: instancia.id,
      },
    });

  const os = async (conversaId, dados) =>
    prisma.atendimento.create({
      data: {
        conversaId,
        numeroOS: Math.floor(Math.random() * 900000) + 100000,
        setor: "Técnico",
        ...dados,
      },
    });

  // ANA: 3 fechados, notas 5,5,5 (bate o minimo), assume rapido -> lidera.
  const cAna = await conversa("ana", "ACME LTDA");
  for (let i = 0; i < 3; i++) {
    await os(cAna.id, {
      atendenteNome: `${MARCA} Ana`,
      status: "fechada",
      avaliacao: 5,
      abertoEm: min(300 - i),
      atendidoEm: min(299 - i),
      fechadoEm: min(200 - i),
    });
  }
  // BRUNO: 2 fechados, sem nota nenhuma.
  const cBruno = await conversa("bruno", "BETA COMERCIO SA");
  for (let i = 0; i < 2; i++) {
    await os(cBruno.id, {
      atendenteNome: `${MARCA} Bruno`,
      status: "fechada",
      abertoEm: min(400 - i),
      atendidoEm: min(340 - i),
      fechadoEm: min(300 - i),
    });
  }
  // CARLA: nenhum fechado e a OS ainda NAO assumida (`atendidoEm` nulo) -- e o
  // unico jeito de zerar de verdade. So "nada fechado" NAO zera: a parcela de
  // agilidade pontua pelo tempo ate assumir, entao quem assumiu rapido e ainda
  // esta atendendo ja tem pontos. Descobri isso porque este teste reprovou.
  const cCarla = await conversa("carla", null);
  await os(cCarla.id, {
    atendenteNome: `${MARCA} Carla`,
    status: "aberta",
    abertoEm: min(30),
  });

  const r = await painelService.rankingEquipe();
  const meu = r.classificacao.filter((p) => p.nome.startsWith(MARCA));
  const por = (n) => meu.find((p) => p.nome === `${MARCA} ${n}`);

  titulo("1. A CONTA E A MESMA DO PAINEL DE PAREDE");
  const parede = await painelService.obter(null);
  const daParede = parede.ranking.classificacao.filter((p) => p.nome.startsWith(MARCA));
  for (const p of daParede) {
    const aqui = por(p.nome.replace(`${MARCA} `, ""));
    check(
      aqui && aqui.pontos === p.pontos,
      `${p.nome}: ${p.pontos} pts na parede e ${aqui?.pontos} aqui`
    );
  }
  // A ORDEM tambem, e nao so os numeros: pontos iguais com criterio de desempate
  // diferente dariam medalhas trocadas com a mesma pontuacao na tela.
  const ordemParede = daParede.map((p) => p.nome);
  const ordemAqui = meu.filter((p) => ordemParede.includes(p.nome)).map((p) => p.nome);
  check(
    JSON.stringify(ordemParede) === JSON.stringify(ordemAqui),
    `a ordem bate: [${ordemAqui.join(" > ")}]`
  );

  titulo("2. ENTRA TODO MUNDO (a parede corta no top 3)");
  check(!!por("Carla"), "quem tem zero ponto aparece na Visao Geral");
  check(
    !parede.ranking.classificacao.some((p) => p.nome === `${MARCA} Carla`),
    "e continua FORA da parede, onde 0 pts vira cobranca publica"
  );
  check(
    por("Carla")?.pontos === 0,
    `Carla com ${por("Carla")?.pontos} pts (so tem OS aberta, nada fechado)`
  );

  titulo("3. COLOCACAO SEQUENCIAL, SEM BURACO");
  const posicoes = meu.map((p) => p.posicao);
  check(
    posicoes.every((v, i) => i === 0 || v > posicoes[i - 1]),
    `as posicoes sobem sem repetir (${posicoes.join(", ")})`
  );

  titulo("4. O ULTIMO ATENDIMENTO");
  const ana = por("Ana");
  check(ana?.ultimo?.empresa === "ACME LTDA", `empresa atendida veio junto ("${ana?.ultimo?.empresa}")`);
  check(!!ana?.ultimo?.quando, "com data e horario");
  check(ana?.ultimo?.encerrado === true, "marcado como encerrado (a OS esta fechada)");
  // `\d{5,}` e nao `\d{5}`: o `padStart(5)` COMPLETA ate cinco digitos, nao
  // corta -- e os numeros sorteados por este teste tem seis. Uma OS de verdade
  // passa de 99999 um dia, e cortar seria pior do que ficar mais larga.
  check(/^OS\d{5,}$/.test(ana?.ultimo?.os || ""), `numero da OS formatado (${ana?.ultimo?.os})`);

  // O CASO QUE A ORDENACAO POR `fechadoEm` ERRARIA: Carla so tem OS ABERTA, sem
  // data de fechamento. Se o "ultimo" saisse de um campo nulo, ela viria vazia
  // ou com a OS errada -- justamente quem esta atendendo agora.
  const carla = por("Carla");
  check(!!carla?.ultimo, "quem so tem OS ABERTA tambem tem ultimo atendimento");
  check(
    carla?.ultimo?.encerrado === false,
    "e ele vem marcado como EM ANDAMENTO, nao como fechado"
  );
  check(carla?.ultimo?.empresa === null, "sem empresa vinculada devolve null (a tela mostra o cliente)");
  check(
    carla?.ultimo?.cliente === `${MARCA} carla`,
    `e o nome do cliente vai junto ("${carla?.ultimo?.cliente}")`
  );

  // O MAIS RECENTE, e nao qualquer um: uma OS nova para a Ana precisa passar a
  // ser o "ultimo" dela.
  const cAna2 = await conversa("ana segunda", "ZETA SERVICOS ME");
  await os(cAna2.id, {
    atendenteNome: `${MARCA} Ana`,
    status: "fechada",
    avaliacao: 5,
    abertoEm: min(10),
    atendidoEm: min(9),
    fechadoEm: min(5),
  });
  const r2 = await painelService.rankingEquipe();
  const ana2 = r2.classificacao.find((p) => p.nome === `${MARCA} Ana`);
  check(
    ana2?.ultimo?.empresa === "ZETA SERVICOS ME",
    `o atendimento mais novo vira o ultimo ("${ana2?.ultimo?.empresa}")`
  );

  titulo("5. O MINIMO DE NOTAS CONTINUA VALENDO");
  check(por("Bruno")?.nota.conta === false, "quem nao tem o minimo de notas nao pontua por nota");
  check(por("Bruno")?.nota.pontos === 0, "e a parcela vale 0, nao a media de uma amostra pequena");
  check(typeof r.minimoAvaliacoes === "number", `o minimo vai para a tela (${r.minimoAvaliacoes})`);

  titulo("6. O HISTORICO IMPORTADO NAO E UMA PESSOA");

  // O relato: "Historico do WhatsApp" apareceu na classificacao como se fosse
  // um atendente, e ninguem na equipe conhecia essa pessoa.
  //
  // Nao era invencao da tela nova: quando alguem importa o historico do celular
  // para dentro de uma conversa, as mensagens antigas precisam pertencer a
  // alguma OS -- entao e criada uma OS sintetica, ja fechada, carimbada com
  // esse rotulo no campo `atendenteNome`. E o MESMO campo em que moram os nomes
  // de pessoas, e o ranking so descartava quem estava em branco (o bot).
  const { ATENDENTE_HISTORICO_IMPORTADO } = require("./src/shared/helpers/atendimentoSintetico.helper");
  const conversaRepository = require("./src/infrastructure/repositories/conversa.repository");

  await prisma.parceiro.create({ data: { cnpj: "11222333000181", razaoSocial: MARCA + " Omega Industria", status: "ativo" } });
  const cImport = await conversa("importado", "OMEGA INDUSTRIA LTDA");
  await prisma.conversa.update({ where: { id: cImport.id }, data: { cnpj: "11222333000181" } });
  const osImportada = await conversaRepository.criarAtendimentoImportado(cImport.id, {
    abertoEm: min(120),
    fechadoEm: min(60),
  });
  check(
    osImportada.atendenteNome === ATENDENTE_HISTORICO_IMPORTADO,
    "a OS sintetica continua sendo criada com o rotulo (nada mudou na importacao)"
  );

  const r3 = await painelService.rankingEquipe();
  check(
    !r3.classificacao.some((p) => p.nome === ATENDENTE_HISTORICO_IMPORTADO),
    "e o rotulo NAO aparece no ranking da Visao Geral"
  );
  const parede3 = await painelService.obter(null);
  check(
    !parede3.ranking.classificacao.some((p) => p.nome === ATENDENTE_HISTORICO_IMPORTADO),
    "nem no painel de parede (mesma funcao, mesma protecao)"
  );

  // O RELATORIO QUE VAI PARA O CLIENTE e o lugar mais caro desse vazamento: a
  // OS sintetica nasce fechada com data no passado, entao entra no recorte do
  // periodo e vira um atendimento que nunca aconteceu no documento da empresa.
  const relatorioService = require("./src/modules/relatorios/relatorio.service");
  const hoje = new Date();
  const rel = await relatorioService.relatorioEmpresa("11222333000181", {
    periodo: "mes",
    referencia: hoje.toISOString().slice(0, 10),
  }).catch(() => null);
  if (rel) {
    check(
      !(rel.chamados || []).some((c) => c.atendente === ATENDENTE_HISTORICO_IMPORTADO),
      "o relatorio do cliente nao lista o historico importado como chamado"
    );
  } else {
    check(false, "nao consegui gerar o relatorio da empresa para conferir");
  }

  titulo("limpeza");
  await limpar();
  const sobrou = await prisma.conversa.count({ where: { cliente: { startsWith: MARCA } } });
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
    console.log("\nRANKING DO TIME: TUDO CONFERE");
  });
