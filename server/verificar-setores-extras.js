/**
 * SETORES EXTRAS POR PESSOA -- a verificacao do lado que CONCEDE.
 *
 * ── POR QUE ISTO NAO ESTA DENTRO DE verificar-escopo-dados.js ──────────────
 *
 * Aquela varredura procura VAZAMENTO: ela prova que quem nao devia ver, nao ve.
 * E ela continua passando inteira depois desta mudanca -- o que e necessario e
 * nao e suficiente. Um `podeAcessarSetor` que devolvesse `false` para tudo
 * passaria naquela suite com louvor.
 *
 * O que falta provar e o oposto: que o extra REALMENTE abre a porta, pela API
 * de verdade, e que tirar o extra fecha de novo. Sem esta metade, a tela de
 * Gestao da Equipe poderia marcar setores que nao mudam nada e ninguem
 * perceberia ate alguem reclamar que "marquei e continua sem ver".
 *
 * ── O QUE E EXERCITADO ─────────────────────────────────────────────────────
 *
 *   1. Comercial SEM extra nao ve a conversa do Tecnico          (403)
 *   2. o mesmo Comercial COM o extra "Técnico" passa a ver       (200)
 *   3. o extra tambem vale na LISTAGEM, e nao so no acesso por id
 *   4. tirar o extra fecha a porta de novo                       (403)
 *   5. extra nunca TIRA: o proprio setor do cargo continua visivel
 *   6. lixo gravado na coluna nao vira acesso a nada
 *
 * O passo 4 importa mais do que parece: `req.user` e remontado do BANCO a cada
 * requisicao justamente para que revogar valha na hora, e nao quando o token
 * vencer. Se alguem um dia mover os extras para dentro do JWT "para poupar uma
 * consulta", este passo quebra -- que e o aviso que se quer ter.
 *
 * TOCA O BANCO DE DESENVOLVIMENTO e limpa tudo no final.
 *
 *   cd server && node verificar-setores-extras.js
 */
process.env.TURNSTILE_SITE_KEY = "";
process.env.TURNSTILE_SECRET_KEY = "";

const bcrypt = require("bcryptjs");
const prisma = require("./src/infrastructure/database/prisma.client");
const createApp = require("./src/app");

const MARCA = "extras-" + process.pid;
const criados = { usuarios: [], conversas: [], instancias: [] };
const erros = [];
let secao = "";
let base = "";
let servidor = null;

const titulo = (t) => { secao = t; console.log(`\n=== ${t} ===`); };
const check = (ok, msg) => {
  console.log(`  ${ok ? "OK  " : "FALHA"} ${msg}`);
  if (!ok) erros.push(`[${secao}] ${msg}`);
};

async function logar(email, senha) {
  const r = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": "10.9.9.9, 10.0.0.1" },
    body: JSON.stringify({ email, senha }),
  });
  const json = await r.json().catch(() => null);
  const token = (json?.data || json || {}).token;
  if (r.status !== 200 || !token) {
    throw new Error(`login falhou para ${email}: HTTP ${r.status}`);
  }
  return token;
}

async function get(caminho, token) {
  const r = await fetch(base + caminho, { headers: { Authorization: `Bearer ${token}` } });
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* nao-JSON */ }
  return { status: r.status, texto, json };
}

async function criarUsuario(cargo) {
  const senha = "Senha!" + Math.random().toString(36).slice(2, 10);
  const semAcento = cargo.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const u = await prisma.usuario.create({
    data: {
      nome: `${MARCA}-${cargo}`,
      email: `${MARCA}-${semAcento}@teste.local`.toLowerCase(),
      senhaHash: await bcrypt.hash(senha, 10),
      cargo,
      ativo: true,
    },
  });
  criados.usuarios.push(u.id);
  return { ...u, senha };
}

// Grava os extras DIRETO no banco de proposito: o que esta sob teste e a regra
// de acesso, nao a rota que a edita. Passar pelo PATCH aqui misturaria as duas
// falhas -- uma rota quebrada pareceria uma regra quebrada.
const darExtras = (id, valor) =>
  prisma.usuario.update({ where: { id }, data: { setoresExtras: valor } });

