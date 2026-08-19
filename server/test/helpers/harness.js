// Harness de testes de seguranca.
//
// Cada arquivo de teste roda em processo proprio (node --test) e cria um banco
// SQLite descartavel, sobe o app numa porta efemera e semeia usuarios/conversas.
// Nao depende de rede: as chamadas externas (Evolution/n8n) nao sao exercitadas
// pelos casos aqui -- validamos autorizacao/validacao, que acontece ANTES.
//
// IMPORTANTE: as variaveis de ambiente sao definidas ANTES de requerer o app,
// porque o prisma.client e um singleton que le DATABASE_URL na construcao.

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { execSync } = require("child_process");

const RAIZ = path.join(__dirname, "..", "..");

function criarAmbiente(nome) {
  // 1) Ambiente isolado, definido antes de qualquer require de app/prisma.
  const dir = path.join(RAIZ, ".test-dbs");
  fs.mkdirSync(dir, { recursive: true });
  const dbFile = path.join(dir, `${nome}-${crypto.randomBytes(4).toString("hex")}.db`);
  const url = `file:${dbFile.replace(/\\/g, "/")}`;

  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = url;
  process.env.JWT_SECRET = "test-jwt-secret-fixo";
  process.env.WEBHOOK_SECRET = "test-webhook-secret-fixo";
  process.env.JWT_EXPIRES_IN = "8h";

  // 2) Cria o schema no banco descartavel.
  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    cwd: RAIZ,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "ignore",
  });

  // 3) Agora sim: requer app + prisma (ja com DATABASE_URL correto).
  const jwt = require("jsonwebtoken");
  const bcrypt = require("bcryptjs");
  const createApp = require("../../src/app");
  const prisma = require("../../src/infrastructure/database/prisma.client");

  const app = createApp();

  function assinar(usuario) {
    return jwt.sign(
      { sub: usuario.id, email: usuario.email, nome: usuario.nome, cargo: usuario.cargo },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );
  }

  const estado = { prisma, app, url, dbFile, server: null, base: null };

  estado.iniciar = () =>
    new Promise((resolve) => {
      estado.server = app.listen(0, () => {
        estado.base = `http://127.0.0.1:${estado.server.address().port}`;
        resolve(estado.base);
      });
    });

  estado.semear = async () => {
    const senhaHash = await bcrypt.hash("senha123", 8);

    const instancia = await prisma.instancia.create({
      data: { nome: "test-instance", conectado: true, webhookSecret: process.env.WEBHOOK_SECRET },
    });

    const mk = (nome, cargo, ativo = true) =>
      prisma.usuario.create({
        data: { nome, email: `${nome}@t.com`, senhaHash, cargo, ativo },
      });

    const admin = await mk("admin", "Administrador");
    const tecnico = await mk("tecnico", "Técnico");
    const financeiro = await mk("financeiro", "Financeiro");
    const comercial = await mk("comercial", "Comercial");
    const inativo = await mk("inativo", "Técnico", false);

    const conv = (cliente, setor) =>
      prisma.conversa.create({
        data: {
          instanciaId: instancia.id,
          cliente,
          telefone: "5527999" + Math.floor(Math.random() * 1e6),
          setor,
          statusAtendimento: "aberta",
        },
      });

    const convFinanceiro = await conv("Cliente Fin", "Financeiro");
    const convTecnico = await conv("Cliente Tec", "Técnico");
    const convGeral = await conv("Cliente Geral", "Geral");

    const usuarios = { admin, tecnico, financeiro, comercial, inativo };
    estado.usuarios = usuarios;
    estado.tokens = Object.fromEntries(
      Object.entries(usuarios).map(([k, u]) => [k, assinar(u)])
    );
    estado.instancia = instancia;
    estado.conversas = { financeiro: convFinanceiro, tecnico: convTecnico, geral: convGeral };
    return estado;
  };

  // Assina um token arbitrario (para simular token defasado / forjado).
  estado.assinar = assinar;
  estado.tokenCargo = (usuario, cargo) => assinar({ ...usuario, cargo });

  estado.encerrar = async () => {
    try { await prisma.$disconnect(); } catch { /* ignore */ }
    if (estado.server) await new Promise((r) => estado.server.close(r));
    try { fs.rmSync(dbFile, { force: true }); } catch { /* ignore */ }
  };

  return estado;
}

// Cliente HTTP minimo sobre o fetch global.
async function req(base, method, caminho, { token, body, headers } = {}) {
  const h = { "Content-Type": "application/json", ...(headers || {}) };
  if (token) h.Authorization = `Bearer ${token}`;
  const resp = await fetch(`${base}${caminho}`, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await resp.json(); } catch { /* sem corpo */ }
  return { status: resp.status, json };
}

module.exports = { criarAmbiente, req };
