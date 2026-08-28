/**
 * BLOQUEIO PROGRESSIVO -- o freio contra tentativa e erro de senha.
 *
 * ── POR QUE ESTE ARQUIVO EXISTE ────────────────────────────────────────────
 *
 * O rate limit responde "quantas requisicoes por janela". Isso corta volume,
 * mas nao distingue quem ACERTA de quem ERRA: quarenta logins certos e
 * quarenta tentativas de adivinhar senha contam igual. O bloqueio progressivo
 * responde a outra pergunta -- "quantas FALHAS seguidas" -- que e o sinal de
 * forca bruta.
 *
 * O risco de um mecanismo desses e virar arma. Bloquear a CONTA por e-mail e o
 * caminho obvio e e uma porta de negacao de servico: qualquer pessoa que saiba
 * o e-mail de um operador erra a senha dez vezes e tranca o acesso dele. O
 * ataque custa nada e quem paga e a empresa.
 *
 * Entao os testes daqui provam as duas coisas, e a segunda importa tanto quanto:
 *
 *   1. quem insiste errando E BARRADO (por IP);
 *   2. ninguem consegue trancar a conta DE OUTRA PESSOA, nem errando de
 *      proposito; e quem acerta a senha nao e barrado por nada disto.
 *
 * Usa `X-Forwarded-For` para simular IPs diferentes -- e o mesmo caminho que a
 * requisicao real percorre atras da Cloudflare e do nginx (TRUST_PROXY=2).
 *
 * Cria e apaga o proprio usuario. Nenhuma conta real e tocada.
 *
 *   cd server && node verificar-bloqueio.js
 */
process.env.TURNSTILE_SITE_KEY = "";   // o desafio nao e o assunto deste teste
process.env.TURNSTILE_SECRET_KEY = "";

const bcrypt = require("bcryptjs");
const prisma = require("./src/infrastructure/database/prisma.client");
const createApp = require("./src/app");
const bloqueio = require("./src/shared/middlewares/bloqueioProgressivo.middleware");

const MARCA = "teste-bloqueio";
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

async function tentar(email, senha, ip) {
  const t0 = Date.now();
  const r = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": `${ip}, 10.0.0.1` },
    body: JSON.stringify({ email, senha }),
  });
  return { status: r.status, ms: Date.now() - t0, corpo: await r.text() };
}

