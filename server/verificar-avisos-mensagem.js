/**
 * O AVISO DE MENSAGEM NOVA -- som e notificação do sistema, SEMPRE ligados.
 *
 * ── O QUE FALTAVA ──────────────────────────────────────────────────────────
 *
 * Só havia som. Ele serve para quem está com o painel na frente; quem está em
 * outra aba, em outro programa ou com a janela minimizada não ouve o suficiente
 * e não vê o contador subir -- e mensagem de cliente parada é a única coisa que
 * esta plataforma existe para evitar.
 *
 * ── O LIMITE, ESCRITO PARA NINGUÉM PROMETER DEMAIS ─────────────────────────
 *
 * Enquanto a ABA estiver aberta -- mesmo em segundo plano --, o SSE entrega e a
 * notificação aparece. Com o navegador FECHADO ela não chega, e nenhum ajuste
 * neste código muda isso: sem aba não há JavaScript rodando. Só Service Worker
 * com Web Push resolveria, e é outro assunto.
 *
 * ── SEM INTERRUPTOR, E POR QUE ISSO MUDA O PEDIDO DE PERMISSÃO ─────────────
 *
 * Houve uma preferência por usuário e um botão na barra lateral para ligar e
 * desligar. Saíram a pedido: o aviso fica sempre ligado, e interruptor para algo
 * que nunca se desliga é linha ocupada por nada. As checagens da preferência
 * saíram junto -- teste de regra que não existe mais é teste que nunca reprova.
 *
 * Só que a permissão continua exigindo um GESTO da pessoa; isso é regra do
 * navegador. Sem botão, o gesto passou a ser o primeiro clique no painel -- e é
 * essa passagem que este arquivo protege.
 */
const fs = require("fs");
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

const C = path.resolve(__dirname, "../client/src");
// Lidos com a quebra de linha NORMALIZADA. Os arquivos do repositorio estao em
// CRLF, e um padrao escrito aqui com barra-n nao casaria nada -- a checagem
// passaria a reprovar codigo correto, que e o jeito mais rapido de ela ser
// ignorada. Foi exatamente o que aconteceu na primeira versao deste arquivo.
const ler = (rel) => fs.readFileSync(path.join(C, rel), "utf8").split("\r\n").join("\n");
const util = ler("utils/notificacao.js");
const app = ler("context/AppContext.jsx");
const layout = ler("components/layout/AppLayout.jsx");

console.log("=== Aviso de mensagem nova ===");

// ── `estaOlhando` é o corte, e ele executa de verdade ────────────────────────
//
// `document.hidden` sozinho não basta: a aba pode estar visível numa janela que
// está ATRÁS de outro programa, e aí a pessoa não está lendo nada. É o caso mais
// comum de um turno -- o painel aberto e outro programa por cima.
{
  const corpo = /export function estaOlhando\(\) \{([\s\S]*?)\n\}/.exec(util)?.[1];
  check("achei `estaOlhando`", corpo ? [] : ["nao achei a funcao em utils/notificacao.js"]);

  if (corpo) {
    // eslint-disable-next-line no-new-func
    const fn = new Function("document", corpo);
    const casos = [
      [{ hidden: false, hasFocus: () => true }, true, "painel em foco"],
      [{ hidden: true, hasFocus: () => false }, false, "outra aba"],
      [{ hidden: false, hasFocus: () => false }, false, "janela visivel ATRAS de outro programa"],
      [{ hidden: false }, true, "navegador sem hasFocus: nao inventa que a pessoa saiu"],
    ];
    const problemas = [];
    for (const [doc, quero, porque] of casos) {
      const obtido = fn(doc);
      if (obtido !== quero) problemas.push(`${porque}: esperava ${quero}, veio ${obtido}`);
    }
    // A funcao estar certa nao basta: o disparo precisa USA-LA. Sem esta linha,
    // tirar o corte do AppContext passava despercebido -- a checagem mediria a
    // ferramenta, e nao o lugar onde ela e usada.
    if (!app.includes("if (!estaOlhando()) {")) {
      problemas.push("o disparo nao usa `!estaOlhando()`: o cartao aparece por cima do painel em foco");
    }
    check("so avisa quem NAO esta olhando", problemas);
  }
}

