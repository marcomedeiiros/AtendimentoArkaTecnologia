/**
 * O CHECKLIST DO RELATÓRIO DEIXOU DE SER FIXO.
 *
 * ── O QUE MUDOU ────────────────────────────────────────────────────────────
 *
 * Eram oito itens cravados no código (`ITENS_MAPEAMENTO`). Cada empresa mapeia
 * coisas diferentes -- um cliente sem ramal nunca preenche "Telefonia", e isso
 * virava completude perdida para sempre, sem ninguém entender por quê.
 *
 * A lista passou a ser configuração, e ela atravessa MUITA coisa: a nota de
 * completude, a leitura do PDF, o formulário de visita, a allowlist do que pode
 * ser gravado e o schema da borda. Cada um desses era um lugar onde a lista
 * fixa podia sobreviver escondida e fazer o item novo sumir sem erro nenhum.
 *
 * ── O QUE ESTÁ TRAVADO AQUI ────────────────────────────────────────────────
 *
 *   A CONTA        completude usa a lista em vigor, e um item a mais muda o
 *                  denominador (é retroativo, e a tela avisa).
 *   O VOCABULÁRIO  acompanha o checklist sozinho -- item novo nasce com chave
 *                  em `palavras`, item removido não deixa órfão.
 *   A BORDA        o schema aceita chave criada pela empresa; a allowlist de
 *                  verdade mudou para o serviço, que enxerga a configuração.
 *   O HISTÓRICO    remover um item NÃO apaga o que já foi escrito nele.
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

const R = path.join(__dirname, "src/modules/rankings");
const regras = require(path.join(R, "relatorio.regras"));
const { completudeDe, ITENS_MAPEAMENTO } = require(path.join(R, "pontuacao.externa"));

console.log("=== Checklist configuravel ===");

const base = regras.validar({}, undefined);

// ── A configuração ───────────────────────────────────────────────────────────
{
  const problemas = [];
  if (base.itens.length !== ITENS_MAPEAMENTO.length) {
    problemas.push(`o padrao deveria trazer os ${ITENS_MAPEAMENTO.length} itens de fabrica, trouxe ${base.itens.length}`);
  }

  // Renomear NÃO pode trocar a chave: ela é o campo no JSON já gravado, e uma
  // chave nova faria o texto existente virar órfão sem aviso.
  const renomeado = regras.validar({ itens: [{ chave: "backup", rotulo: "Cópias de segurança" }] }, base);
  if (renomeado.itens[0].chave !== "backup") {
    problemas.push("renomear o rotulo trocou a chave -- o texto ja escrito viraria orfao");
  }

  // Item novo ganha chave a partir do rótulo, sem acento nem espaço.
  const comNovo = regras.validar({ itens: [...base.itens, { rotulo: "Câmeras e CFTV" }] }, base);
  if (!comNovo.itens.some((i) => i.chave === "camerasecftv")) {
    problemas.push("item novo nao gerou chave utilizavel: " + JSON.stringify(comNovo.itens.at(-1)));
  }

  // Lista vazia é recusada alto: com zero itens a completude de todo mundo vira
  // zero, e o operador só descobriria pelo ranking do mês.
  let recusou = false;
  try { regras.validar({ itens: [] }, base); } catch (e) { recusou = e.code === "CHECKLIST_VAZIO"; }
  if (!recusou) problemas.push("checklist vazio foi aceito");

  // Duplicata não pode entrar: duas linhas com a mesma chave se sobrescreveriam.
  const dup = regras.validar({ itens: [{ rotulo: "Backup" }, { rotulo: "backup" }] }, base);
  if (dup.itens.length !== 1) problemas.push("chave duplicada passou: " + JSON.stringify(dup.itens));

  check("adicionar, remover e renomear itens", problemas);
}

// ── O vocabulário acompanha ──────────────────────────────────────────────────
//
// O caso que mais engana: salvar SÓ o checklist. O bloco de `palavras` nem roda,
// e sem reconciliação o item novo nasceria sem chave nenhuma -- a leitura do PDF
// cairia num `undefined` e ele jamais seria dado como coberto.
{
  const so = regras.validar({ itens: [{ chave: "backup", rotulo: "Backup" }, { rotulo: "Câmeras" }] }, base);
  const chaves = Object.keys(so.palavras).sort().join(",");
  check("o vocabulario acompanha o checklist mesmo salvando so os itens", [
    ...(chaves === "backup,cameras" ? [] : ["as chaves de `palavras` ficaram " + chaves]),
    ...((so.palavras.backup || []).length ? [] : ["o item de fabrica perdeu as palavras dele"]),
    ...((so.palavras.cameras || []).length === 0
      ? []
      : ["o item novo nasceu com palavras inventadas -- casariam com texto que nao tem nada a ver"]),
  ]);
}

// ── A conta ──────────────────────────────────────────────────────────────────
{
  const mapa = { itens: { backup: "feito", seguranca: "ok" }, resumo: "x".repeat(30) };
  const doisItens = [{ chave: "backup", rotulo: "B" }, { chave: "seguranca", rotulo: "S" }];
  const tresItens = [...doisItens, { chave: "cameras", rotulo: "C" }];

  const c2 = completudeDe(mapa, doisItens);
  const c3 = completudeDe(mapa, tresItens);

  check("a completude usa o checklist em vigor", [
    // 2 preenchidos + resumo, sobre 2 itens + 1 = 100%.
    ...(Math.round(c2 * 100) === 100 ? [] : ["com 2 itens preenchidos de 2 deveria dar 100%, deu " + Math.round(c2 * 100)]),
    // O mesmo relatorio, com um item a mais no checklist: 3 de 4 = 75%.
    ...(Math.round(c3 * 100) === 75 ? [] : ["com um item a mais deveria cair para 75%, deu " + Math.round(c3 * 100)]),
    ...(c3 < c2 ? [] : ["acrescentar item deveria BAIXAR a completude dos relatorios antigos -- e retroativo, e a tela avisa"]),
  ]);

  // Sem itens a conta nao pode dividir por 1 e dar 100% de graca.
  check("checklist vazio nao vira nota cheia", [
    ...(completudeDe(mapa, []) === 0 ? [] : ["com zero itens deveria dar 0, deu " + completudeDe(mapa, [])]),
  ]);
}

// ── A borda aceita chave criada pela empresa ────────────────────────────────
{
  const { criarMapeamentoSchema } = require(path.join(R, "ranking.dto"));
  const problemas = [];
  const corpo = {
    empresa: "ACME",
    dataVisita: "2026-09-01",
    itens: { camerasecftv: "quatro cameras novas" },
  };
  const r = criarMapeamentoSchema?.safeParse ? criarMapeamentoSchema.safeParse(corpo) : null;
  if (!r) problemas.push("nao achei `criarMapeamentoSchema` para testar a borda");
  else if (!r.success) {
    problemas.push("chave criada pela empresa foi recusada na borda: " + JSON.stringify(r.error.issues?.[0]));
  }
  // E o que NAO e chave continua barrado.
  const ruim = criarMapeamentoSchema?.safeParse({ ...corpo, itens: { "Ca meras!": "x" } });
  if (ruim?.success) problemas.push("chave com espaco/maiuscula passou na borda");

  check("a borda aceita item criado pela empresa, e so ele", problemas);
}

console.log(
  "\n" + (erros.length ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ") : "CHECKLIST CONFIGURAVEL: TUDO CONFERE")
);
process.exit(erros.length ? 1 : 0);
