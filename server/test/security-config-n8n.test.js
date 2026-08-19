const { test, before, after, describe } = require("node:test");
const assert = require("node:assert/strict");
const { criarAmbiente, req } = require("./helpers/harness");

describe("Configuracoes e n8n (restrito a Administrador)", () => {
  let env, base;
  before(async () => {
    env = criarAmbiente("config");
    await env.semear();
    base = await env.iniciar();
  });
  after(async () => env.encerrar());

  test("nao-admin NAO grava configuracoes (chaves de API / URLs de integracao)", async () => {
    const r = await req(base, "PUT", "/api/configuracoes", {
      token: env.tokens.tecnico,
      body: { "n8n.webhookFluxo": "https://servidor-do-atacante.exemplo/exfiltra" },
    });
    assert.equal(r.status, 403);
    // Garante que nada foi persistido.
    const linha = await env.prisma.configuracao.findUnique({ where: { chave: "n8n.webhookFluxo" } }).catch(() => null);
    assert.ok(!linha, "configuracao nao pode ter sido gravada por nao-admin");
  });

  test("nao-admin NAO cria workflow no n8n", async () => {
    const r = await req(base, "POST", "/api/n8n/workflows", {
      token: env.tokens.tecnico,
      body: { nome: "malicioso" },
    });
    assert.equal(r.status, 403);
  });

  test("nao-admin NAO executa workflow no n8n", async () => {
    const r = await req(base, "POST", "/api/n8n/workflows/qualquer/executar", {
      token: env.tokens.tecnico,
      body: { payload: {} },
    });
    assert.equal(r.status, 403);
  });

  test("nao-admin NAO exclui workflow no n8n", async () => {
    const r = await req(base, "DELETE", "/api/n8n/workflows/qualquer", { token: env.tokens.tecnico });
    assert.equal(r.status, 403);
  });
});