// ── O aviso é incondicional ──────────────────────────────────────────────────
//
// Sem interruptor: nada entre a mensagem e o aviso. Uma condição que volte a
// aparecer aqui é um jeito de alguém ficar mudo sem saber -- e silêncio é
// indistinguível de "não chegou mensagem".
{
  const problemas = [];
  if (/avisosRef|avisos\.som|avisos\.desktop/.test(app)) {
    problemas.push("voltou uma preferencia condicionando o aviso");
  }
  // ── ESTA CHECAGEM TRAVAVA A FORMA, E NAO A GARANTIA ───────────────────────
  //
  // Ela exigia o texto literal `if (novas.length > 0) {\n playPing();` -- ou
  // seja, UMA linha de codigo escrita daquele jeito. Quando os dois sons foram
  // separados (chamado novo na TV, blip na Central), a garantia continuou de pe
  // e a checagem reprovou de todo modo, porque a forma mudou.
  //
  // A garantia que importa e outra, e sao duas coisas:
  //
  //   1. NENHUMA PREFERENCIA gateia o aviso -- e o que os greps acima e abaixo
  //      protegem. Interruptor e o jeito de alguem ficar mudo sem saber, e
  //      silencio e indistinguivel de "nao chegou mensagem";
  //   2. quem esta na CENTRAL e avisado de toda mensagem nova, sem condicao
  //      alguma no caminho.
  //
  // O Modo TV toca so em chamado novo, de proposito (auditoria dos sons, 10/09):
  // e painel de parede, e blipar a cada mensagem de conversa em andamento viraria
  // barulho continuo numa tela que ninguem esta operando. Isso NAO e um
  // interruptor -- ninguem pode desligar, e depende do contexto, nao de gosto.
  if (!/if \(novas\.length > 0\)/.test(app)) {
    problemas.push("o bloco que dispara o aviso mudou de gatilho");
  }
  if (!/\}\s*else\s*\{\s*\n\s*tocarSomMensagem\(\);/.test(app)) {
    problemas.push("fora do Modo TV o som deixou de ser incondicional");
  }
  // ── UMA TELA, UM SOM: a regra e SO o Modo TV ────────────────────────────
  //
  // A escolha do som depende UNICAMENTE de qual tela esta aberta. Duas versoes
  // anteriores minhas erraram aqui, e as duas pelo mesmo motivo -- uma condicao
  // extra que ninguem pediu ("a conversa e nova?"):
  //
  //   1. `if (modoTv) { if (chamadoNovo) toca; }` -- deixava o Modo TV MUDO na
  //      maior parte do tempo, e silencio e indistinguivel de defeito;
  //   2. `if (modoTv && chamadoNovo) monitoramento; else blip;` -- na TV o som
  //      do Monitoramento praticamente nao saia, porque chamado novo e raro.
  //
  // Por isso a checagem trava a condicao EXATA, sem `&&`: qualquer condicao a
  // mais ali e o caminho de volta para os dois defeitos acima.
  if (!/if \(modoTvRef\.current\) \{\s*\n\s*tocarSomMonitoramento\(\);\s*\n\s*\} else \{\s*\n\s*tocarSomMensagem\(\);/.test(app)) {
    problemas.push(
      "a escolha do som deixou de ser SO a tela -- Modo TV toca Monitoramento, Central toca blip, sem condicao extra"
    );
  }
  if (/houveChamadoNovo/.test(app.replace(/\/\/[^\n]*/g, ""))) {
    problemas.push("voltou a distincao 'chamado novo' na decisao do som (ela nunca foi pedida)");
  }
  if (/Notificações ligadas|Notificações bloqueadas|BellOff/.test(layout)) {
    problemas.push("o botao de ligar/desligar voltou para a barra lateral");
  }
  check("o aviso e sempre ligado, sem interruptor", problemas);
}

// ── A permissão sai de um GESTO, e só quando falta responder ────────────────
{
  const problemas = [];
  const corpo = /export function pedirPermissaoNoPrimeiroGesto\(\) \{([\s\S]*?)\n\}/.exec(util)?.[1] || "";

  if (!corpo) problemas.push("nao achei `pedirPermissaoNoPrimeiroGesto`");
  if (corpo && !corpo.includes("{ once: true, passive: true }")) {
    problemas.push("o ouvinte nao e `once`: ficaria pendurado em todo clique do turno");
  }
  // `default` = ainda nao perguntaram. Com `granted` nao ha o que pedir; com
  // `denied` insistir nao abre nada -- so gasta o gesto.
  if (corpo && !corpo.includes("Notification.permission !== 'default'")) {
    problemas.push("pede a permissao mesmo com resposta ja dada (granted/denied)");
  }
  // O que NAO pode: pedir no carregamento. O navegador recusa e marca o site,
  // estragando o pedido tambem para as proximas vezes.
  if (/^\s*pedirPermissao\(\)/m.test(util.replace(/export async function pedirPermissao[\s\S]*?\n\}/, ""))) {
    problemas.push("`pedirPermissao` e chamada solta no modulo -- pedido no carregamento");
  }
  if (!/pedirPermissaoNoPrimeiroGesto\(\);/.test(app)) {
    problemas.push("ninguem arma o pedido: a permissao nunca seria pedida sem o botao");
  }
  check("a permissao sai de um gesto, uma vez, e so se faltar responder", problemas);
}

// ── Uma notificação, e não uma pilha ────────────────────────────────────────
{
  const problemas = [];
  if (!/const primeira = novas\[0\];/.test(app)) {
    problemas.push("nao achei o agrupamento -- varias conversas virariam varios cartoes empilhados");
  }
  if (/novas\.forEach\([^)]*notificar/.test(app)) {
    problemas.push("notifica uma por conversa: quem volta do cafe recebe uma pilha");
  }
  if (!/tag: outras > 0 \? .arka-varias. : `arka-\$\{primeira\.convId\}`/.test(app)) {
    problemas.push("a `tag` nao agrupa por conversa -- mensagens seguidas do mesmo cliente empilham");
  }
  check("varias conversas viram UM aviso", problemas);
}

console.log(
  "\n" + (erros.length ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ") : "AVISO DE MENSAGEM: TUDO CONFERE")
);
process.exit(erros.length ? 1 : 0);
