/**
 * DE QUEM É A NOTA QUE O CLIENTE DEU.
 *
 * ── O DEFEITO, COMO FOI RELATADO EM 10/09/2026 ──────────────────────────────
 *
 * O Lucas atendeu, fechou, o cliente deu 5 estrelas e escreveu um comentário.
 * Depois o Rangel abriu a mesma conversa e continuou o assunto -- e a nota do
 * Lucas passou a aparecer como sendo do Rangel: na tela de Feedbacks e, pior,
 * no ranking da sede, que agrupa os pontos por `atendenteNome` da OS.
 *
 * Eram DOIS caminhos independentes, e os dois estão travados aqui:
 *
 *   1. atender RESPONDENDO (o gesto natural) gravava o atendente só na
 *      CONVERSA. A OS ficava sem autor -- e aí a tela caía no
 *      `ultimoAtendenteNome` da conversa, que é mutável, e o ranking lia a OS
 *      como atendimento do BOT (a nota não pontuava para ninguém);
 *
 *   2. REABRIR continuava na MESMA OS, sobrescrevendo o autor, apagando o
 *      motivo e tirando o status de "fechada" -- e com isso a nota do Lucas
 *      passava a pontuar para quem reabriu.
 *
 * ── A REGRA QUE ISTO TRAVA ──────────────────────────────────────────────────
 *
 * A nota é um julgamento do cliente sobre um trabalho ESPECÍFICO. Quem fez
 * aquele trabalho é fato encerrado no instante em que o cliente respondeu, e
 * nenhuma ação posterior -- reabrir, responder, transferir -- muda de quem era.
 *
 * Roda contra o BANCO, porque o defeito vivia na gravação: um teste de função
 * pura teria passado nos dois estados.
 */
const path = require("path");

const prisma = require(path.join(__dirname, "src/infrastructure/database/prisma.client"));
const conversaRepository = require(path.join(__dirname, "src/infrastructure/repositories/conversa.repository"));
const conversaService = require(path.join(__dirname, "src/modules/conversas/conversa.service"));
const rankingService = require(path.join(__dirname, "src/modules/rankings/ranking.service"));

const erros = [];
function check(ok, nome) {
  if (ok) {
    console.log("  OK    " + nome);
  } else {
    erros.push(nome);
    console.log("  FALHA " + nome);
  }
}
const titulo = (t) => console.log("\n=== " + t + " ===\n");

const MARCA = "teste-credito";
const hoje = new Date();
const COMP = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
const noMes = (dia, hora = 10) => new Date(hoje.getFullYear(), hoje.getMonth(), dia, hora, 0, 0);

async function limpar() {
  await prisma.atendimento.deleteMany({ where: { conversa: { cliente: { startsWith: MARCA } } } });
  await prisma.conversa.updateMany({
    where: { cliente: { startsWith: MARCA } },
    data: { atendimentoAtualId: null },
  });
  await prisma.conversa.deleteMany({ where: { cliente: { startsWith: MARCA } } });
  await prisma.usuario.deleteMany({ where: { nome: { startsWith: MARCA } } });
}

