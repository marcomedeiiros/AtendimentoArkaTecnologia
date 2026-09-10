/**
 * AS REGRAS DOS RELATORIOS DE VISITA -- o que o administrador decide sem deploy.
 *
 * ── O QUE MORA AQUI, E O QUE NAO ───────────────────────────────────────────
 *
 * Mora o que e POLITICA da empresa: quanto tempo se tem para entregar, quanto
 * cada coisa vale, quantos relatorios ja permitem julgar alguem, e o vocabulario
 * que a leitura do PDF procura. Tudo isso mudava so com alguem editando codigo
 * e subindo versao -- e a pergunta "por que o prazo e de 3 dias?" nao tinha
 * resposta melhor do que "foi o que ficou escrito".
 *
 * NAO mora aqui a formula. O jeito de somar as parcelas continua em
 * `pontuacao.externa`, fechado: peso e uma decisao de negocio, mas "como se
 * calcula" e uma decisao de engenharia, e abrir as duas na mesma tela e como
 * ninguem mais saber por que o numero deu aquilo.
 *
 * ── UM REGISTRO SO, EM JSON ────────────────────────────────────────────────
 *
 * Uma linha na tabela de configuracao, gravada por acesso direto -- mesma
 * escolha do marco de zeragem do painel, e pelo mesmo motivo: o
 * `configuracaoService` serve a tela de Configuracoes (allowlist propria, cache
 * proprio), e pendurar isto la faria um JSON de regras aparecer como campo de
 * texto numa tela que nao e esta.
 *
 * ── O QUE E GUARDADO E SO O QUE MUDOU ──────────────────────────────────────
 *
 * O padrao vive no codigo e e aplicado por cima do que estiver salvo. Assim uma
 * regra nova nasce com valor sensato sem ninguem precisar re-salvar a tela, e um
 * banco vazio nao significa "tudo zero".
 */
const prisma = require("../../infrastructure/database/prisma.client");
const AppError = require("../../shared/errors/AppError");
const logger = require("../../config/logger");
// A MESMA aparagem que o ciclo do ranking usa -- ver o helper.
const { diaQueExiste } = require("../../shared/helpers/calendario.helper");
const { ITENS_MAPEAMENTO, PESOS, MINIMO_MAPEAMENTOS, CUSTO_POR_DEVOLUCAO } = require("./pontuacao.externa");
const { PALAVRAS_PADRAO } = require("./analise.relatorio");

const CHAVE = "relatorios.regras";

/**
 * O PADRAO sai das constantes que ja existiam -- e nao de numeros repetidos
 * aqui. Duas listas para a mesma coisa e o comeco da divergencia: alguem
 * ajustaria o peso num lugar e o "restaurar padrao" devolveria o outro.
 */
function padrao() {
  return {
    // Prazo de entrega: dias corridos depois da visita.
    prazoDias: 3,
    // Vencimento MENSAL: ate o dia N do mes seguinte, todos os relatorios
    // daquele mes precisam estar entregues. `null` = a empresa nao usa essa
    // regra e vale so o prazo por relatorio.
    vencimentoDiaDoMes: null,
    // Nao deixa ENTREGAR sem o PDF anexado. Desligado por padrao: ligar isso
    // numa operacao que ainda nao manda PDF trancaria a entrega de todo mundo.
    exigirPdf: false,
    minimoRelatorios: MINIMO_MAPEAMENTOS,
    pesos: { ...PESOS },
    custoPorDevolucao: CUSTO_POR_DEVOLUCAO,
    // O vocabulario que a leitura do PDF procura em cada item do checklist.
    // E o ajuste mais provavel de todos: cada empresa escreve o relatorio com
    // as palavras dela, e um item que nunca casa vira completude perdida sem
    // ninguem entender por que.
    // O CHECKLIST. Deixou de ser fixo em 09/2026: cada empresa mapeia coisas
    // diferentes, e um item que não se usa é completude perdida para sempre --
    // ninguém preenche "Telefonia e ramais" num cliente que não tem ramal.
    itens: ITENS_MAPEAMENTO.map((i) => ({ ...i })),
    palavras: Object.fromEntries(ITENS_MAPEAMENTO.map((i) => [i.chave, [...(PALAVRAS_PADRAO[i.chave] || [])]])),
  };
}

const inteiro = (v, min, max, atual) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return atual;
  return Math.min(max, Math.max(min, Math.round(n)));
};

// Chave de item: minúsculas, sem acento e sem espaço. É ela que vira campo no
// formulário e chave no JSON gravado -- se mudar, o texto já escrito naquele
// item deixa de ser encontrado. Por isso a chave de um item existente NUNCA é
// reescrita a partir do rótulo: renomear "Backup" para "Cópias" mantém a
// chave `backup` e o histórico junto.
function chaveDeItem(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 40);
}

// Teto de itens. Não é limite técnico: é o ponto em que o formulário de visita
// vira um questionário que ninguém preenche até o fim -- e checklist pela
// metade é completude perdida, que é o defeito que ele deveria evitar.
const MAX_ITENS = 20;

