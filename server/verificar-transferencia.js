/**
 * TRANSFERIR CONVERSA: QUEM PODE, E QUANTAS VEZES.
 *
 * ── AS PERGUNTAS QUE ESTE ARQUIVO RESPONDE ─────────────────────────────────
 *
 * "O colega consegue tirar de mim a conversa que EU estou atendendo?"
 * "Se eu clicar duas vezes, a conversa e transferida duas vezes?"
 *
 * As duas respostas eram sim.
 *
 * A primeira porque `definirAtendente` conferia UMA coisa so -- se a pessoa
 * tinha acesso ao SETOR da conversa. Dono nao entrava na conta, e o controller
 * nem repassava `req.user.sub`: o id de quem pedia nao chegava ao service, logo
 * nao havia como conferir nem se alguem quisesse. Esconder o botao na tela nao
 * mudava nada -- por curl era igual.
 *
 * A segunda porque a troca era ler-depois-escrever:
 *
 *     const conversa = await findById(id);      // dono = A
 *     ...                                        // <- a outra requisicao passa aqui
 *     await update(id, { atendenteId: novo });   // grava por cima
 *
 * Dois cliques passavam os dois, o ultimo UPDATE vencia, e o fio da conversa
 * ganhava DUAS linhas "Conversa transferida para ...", cada uma para uma pessoa
 * diferente.
 *
 * Aqui o teste bate na API por HTTP -- e nao no service -- de proposito: a
 * pergunta e sobre o que a ROTA aceita de quem manda a requisicao a mao.
 *
 * Cria e apaga as proprias contas e conversas. Nada real e tocado.
 *
 *   cd server && node verificar-transferencia.js
 */
process.env.TURNSTILE_SITE_KEY = "";
process.env.TURNSTILE_SECRET_KEY = "";

const bcrypt = require("bcryptjs");
const prisma = require("./src/infrastructure/database/prisma.client");
const createApp = require("./src/app");

const MARCA = "teste-transf";
const SENHA = "SenhaCerta#2026";
const erros = [];
let secao = "";
const titulo = (t) => { secao = t; console.log(`\n=== ${t} ===`); };
const check = (ok, rotulo) => {
  console.log(`  ${ok ? "OK  " : "FALHA"} ${rotulo}`);
  if (!ok) erros.push(`[${secao}] ${rotulo}`);
};

let base = "";
let servidor = null;

async function logar(email) {
  const r = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.9, 10.0.0.1" },
    body: JSON.stringify({ email, senha: SENHA }),
  });
  const j = await r.json();
  return j?.data?.token;
}

async function pedir(caminho, { metodo = "GET", corpo, token } = {}) {
  const r = await fetch(base + caminho, {
    method: metodo,
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": "203.0.113.9, 10.0.0.1",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
  });
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* nao-JSON */ }
  return { status: r.status, json };
}

async function criarUsuario(sufixo, cargo) {
  return prisma.usuario.create({
    data: {
      nome: `${MARCA} ${sufixo}`,
      email: `${MARCA}-${sufixo}@exemplo.test`,
      senhaHash: await bcrypt.hash(SENHA, 10),
      cargo,
      ativo: true,
    },
  });
}

// Toda conversa pertence a uma instancia do WhatsApp -- a coluna e obrigatoria.
// Usa a que o seed criou; sem ela, o banco esta vazio e o teste nao tem o que
// exercitar.
let instanciaId = null;

async function criarConversa(dono, setor = "Técnico") {
  return prisma.conversa.create({
    data: {
      telefone: `55119${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 90 + 10)}`,
      cliente: `${MARCA} cliente`,
      setor,
      statusAtendimento: "aberta",
      atendenteId: dono ? dono.id : null,
      instanciaId,
    },
  });
}

