/**
 * O STREAM QUE MORRE CALADO -- e o vigia que percebe.
 *
 * ── O RELATO ───────────────────────────────────────────────────────────────
 *
 * "A automação fecha a conversa, mas ela só vai para a aba de Fechadas quando eu
 * volto para o navegador." O fechamento acontece no servidor (varredura de
 * inatividade) e o evento É emitido -- conferido em `chatbot.engine.fecharConversa`.
 * O que faltava era o painel receber.
 *
 * ── AS DUAS FALHAS QUE ISTO CORRIGE ────────────────────────────────────────
 *
 * BATIMENTO INVISÍVEL. O servidor mandava `: ping`, um COMENTÁRIO. Ele mantém a
 * conexão viva contra proxy e firewall, mas o `EventSource` não entrega
 * comentário ao JavaScript -- só linhas `data:`. Sem isso o painel não tinha como
 * distinguir "conectado e sem novidade" de "conexão morta em silêncio", e
 * portanto não podia ter vigia nenhum.
 *
 * `onerror` não cobre esse caso: ele dispara quando o NAVEGADOR percebe a queda.
 * Aba congelada em segundo plano e proxy que corta calado não disparam nada -- a
 * conexão fica de pé no papel e muda para sempre.
 *
 * VOLTAR DE OUTRO PROGRAMA. A releitura de segurança rodava em
 * `visibilitychange`. Ao voltar de outro aplicativo a aba muitas vezes nunca
 * ficou oculta -- a janela só perdeu o foco --, então o evento não dispara. Era
 * o caso relatado.
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

const ler = (p) => fs.readFileSync(p, "utf8").split("\r\n").join("\n");
const stream = ler(path.join(__dirname, "src/modules/conversas/conversa.stream.js"));
const app = ler(path.resolve(__dirname, "../client/src/context/AppContext.jsx"));

console.log("=== Stream vivo ===");

// ── O batimento tem de ser VISÍVEL para o cliente ────────────────────────────
{
  const problemas = [];
  if (/res\.write\(":\s*ping/.test(stream)) {
    problemas.push("o batimento voltou a ser comentario (`: ping`) -- o EventSource nao o entrega ao JavaScript");
  }
  if (!/type: "ping"/.test(stream)) {
    problemas.push("nao achei o batimento como evento `ping`");
  }
  // E ele nao pode mexer em estado: `aplicarEvento` so trata tipos conhecidos.
  if (/case "ping"|type === "ping"/.test(app)) {
    problemas.push("o cliente passou a tratar `ping` como evento de conteudo");
  }
  check("o batimento e um evento que o cliente enxerga", problemas);
}

// ── O vigia ──────────────────────────────────────────────────────────────────
{
  const problemas = [];
  if (!/let ultimoSinal = Date\.now\(\);/.test(app)) {
    problemas.push("ninguem marca quando chegou o ultimo sinal");
  }
  // Marcado em QUALQUER mensagem, inclusive o batimento: so em evento util, o
  // vigia derrubaria conexao saudavel numa hora de pouco movimento.
  if (!/ultimoSinal = Date\.now\(\);\n\s*try \{ aplicarEvento/.test(app)) {
    problemas.push("o sinal nao e marcado no `onmessage` -- hora parada derrubaria a conexao");
  }
  if (!/const vigia = setInterval\(/.test(app)) {
    problemas.push("nao ha vigia: conexao morta sem `onerror` fica parada para sempre");
  }
  if (!/clearInterval\(vigia\);/.test(app)) {
    problemas.push("o vigia nao e desligado na limpeza do efeito -- vaza a cada remontagem");
  }
  check("o vigia percebe a conexao que morre calada", problemas);
}

// ── A janela de silêncio tem de caber no batimento ──────────────────────────
//
// A checagem que mais importa deste arquivo. Batimento a cada 20s e limite de
// 70s = tres perdidos. Se alguem aumentar o batimento sem mexer no limite, o
// vigia passa a derrubar conexao SAUDAVEL -- e o sintoma seria reconexao em
// looping, pior que o defeito original.
{
  const hb = Number(/const HEARTBEAT_MS = ([\d_]+)/.exec(stream)?.[1].replace(/_/g, ""));
  const limite = Number(/Date\.now\(\) - ultimoSinal < (\d+)/.exec(app)?.[1]);
  const problemas = [];
  if (!hb) problemas.push("nao achei HEARTBEAT_MS");
  if (!limite) problemas.push("nao achei o limite de silencio do vigia");
  if (hb && limite && limite < hb * 3) {
    problemas.push(
      `o limite (${limite}ms) e menor que tres batimentos (${hb * 3}ms): o vigia derrubaria conexao saudavel`
    );
  }
  check("o limite do vigia cabe em tres batimentos", problemas);
}

// ── Voltar de outro programa reconcilia ─────────────────────────────────────
{
  const problemas = [];
  if (!/window\.addEventListener\('focus', reconciliar\);/.test(app)) {
    problemas.push("nao reconcilia no `focus`: voltar de outro aplicativo nao dispara `visibilitychange`");
  }
  if (!/window\.removeEventListener\('focus', reconciliar\);/.test(app)) {
    problemas.push("o ouvinte de `focus` nao e removido -- acumula a cada remontagem");
  }
  check("voltar de outro programa reconcilia a lista", problemas);
}

console.log(
  "\n" + (erros.length ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ") : "STREAM VIVO: TUDO CONFERE")
);
process.exit(erros.length ? 1 : 0);
