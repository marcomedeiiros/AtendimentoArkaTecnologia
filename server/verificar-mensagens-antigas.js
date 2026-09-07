/**
 * "VER MENSAGENS ANTIGAS" TEM DE MOSTRAR MENSAGEM ANTIGA.
 *
 * ── O DEFEITO ──────────────────────────────────────────────────────────────
 *
 * O botão revelava UMA OS por clique. Parece óbvio, e está errado: existe OS
 * sem mensagem nenhuma -- um atendimento aberto e fechado sem ninguém escrever
 * (fora de horário, bot que encerrou, transferência desfeita) fica no banco com
 * zero mensagens.
 *
 * Caindo numa dessas, o clique mudava só o NÚMERO no botão. A conversa ficava
 * idêntica. Quem clicava concluía, com razão, que o botão não funciona -- e o
 * histórico importado do WhatsApp, que fica no começo de tudo, parecia não ter
 * sido importado.
 *
 * ── COMO ISTO É MEDIDO ─────────────────────────────────────────────────────
 *
 * Executando o CÓDIGO DE VERDADE: o corpo do `useMemo` é extraído do
 * AtendimentoView.jsx e rodado sobre uma conversa montada aqui. Reimplementar a
 * regra no teste faria ele concordar com o defeito no dia em que ele voltasse.
 */
const fs = require("fs");
const path = require("path");

const TELA = path.join(__dirname, "../client/src/components/pages/AtendimentoView.jsx");
const fonte = fs.readFileSync(TELA, "utf8");

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

console.log("=== Ver mensagens antigas ===");

// ── O corpo real do memo, tirado do arquivo ──────────────────────────────────
const corpo = /const \{ mensagensVisiveis[\s\S]*?\} = useMemo\(\(\) => \{([\s\S]*?)\n  \}, \[conversa\.mensagens, osCronologicas, osCarregadas\]\);/.exec(
  fonte
)?.[1];

check("achei o calculo do trecho visivel", corpo ? [] : ["nao achei o useMemo em AtendimentoView.jsx"]);

if (!corpo) {
  console.log("\nFALHAS (" + erros.length + ")");
  process.exit(1);
}

// eslint-disable-next-line no-new-func
const calcular = new Function("conversa", "osCronologicas", "osCarregadas", corpo);

// ── O caso das prints ────────────────────────────────────────────────────────
//
// OS #46 e #86/#87 têm mensagem; a #83 foi aberta e fechada sem ninguém
// escrever. Abrindo a conversa em #86/#87, a #83 é a próxima da fila.
const os = (id, numero) => ({ id, os: numero, abertoEm: "2026-09-0" + id });
const OS = [os("1", 46), os("2", 83), os("3", 86), os("4", 87)];
const msg = (id, atendimentoId) => ({ id, atendimentoId });
const MENSAGENS = [msg("m1", "1"), msg("m2", "1"), msg("m3", "3"), msg("m4", "4")];

{
  const r = calcular({ mensagens: MENSAGENS }, OS, 2);

  check("o botao anuncia a OS que tem mensagem, e nao a vazia", [
    ...(r.proximaOsAntiga?.os === 46
      ? []
      : ["deveria anunciar a #46 (que tem mensagem); anuncia " + JSON.stringify(r.proximaOsAntiga?.os)]),
  ]);

  check("um clique pula a OS vazia", [
    ...(r.passosParaRevelar === 2
      ? []
      : ["deveria andar 2 (pulando a #83 vazia), anda " + r.passosParaRevelar]),
  ]);

  // O que o clique de fato produz.
  const antes = r.mensagensVisiveis.length;
  const depois = calcular({ mensagens: MENSAGENS }, OS, 2 + Math.max(1, r.passosParaRevelar));
  check("depois do clique aparece mensagem nova", [
    ...(depois.mensagensVisiveis.length > antes
      ? []
      : [`a conversa continuou com ${antes} mensagens -- o clique nao mostrou nada`]),
  ]);

  // A prova do defeito: com o passo fixo de 1, nada mudava. Se um dia alguem
  // voltar a andar de um em um, ESTA linha e que diz o que o usuario via.
  const passoFixo = calcular({ mensagens: MENSAGENS }, OS, 3);
  check("o passo fixo de 1 seria mesmo invisivel (a prova do defeito)", [
    ...(passoFixo.mensagensVisiveis.length === antes
      ? []
      : ["o cenario nao reproduz o defeito: andar 1 ja mostrava algo, entao o teste nao prova nada"]),
  ]);
}

