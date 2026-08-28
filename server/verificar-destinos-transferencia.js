/**
 * O TECNICO CONSEGUE VER PARA QUEM TRANSFERIR?
 *
 * ── O DEFEITO ──────────────────────────────────────────────────────────────
 *
 * "Escolha um atendente que vai assumir essa conversa" / "Nenhum outro operador
 * com conta" -- com a base cheia de operadores.
 *
 * O seletor usava a lista global da equipe, de `GET /api/equipe`. Essa rota e
 * guardada por `exigirModulo("equipe")` -- o modulo da tela de GESTAO DA
 * EQUIPE. Na matriz de permissoes ele e do grupo A, e o padrao do grupo A e
 * "so o Comercial":
 *
 *     if (def.grupo === "B") return true;
 *     return cargo === "Comercial";
 *
 * Entao Tecnico e Financeiro levavam 403. E o erro nao aparecia: o AppContext
 * carrega tudo com `Promise.allSettled` e converte promessa rejeitada em lista
 * vazia -- "nao consegui carregar" virava "nao ha ninguem".
 *
 * A consulta nunca foi o problema: `equipe.service.listar()` nao filtra cargo
 * nenhum. Era a PORTA: transferir passou a depender do modulo de ADMINISTRAR a
 * equipe, que e outra coisa.
 *
 * ── O QUE ESTE ARQUIVO MEDE ────────────────────────────────────────────────
 *
 * Bate na API por HTTP, com contas reais de cada cargo. E cobre os dois lados:
 * o Tecnico passou a VER os destinos, e a rota de GESTAO continua fechada para
 * ele -- a correcao nao podia ser dar o modulo "equipe" ao Tecnico.
 *
 * Cria e apaga as proprias contas e conversas. Nada real e tocado.
 *
 *   cd server && node verificar-destinos-transferencia.js
 */
process.env.TURNSTILE_SITE_KEY = "";
process.env.TURNSTILE_SECRET_KEY = "";

const bcrypt = require("bcryptjs");
const prisma = require("./src/infrastructure/database/prisma.client");
const createApp = require("./src/app");

const MARCA = "teste-destinos";
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
let instanciaId = null;

async function logar(email) {
  const r = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.21, 10.0.0.1" },
    body: JSON.stringify({ email, senha: SENHA }),
  });
  return (await r.json())?.data?.token;
}

async function pedir(caminho, { metodo = "GET", corpo, token } = {}) {
  const r = await fetch(base + caminho, {
    method: metodo,
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": "203.0.113.21, 10.0.0.1",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
  });
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* nao-JSON */ }
  return { status: r.status, json, texto };
}

async function criarUsuario(sufixo, cargo, ativo = true) {
  return prisma.usuario.create({
    data: {
      nome: `${MARCA} ${sufixo}`,
      email: `${MARCA}-${sufixo}@exemplo.test`,
      senhaHash: await bcrypt.hash(SENHA, 10),
      cargo,
      ativo,
    },
  });
}