(async () => {
  let usuario = null;
  let vitima = null;
  try {
    const app = createApp();
    await new Promise((res) => { servidor = app.listen(0, "127.0.0.1", res); });
    base = `http://127.0.0.1:${servidor.address().port}`;

    const senhaHash = await bcrypt.hash(SENHA, 10);
    usuario = await prisma.usuario.create({
      data: { nome: "Teste Bloqueio", email: `${MARCA}-a@exemplo.invalido`, senhaHash, cargo: "Administrador", ativo: true },
    });
    vitima = await prisma.usuario.create({
      data: { nome: "Teste Vitima", email: `${MARCA}-vitima@exemplo.invalido`, senhaHash, cargo: "Administrador", ativo: true },
    });

    // ─────────────────────────────────────────────────────────────────────
    titulo("1. Senha certa passa -- o freio nao atrapalha quem acerta");
    bloqueio._zerar();
    const ok1 = await tentar(usuario.email, SENHA, "198.51.100.1");
    check(ok1.status === 200, `login valido -> ${ok1.status}`);

    // ─────────────────────────────────────────────────────────────────────
    titulo("2. Insistir errando e barrado (por IP)");
    bloqueio._zerar();
    const IP_ATACANTE = "198.51.100.66";
    const statuses = [];
    for (let i = 0; i < 12; i++) {
      const r = await tentar(usuario.email, "senha-errada", IP_ATACANTE);
      statuses.push(r.status);
    }
    const bloqueou = statuses.some((s) => s === 429 || s === 403);
    check(bloqueou, `apos 12 erros o IP e barrado (statuses: ${[...new Set(statuses)].join(", ")})`);

    // A prova que separa "bloqueio" de "senha errada": mesmo COM A SENHA CERTA,
    // o IP castigado nao entra. Se passasse, o bloqueio seria decorativo.
    const comSenhaCerta = await tentar(usuario.email, SENHA, IP_ATACANTE);
    check(comSenhaCerta.status !== 200,
      `o IP barrado nao entra nem com a senha certa -> ${comSenhaCerta.status}`);

    // ─────────────────────────────────────────────────────────────────────
    titulo("3. O bloqueio e do IP, e nao da conta (nao vira arma)");
    // Este e o teste que impede o mecanismo de virar negacao de servico: o
    // atacante acabou de errar 12 vezes NAQUELA conta. O dono dela, vindo do
    // proprio IP, tem de conseguir entrar normalmente.
    const donoDeOutroIp = await tentar(usuario.email, SENHA, "203.0.113.77");
    check(donoDeOutroIp.status === 200,
      `o dono entra de outro IP, mesmo apos o ataque -> ${donoDeOutroIp.status}`);

    // ─────────────────────────────────────────────────────────────────────
    titulo("4. Errar numa conta nao tranca as outras");
    bloqueio._zerar();
    const IP_LIMPO = "203.0.113.90";
    for (let i = 0; i < 4; i++) await tentar(vitima.email, "errada", IP_LIMPO);
    // Poucas falhas: ainda nao bloqueia, no maximo atrasa.
    const outraConta = await tentar(usuario.email, SENHA, "203.0.113.91");
    check(outraConta.status === 200, `outra conta, outro IP, segue entrando -> ${outraConta.status}`);

    // ─────────────────────────────────────────────────────────────────────
    titulo("5. Acertar a senha ZERA o castigo");
    bloqueio._zerar();
    const IP_DISTRAIDO = "203.0.113.55";
    for (let i = 0; i < 3; i++) await tentar(usuario.email, "errada", IP_DISTRAIDO);
    const lembrou = await tentar(usuario.email, SENHA, IP_DISTRAIDO);
    check(lembrou.status === 200, `quem lembra a senha na 4a tentativa entra -> ${lembrou.status}`);
    // E o contador some: as falhas anteriores nao ficam pendendo sobre ele.
    const depois = await tentar(usuario.email, SENHA, IP_DISTRAIDO);
    check(depois.status === 200, `e continua entrando depois -> ${depois.status}`);

    // ─────────────────────────────────────────────────────────────────────
    titulo("6. O atraso tem TETO (senao a defesa vira DoS em nos mesmos)");
    // Cada requisicao presa segura um socket. Sem teto, o proprio mecanismo
    // derruba o servidor -- o atacante nem precisa acertar a senha.
    bloqueio._zerar();
    const IP_LENTO = "203.0.113.44";
    let pior = 0;
    for (let i = 0; i < 7; i++) {
      const r = await tentar(usuario.email, "errada", IP_LENTO);
      if (r.status !== 429 && r.status !== 403) pior = Math.max(pior, r.ms);
    }
    const teto = require("./src/config/env").seguranca.atrasoMaxMs;
    check(pior <= teto + 1500, `nenhuma resposta passou do teto (pior: ${pior}ms, teto: ${teto}ms)`);
  } catch (e) {
    console.error("\nERRO NO TESTE:", e.stack || e.message);
    erros.push("excecao: " + e.message);
  } finally {
    if (servidor) servidor.close();
    // As sessoes saem PRIMEIRO e por `usuarioId`: `SessaoRefresh` nao tem
    // relacao `usuario` no schema, e cada login bem-sucedido do teste criou uma.
    // Sem isto elas ficariam orfas no banco de desenvolvimento.
    const ids = (await prisma.usuario
      .findMany({ where: { email: { startsWith: MARCA } }, select: { id: true } })
      .catch(() => [])).map((u) => u.id);
    if (ids.length) {
      await prisma.sessaoRefresh.deleteMany({ where: { usuarioId: { in: ids } } }).catch(() => {});
    }
    await prisma.usuario.deleteMany({ where: { email: { startsWith: MARCA } } }).catch(() => {});
    const restou = await prisma.usuario.count({ where: { email: { startsWith: MARCA } } }).catch(() => -1);
    const sessoesOrfas = ids.length
      ? await prisma.sessaoRefresh.count({ where: { usuarioId: { in: ids } } }).catch(() => -1)
      : 0;
    check(restou === 0 && sessoesOrfas === 0,
      `limpeza completa (${restou} usuarios, ${sessoesOrfas} sessoes restantes)`);
    await prisma.$disconnect();
    console.log(
      "\n" + (erros.length
        ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ")
        : "BLOQUEIO PROGRESSIVO: TUDO CONFERE")
    );
    process.exit(erros.length ? 1 : 0);
  }
})();