async function limpar() {
  await prisma.mensagem.deleteMany({ where: { conversa: { cliente: { startsWith: MARCA } } } });
  await prisma.atendimento.deleteMany({ where: { conversa: { cliente: { startsWith: MARCA } } } });
  await prisma.conversa.updateMany({ where: { cliente: { startsWith: MARCA } }, data: { atendimentoAtualId: null } });
  await prisma.conversa.deleteMany({ where: { cliente: { startsWith: MARCA } } });
  await prisma.usuario.deleteMany({ where: { email: { startsWith: `${MARCA}-` } } });
}

async function main() {
  await limpar();

  const instancia = await prisma.instancia.findFirst();
  if (!instancia) throw new Error("sem instancia no banco -- rode o seed (npm run db:seed)");
  instanciaId = instancia.id;

  const app = createApp();
  await new Promise((ok) => { servidor = app.listen(0, ok); });
  base = `http://127.0.0.1:${servidor.address().port}`;

  const alice = await criarUsuario("alice", "Técnico");
  const bruno = await criarUsuario("bruno", "Técnico");   // MESMO setor da Alice
  const carla = await criarUsuario("carla", "Técnico");
  const admin = await criarUsuario("admin", "Administrador");

  const tAlice = await logar(alice.email);
  const tBruno = await logar(bruno.email);
  const tAdmin = await logar(admin.email);
  check(!!tAlice && !!tBruno && !!tAdmin, "as tres contas de teste entraram");

  // ─────────────────────────────────────────────────────────────────────────
  titulo("1. O RESPONSAVEL transfere");

  let conversa = await criarConversa(alice);
  let r = await pedir(`/api/conversas/${conversa.id}/atendente`, {
    metodo: "PATCH", corpo: { atendenteId: carla.id }, token: tAlice,
  });
  check(r.status === 200, `Alice (dona) transfere para Carla -> ${r.status}`);
  let noBanco = await prisma.conversa.findUnique({ where: { id: conversa.id } });
  check(noBanco.atendenteId === carla.id, "o banco registra Carla como responsavel");

  // ─────────────────────────────────────────────────────────────────────────
  titulo("2. QUALQUER PESSOA DO SETOR transfere -- inclusive puxando para si");

  // REVERSAO DELIBERADA (2026-08-28, pedido da operacao).
  //
  // Por algumas horas esta secao cobrou 403 de quem nao era o dono. A intencao
  // era boa -- ninguem tira do colega a conversa que ele esta atendendo -- mas
  // travou o uso normal: assumir a conversa de um colega que saiu para almocar
  // exigia um Administrador. Agora a autorizacao e o SETOR (ver secao 7), e a
  // autoria de quem transferiu passa a ficar registrada no historico.
  conversa = await criarConversa(alice);
  r = await pedir(`/api/conversas/${conversa.id}/atendente`, {
    metodo: "PATCH", corpo: { atendenteId: bruno.id }, token: tBruno,
  });
  check(r.status === 200, `Bruno PUXA PARA SI a conversa da Alice -> ${r.status} (esperado 200)`);
  noBanco = await prisma.conversa.findUnique({ where: { id: conversa.id } });
  check(noBanco.atendenteId === bruno.id, "o banco registra Bruno como responsavel");

  // O historico diz de quem partiu a troca -- sem a trava de dono, nao havia
  // como deduzir isso. Puxar para si e "assumida por", nao "transferida para X
  // por X", que era o que saia e nao se entende lendo depois.
  const ultimoAviso = async (conversaId) =>
    (
      await prisma.mensagem.findFirst({
        where: { conversaId, origem: "sistema", texto: { contains: "onversa" } },
        orderBy: { criadoEm: "desc" },
      })
    )?.texto || "";

  let aviso = await ultimoAviso(conversa.id);
  check(
    aviso === `Conversa assumida por ${bruno.nome}`,
    `puxar para si registra "assumida por": ${JSON.stringify(aviso)}`
  );

  // Transferir a conversa alheia para uma TERCEIRA pessoa tambem passa.
  r = await pedir(`/api/conversas/${conversa.id}/atendente`, {
    metodo: "PATCH", corpo: { atendenteId: carla.id }, token: tAlice,
  });
  check(r.status === 200, `Alice transfere para Carla a conversa que estava com Bruno -> ${r.status}`);
  aviso = await ultimoAviso(conversa.id);
  check(
    aviso === `Conversa transferida para ${carla.nome} por ${alice.nome}`,
    `transferir a de outro registra autor e destino: ${JSON.stringify(aviso)}`
  );

  // E limpar a atribuicao alheia tambem.
  r = await pedir(`/api/conversas/${conversa.id}/atendente`, {
    metodo: "PATCH", corpo: { atendenteId: null }, token: tBruno,
  });
  check(r.status === 200, `Bruno REMOVE a atribuicao da Carla -> ${r.status}`);
  noBanco = await prisma.conversa.findUnique({ where: { id: conversa.id } });
  check(noBanco.atendenteId === null, "a conversa ficou sem responsavel");

  // ─────────────────────────────────────────────────────────────────────────
  titulo("3. Bruno continua podendo o que sempre pode -- nada foi trancado a mais");

  // A conversa da secao 2 ficou sem dono; esta secao precisa de uma com dono.
  conversa = await criarConversa(alice);

  const conversaLivre = await criarConversa(null);
  r = await pedir(`/api/conversas/${conversaLivre.id}/atendente`, {
    metodo: "PATCH", corpo: { atendenteId: bruno.id }, token: tBruno,
  });
  check(r.status === 200, `conversa SEM dono: qualquer um do setor atribui -> ${r.status}`);

  r = await pedir(`/api/conversas/${conversa.id}`, { token: tBruno });
  check(r.status === 200, "Bruno continua LENDO a conversa da Alice (o setor e o mesmo)");

  r = await pedir(`/api/conversas/${conversa.id}/mensagens`, {
    metodo: "POST", corpo: { texto: "posso ajudar aqui" }, token: tBruno,
  });
  check(
    r.status === 200 || r.status === 201,
    `Bruno continua RESPONDENDO na conversa da Alice -> ${r.status} (a conversa nunca foi trancada)`
  );
  noBanco = await prisma.conversa.findUnique({ where: { id: conversa.id } });
  check(noBanco.atendenteId === alice.id, "e responder NAO rouba a autoria: segue Alice");

  // ─────────────────────────────────────────────────────────────────────────
  titulo("4. Administrador transfere (escalonamento continua possivel)");

  r = await pedir(`/api/conversas/${conversa.id}/atendente`, {
    metodo: "PATCH", corpo: { atendenteId: carla.id }, token: tAdmin,
  });
  check(r.status === 200, `admin transfere conversa de outra pessoa -> ${r.status}`);
  noBanco = await prisma.conversa.findUnique({ where: { id: conversa.id } });
  check(noBanco.atendenteId === carla.id, "o banco registra a transferencia feita pelo admin");

  // ─────────────────────────────────────────────────────────────────────────
  titulo("5. DUPLO CLIQUE: uma transferencia, um aviso");

  conversa = await criarConversa(alice);
  const [r1, r2] = await Promise.all([
    pedir(`/api/conversas/${conversa.id}/atendente`, { metodo: "PATCH", corpo: { atendenteId: carla.id }, token: tAlice }),
    pedir(`/api/conversas/${conversa.id}/atendente`, { metodo: "PATCH", corpo: { atendenteId: carla.id }, token: tAlice }),
  ]);
  const oks = [r1, r2].filter((x) => x.status === 200).length;
  // As DUAS respondem 200: o mesmo destino pedido duas vezes nao e conflito, e
  // um clique repetido. Quem chega em segundo encontra a conversa ja no estado
  // que queria e devolve sucesso sem gravar nada de novo.
  check(oks === 2, `dois cliques no MESMO atendente: ${r1.status} e ${r2.status} (esperado 200 e 200)`);

  noBanco = await prisma.conversa.findUnique({ where: { id: conversa.id } });
  check(noBanco.atendenteId === carla.id, "o dono final e Carla, uma vez so");

  let avisos = await prisma.mensagem.count({
    where: { conversaId: conversa.id, origem: "sistema", texto: { contains: "transferida" } },
  });
  check(avisos === 1, `o historico tem UM aviso de transferencia (encontrados: ${avisos})`);

  // ─────────────────────────────────────────────────────────────────────────
  titulo("6. REENVIO: transferir de novo para quem ja e o dono nao duplica nada");

  r = await pedir(`/api/conversas/${conversa.id}/atendente`, {
    metodo: "PATCH", corpo: { atendenteId: carla.id }, token: tAdmin,
  });
  check(r.status === 200, `repetir a mesma transferencia -> ${r.status} (idempotente, nao e erro)`);
  avisos = await prisma.mensagem.count({
    where: { conversaId: conversa.id, origem: "sistema", texto: { contains: "transferida" } },
  });
  check(avisos === 1, `continua UM aviso no historico (encontrados: ${avisos})`);

  // ─────────────────────────────────────────────────────────────────────────
  titulo("7. CORRIDA REAL: dois destinos diferentes ao mesmo tempo");

  conversa = await criarConversa(admin);
  const [ra, rb] = await Promise.all([
    pedir(`/api/conversas/${conversa.id}/atendente`, { metodo: "PATCH", corpo: { atendenteId: alice.id }, token: tAdmin }),
    pedir(`/api/conversas/${conversa.id}/atendente`, { metodo: "PATCH", corpo: { atendenteId: bruno.id }, token: tAdmin }),
  ]);
  const vencedores = [ra, rb].filter((x) => x.status === 200).length;
  const conflitos = [ra, rb].filter((x) => x.status === 409).length;
  check(
    vencedores === 1 && conflitos === 1,
    `uma vence e a outra recebe conflito -> ${ra.status} e ${rb.status} (esperado 200 e 409)`
  );
  noBanco = await prisma.conversa.findUnique({ where: { id: conversa.id } });
  check(
    noBanco.atendenteId === alice.id || noBanco.atendenteId === bruno.id,
    "o dono final e UM dos dois, e nao uma mistura"
  );
  avisos = await prisma.mensagem.count({
    where: { conversaId: conversa.id, origem: "sistema", texto: { contains: "transferida" } },
  });
  check(avisos === 1, `so a que venceu escreveu no historico (avisos: ${avisos})`);

  // ─────────────────────────────────────────────────────────────────────────
  titulo("8. O guard de SETOR nao foi afrouxado");

  const financeiro = await criarUsuario("fin", "Financeiro");
  const tFin = await logar(financeiro.email);
  const conversaTecnica = await criarConversa(null, "Técnico");
  r = await pedir(`/api/conversas/${conversaTecnica.id}/atendente`, {
    metodo: "PATCH", corpo: { atendenteId: financeiro.id }, token: tFin,
  });
  check(r.status === 403, `Financeiro mexendo em conversa do Tecnico -> ${r.status} (403 de setor)`);
  check(r.json?.error?.code === "FORBIDDEN_SECTOR", "e o 403 de SETOR, nao o de dono");

  // ─────────────────────────────────────────────────────────────────────────
  titulo("9. Sem sessao nao passa");

  r = await pedir(`/api/conversas/${conversa.id}/atendente`, {
    metodo: "PATCH", corpo: { atendenteId: alice.id },
  });
  check(r.status === 401, `sem token -> ${r.status}`);

  // ─────────────────────────────────────────────────────────────────────────
  titulo("limpeza");
  await limpar();
  const sobrou = await prisma.usuario.count({ where: { email: { startsWith: `${MARCA}-` } } });
  check(sobrou === 0, `limpeza completa (sobraram ${sobrou} registros)`);
}

main()
  .catch((e) => { erros.push(`excecao: ${e.message}`); console.error(e); })
  .finally(async () => {
    await limpar().catch(() => {});
    if (servidor) servidor.close();
    await prisma.$disconnect();
    if (erros.length) {
      console.log(`\nFALHAS (${erros.length}):`);
      for (const e of erros) console.log(`  ${e}`);
      process.exit(1);
    }
    console.log("\nTRANSFERENCIA: TUDO CONFERE");
  });
