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
    // O `&& paraMeuOuvido.length > 0` entrou junto com o recorte por dono
    // (11/09/2026): o cartao do sistema segue a mesma regra do som. A parte que
    // esta checagem protege continua sendo o `!estaOlhando()` -- cartao por cima
    // do painel em foco e ruido, porque a conversa ja entrou na lista.
    if (!app.includes("if (!estaOlhando() && paraMeuOuvido.length > 0) {")) {
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

  /**
   * O CODIGO, SEM OS COMENTARIOS -- e para as checagens NEGATIVAS.
   *
   * Toda vez que uma regra sai, o arquivo passa a CITAR a regra antiga para
   * explicar por que ela saiu -- e uma checagem do tipo "isto nao pode existir"
   * medindo o texto cru reprova justamente a explicacao. Aconteceu quatro vezes
   * nesta semana, em quatro arquivos diferentes: e a explicacao que faz a
   * proxima pessoa entender que a ausencia e decisao, entao ela fica, e o
   * medidor e que se ajusta.
   */
  const codigo = app
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  if (/avisosRef|avisos\.som|avisos\.desktop/.test(codigo)) {
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
  // ── O SOM DA CENTRAL PASSOU A TER DONO (11/09/2026) ─────────────────────
  //
  // Esta checagem exigia que, fora do Modo TV, o som fosse INCONDICIONAL. Ela
  // estava certa enquanto a pergunta era "alguem pode me deixar mudo sem eu
  // saber?" -- e continua sendo essa a pergunta para PREFERENCIA. O que mudou e
  // que o som passou a ter DONO, a pedido:
  //
  //   "o som aparece para todos os perfis; eu queria que so tocasse para quem
  //    atendeu. Ficar na plataforma ouvindo notificacao o tempo todo sendo que
  //    nao fui eu que atendi o chamado nao faz sentido."
  //
  // E som que nao e meu e som que eu aprendo a ignorar -- inclusive quando for
  // meu. Entao a garantia trocou de forma, e nao de natureza: nada de gosto
  // pessoal no caminho, mas o CONTEXTO decide (de quem e a conversa), como ja
  // decidia no Modo TV.
  //
  // O que se trava agora:
  if (!app.includes("const paraMeuOuvido = novas.filter(")) {
    problemas.push("o recorte do som por dono desapareceu");
  }
  // ── E A FILA SAIU DO SOM DA CENTRAL (11/09/2026) ────────────────────────
  //
  // Esta checagem travava o OPOSTO: exigia que conversa sem dono tocasse para
  // todos, porque silenciar a fila trocaria um incomodo por um cliente
  // esperando. A garantia estava certa enquanto a fila nao tinha outro vigia.
  //
  // Ela passou a ter: o MODO TV, que e a tela feita para isso e continua tocando
  // em tudo. A fila saiu do som da Central a pedido, e o que sustenta a decisao
  // e ela continuar VISIVEL ali (o badge do menu com a contagem de pendentes, a
  // lista de avisos e o sino -- nenhum deles recortado).
  //
  // Agora se trava o contrario, nas duas direcoes: o dono ouve, e a fila NAO
  // toca na Central.
  if (!app.includes("novas.filter((n) => n.atendenteId === usuario?.id)")) {
    problemas.push("o som da Central deixou de ser exatamente 'so o dono ouve'");
  }
  if (/!n\.atendenteId\s*\|\|/.test(codigo)) {
    problemas.push("a fila voltou a tocar na Central -- ela e do Modo TV agora");
  }
  if (!app.includes("} else if (paraMeuOuvido.length > 0) {")) {
    problemas.push("o som da Central nao esta mais condicionado APENAS ao dono/fila");
  }
  // E O AVISO DO SISTEMA segue a mesma regra: cartao sobre conversa que nao e
  // minha e o mesmo incomodo em outro formato, e fica na tela ate alguem fechar.
  if (!app.includes("!estaOlhando() && paraMeuOuvido.length > 0")) {
    problemas.push("o aviso do sistema deixou de seguir a mesma regra do som");
  }
  // ── A ESCOLHA DO SOM, E A FORMA QUE GARANTE QUE NINGUEM FICA MUDO ──────
  //
  // Esta checagem ja travou TRES regras diferentes, e reprovou codigo CORRETO
  // nas tres viradas -- porque media a FORMA da linha, e nao a garantia. A
  // versao anterior exigia `if (modoTvRef.current) {` seguido de
  // `tocarSomMonitoramento();` sem condicao: era a regra de c0d21df ("uma
  // tela, um som"), que o proprio pedido mandou tirar em d31a754 ("no Modo TV
  // ele fica notificando sem parar"). Ficou dias VERMELHA defendendo o
  // contrario do que a operacao pediu -- e verificador que reprova codigo
  // certo e verificador que a proxima pessoa aprende a ignorar.
  //
  // A GARANTIA DE HOJE, escrita como afirmacao e nao como desenho:
  //
  //   1. na TV, o Monitoramento toca se e so se houver mensagem nova em
  //      conversa PENDENTE (`paraATv`) -- e nao em atendimento em curso;
  //   2. o dono OUVE o proprio blip com o Modo TV aberto ou fechado. As duas
  //      regras sao independentes: a tela que esta aberta nao pode deixar
  //      ninguem mudo.
  //
  // A (2) e o defeito de 14/09/2026, e ele era de FORMA: a condicao da TV
  // estava ANINHADA (`if (modoTv) { if (paraATv...) }`), entao com a TV aberta
  // e a fila parada o `else if` do dono nao era alcancado. COMBINADA num ramo
  // so, o `else` volta a cobrir todo o resto. Por isso se trava a forma
  // combinada: nao da para afirmar "nenhum caminho fica sem som" sem olhar a
  // estrutura que garante isso.
  //
  // E se trava por TEXTO, e nao por regex: as tres versoes anteriores eram
  // regex, e o que quebrou nas tres foi o padrao, nao a garantia.
  if (!app.includes("const paraATv = novas.filter((n) => n.pendente);")) {
    problemas.push("o recorte do som da TV pela FILA sumiu -- a TV volta a tocar em atendimento em curso");
  }
  if (!codigo.includes("if (modoTvRef.current && paraATv.length > 0) {")) {
    problemas.push("a condicao do som da TV deixou de ser COMBINADA -- com a TV aberta, o dono pode ter voltado a ficar mudo");
  }
  // A forma ANINHADA de volta e exatamente o defeito de 14/09: um ramo so da
  // TV, e o dono sem `else`.
  if (codigo.includes("if (modoTvRef.current) {")) {
    problemas.push("a condicao do Modo TV voltou a ser aninhada -- foi assim que o dono ficou sem o blip");
  }
  if (!app.includes("tocarSomMensagem();")) {
    problemas.push("o som da Central desapareceu");
  }
  // ── VER NAO E OUVIR, e esta e a invariante nova ─────────────────────────
  //
  // O recorte e do SOM. A lista de notificacoes, o pulso do sino e os
  // contadores continuam recebendo `novas` -- tudo que chega no setor --,
  // porque acompanhar o que a equipe esta recebendo e util e nao incomoda
  // ninguem. Recortar a lista junto seria tirar visibilidade para resolver
  // barulho, e ai a tela passaria a esconder trabalho da equipe.
  if (!app.includes("setNotificacoes(prev => [...novas,")) {
    problemas.push("a LISTA de avisos passou a ser recortada -- o recorte e so do som");
  }
  if (app.includes("registrarNoHistorico(paraMeuOuvido)")) {
    problemas.push("o historico de avisos passou a ser recortado -- ele mostra o setor inteiro");
  }
  if (/houveChamadoNovo/.test(codigo)) {
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
  // `paraMeuOuvido[0]` e nao `novas[0]` desde o recorte por dono: o cartao
  // fala das conversas que fazem som para esta pessoa.
  if (!/const primeira = paraMeuOuvido\[0\];/.test(app)) {
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

// ── E AGORA A REGRA E EXECUTADA, e nao so lida ─────────────────────────
//
// Tudo acima e grep, e grep foi o que falhou tres vezes: a garantia ficava
// de pe e a checagem reprovava a forma nova. As duas auditorias dos sons
// dizem que o ideal seria exercitar a decisao, e que nao dava porque ela
// vive dentro de um efeito React alimentado por SSE.
//
// Da, sim -- desde que se recorte apenas o BLOCO da decisao. Ele nao depende
// do React: sao cinco nomes (`modoTvRef`, as duas listas e os dois sons).
// Extraindo o texto REAL do arquivo e rodando com dubles, a pergunta deixa
// de ser "a linha esta escrita assim?" e passa a ser "com a TV aberta e a
// fila parada, o dono ouve?" -- que e a pergunta que o relato de 14/09 fez.
{
  const problemas = [];
  // Acha o bloco pelo INICIO da condicao, e nao pela forma inteira: assim,
  // se a forma aninhada voltar, este bloco a EXECUTA e diz qual caso ficou
  // mudo -- em vez de reclamar que nao encontrou nada. Forma quem trava e a
  // checagem de texto acima; aqui se mede comportamento.
  const i = app.indexOf("if (modoTvRef.current");
  if (i < 0) {
    problemas.push("nao achei o bloco da decisao do som para executar");
  } else {
    const j = app.indexOf("\n", app.indexOf("tocarSomMensagem();", i));
    const bloco = app.slice(i, app.indexOf("}", j) + 1);

    //  nome                                          TV     fila minhas  esperado
    const casos = [
      ["TV aberta + mensagem na FILA",                true,  1,   0,      "monitoramento"],
      ["TV aberta + mensagem na MINHA conversa",      true,  0,   1,      "blip"],
      ["TV aberta + fila e minha conversa na rajada", true,  1,   1,      "monitoramento"],
      ["TV aberta + conversa de OUTRO atendente",     true,  0,   0,      "silencio"],
      ["Central + minha conversa",                    false, 0,   1,      "blip"],
      ["Central + fila (a fila e do Modo TV)",        false, 1,   0,      "silencio"],
    ];

    for (const [nome, tv, nFila, nMinhas, esperado] of casos) {
      let tocou = "silencio";
      // eslint-disable-next-line no-new-func
      const fn = new Function(
        "modoTvRef", "paraATv", "paraMeuOuvido", "tocarSomMonitoramento", "tocarSomMensagem",
        bloco
      );
      fn(
        { current: tv },
        new Array(nFila).fill({}),
        new Array(nMinhas).fill({}),
        () => { tocou = "monitoramento"; },
        () => { tocou = "blip"; }
      );
      if (tocou !== esperado) problemas.push(nome + ": esperava " + esperado + ", veio " + tocou);
    }
  }
  check("a decisao do som, EXECUTADA caso a caso", problemas);
}

console.log(
  "\n" + (erros.length ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ") : "AVISO DE MENSAGEM: TUDO CONFERE")
);
process.exit(erros.length ? 1 : 0);