async function main() {
  await limpar();
  const instancia = await prisma.instancia.findFirst();
  if (!instancia) throw new Error("sem instancia no banco -- rode o seed (npm run db:seed)");

  const criarUsuario = (nome) =>
    prisma.usuario.create({
      data: {
        nome: `${MARCA} ${nome}`,
        email: `${MARCA}.${nome}.${Date.now()}${Math.random().toString(36).slice(2, 6)}@teste.local`,
        senhaHash: "x",
        cargo: "Técnico",
        ativo: true,
        equipeRanking: "sede",
      },
    });

  const lucas = await criarUsuario("Lucas");
  const rangel = await criarUsuario("Rangel");
  const autorDe = (u) => ({ sub: u.id, nome: u.nome, cargo: u.cargo });

  titulo("1. ATENDER RESPONDENDO REGISTRA O ATENDENTE NA OS");

  // A conversa nasce como nasce de verdade: do cliente, sem responsavel.
  const conversa = await prisma.conversa.create({
    data: {
      cliente: `${MARCA} cliente`,
      telefone: `5527${String(Date.now()).slice(-7)}11`,
      setor: "Técnico",
      statusAtendimento: "pendente",
      instanciaId: instancia.id,
      criadoEm: noMes(2, 8),
    },
  });
  const os1 = await conversaRepository.abrirAtendimento(conversa.id, {
    setor: "Técnico",
    status: "pendente",
  });
  await prisma.atendimento.update({ where: { id: os1.id }, data: { abertoEm: noMes(2, 8) } });

  // O LUCAS ATENDE RESPONDENDO -- sem clicar em "Atender". E o caminho comum, e
  // era o que nao deixava rastro na OS.
  await conversaService._registrarAtendente(
    await conversaRepository.findById(conversa.id),
    "equipe",
    autorDe(lucas)
  );

  let osDoLucas = await prisma.atendimento.findUnique({ where: { id: os1.id } });
  check(osDoLucas.atendenteNome === lucas.nome, `a OS passa a ter o atendente (${osDoLucas.atendenteNome})`);
  check(!!osDoLucas.atendidoEm, "e o instante em que foi assumida");

  titulo("2. O CLIENTE FECHA O CICLO E AVALIA");

  // Fecha a OS e a conversa, e a pesquisa grava a nota NA OS AVALIADA -- como o
  // engine faz (`osAvaliada`, e nao "a OS atual").
  await prisma.atendimento.update({
    where: { id: os1.id },
    data: { status: "fechada", fechadoEm: noMes(2, 11), motivo: "Backup e restauração" },
  });
  await conversaRepository.update(conversa.id, {
    statusAtendimento: "fechada",
    fechadoEm: noMes(2, 11),
  });
  await conversaRepository.atualizarAtendimento(os1.id, { avaliacao: 5, avaliacaoStatus: "respondida" });
  await conversaRepository.update(conversa.id, { avaliacao: 5, avaliacaoStatus: "respondida" });

  const antes = await rankingService.obter("sede", COMP);
  const pLucasAntes = antes.classificacao.find((p) => p.usuarioId === lucas.id)?.pontos ?? 0;
  const pRangelAntes = antes.classificacao.find((p) => p.usuarioId === rangel.id)?.pontos ?? 0;
  check(pLucasAntes > 0, `o Lucas pontua pela nota (${pLucasAntes} pts)`);
  check(pRangelAntes === 0, `e o Rangel nao pontua nada (${pRangelAntes} pts)`);

  titulo("3. O RANGEL REABRE A CONVERSA -- E A NOTA CONTINUA SENDO DO LUCAS");

  // O CASO DO RELATO: a conversa está SEM dono quando o Rangel chega.
  //
  // É o estado normal depois de fechar e voltar para a fila -- e era o estado em
  // que a sobrescrita acontecia. Com dono, o sistema não deixa outra pessoa
  // assumir ("não rouba conversa de ninguém"), e esse ramo é conferido no §3b.
  await conversaRepository.update(conversa.id, { atendenteId: null });
  await conversaService.atualizarStatus(conversa.id, "aberta", null, autorDe(rangel));

  osDoLucas = await prisma.atendimento.findUnique({ where: { id: os1.id } });
  check(osDoLucas.atendenteNome === lucas.nome, `a OS avaliada continua com o Lucas (${osDoLucas.atendenteNome})`);
  check(osDoLucas.avaliacao === 5, "e continua com a nota 5");
  check(osDoLucas.status === "fechada", `e continua FECHADA -- senao a nota para de pontuar (${osDoLucas.status})`);
  check(osDoLucas.motivo === "Backup e restauração", `e o motivo do fechamento nao foi apagado (${osDoLucas.motivo})`);

  // A continuacao do atendimento virou OS NOVA, e essa e do Rangel.
  const todas = await prisma.atendimento.findMany({
    where: { conversaId: conversa.id },
    orderBy: { abertoEm: "asc" },
  });
  check(todas.length === 2, `a continuacao virou OS nova (${todas.length} OS na conversa)`);
  const osNova = todas.find((o) => o.id !== os1.id);
  check(osNova?.atendenteNome === rangel.nome, `e a OS nova e do Rangel (${osNova?.atendenteNome})`);
  check(osNova?.avaliacao == null, "que nasce SEM nota -- o cliente ainda nao avaliou este ciclo");
  const conversaDepois = await conversaRepository.findById(conversa.id);
  check(
    conversaDepois.atendimentoAtualId === osNova?.id,
    "e a conversa passa a apontar para a OS nova"
  );

  titulo("3b. E QUEM REABRE NAO ROUBA CONVERSA QUE TEM DONO");

  // A conversa agora e do Rangel (ele assumiu ao reabrir). Se o Lucas reabrir
  // este ciclo, o responsavel NAO muda -- e a regra que ja existia, e ela
  // continua valendo depois do conserto.
  await prisma.atendimento.update({
    where: { id: osNova.id },
    data: { status: "fechada", fechadoEm: noMes(3, 15) },
  });
  await conversaRepository.update(conversa.id, { statusAtendimento: "fechada" });
  await conversaService.atualizarStatus(conversa.id, "aberta", null, autorDe(lucas));

  const osNovaAinda = await prisma.atendimento.findUnique({ where: { id: osNova.id } });
  check(
    osNovaAinda.atendenteNome === rangel.nome,
    `ciclo sem nota reaberto continua com o dono (${osNovaAinda.atendenteNome})`
  );
  const quantas = await prisma.atendimento.count({ where: { conversaId: conversa.id } });
  check(quantas === 2, `e sem nota NAO abre OS nova -- reabrir continua a mesma (${quantas} OS)`);

  titulo("4. E O RANKING NAO MUDA DE DONO");

  const depois = await rankingService.obter("sede", COMP);
  const pLucasDepois = depois.classificacao.find((p) => p.usuarioId === lucas.id)?.pontos ?? 0;
  const pRangelDepois = depois.classificacao.find((p) => p.usuarioId === rangel.id)?.pontos ?? 0;
  check(
    pLucasDepois === pLucasAntes,
    `o Lucas mantem os pontos depois do reabrir (${pLucasAntes} -> ${pLucasDepois})`
  );
  check(
    pRangelDepois === 0,
    `e o Rangel continua sem pontos da nota que nao era dele (${pRangelDepois})`
  );

  titulo("5. A TRAVA DE TRAS: A AUTORIA DE OS AVALIADA NAO SE REESCREVE");

  // Segunda barreira, para o caminho que ninguem previu. Apontamos a conversa
  // de volta para a OS avaliada e tentamos sobrescrever o autor por ali.
  await prisma.conversa.update({ where: { id: conversa.id }, data: { atendimentoAtualId: os1.id } });
  await conversaRepository.atualizarAtendimentoAtual(conversa.id, {
    atendenteId: rangel.id,
    atendenteNome: rangel.nome,
    status: "aberta",
  });
  osDoLucas = await prisma.atendimento.findUnique({ where: { id: os1.id } });
  check(osDoLucas.atendenteNome === lucas.nome, `a autoria foi recusada (${osDoLucas.atendenteNome})`);
  check(osDoLucas.status === "aberta", "e o resto do espelho continuou passando (status mudou)");

  // E numa OS SEM nota, escrever o autor continua sendo o comportamento normal.
  await prisma.conversa.update({ where: { id: conversa.id }, data: { atendimentoAtualId: osNova.id } });
  await conversaRepository.atualizarAtendimentoAtual(conversa.id, { atendenteNome: lucas.nome });
  const osNovaDepois = await prisma.atendimento.findUnique({ where: { id: osNova.id } });
  check(
    osNovaDepois.atendenteNome === lucas.nome,
    "e ciclo ainda nao avaliado continua aceitando troca de responsavel (transferencia)"
  );

  titulo("6. A TELA NAO INVENTA NOME");

  // A coluna "Atendente" das avaliacoes sai da OS, e de mais nenhum lugar. O
  // `ultimoAtendenteNome` da CONVERSA muda quando outra pessoa abre o fio, e era
  // dele que a tela tirava o nome quando a OS estava sem autor.
  const fs = require("fs");
  const tela = fs.readFileSync(
    path.join(__dirname, "../client/src/components/pages/Dashboard.jsx"),
    "utf8"
  );
  check(
    !tela.includes("ultimoAtendenteNome: a.atendenteNome || c.ultimoAtendenteNome"),
    "a avaliacao nao cai mais no ultimo atendente da conversa"
  );
  check(
    tela.includes("não registrado"),
    "e sem o dado da OS a tela diz 'nao registrado', em vez de um nome errado"
  );

  titulo("limpeza");
  await limpar();
  const sobrou =
    (await prisma.conversa.count({ where: { cliente: { startsWith: MARCA } } })) +
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
          : "CREDITO DA AVALIACAO: TUDO CONFERE")
    );
    process.exit(erros.length ? 1 : 0);
  });
