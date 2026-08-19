const { test, before, after, describe } = require("node:test");
const assert = require("node:assert/strict");
const { criarAmbiente, req } = require("./helpers/harness");

describe("Gestao da equipe (escalonamento de privilegio)", () => {
  let env, base;
  before(async () => {
    env = criarAmbiente("equipe");
    await env.semear();
    base = await env.iniciar();
  });
  after(async () => env.encerrar());

  test("nao-admin NAO consegue se promover a Administrador", async () => {
    const r = await req(base, "PATCH", `/api/equipe/${env.usuarios.tecnico.id}/cargo`, {
      token: env.tokens.tecnico,
      body: { cargo: "Administrador" },
    });
    assert.equal(r.status, 403);
    const depois = await env.prisma.usuario.findUnique({ where: { id: env.usuarios.tecnico.id } });
    assert.equal(depois.cargo, "Técnico", "cargo nao pode ter mudado");
  });

  test("nao-admin NAO consegue ativar/desativar contas", async () => {
    const r = await req(base, "PATCH", `/api/equipe/${env.usuarios.financeiro.id}/status`, {
      token: env.tokens.tecnico,
      body: { ativo: false },
    });
    assert.equal(r.status, 403);
  });

  test("admin consegue alterar cargo", async () => {
    const r = await req(base, "PATCH", `/api/equipe/${env.usuarios.comercial.id}/cargo`, {
      token: env.tokens.admin,
      body: { cargo: "Financeiro" },
    });
    assert.equal(r.status, 200);
  });

  test("nao pode rebaixar o ultimo Administrador ativo", async () => {
    const r = await req(base, "PATCH", `/api/equipe/${env.usuarios.admin.id}/cargo`, {
      token: env.tokens.admin,
      body: { cargo: "Técnico" },
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "ULTIMO_ADMIN");
  });

  test("token forjado com cargo=Administrador NAO vale (cargo vem do banco)", async () => {
    // Simula um token defasado: assinado como admin, mas o banco diz Tecnico.
    const tokenFalso = env.tokenCargo(env.usuarios.tecnico, "Administrador");
    const r = await req(base, "PATCH", `/api/equipe/${env.usuarios.financeiro.id}/cargo`, {
      token: tokenFalso,
      body: { cargo: "Administrador" },
    });
    assert.equal(r.status, 403);
  });
});