/**
 * O CHECKLIST configurado.
 *
 * Recusa alto quando a lista chega vazia ou toda inválida: com zero itens a
 * completude de todo mundo vira zero, e o operador só descobriria pelo ranking
 * do mês. É o mesmo critério dos pesos que não somam 100.
 */
function validarItens(lista, base) {
  if (lista === undefined) return base;
  if (!Array.isArray(lista)) return base;

  const vistos = new Set();
  const out = [];
  for (const bruto of lista) {
    const rotulo = String(bruto?.rotulo || "").trim().slice(0, 60);
    if (!rotulo) continue;
    // A chave enviada vence; ela existe justamente para sobreviver a um
    // rótulo renomeado. Só um item NOVO tira a chave do rótulo.
    const chave = chaveDeItem(bruto?.chave) || chaveDeItem(rotulo);
    if (!chave || vistos.has(chave)) continue;
    vistos.add(chave);
    out.push({ chave, rotulo });
    if (out.length >= MAX_ITENS) break;
  }

  if (!out.length) {
    throw new AppError(
      "O checklist precisa ter pelo menos um item.",
      400,
      "CHECKLIST_VAZIO"
    );
  }
  return out;
}

/**
 * VALIDA o que veio da tela, campo a campo.
 *
 * Recusa alto (400) em vez de corrigir em silencio nos casos em que corrigir
 * mudaria o SIGNIFICADO -- pesos que nao somam 100 sao o exemplo: aparar o
 * excedente sozinho daria um quadro salvo diferente do que a pessoa digitou, e
 * ela so descobriria pela pontuacao do mes.
 *
 * Nos limites simples (prazo, minimo) prende na faixa: ali "90 dias" e "900
 * dias" querem dizer a mesma coisa, e travar a tela por isso e ruido.
 */
function validar(entrada, base = padrao()) {
  const out = { ...base };

  if (entrada.prazoDias !== undefined) out.prazoDias = inteiro(entrada.prazoDias, 1, 90, base.prazoDias);

  if (entrada.vencimentoDiaDoMes !== undefined) {
    const v = entrada.vencimentoDiaDoMes;
    // DE 1 A 31, e o dia que nao existe no mes cai no ULTIMO dia dele (ver
    // `prazoDe` e o helper de calendario). O teto era 28, com a justificativa
    // "o dia 30 nao existe em fevereiro" -- e ela resolvia o problema errado:
    // quem fecha o mes no dia 30 precisava do dia 30. O que a regra nunca pode
    // fazer e SUMIR num mes do ano, e a aparagem e o que garante isso.
    out.vencimentoDiaDoMes = v === null || v === "" ? null : inteiro(v, 1, 31, base.vencimentoDiaDoMes ?? 5);
  }

  if (entrada.exigirPdf !== undefined) out.exigirPdf = !!entrada.exigirPdf;
  if (entrada.minimoRelatorios !== undefined) {
    out.minimoRelatorios = inteiro(entrada.minimoRelatorios, 1, 20, base.minimoRelatorios);
  }
  if (entrada.custoPorDevolucao !== undefined) {
    out.custoPorDevolucao = inteiro(entrada.custoPorDevolucao, 0, 25, base.custoPorDevolucao);
  }

  // ANTES de `palavras`: é o checklist novo que decide quais chaves de
  // vocabulário fazem sentido guardar. Na ordem inversa, um item recém-criado
  // teria as palavras descartadas na mesma gravação em que nasceu.
  out.itens = validarItens(entrada.itens, base.itens);

  if (entrada.pesos && typeof entrada.pesos === "object") {
    const pesos = {};
    for (const chave of Object.keys(base.pesos)) {
      pesos[chave] = inteiro(entrada.pesos[chave], 0, 100, base.pesos[chave]);
    }
    const soma = Object.values(pesos).reduce((a, b) => a + b, 0);
    if (soma !== 100) {
      throw new AppError(
        `Os pesos precisam somar 100. Somaram ${soma}.`,
        400,
        "PESOS_NAO_SOMAM_100"
      );
    }
    out.pesos = pesos;
  }

  if (entrada.palavras && typeof entrada.palavras === "object") {
    const palavras = {};
    // Os itens EM VIGOR, e não a lista de fábrica: item removido não deixa
    // vocabulário órfão crescendo no JSON, e item novo ganha o campo dele.
    for (const item of out.itens) {
      const bruto = entrada.palavras[item.chave];
      const lista = (Array.isArray(bruto) ? bruto : String(bruto || "").split(","))
        .map((p) => String(p).trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 40);
      // ITEM SEM PALAVRA NENHUMA NUNCA SERIA DADO COMO COBERTO -- e a pessoa
      // veria a completude da equipe cair sem relacionar com o campo que ela
      // esvaziou. Vazio volta ao padrao, e a tela mostra o que ficou.
      // Vazio volta ao padrão -- mas item CRIADO pela empresa não tem padrão.
      // Ali o vazio fica vazio mesmo, e é a tela que precisa cobrar as
      // palavras: inventar uma lista para um item que ninguém descreveu seria
      // pior, porque casaria com texto que não tem nada a ver.
      const padraoDoItem = base.palavras?.[item.chave] || PALAVRAS_PADRAO[item.chave] || [];
      palavras[item.chave] = lista.length ? [...new Set(lista)] : [...padraoDoItem];
    }
    out.palavras = palavras;
  }

  // ── O VOCABULÁRIO ACOMPANHA O CHECKLIST, SEMPRE ──────────────────────────
  //
  // A reconciliação fica FORA do `if (entrada.palavras)` de propósito. A tela
  // pode salvar só o checklist -- ao adicionar um item, por exemplo --, e nesse
  // caso o bloco acima nem roda: o item nasceria sem chave nenhuma em
  // `palavras`, a leitura do PDF cairia num `undefined` e ele jamais seria dado
  // como coberto. Completude perdida em silêncio, que é exatamente o defeito
  // que o vocabulário configurável existe para evitar.
  //
  // Aqui também saem os órfãos: item removido não deixa lista crescendo no
  // JSON para sempre.
  out.palavras = Object.fromEntries(
    out.itens.map((i) => [
      i.chave,
      // Item de fábrica cai no padrão dele. Item criado pela empresa começa
      // VAZIO -- e é a tela que cobra as palavras. Inventar uma lista para um
      // item que ninguém descreveu seria pior: casaria com texto que não tem
      // nada a ver, e daria o item como coberto sem ele estar.
      out.palavras?.[i.chave] || base.palavras?.[i.chave] || PALAVRAS_PADRAO[i.chave] || [],
    ])
  );

  return out;
}