// ── Nada oculto tem conteudo: o botao nao pode prometer ──────────────────────
{
  const soVazias = [os("1", 40), os("2", 41), os("3", 86)];
  const r = calcular({ mensagens: [msg("m1", "3")] }, soVazias, 1);
  check("sem nada para revelar, o botao nao se oferece", [
    ...(r.temMaisAntigas === false
      ? []
      : ["`temMaisAntigas` deveria ser false: as OS ocultas estao todas vazias"]),
  ]);
}

// ── Mensagem orfa (anterior ao modelo de OS) ainda tem de ser alcancavel ─────
{
  const comOrfa = [os("1", 40), os("2", 86)];
  const mensagens = [{ id: "velha", atendimentoId: null }, msg("m1", "2")];
  const r = calcular({ mensagens }, comOrfa, 1);
  const depois = calcular({ mensagens }, comOrfa, 1 + Math.max(1, r.passosParaRevelar));
  check("a mensagem orfa continua alcancavel mesmo com OS vazia no caminho", [
    ...(r.temMaisAntigas ? [] : ["o botao sumiu, e a mensagem orfa ficou inalcancavel"]),
    ...(depois.mensagensVisiveis.some((m) => m.id === "velha")
      ? []
      : ["a mensagem orfa nao apareceu depois do clique"]),
  ]);
}

// ── A BUSCA NO WHATSAPP NAO PODE DEPENDER DE ESGOTAR AS OS ──────────────────
//
// Ela ja foi o segundo estado de um botao unico: primeiro revelar tudo, e so
// entao procurar. Conversa com muitas OS escondia a importacao atras de uma
// fila de cliques -- e o motivo de a importacao existir e o tecnico NAO
// precisar abrir o celular da empresa. Uma acao que existe para isso nao pode
// ficar no fim da fila.
//
// Duas coisas travadas: que os dois botoes sejam independentes (a busca nao
// condicionada a `temMaisAntigas`), e que ela continue disponivel depois de um
// "nada de novo" -- o historico do WhatsApp muda a cada pareamento.
{
  const problemas = [];

  // O botao unico decidia a acao no proprio onClick. Se isso voltar, voltou o
  // sequenciamento.
  if (/onClick=\{temMaisAntigas \?/.test(fonte)) {
    problemas.push("o clique voltou a escolher entre revelar e buscar -- a busca so aparece quando as OS acabam");
  }
  if (!fonte.includes("{podeBuscarHistorico && (")) {
    problemas.push("nao achei o botao de busca proprio, renderizado por conta de `podeBuscarHistorico`");
  }
  check("a busca no WhatsApp e um botao proprio, independente das OS", problemas);

  const daPermanencia = [];
  if (/podeBuscarHistorico=\{ehAdmin && !historicoVazio/.test(fonte)) {
    daPermanencia.push("o botao volta a sumir depois de um 'nada de novo', e nao ha como tentar de novo");
  }
  if (!fonte.includes("buscaSemNovidade={historicoVazio.has(conversa.id)}")) {
    daPermanencia.push("o resultado anterior deixou de mudar o rotulo do botao");
  }
  check("depois de 'nada de novo' o botao fica, com outro rotulo", daPermanencia);
}
console.log(
  "\n" +
    (erros.length
      ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ")
      : "VER MENSAGENS ANTIGAS: TUDO CONFERE")
);
process.exit(erros.length ? 1 : 0);
