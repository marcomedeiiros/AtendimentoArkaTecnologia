/**
 * ENCERRAR A SESSAO EM TODOS OS DISPOSITIVOS -- o botao precisa cumprir o que diz.
 *
 * ── POR QUE ESTE ARQUIVO EXISTE ────────────────────────────────────────────
 *
 * O texto do botao promete uma coisa forte:
 *
 *     "Encerra o acesso em todos os aparelhos, inclusive neste. Use se
 *      desconfiar que alguem entrou na sua conta."
 *
 * Quem clica ali esta com medo. Se a revogacao falhar em silencio -- ou valer
 * so quando o token vencer sozinho, daqui a horas -- a pessoa vai embora achando
 * que expulsou o invasor, e nao expulsou. Um botao de seguranca que mente e pior
 * do que botao nenhum, porque encerra a busca por outra solucao.
 *
 * Entao aqui se prova, contra o banco de verdade, que:
 *
 *   1. TODAS as familias caem -- inclusive a de quem clicou. Isto e o oposto da
 *      troca de senha, que poupa a sessao atual de proposito. Confundir as duas
 *      deixaria viva justamente a sessao do computador emprestado.
 *   2. `familiaAtiva` passa a responder NAO. E o que o `authMiddleware` consulta
 *      a cada requisicao, e por isso o token de acesso ja emitido para de valer
 *      na hora, e nao no fim do prazo dele.
 *   3. A conta AO LADO nao e afetada. "Todos os dispositivos" e todos os DESTA
 *      pessoa -- derrubar terceiros seria uma negacao de servico com um clique.
 *
 * Os dados sao descartaveis e criados aqui mesmo (e-mails com marca propria),
 * apagados no final inclusive se o teste falhar. Nenhum usuario real e tocado.
 *
 *   cd server && node verificar-sair-de-todos.js
 */
const prisma = require("./src/infrastructure/database/prisma.client");
const sessaoRefreshRepository = require("./src/infrastructure/repositories/sessaoRefresh.repository");
const authService = require("./src/modules/auth/auth.service");

const MARCA = "teste-sair-de-todos";
const erros = [];
let secao = "";
const titulo = (t) => { secao = t; console.log(`\n=== ${t} ===`); };
const check = (rotulo, obtido, esperado) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  console.log(`  ${ok ? "OK  " : "FALHA"} ${rotulo}`);
  if (!ok) {
    console.log(`        obtido:   ${JSON.stringify(obtido)}`);
    console.log(`        esperado: ${JSON.stringify(esperado)}`);
    erros.push(`[${secao}] ${rotulo}`);
  }
};

// Uma "sessao" e uma familia de refresh: o login cria a familia, e cada rotacao
// grava uma linha nova com o mesmo `familia`. Revogar a familia mata a sessao.
async function criarSessao(usuarioId, familia) {
  const daquiUmMes = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await sessaoRefreshRepository.criar({
    familia,
    familiaCriadaEm: new Date(),
    tokenHash: `${MARCA}:${familia}:${Math.random().toString(36).slice(2)}`,
    usuarioId,
    expiraEm: daquiUmMes,
  });
}

async function main() {
  // Duas contas: a que clica no botao, e a vizinha que nao pode ser afetada.
  const dono = await prisma.usuario.create({
    data: { nome: "Teste Dono", email: `${MARCA}-dono@exemplo.invalido`, senhaHash: "x", ativo: true },
  });
  const vizinho = await prisma.usuario.create({
    data: { nome: "Teste Vizinho", email: `${MARCA}-vizinho@exemplo.invalido`, senhaHash: "x", ativo: true },
  });

  // O dono esta logado em tres lugares: o celular, o computador de casa e o
  // computador emprestado -- que e o motivo de existir o botao.
  const CELULAR = `${MARCA}-celular`;
  const CASA = `${MARCA}-casa`;
  const EMPRESTADO = `${MARCA}-emprestado`;
  for (const f of [CELULAR, CASA, EMPRESTADO]) await criarSessao(dono.id, f);
  const DO_VIZINHO = `${MARCA}-vizinho`;
  await criarSessao(vizinho.id, DO_VIZINHO);

  titulo("1. Antes do clique: as quatro sessoes valem");
  check("celular ativo", await sessaoRefreshRepository.familiaAtiva(CELULAR), true);
  check("casa ativo", await sessaoRefreshRepository.familiaAtiva(CASA), true);
  check("emprestado ativo", await sessaoRefreshRepository.familiaAtiva(EMPRESTADO), true);
  check("vizinho ativo", await sessaoRefreshRepository.familiaAtiva(DO_VIZINHO), true);

  titulo("2. O clique encerra TODAS as do dono -- inclusive a atual");
  const r = await authService.sairDeTodos(dono.id);
  check("respondeu encerradas", r.encerradas, true);
  check("contou as 3 sessoes", r.sessoesEncerradas, 3);
  check("celular caiu", await sessaoRefreshRepository.familiaAtiva(CELULAR), false);
  check("casa caiu", await sessaoRefreshRepository.familiaAtiva(CASA), false);
  // A DIFERENCA para a troca de senha: aqui a sessao de quem clicou tambem cai.
  check("emprestado caiu (a atual NAO e poupada)",
    await sessaoRefreshRepository.familiaAtiva(EMPRESTADO), false);

  titulo("3. A conta ao lado nao e atingida");
  check("vizinho continua ativo", await sessaoRefreshRepository.familiaAtiva(DO_VIZINHO), true);

  titulo("4. Clicar de novo nao quebra (sem sessao viva)");
  const r2 = await authService.sairDeTodos(dono.id);
  check("responde normalmente", r2.encerradas, true);
  check("nao havia mais nada para encerrar", r2.sessoesEncerradas, 0);

  titulo("5. Contraste: a troca de senha POUPA a sessao atual");
  // Mesma engrenagem, argumento diferente. Se um dia alguem passar `exceto` no
  // sairDeTodos por engano, este par de testes mostra o que mudou.
  const NOVA = `${MARCA}-nova`;
  const OUTRA = `${MARCA}-outra`;
  await criarSessao(dono.id, NOVA);
  await criarSessao(dono.id, OUTRA);
  await sessaoRefreshRepository.revogarDoUsuario(dono.id, NOVA);   // `exceto: NOVA`
  check("a sessao poupada sobrevive", await sessaoRefreshRepository.familiaAtiva(NOVA), true);
  check("a outra cai", await sessaoRefreshRepository.familiaAtiva(OUTRA), false);

  return [dono.id, vizinho.id];
}

let ids = [];
main()
  .then((r) => { ids = r; })
  .catch((e) => { erros.push(`[erro] ${e.message}`); console.error(e); })
  .finally(async () => {
    // Faxina SEMPRE -- inclusive quando o teste falha, senao a proxima execucao
    // esbarra no e-mail unico e o erro seguinte esconde o de verdade.
    await prisma.sessaoRefresh.deleteMany({ where: { familia: { startsWith: MARCA } } });
    if (ids.length) await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
    else await prisma.usuario.deleteMany({ where: { email: { startsWith: MARCA } } });
    await prisma.$disconnect();
    console.log(
      "\n" + (erros.length
        ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ")
        : "SAIR DE TODOS: TUDO CONFERE")
    );
    process.exit(erros.length ? 1 : 0);
  });