/** As regras em vigor: o padrao com o que estiver salvo por cima. */
async function obter() {
  const base = padrao();
  try {
    const linha = await prisma.configuracao.findUnique({ where: { chave: CHAVE } });
    if (!linha?.valor) return base;
    // `validar` tambem na LEITURA: um valor gravado por uma versao anterior (ou
    // editado no banco na mao) nao pode virar peso invalido rodando na conta do
    // mes. Se nem assim der, cai no padrao e registra -- nunca derruba a tela.
    return validar(JSON.parse(linha.valor), base);
  } catch (e) {
    logger.warn("Regras de relatorio invalidas no banco; usando o padrao", { message: e.message });
    return base;
  }
}

async function salvar(entrada, autor = null) {
  const atual = await obter();
  const novo = validar(entrada || {}, atual);
  const valor = JSON.stringify(novo);
  await prisma.configuracao.upsert({
    where: { chave: CHAVE },
    update: { valor },
    create: { chave: CHAVE, valor },
  });
  // Com autoria: isto muda a pontuacao da equipe inteira, inclusive de meses
  // ja fechados (o historico e recalculado). "Meu ranking mudou sozinho" sem
  // rastro de quem e quando e uma tarde perdida.
  logger.warn("Regras de relatorio alteradas", {
    por: autor?.nome || autor?.email || autor?.sub || "desconhecido",
    regras: novo,
  });
  return novo;
}

/**
 * O PRAZO de um relatorio, a partir da data da visita.
 *
 * Combina as duas regras quando as duas existem, e vale a MAIS APERTADA: o
 * prazo por relatorio existe para o trabalho nao esfriar, e o vencimento mensal
 * existe para o mes fechar. Valer a mais folgada esvaziaria uma das duas.
 */
function prazoDe(dataVisitaISO, regras) {
  const puro = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dataVisitaISO || ""));
  const base = puro
    ? new Date(Number(puro[1]), Number(puro[2]) - 1, Number(puro[3]), 12, 0, 0, 0)
    : new Date(dataVisitaISO);
  if (Number.isNaN(base.getTime())) return null;

  const porRelatorio = new Date(base);
  porRelatorio.setDate(porRelatorio.getDate() + (regras?.prazoDias ?? 3));

  if (!regras?.vencimentoDiaDoMes) return porRelatorio;

  // O VENCIMENTO CAI NO ULTIMO DIA DO MES QUANDO O DIA NAO EXISTE NELE.
  //
  // Sem a aparagem, `new Date(2026, 1, 30)` nao falha: TRANSBORDA para 02/03,
  // e o vencimento de fevereiro passaria a ser em marco -- dois dias de folga
  // que ninguem concedeu, num mes so, sem nada na tela explicando.
  //
  // O mes de referencia e o SEGUINTE ao da visita, e por isso a aparagem usa
  // `getMonth() + 1`: e nele que o dia precisa existir.
  const mesDoVencimento = base.getMonth() + 1;
  const mensal = new Date(
    base.getFullYear(),
    mesDoVencimento,
    diaQueExiste(base.getFullYear(), mesDoVencimento, regras.vencimentoDiaDoMes),
    12,
    0,
    0,
    0
  );
  return porRelatorio <= mensal ? porRelatorio : mensal;
}

const paraISO = (d) =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : null;

module.exports = { obter, salvar, padrao, validar, prazoDe, paraISO, CHAVE };
