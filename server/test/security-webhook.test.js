const { test, before, after, describe } = require("node:test");
const assert = require("node:assert/strict");
const { criarAmbiente, req } = require("./helpers/harness");

const EVENTO = { event: "messages.upsert", instance: "test-instance", data: { key: { remoteJid: "5527999999999@s.whatsapp.net", fromMe: false, id: "X" }, message: { conversation: "oi" } } };

describe("Webhook do WhatsApp (autenticacao)", () => {
  let env, base;
  before(async () => {
    env = criarAmbiente("webhook");
    await env.semear();
    base = await env.iniciar();
  });
  after(async () => env.encerrar());

  test("SEM token -> 401 (a ausencia nao pode passar)", async () => {
    const r = await req(base, "POST", "/api/webhook/v1/whatsapp", { body: EVENTO });
    assert.equal(r.status, 401);
    assert.equal(r.json.error.code, "WEBHOOK_UNAUTHORIZED");
  });

  test("token ERRADO -> 401", async () => {
    const r = await req(base, "POST", "/api/webhook/v1/whatsapp", {
      body: EVENTO,
      headers: { "x-webhook-token": "errado" },
    });
    assert.equal(r.status, 401);
  });

  test("responder (envia WhatsApp) SEM token -> 401", async () => {
    const r = await req(base, "POST", "/api/webhook/v1/whatsapp/responder", {
      body: { telefone: "5527999999999", texto: "spam" },
    });
    assert.equal(r.status, 401);
  });

  test("token CERTO -> passa da autenticacao (nao 401)", async () => {
    const r = await req(base, "POST", "/api/webhook/v1/whatsapp", {
      body: EVENTO,
      headers: { "x-webhook-token": process.env.WEBHOOK_SECRET },
    });
    assert.notEqual(r.status, 401);
  });
});
