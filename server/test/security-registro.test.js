const { test, before, after, describe } = require("node:test");
const assert = require("node:assert/strict");
const { criarAmbiente, req } = require("./helpers/harness");

describe("Cadastro publico (mass-assignment de privilegio)", () => {
  let env, base;
  before(async () => {
    env = criarAmbiente("registro");
    await env.semear(); // ja existe um admin -> novo cadastro NAO e o primeiro
    base = await env.iniciar();
  });
  after(async () => env.encerrar());

  test("auto-cadastro NAO pode escolher cargo Administrador", async () => {
    // Propriedade de seguranca (agnostica ao design): o atacante nunca fica com
    // conta Administrador. Defesa em profundidade: o DTO pode REJEITAR (4xx) ou,
    // se passar, o service COAGE para um papel comum. Qualquer um dos dois vale.
    const r = await req(base, "POST", "/api/auth/cadastrar", {
      body: { nome: "Invasor", email: "invasor@t.com", senha: "senha123", cargo: "Administrador" },
    });

    const criado = await env.prisma.usuario.findUnique({ where: { email: "invasor@t.com" } });

    if (r.status >= 400) {
      assert.ok(!criado, "cadastro rejeitado: nenhuma conta deve existir");
    } else {
      assert.ok(criado, "conta deveria existir");
      assert.notEqual(criado.cargo, "Administrador", "auto-cadastro nao pode virar Administrador");
    }
  });

  test("mesmo contornando o DTO, o service coage cargo para papel comum", async () => {
    // Ataca a 2a camada diretamente: chama o service com cargo malicioso,
    // provando que a defesa nao depende so da validacao de entrada.
    const authService = require("../src/modules/auth/auth.service");
    const criado = await authService.cadastrar({
      nome: "Bypass",
      email: "bypass@t.com",
      senha: "senha123",
      cargo: "Administrador",
    });
    assert.notEqual(criado.usuario.cargo, "Administrador");
  });

  test("conta recem-cadastrada nasce inativa (precisa aprovacao)", async () => {
    const r = await req(base, "POST", "/api/auth/cadastrar", {
      body: { nome: "Novato", email: "novato@t.com", senha: "senha123" },
    });
    assert.ok(r.status === 201 || r.status === 200);
    const criado = await env.prisma.usuario.findUnique({ where: { email: "novato@t.com" } });
    assert.equal(criado.ativo, false);
  });
});
