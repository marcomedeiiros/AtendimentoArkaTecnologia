/**
 * A PAREDE MOSTRA AS DUAS COMPETIÇÕES, E QUEM ESTÁ ATRÁS.
 *
 * ── O QUE FALTAVA ──────────────────────────────────────────────────────────
 *
 * A TV mostrava só os TRÊS primeiros da sede. Numa equipe de seis, metade não
 * se via -- e quem está em 4º é justamente quem mais precisa saber disso. Quem
 * trabalha fora da sede não aparecia de forma nenhuma, apesar de ser o time que
 * passa o dia na rua e olha a parede de passagem.
 *
 * ── O QUE ESTÁ TRAVADO ─────────────────────────────────────────────────────
 *
 * Que o painel entregue o ranking externo, que ele NUNCA derrube a parede, e
 * que a tela mostre as posições além da terceira. A parte da parede que já
 * funcionava -- fila, indicadores, sede -- não pode cair por causa de um painel
 * a mais: é a que fica exposta o dia inteiro.
 */
const path = require("path");
const fs = require("fs");

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

console.log("=== Modo TV: as duas competicoes ===");

// ── O painel entrega o externo, e sobrevive a ele ────────────────────────────
//
// Executado de verdade, com `ranking.service` dublado nos três desfechos: sem
// equipe externa, com equipe, e explodindo. O terceiro é o que importa -- a
// parede não pode cair por causa de um painel novo.
{
  const ALVO = path.resolve(__dirname, "src/modules/dashboard");
  const pRanking = require.resolve(path.join(ALVO, "../rankings/ranking.service"));

  let modo = "vazio";
  require.cache[pRanking] = {
    id: pRanking,
    filename: pRanking,
    loaded: true,
    exports: {
      equipes: async () => {
        if (modo === "explode") throw new Error("banco fora do ar");
        return { sede: [], externo: modo === "com" ? [{ id: "u1", nome: "Fulano" }] : [], supervisores: [] };
      },
      _rankingExterno: async () => ({
        classificacao: [{ usuarioId: "u1", nome: "Fulano", pontos: 42, registros: 3, posicao: 1 }],
      }),
    },
  };

  const painel = require(path.join(ALVO, "painel.service"));

  (async () => {
    const problemas = [];

    modo = "vazio";
    const semEquipe = await painel._paredeExterna(new Date());
    if (semEquipe !== null) {
      problemas.push("sem equipe externa deveria devolver null (a tela nao desenha coluna vazia), veio " + JSON.stringify(semEquipe));
    }

    modo = "com";
    const comEquipe = await painel._paredeExterna(new Date());
    if (comEquipe?.classificacao?.[0]?.pontos !== 42) {
      problemas.push("com equipe externa deveria trazer a classificacao: " + JSON.stringify(comEquipe));
    }

    modo = "explode";
    let caiu = false;
    let resultado;
    try {
      resultado = await painel._paredeExterna(new Date());
    } catch {
      caiu = true;
    }
    if (caiu) problemas.push("uma falha no ranking externo DERRUBOU a parede inteira");
    else if (resultado !== null) problemas.push("na falha deveria devolver null, veio " + JSON.stringify(resultado));

    check("o painel entrega o externo, e uma falha nele nao derruba a parede", problemas);

    // ── A tela ────────────────────────────────────────────────────────────────
    const tv = fs.readFileSync(
      path.resolve(__dirname, "../client/src/components/ModoTv.jsx"),
      "utf8"
    );

    check("a parede mostra quem esta da quarta posicao em diante", [
      ...(tv.includes("const atras = itens.slice(3);")
        ? []
        : ["nao achei o corte a partir da 4a posicao -- a parede voltou a mostrar so tres"]),
      ...(/\{atras\.map\(\(p\) => \(/.test(tv)
        ? []
        : ["quem esta atras nao e desenhado"]),
    ]);

    check("a parede desenha o ranking de fora da sede", [
      ...(tv.includes("dados?.rankingExterno?.classificacao?.length")
        ? []
        : ["a tela nao le `rankingExterno` do painel"]),
      ...(tv.includes("{temExterno && (") ? [] : ["o painel externo nao e condicionado a existir equipe"]),
    ]);

    // As parcelas do externo sao outras. Com o texto da sede cravado na linha, o
    // painel de fora da sede mostraria "0 aval. · 0 de 3 ★" para quem entrega
    // relatorio -- numeros de uma conta que nao e a dele.
    check("cada ranking mostra as SUAS parcelas na linha", [
      ...(tv.includes("detalhe ? detalhe(item, minimo) : (")
        ? []
        : ["a linha voltou a cravar o texto da sede"]),
      ...(/detalhe=\{\(item\) => \(/.test(tv)
        ? []
        : ["o painel externo nao passa o proprio detalhe"]),
    ]);

    console.log(
      "\n" + (erros.length ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ") : "MODO TV: TUDO CONFERE")
    );
    process.exit(erros.length ? 1 : 0);
  })();
}
