/**
 * A ESCADA DE VOLUME DA SEDE, E O ALVO QUE O ADMINISTRADOR DECIDE.
 *
 * ── O DEFEITO ──────────────────────────────────────────────────────────────
 *
 * A parcela de atendimentos saturava em 10 no mês -- número cravado no código,
 * calibrado para uma operação que fazia menos que isso. Quando a equipe passou
 * a fazer 10 numa manhã, os 100 pontos eram alcançáveis no primeiro dia: do 11º
 * atendimento em diante, o mês inteiro deixava de valer. Várias pessoas
 * empatavam no teto e a ordem entre elas virava sorteio.
 *
 * ── POR QUE UM NÚMERO, E NÃO SEIS ──────────────────────────────────────────
 *
 * A alternativa óbvia -- abrir os seis degraus para edição -- deixa a escada à
 * mercê de quem digita. Configura-se só o topo; a forma é reescalada.
 *
 * ── O QUE ESTÁ TRAVADO AQUI ────────────────────────────────────────────────
 *
 * Que o padrão continue idêntico ao de sempre (ninguém acorda com pontuação
 * diferente por causa desta mudança), que a escada sempre suba, que atingir o
 * alvo pague a parcela cheia e que nenhum degrau fique inalcançável.
 *
 * Medido executando `_ranking`, a função que a parede, a Visão Geral e o ranking
 * da sede usam -- as três são a mesma.
 */
const path = require("path");

const erros = [];
function check(nome, problemas) {
  if (problemas.length) {
    erros.push(nome);
    console.log("  FALHA " + nome);
    for (const p of problemas) console.log("        " + p);
  } else {
    console.log("  OK   " + nome);
  }
}

const painel = require(path.join(__dirname, "src/modules/dashboard/painel.service"));
const padrao = painel.regrasPadrao();

// Uma pessoa com N atendimentos fechados, todos com nota 5, assumidos na hora.
// Nota e agilidade ficam no teto de propósito: assim os pontos que variam são
// só os do volume, que é o que este arquivo mede.
function pontosCom(fechados, regras) {
  const atendimentos = [];
  for (let i = 0; i < fechados; i++) {
    atendimentos.push({
      atendenteNome: "Fulano",
      status: "fechada",
      avaliacao: 5,
      abertoEm: new Date("2026-09-01T10:00:00Z"),
      atendidoEm: new Date("2026-09-01T10:00:10Z"),
    });
  }
  const r = painel._ranking(atendimentos, { limite: 99, regras });
  return r.classificacao[0]?.atendimentos?.pontos ?? 0;
}

console.log("=== Pontuacao da sede: a escada de volume ===");

// ── O padrao nao pode ter mudado ─────────────────────────────────────────────
{
  const problemas = [];
  if (padrao.alvoAtendimentos !== 10) {
    problemas.push("o alvo padrao deveria ser 10, e " + padrao.alvoAtendimentos);
  }
  // Os degraus historicos, um por um. Se a reescala mexer no caso padrao, a
  // pontuacao de todo mundo muda sem ninguem ter configurado nada -- e o
  // historico e recalculado, entao mudaria o passado tambem.
  const historico = [[10, 35], [8, 30], [6, 24], [4, 17], [2, 9], [1, 4], [0, 0]];
  for (const [fechados, esperado] of historico) {
    const obtido = pontosCom(fechados, padrao);
    if (obtido !== esperado) {
      problemas.push(`com ${fechados} atendimentos deveria dar ${esperado} pts, deu ${obtido}`);
    }
  }
  check("sem configurar nada, a pontuacao e exatamente a de sempre", problemas);
}

// ── O alvo move o ponto de saturacao ─────────────────────────────────────────
{
  const regras = { ...padrao, alvoAtendimentos: 60 };
  const problemas = [];

  // Era 35 pontos com 10. Com alvo 60, 10 atendimentos nao podem mais valer o teto.
  const com10 = pontosCom(10, regras);
  if (com10 >= 35) {
    problemas.push(`com alvo 60, 10 atendimentos ainda valem ${com10} pts -- o teto nao se moveu`);
  }
  const com60 = pontosCom(60, regras);
  if (com60 !== 35) problemas.push(`com alvo 60, 60 atendimentos deveriam valer 35 pts, valem ${com60}`);

  check("o alvo empurra a saturacao para onde o administrador disser", problemas);
}

