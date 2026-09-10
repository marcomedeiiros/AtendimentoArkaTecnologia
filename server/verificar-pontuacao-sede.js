/**
 * A PONTUAÇÃO DA SEDE ACUMULA, E NÃO SATURA.
 *
 * ── O DEFEITO QUE ISTO TRAVA ───────────────────────────────────────────────
 *
 * A pontuação era um índice de 0 a 100, e a parcela de volume vinha de uma
 * ESCADA DE FAIXAS: 6 atendimentos valiam 24 pontos, e 7 também. Fechar o
 * sétimo não movia nada; o próximo salto era no oitavo.
 *
 * Com a equipe fazendo de 2 a 8 atendimentos por ciclo e nota 5,0 (parcela
 * cheia), três pessoas ficaram em 84 pontos ao mesmo tempo e o placar
 * congelou -- relatado em 10/09/2026 como "o ranking travado nos 84".
 *
 * Este arquivo já existia para impedir SATURAÇÃO (a escada saturava em 10 no
 * mês), e a saturação voltou por outro caminho: o platô entre degraus. As
 * checagens de escada e alvo saíram porque escada e alvo deixaram de existir --
 * e o que ficou mede a garantia que interessa, que é a mesma de antes: **o
 * placar tem de se mover quando alguém trabalha mais.**
 *
 * ── O QUE ESTÁ TRAVADO AQUI ────────────────────────────────────────────────
 *
 * Que cada atendimento avaliado a mais aumente o total (de 1 a 40, um por um),
 * que o par 6 -> 7 do relato se mova, que o dobro de trabalho valha o dobro,
 * que as três parcelas continuem separadas e somem o total, que nota melhor
 * valha mais, que o mínimo de avaliações siga protegendo a parcela de
 * qualidade -- e que teto e alvo não voltem a existir sem a suíte reclamar.
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

// A pontuacao TOTAL, e nao so a parcela de volume: e ela que responde "o placar
// se move quando eu trabalho mais?".
function totalCom(fechados, regras) {
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
  return r.classificacao[0]?.pontos ?? 0;
}

console.log("=== Pontuacao da sede: acumula, e nao satura ===");

// ── A UNIDADE PADRAO ────────────────────────────────────────────────────────
{
  const problemas = [];
  if (padrao.unidades?.atendimento !== 10) {
    problemas.push("atendimento deveria valer 10, e " + padrao.unidades?.atendimento);
  }
  if (padrao.unidades?.estrela !== 2) {
    problemas.push("estrela deveria valer 2, e " + padrao.unidades?.estrela);
  }
  // O teto e o alvo NAO existem mais. Se alguem os reintroduzir, e aqui que a
  // suite reclama antes de a saturacao voltar em silencio.
  if (padrao.pesos !== undefined) problemas.push("`pesos` (os tetos antigos) voltou a existir");
  if (padrao.alvoAtendimentos !== undefined) problemas.push("`alvoAtendimentos` voltou a existir");
  check("a regua e por unidade, sem teto nem alvo", problemas);
}

// ── O NUCLEO: CADA ATENDIMENTO A MAIS SOMA, PARA SEMPRE ─────────────────────
//
// O defeito que esta mudanca conserta, em teste. Com a escada antiga, 6 e 7
// atendimentos davam os MESMOS 24 pontos de volume -- fechar o setimo nao movia
// nada. Tres pessoas ficaram em 84 pontos ao mesmo tempo, e o placar congelou.
{
  const problemas = [];
  let anterior = totalCom(1, padrao);
  for (let n = 2; n <= 40; n += 1) {
    const agora = totalCom(n, padrao);
    if (agora <= anterior) {
      problemas.push(`de ${n - 1} para ${n} atendimentos o placar NAO subiu (${anterior} -> ${agora})`);
      break;
    }
    anterior = agora;
  }
  check("de 1 a 40 atendimentos, cada um a mais aumenta a pontuacao", problemas);
}

// ── E NAO HA PLATO ENTRE DEGRAUS ────────────────────────────────────────────
//
// A checagem acima pegaria um plato, mas vale travar o caso EXATO do relato:
// 6 -> 7 era o par que nao se movia.
{
  const problemas = [];
  const seis = totalCom(6, padrao);
  const sete = totalCom(7, padrao);
  if (sete === seis) problemas.push(`6 e 7 atendimentos dao o mesmo total (${seis}) -- o plato voltou`);
  // Dobrar o trabalho tem de dobrar a pontuacao, com nota e rapidez iguais.
  const doze = totalCom(12, padrao);
  if (doze !== seis * 2) {
    problemas.push(`12 atendimentos deveriam valer o dobro de 6 (${seis * 2}), valeram ${doze}`);
  }
  check("o caso do relato (6 -> 7) se move, e o dobro de trabalho vale o dobro", problemas);
}

// ── AS TRES PARCELAS CONTINUAM SEPARADAS E SOMAM O TOTAL ────────────────────
//
// A conta a vista sempre foi a condicao para um numero unico ser defensavel.
// Sem isto, "150 pontos" seria um oraculo.
{
  const problemas = [];
  const atendimentos = [];
  for (let i = 0; i < 6; i++) {
    atendimentos.push({
      atendenteNome: "Fulano", status: "fechada", avaliacao: 5,
      abertoEm: new Date("2026-09-01T10:00:00Z"),
      atendidoEm: new Date("2026-09-01T10:00:10Z"),
    });
  }
  const p = painel._ranking(atendimentos, { limite: 99, regras: padrao }).classificacao[0];
  const soma = p.atendimentos.pontos + p.nota.pontos + p.agilidade.pontos;
  if (soma !== p.pontos) problemas.push(`as parcelas somam ${soma}, mas o total e ${p.pontos}`);
  if (p.atendimentos.pontos !== 60) problemas.push(`volume: 6 x 10 = 60, veio ${p.atendimentos.pontos}`);
  if (p.nota.pontos !== 60) problemas.push(`nota: soma 30 estrelas x 2 = 60, veio ${p.nota.pontos}`);
  if (p.agilidade.pontos !== 30) problemas.push(`agilidade: 6 x 5 (assumido em 10s) = 30, veio ${p.agilidade.pontos}`);
  check("as tres parcelas saem separadas e somam o total", problemas);
}

// ── A NOTA PREMIA QUALIDADE, E NAO SO VOLUME ────────────────────────────────
//
// Somar as notas (e nao a media) e o que faz a parcela acumular. O risco de
// somar e virar "volume de novo" -- dez notas 3 nao podem valer mais que dez
// notas 5. Aqui isso fica travado.
{
  const problemas = [];
  const fazer = (nota, quantos) => {
    const a = [];
    for (let i = 0; i < quantos; i++) {
      a.push({ atendenteNome: "F", status: "fechada", avaliacao: nota,
        abertoEm: new Date("2026-09-01T10:00:00Z"), atendidoEm: new Date("2026-09-01T10:00:10Z") });
    }
    return painel._ranking(a, { limite: 99, regras: padrao }).classificacao[0];
  };
  const dezCincos = fazer(5, 10);
  const dezTres = fazer(3, 10);
  if (!(dezCincos.pontos > dezTres.pontos)) {
    problemas.push(`dez notas 5 (${dezCincos.pontos}) deveriam valer mais que dez notas 3 (${dezTres.pontos})`);
  }
  // E volume ainda conta: vinte notas 3 passam dez notas 5, e isso e a decisao
  // de produto desta regua (sem teto, quem produz mais soma mais).
  const vinteTres = fazer(3, 20);
  if (!(vinteTres.pontos > dezCincos.pontos)) {
    problemas.push(`vinte notas 3 (${vinteTres.pontos}) deveriam passar dez notas 5 (${dezCincos.pontos})`);
  }
  check("nota melhor vale mais, e volume tambem conta", problemas);
}

// ── O MINIMO DE AVALIACOES CONTINUA VALENDO PARA A NOTA ─────────────────────
//
// Sem ele, uma amostra de uma avaliacao ja pontuaria qualidade. O volume conta
// desde a primeira -- e ele nao depende de amostra.
{
  const problemas = [];
  const a = [{ atendenteNome: "F", status: "fechada", avaliacao: 5,
    abertoEm: new Date("2026-09-01T10:00:00Z"), atendidoEm: new Date("2026-09-01T10:00:10Z") }];
  const p = painel._ranking(a, { limite: 99, regras: padrao }).classificacao[0];
  if (p.nota.pontos !== 0) problemas.push(`com 1 nota a parcela de qualidade deveria ser 0, veio ${p.nota.pontos}`);
  if (p.nota.conta !== false) problemas.push("a tela precisa saber que ainda nao conta (para escrever '1 de 3')");
  if (p.atendimentos.pontos !== 10) problemas.push(`mas o volume conta desde a primeira: 10, veio ${p.atendimentos.pontos}`);
  check("com uma avaliacao so, qualidade nao pontua e volume pontua", problemas);
}

// ── A UNIDADE CONFIGURADA MUDA A ESCALA ─────────────────────────────────────
{
  const problemas = [];
  const dobrado = totalCom(6, { ...padrao, unidades: { atendimento: 20, estrela: 2 } });
  const normal = totalCom(6, padrao);
  if (dobrado !== normal + 60) {
    problemas.push(`dobrar o valor do atendimento deveria somar 60 (6 x 10), somou ${dobrado - normal}`);
  }
  check("mexer na unidade muda a pontuacao na proporcao esperada", problemas);
}

// ── OS DOIS LADOS DO MESMO AVISO NAO PODEM DISCORDAR ────────────────────────
//
// O DEFEITO (auditoria-tela-rankings-10-09.md, achado 5): a parcela da nota
// respeitava o minimo CONFIGURADO e a lista "a caminho da nota" filtrava pela
// constante de fabrica. Com o minimo em 5, quem tinha 4 notas pontuava zero em
// qualidade e NAO aparecia em "a caminho" -- a explicacao desaparecia justo
// quando era necessaria. Com o minimo em 2, quem tinha 2 ja pontuava e a parede
// continuava anunciando que faltava.
//
// A regra em uma linha: "a caminho" e EXATAMENTE quem tem nota e ainda nao
// conta. Varre minimo de 1 a 6 contra 0 a 8 notas, porque o defeito so aparece
// quando o minimo sai do 3 de fabrica -- e ele saiu do 3 no dia em que o campo
// virou configuravel.
{
  const problemas = [];
  const comNotas = (quantas) => {
    const a = [];
    for (let i = 0; i < quantas; i++) {
      a.push({
        atendenteNome: "Fulano",
        status: "fechada",
        avaliacao: 5,
        abertoEm: new Date("2026-09-01T10:00:00Z"),
        atendidoEm: new Date("2026-09-01T10:00:10Z"),
      });
    }
    return a;
  };

  for (let minimo = 1; minimo <= 6; minimo += 1) {
    for (let notas = 0; notas <= 8; notas += 1) {
      const regras = { ...padrao, minimoAvaliacoes: minimo };
      const r = painel._ranking(comNotas(notas), { limite: 99, incluirZerados: true, regras });
      const pessoa = r.classificacao[0];
      const anunciado = r.aCaminho.some((x) => x.nome === "Fulano");
      const deveria = notas > 0 && notas < minimo;
      if (anunciado !== deveria) {
        problemas.push(
          `minimo ${minimo} com ${notas} nota(s): "a caminho" deveria ser ${deveria} e foi ${anunciado}`
        );
      }
      // E o OUTRO lado do aviso: quem nao aparece em "a caminho" (tendo nota) e
      // porque a parcela ja conta. Os dois lados saem do mesmo minimo, ou o
      // texto da parede fica impossivel ("2 de 2").
      if (notas > 0 && pessoa && pessoa.nota.conta === anunciado) {
        problemas.push(
          `minimo ${minimo} com ${notas} nota(s): a parcela conta=${pessoa.nota.conta} e o aviso diz ${anunciado} -- os dois lados discordam`
        );
      }
      // O minimo que a tela ESCREVE ("3 de 5") e o mesmo que filtrou.
      if (r.minimoAvaliacoes !== minimo) {
        problemas.push(`o minimo devolvido para a tela deveria ser ${minimo}, e e ${r.minimoAvaliacoes}`);
      }
      if (problemas.length > 3) break;
    }
    if (problemas.length > 3) break;
  }
  check("'a caminho da nota' e exatamente quem ainda nao conta, no minimo configurado", problemas);
}

console.log("");
if (erros.length) {
  console.log(`${erros.length} FALHA(S)`);
  for (const e of erros) console.log("  - " + e);
  process.exit(1);
}
console.log("PONTUACAO DA SEDE: TUDO CONFERE");
