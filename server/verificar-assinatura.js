/**
 * ASSINATURA DAS MENSAGENS -- o formato que o WhatsApp entende.
 *
 * ── POR QUE ESTE ARQUIVO EXISTE ────────────────────────────────────────────
 *
 * A assinatura sai assim:
 *
 *     > *Marco*
 *     texto da mensagem
 *
 * Duas marcações do WhatsApp, e nenhuma é Markdown:
 *
 *   `*nome*`  negrito -- UM asterisco de cada lado. Com dois (`**nome**`) o
 *             WhatsApp não reconhece e mostra os asteriscos como texto.
 *   `> `      citação -- separa a assinatura do corpo da mensagem.
 *
 * O defeito relatado era `**Marco**` chegando ao cliente. A causa não era a
 * formatação: era o NOME guardado no perfil já vir com a marcação (quem
 * preenche digita `*Marco*`, porque é assim que aparece no WhatsApp) e o código
 * embrulhar por cima.
 *
 * O que este arquivo protege, e por isso ele existe: as expressões que DETECTAM
 * assinatura repetida precisam reconhecer todas as formas que já circularam --
 * com e sem `> `, com um ou dois asteriscos, com `:` no fim. Sem isso, reenviar
 * uma mensagem antiga acumula assinaturas, e a regressão só aparece na conversa
 * do cliente.
 *
 * Não toca no banco: são funções puras do front, carregadas aqui como texto
 * porque o servidor é CommonJS e não há build step (mesma técnica do
 * verificar-tudo.js com o fluxoJson.js).
 *
 *   cd server && node verificar-assinatura.js
 */
const fs = require("fs");
const path = require("path");

const fonte = fs.readFileSync(
  path.join(__dirname, "..", "client", "src", "utils", "assinatura.js"),
  "utf8"
);
const mod = {};
new Function(
  "exports",
  fonte.replace(/export /g, "") +
    "\n;exports.f = formatarComAssinatura; exports.l = formatarLegendaComAssinatura;"
)(mod);
const { f, l } = mod;

const erros = [];
let secao = "";
const titulo = (t) => { secao = t; console.log(`\n=== ${t} ===`); };
const check = (rotulo, obtido, esperado) => {
  const ok = obtido === esperado;
  console.log(`  ${ok ? "OK  " : "FALHA"} ${rotulo}`);
  if (!ok) {
    console.log(`        obtido:   ${JSON.stringify(obtido)}`);
    console.log(`        esperado: ${JSON.stringify(esperado)}`);
    erros.push(`[${secao}] ${rotulo}`);
  }
};

titulo("1. O formato que o WhatsApp entende");
check("assina com > e UM asterisco de cada lado", f("bom dia", true, "Marco"), "> *Marco*\nbom dia");
check("midia sem texto usa so a assinatura", l("", true, "Marco"), "> *Marco*");
check("midia com texto assina igual", l("olha o print", true, "Marco"), "> *Marco*\nolha o print");

// A CAUSA do defeito relatado. Quem preenche o campo de assinatura no perfil
// digita a marcacao junto, porque e assim que ela aparece no WhatsApp. O codigo
// nao pode embrulhar por cima.
titulo("2. Nome guardado ja com marcacao (a origem do **Marco**)");
check("nome como *Marco*", f("bom dia", true, "*Marco*"), "> *Marco*\nbom dia");
check("nome como **Marco**", f("bom dia", true, "**Marco**"), "> *Marco*\nbom dia");
check("nome como > Marco", f("bom dia", true, "> Marco"), "> *Marco*\nbom dia");
check("nome como > *Marco*", f("bom dia", true, "> *Marco*"), "> *Marco*\nbom dia");
check("nome como Marco:", f("bom dia", true, "Marco:"), "> *Marco*\nbom dia");
check("nome com espacos sobrando", f("bom dia", true, "  Marco  "), "> *Marco*\nbom dia");

// Reenviar uma mensagem que ja tem assinatura nao pode acumular. Inclui os
// formatos ANTIGOS, que continuam no historico das conversas.
titulo("3. Nao duplica ao reenviar");
check("ja no formato novo", f("> *Marco*\nbom dia", true, "Marco"), "> *Marco*\nbom dia");
check("formato antigo *Marco*", f("*Marco*\nbom dia", true, "Marco"), "> *Marco*\nbom dia");
check("formato antigo Marco:", f("Marco:\nbom dia", true, "Marco"), "> *Marco*\nbom dia");
check("assinatura no rodape", f("bom dia\n\nMarco", true, "Marco"), "> *Marco*\nbom dia");
check("rodape com despedida", f("bom dia\n\nAtenciosamente,\nMarco", true, "Marco"), "> *Marco*\nbom dia");
check("assinatura no meio", f("bom dia\n\nMarco\n\nate mais", true, "Marco"), "> *Marco*\nbom dia\n\nate mais");
check("texto e so o nome", f("Marco", true, "Marco"), "> *Marco*");

titulo("4. Nao mexe onde nao deve");
check("assinatura desligada", f("bom dia", false, "Marco"), "bom dia");
check("sem nome", f("bom dia", true, ""), "bom dia");
check("texto vazio", f("", true, "Marco"), "");
check("texto vazio sem assinar", f("", false, "Marco"), "");
check("nome so com marcacao vira vazio", f("bom dia", true, "**"), "bom dia");
check("texto nao e string", f(null, true, "Marco"), "");
// O nome citado NO MEIO de uma frase e conteudo, nao assinatura -- apagar
// aquilo mudaria o que o atendente escreveu.
check("nome no meio da frase e conteudo", f("o Marco vai ligar", true, "Marco"), "> *Marco*\no Marco vai ligar");
// Nome com caractere especial de regex nao pode quebrar a expressao.
check("nome com ponto", f("bom dia", true, "Dr. Silva"), "> *Dr. Silva*\nbom dia");

console.log(
  "\n" + (erros.length ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ") : "ASSINATURA: TUDO CONFERE")
);
process.exit(erros.length ? 1 : 0);