(async () => {
  try {
    const app = createApp();
    await new Promise((r) => { servidor = app.listen(0, r); });
    base = `http://127.0.0.1:${servidor.address().port}`;
    console.log(`app de teste em ${base}`);

    const comercial = await criarUsuario("Comercial");

    const instancia = await prisma.instancia.create({
      data: { nome: MARCA, conectado: false, webhookSecret: MARCA },
    });
    criados.instancias.push(instancia.id);

    const conversaTecnico = await prisma.conversa.create({
      data: {
        instanciaId: instancia.id,
        cliente: `${MARCA}-cliente-tecnico`,
        telefone: "5551900000001",
        statusAtendimento: "pendente",
        setor: "Técnico",
      },
    });
    criados.conversas.push(conversaTecnico.id);

    const conversaComercial = await prisma.conversa.create({
      data: {
        instanciaId: instancia.id,
        cliente: `${MARCA}-cliente-comercial`,
        telefone: "5551900000002",
        statusAtendimento: "pendente",
        setor: "Comercial",
      },
    });
    criados.conversas.push(conversaComercial.id);

    // ── 1 ────────────────────────────────────────────────────────────────
    titulo("1. Comercial SEM extra nao ve a conversa do Tecnico");
    let token = await logar(comercial.email, comercial.senha);
    let r = await get(`/api/conversas/${conversaTecnico.id}`, token);
    check(r.status === 403, `GET conversa do Tecnico -> ${r.status} (esperado 403)`);

    // ── 2 ────────────────────────────────────────────────────────────────
    titulo("2. Com o extra 'Técnico', o mesmo Comercial passa a ver");
    await darExtras(comercial.id, "Técnico");
    // MESMO TOKEN de proposito: o acesso vem do banco a cada requisicao, entao
    // a permissao nova vale sem novo login. Se um dia isso exigir relogar, e
    // porque os extras foram parar dentro do JWT -- e este check acusa.
    r = await get(`/api/conversas/${conversaTecnico.id}`, token);
    check(r.status === 200, `GET conversa do Tecnico com o mesmo token -> ${r.status} (esperado 200)`);

    // ── 3 ────────────────────────────────────────────────────────────────
    titulo("3. O extra vale na LISTAGEM, e nao so no acesso por id");
    r = await get("/api/conversas", token);
    const lista = r.json?.data || r.json || [];
    const ids = (Array.isArray(lista) ? lista : []).map((c) => c.id);
    check(ids.includes(conversaTecnico.id), "a conversa do Tecnico aparece na listagem do Comercial");
    check(ids.includes(conversaComercial.id), "a conversa do proprio Comercial continua aparecendo");

    // ── 4 ────────────────────────────────────────────────────────────────
    titulo("4. Tirar o extra fecha a porta de novo, sem esperar o token vencer");
    await darExtras(comercial.id, null);
    r = await get(`/api/conversas/${conversaTecnico.id}`, token);
    check(r.status === 403, `GET conversa do Tecnico apos revogar -> ${r.status} (esperado 403)`);

    // ── 5 ────────────────────────────────────────────────────────────────
    titulo("5. Extra SOMA, nunca subtrai");
    await darExtras(comercial.id, "Financeiro");
    r = await get(`/api/conversas/${conversaComercial.id}`, token);
    check(r.status === 200, `o proprio setor do cargo continua visivel -> ${r.status} (esperado 200)`);
    r = await get(`/api/conversas/${conversaTecnico.id}`, token);
    check(r.status === 403, `um extra de Financeiro nao abre o Tecnico -> ${r.status} (esperado 403)`);

    // ── 6 ────────────────────────────────────────────────────────────────
    titulo("6. Lixo gravado na coluna nao vira acesso a nada");
    await darExtras(comercial.id, "Suporte,,xyz,Administrador");
    r = await get(`/api/conversas/${conversaTecnico.id}`, token);
    check(r.status === 403, `extras invalidos -> ${r.status} (esperado 403)`);
    r = await get(`/api/conversas/${conversaComercial.id}`, token);
    check(r.status === 200, `e nao quebram o acesso que a pessoa ja tinha -> ${r.status} (esperado 200)`);
  } catch (e) {
    erros.push(`[fatal] ${e.message}`);
    console.error("\nERRO FATAL:", e.message);
  } finally {
    titulo("limpeza");
    for (const id of criados.conversas) await prisma.conversa.delete({ where: { id } }).catch(() => {});
    for (const id of criados.instancias) await prisma.instancia.delete({ where: { id } }).catch(() => {});
    for (const id of criados.usuarios) {
      await prisma.sessaoRefresh.deleteMany({ where: { usuarioId: id } }).catch(() => {});
      await prisma.usuario.delete({ where: { id } }).catch(() => {});
    }
    const sobra =
      (await prisma.usuario.count({ where: { nome: { contains: MARCA } } })) +
      (await prisma.conversa.count({ where: { cliente: { contains: MARCA } } })) +
      (await prisma.instancia.count({ where: { nome: MARCA } }));
    check(sobra === 0, `limpeza completa (sobraram ${sobra} registros de teste)`);

    if (servidor) await new Promise((r) => servidor.close(r));
    await prisma.$disconnect();

    console.log(
      erros.length
        ? `\n${erros.length} FALHA(S):\n` + erros.map((e) => "  - " + e).join("\n")
        : "\nSETORES EXTRAS: CONCEDEM E REVOGAM COMO PROMETIDO"
    );
    process.exit(erros.length ? 1 : 0);
  }
})();
