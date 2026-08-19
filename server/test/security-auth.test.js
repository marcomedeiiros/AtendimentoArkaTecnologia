const { test, before, after, describe } = require("node:test");
const assert = require("node:assert/strict");
const { criarAmbiente, req } = require("./helpers/harness");

describe("Autenticacao e sessao (autoridade do banco)", () => {
  let env, base;
  before(async () => {
    env = criarAmbiente("auth");
    await env.semear();
    base = await env.iniciar();
  });
  after(async () => env.encerrar());

  test("rota protegida sem token -> 401", async () => {
    const r = await req(base, "GET", "/api/equipe");
    assert.equal(r.status, 401);
  });

  test("token malformado/assinatura invalida -> 401", async () => {
    const r = await req(base, "GET", "/api/equipe", { token: "abc.def.ghi" });
    assert.equal(r.status, 401);
  });

  test("token valido de conta ativa -> 200", async () => {
    const r = await req(base, "GET", "/api/equipe", { token: env.tokens.admin });
    assert.equal(r.status, 200);
  });

  test("token de conta DESATIVADA -> 403 (nao basta ter token valido)", async () => {
    const r = await req(base, "GET", "/api/auth/me", { token: env.tokens.inativo });
    assert.equal(r.status, 403);
    assert.equal(r.json.error.code, "CONTA_INATIVA");
  });

  test("token de conta EXCLUIDA -> 401 (identidade revalidada no banco)", async () => {
    const alvo = await env.prisma.usuario.create({
      data: { nome: "efemero", email: "efemero@t.com", senhaHash: "x", cargo: "Técnico", ativo: true },
    });
    const token = env.assinar(alvo);
    await env.prisma.usuario.delete({ where: { id: alvo.id } });
    const r = await req(base, "GET", "/api/auth/me", { token });
    assert.equal(r.status, 401);
  });
});
