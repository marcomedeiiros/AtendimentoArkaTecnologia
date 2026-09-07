/**
 * O AVISO DE MENSAGEM NOVA -- som e notificação do sistema.
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
 * ── O QUE ESTÁ TRAVADO AQUI ────────────────────────────────────────────────
 *
 *   O CORTE        só notifica quem NÃO está olhando -- cartão do sistema por
 *                  cima do painel em foco é ruído.
 *   UM AVISO SÓ    várias conversas viram uma notificação, não uma pilha.
 *   A PERMISSÃO    pedida a partir de um CLIQUE; automática, o navegador recusa
 *                  e ainda marca o site.
 *   A PREFERÊNCIA  por usuário (viaja com o perfil), lida por referência para
 *                  não fazer o efeito de mensagem nova rodar à toa.
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
const util = fs.readFileSync(path.join(C, "utils/notificacao.js"), "utf8");
const app = fs.readFileSync(path.join(C, "context/AppContext.jsx"), "utf8");
const auth = fs.readFileSync(path.join(C, "context/AuthContext.jsx"), "utf8");
const layout = fs.readFileSync(path.join(C, "components/layout/AppLayout.jsx"), "utf8");

console.log("=== Aviso de mensagem nova ===");

// ── `estaOlhando` é o corte, e ele executa de verdade ────────────────────────
//
// `document.hidden` sozinho não basta: a aba pode estar visível numa janela que
// está ATRÁS de outro programa, e aí a pessoa não está lendo nada. Este é o
// caso que mais acontece num turno -- o operador com o painel aberto e o Excel
// por cima.
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
    // remover o corte do AppContext passava despercebido -- a checagem media a
    // ferramenta, e nao o lugar onde ela e usada.
    if (!app.includes("if (avisosRef.current.desktop && !estaOlhando()) {")) {
      problemas.push("o disparo nao usa `!estaOlhando()`: o cartao aparece por cima do painel em foco");
    }
    check("so avisa quem NAO esta olhando", problemas);
  }
}

// ── A permissão só é pedida a partir de um clique ────────────────────────────
{
  const problemas = [];
  if (/pedirPermissao\(\)/.test(util.replace(/export async function pedirPermissao[\s\S]*?\n\}/, ""))) {
    problemas.push("`pedirPermissao` e chamada dentro do proprio utilitario -- pedido automatico");
  }
  if (/useEffect\([^)]*\)[\s\S]{0,200}pedirPermissao\(/.test(layout)) {
    problemas.push("a permissao e pedida dentro de um efeito: o navegador recusa e marca o site");
  }
  if (!/onClick=\{async \(\) => \{[\s\S]{0,400}pedirPermissao\(\)/.test(layout)) {
    problemas.push("nao achei o pedido de permissao dentro de um onClick");
  }
  check("a permissao e pedida a partir de um clique", problemas);
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

// ── A preferência é do perfil, e não trava o efeito ─────────────────────────
{
  const problemas = [];
  if (!/const CHAVE_AVISOS = .interface\.avisos.;/.test(auth)) {
    problemas.push("a preferencia nao esta em `interface.avisos` (por usuario, viaja com o perfil)");
  }
  if (!/PreferenciasAPI\.salvar\(CHAVE_AVISOS/.test(auth)) {
    problemas.push("a preferencia nao e salva no servidor -- ficaria so naquele navegador");
  }
  // Lida por REFERENCIA: com `avisos` nas dependencias, trocar a preferencia
  // faria o efeito de mensagem nova rodar de novo, mexendo no `ref` do
  // historico por um motivo que nao e mensagem nova.
  if (!/const avisosRef = useRef\(avisos\);/.test(app)) {
    problemas.push("a preferencia nao e lida por referencia no efeito de aviso");
  }
  if (!/avisosRef\.current\.som/.test(app) || !/avisosRef\.current\.desktop/.test(app)) {
    problemas.push("som e notificacao nao respeitam a preferencia");
  }
  check("a preferencia viaja com o perfil, sem re-disparar o efeito", problemas);
}

// ── O padrão é AVISAR ────────────────────────────────────────────────────────
//
// Preferência gravada por uma versão anterior não tem estes campos. Com `=== true`
// o operador ficaria sem aviso nenhum sem ter pedido -- e não teria como
// desconfiar, porque o silêncio é o mesmo do "não chegou mensagem".
{
  const problemas = [];
  if (!/som: v\?\.som !== false/.test(auth) || !/desktop: v\?\.desktop !== false/.test(auth)) {
    problemas.push("o padrao nao e avisar: preferencia antiga (sem o campo) deixaria o operador mudo");
  }
  check("preferencia antiga nao deixa ninguem sem aviso", problemas);
}

console.log(
  "\n" + (erros.length ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ") : "AVISO DE MENSAGEM: TUDO CONFERE")
);
process.exit(erros.length ? 1 : 0);