async function criarConversa(setor, dono = null) {
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

  const tecnico = await criarUsuario("tecnico", "Técnico");
  const tecnico2 = await criarUsuario("tecnico2", "Técnico");
  const financeiro = await criarUsuario("financeiro", "Financeiro");
  const comercial = await criarUsuario("comercial", "Comercial");
  const desativado = await criarUsuario("desativado", "Técnico", false);

  const tTec = await logar(tecnico.email);
  const tFin = await logar(financeiro.email);
  const tCom = await logar(comercial.email);
  check(!!tTec && !!tFin && !!tCom, "as contas de teste entraram");

  const conversa = await criarConversa("Técnico", tecnico);

  // ─────────────────────────────────────────────────────────────────────────
  titulo("1. O DEFEITO: a rota antiga continua fechada para o Tecnico");

  const equipeTec = await pedir("/api/equipe", { token: tTec });
  check(
    equipeTec.status === 403,
    `Tecnico em GET /api/equipe -> ${equipeTec.status} (era daqui que vinha a lista vazia)`
  );
  const equipeFin = await pedir("/api/equipe", { token: tFin });
  check(equipeFin.status === 403, `Financeiro em GET /api/equipe -> ${equipeFin.status}`);
  const equipeCom = await pedir("/api/equipe", { token: tCom });
  check(equipeCom.status === 200, `Comercial em GET /api/equipe -> ${equipeCom.status} (por isso so ele via a lista)`);

  // ─────────────────────────────────────────────────────────────────────────
  titulo("2. A CORRECAO: o Tecnico ve os destinos pela rota de atendimento");

  const destinos = await pedir(`/api/conversas/atendentes?conversaId=${conversa.id}`, { token: tTec });
  check(destinos.status === 200, `Tecnico em GET /conversas/atendentes -> ${destinos.status}`);
  const lista = destinos.json?.data || [];
  check(Array.isArray(lista) && lista.length > 0, `a lista NAO volta vazia (${lista.length} operadores)`);

  const ids = lista.map((u) => u.id);
  check(ids.includes(tecnico2.id), "o outro Tecnico aparece");
  check(ids.includes(financeiro.id), "o Financeiro aparece");
  check(ids.includes(comercial.id), "o Comercial aparece");
  check(
    !ids.includes(desativado.id),
    "conta DESATIVADA nao aparece (nao entra no painel para atender)"
  );

  // O Financeiro tinha o mesmo problema.
  const destinosFin = await pedir("/api/conversas/atendentes", { token: tFin });
  check(destinosFin.status === 200, `Financeiro em GET /conversas/atendentes -> ${destinosFin.status}`);
  check((destinosFin.json?.data || []).length > 0, "e tambem recebe a lista");

  // ─────────────────────────────────────────────────────────────────────────
  titulo("3. A resposta traz o necessario para escolher, e nada de gestao");

  const um = lista[0];
  check(
    ["id", "nome", "cargo", "status"].every((k) => k in um),
    `cada operador traz id/nome/cargo/status (${Object.keys(um).join(", ")})`
  );
  check(!("email" in um), "e NAO traz e-mail -- isso e dado da tela de gestao");
  check(!("senhaHash" in um) && !("criadoEm" in um), "nem hash de senha, nem data de criacao");
  check(
    lista.every((u) => u.status === "online" || u.status === "offline"),
    "o status usa o mesmo vocabulario da Gestao da Equipe"
  );

  // ─────────────────────────────────────────────────────────────────────────
  titulo("4. `podeVerConversa` avisa quem nao enxergaria a conversa");

  const fin = lista.find((u) => u.id === financeiro.id);
  const tec2 = lista.find((u) => u.id === tecnico2.id);
  check(tec2.podeVerConversa === true, "outro Tecnico ENXERGA uma conversa do setor Tecnico");
  check(fin.podeVerConversa === false, "o Financeiro NAO enxerga -- a tela avisa antes de mandar para la");
  check(
    lista.find((u) => u.id === comercial.id).podeVerConversa === false,
    "o Comercial tambem nao"
  );
  // Ninguem e escondido: a decisao continua sendo de quem atende.
  check(ids.includes(financeiro.id), "mas ele CONTINUA na lista -- e aviso, nao bloqueio");

  // Sem conversaId nao ha setor a comparar, e o campo nem aparece.
  const semConversa = await pedir("/api/conversas/atendentes", { token: tTec });
  check(
    (semConversa.json?.data || []).every((u) => !("podeVerConversa" in u)),
    "sem conversaId, o campo nem e emitido (nao ha setor com o que comparar)"
  );

  // ─────────────────────────────────────────────────────────────────────────
  titulo("5. A transferencia funciona de ponta a ponta, feita pelo Tecnico");

  const r = await pedir(`/api/conversas/${conversa.id}/atendente`, {
    metodo: "PATCH", corpo: { atendenteId: tecnico2.id }, token: tTec,
  });
  check(r.status === 200, `o Tecnico (dono) transfere para o outro Tecnico -> ${r.status}`);
  const noBanco = await prisma.conversa.findUnique({ where: { id: conversa.id } });
  check(noBanco.atendenteId === tecnico2.id, "o banco registra o novo responsavel");

  // E o destinatario ENXERGA a conversa (o teste que o brief pede).
  const tTec2 = await logar(tecnico2.email);
  const vista = await pedir(`/api/conversas/${conversa.id}`, { token: tTec2 });
  check(vista.status === 200, `quem recebeu abre a conversa -> ${vista.status}`);
  check(vista.json?.data?.atendenteId === tecnico2.id, "e ela aparece como dele");

  // ─────────────────────────────────────────────────────────────────────────
  titulo("6. Nada de seguranca foi afrouxado para isso funcionar");

  const semSessao = await pedir("/api/conversas/atendentes");
  check(semSessao.status === 401, `sem sessao -> ${semSessao.status}`);

  // Conversa de outro setor: quem nao le a conversa nao descobre por ela.
  const doFinanceiro = await criarConversa("Financeiro");
  const espiar = await pedir(`/api/conversas/atendentes?conversaId=${doFinanceiro.id}`, { token: tTec });
  check(espiar.status === 403, `Tecnico pedindo destinos de uma conversa do Financeiro -> ${espiar.status}`);

  const inexistente = await pedir("/api/conversas/atendentes?conversaId=nao-existe", { token: tTec });
  check(inexistente.status === 404, `conversaId inexistente -> ${inexistente.status}`);

  // A rota de GESTAO continua exigindo o modulo de gestao.
  check(equipeTec.status === 403, "GET /api/equipe segue 403 para o Tecnico (nao ganhamos o modulo por atalho)");

  // ─────────────────────────────────────────────────────────────────────────
  titulo("limpeza");
  await limpar();
  const sobrou = await prisma.usuario.count({ where: { email: { startsWith: `${MARCA}-` } } });
  check(sobrou === 0, `limpeza completa (sobraram ${sobrou})`);
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
    console.log("\nDESTINOS DE TRANSFERENCIA: TUDO CONFERE");
  });
