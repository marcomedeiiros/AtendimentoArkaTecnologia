const { test, before, after, describe } = require("node:test");
const assert = require("node:assert/strict");
const { criarAmbiente, req } = require("./helpers/harness");

describe("Conversas: IDOR e isolamento por setor", () => {
  let env, base;
  before(async () => {
    env = criarAmbiente("idor");
    await env.semear();
    base = await env.iniciar();
  });
  after(async () => env.encerrar());

  test("Tecnico NAO le conversa do Financeiro (GET /:id) -> 403", async () => {
    const r = await req(base, "GET", `/api/conversas/${env.conversas.financeiro.id}`, {
      token: env.tokens.tecnico,
    });
    assert.equal(r.status, 403);
  });

  test("Tecnico NAO apaga conversa do Financeiro (IDOR em DELETE) -> 403", async () => {
    const r = await req(base, "DELETE", `/api/conversas/${env.conversas.financeiro.id}`, {
      token: env.tokens.tecnico,
    });
    assert.equal(r.status, 403);
    const aindaExiste = await env.prisma.conversa.findUnique({ where: { id: env.conversas.financeiro.id } });
    assert.ok(aindaExiste, "a conversa nao pode ter sido apagada");
  });

  test("Tecnico NAO envia mensagem para conversa do Financeiro -> 403", async () => {
    const r = await req(base, "POST", `/api/conversas/${env.conversas.financeiro.id}/mensagens`, {
      token: env.tokens.tecnico,
      body: { texto: "intruso" },
    });
    assert.equal(r.status, 403);
  });

  test("Tecnico NAO muda status de conversa do Financeiro -> 403", async () => {
    const r = await req(base, "PATCH", `/api/conversas/${env.conversas.financeiro.id}/status`, {
      token: env.tokens.tecnico,
      body: { status: "fechada" },
    });
    assert.equal(r.status, 403);
  });

  test("Tecnico NAO lista conversas de outros setores", async () => {
    const r = await req(base, "GET", "/api/conversas", { token: env.tokens.tecnico });
    assert.equal(r.status, 200);
    const setores = r.json.data.map((c) => c.setor);
    assert.ok(!setores.includes("Financeiro"), "nao deve vazar conversas do Financeiro na listagem");
  });

  test("Tecnico ACESSA a propria conversa e as Gerais", async () => {
    const rTec = await req(base, "GET", `/api/conversas/${env.conversas.tecnico.id}`, { token: env.tokens.tecnico });
    assert.equal(rTec.status, 200);
    const rGeral = await req(base, "GET", `/api/conversas/${env.conversas.geral.id}`, { token: env.tokens.tecnico });
    assert.equal(rGeral.status, 200);
  });

  test("Administrador acessa qualquer setor", async () => {
    const r = await req(base, "GET", `/api/conversas/${env.conversas.financeiro.id}`, { token: env.tokens.admin });
    assert.equal(r.status, 200);
  });
});