// ── A escada tem de subir SEMPRE ─────────────────────────────────────────────
//
// Mais atendimentos nunca pode valer menos pontos, em alvo nenhum -- e atingir
// o alvo tem de pagar a parcela cheia, senao o numero configurado nao significa
// o que a tela promete.
{
  const problemas = [];
  for (const alvo of [1, 2, 3, 4, 5, 7, 10, 13, 25, 60, 137, 1000]) {
    const regras = { ...padrao, alvoAtendimentos: alvo };
    let anterior = -1;
    // Ate um pouco alem do alvo, para incluir a saturacao.
    for (let n = 0; n <= alvo + 3; n++) {
      const pts = pontosCom(n, regras);
      if (pts < anterior) {
        problemas.push(`alvo ${alvo}: ${n} atendimentos valem ${pts} pts, menos que ${n - 1} (${anterior})`);
        break;
      }
      anterior = pts;
    }
    if (pontosCom(alvo, regras) !== 35) {
      problemas.push(`alvo ${alvo}: atingir o alvo deveria dar os 35 pts cheios, deu ${pontosCom(alvo, regras)}`);
    }
  }
  check("a escada nunca desce, e o alvo sempre paga o teto", problemas);
}

// ── NENHUM DEGRAU PODE FICAR MORTO ───────────────────────────────────────────
//
// Este e o efeito real do ajuste de arredondamento, e ele NAO e evitar que a
// pontuacao desca: `pontosDeVolume` casa o primeiro degrau da lista, o de maior
// pontuacao, entao empate nunca inverte a ordem -- medido.
//
// O que o empate faz e matar o degrau de baixo. Com alvo 3 e sem o ajuste, os
// degraus de 24, 9 e 4 pontos nao sao alcancaveis por numero nenhum de
// atendimentos: a escada de seis degraus vira uma de tres, e quem configurou um
// alvo baixo perde a resolucao do meio sem ser avisado.
{
  const problemas = [];
  for (const alvo of [1, 2, 3, 4, 5, 7, 10, 60]) {
    const regras = { ...padrao, alvoAtendimentos: alvo };
    // A escada EM VIGOR, pelo caminho de verdade: `_ranking` a devolve.
    const escada = painel._ranking([], { regras }).pesos.volume;

    const alcancados = new Set();
    for (let n = 0; n <= alvo + 2; n++) alcancados.add(pontosCom(n, regras));

    const mortos = escada.filter((d) => !alcancados.has(d.pontos));
    if (mortos.length) {
      problemas.push(
        `alvo ${alvo}: ${mortos.length} degrau(s) inalcancavel(is) -- ` +
          mortos.map((d) => `${d.pontos}pts a partir de ${d.aPartirDe}`).join(", ")
      );
    }
  }
  check("todo degrau da escada e alcancavel", problemas);
}

// ── Valor absurdo no banco nao vira regra ────────────────────────────────────
{
  const sedeRegras = require(path.join(__dirname, "src/modules/dashboard/sede.regras"));
  const problemas = [];
  const zero = sedeRegras.validar({ alvoAtendimentos: 0 }, padrao);
  if (zero.alvoAtendimentos < 1) {
    problemas.push("alvo 0 passou: todo mundo ficaria no teto sempre, que e o defeito de origem");
  }
  const negativo = sedeRegras.validar({ alvoAtendimentos: -5 }, padrao);
  if (negativo.alvoAtendimentos < 1) problemas.push("alvo negativo passou");
  const texto = sedeRegras.validar({ alvoAtendimentos: "abc" }, padrao);
  if (texto.alvoAtendimentos !== padrao.alvoAtendimentos) {
    problemas.push("texto no lugar do numero deveria manter o valor atual, virou " + texto.alvoAtendimentos);
  }
  check("valor invalido nao vira regra rodando na conta do mes", problemas);
}

console.log(
  "\n" +
    (erros.length
      ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ")
      : "PONTUACAO DA SEDE: TUDO CONFERE")
);
process.exit(erros.length ? 1 : 0);
