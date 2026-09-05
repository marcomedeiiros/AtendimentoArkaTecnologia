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
    palavras: Object.fromEntries(ITENS_MAPEAMENTO.map((i) => [i.chave, [...(PALAVRAS_PADRAO[i.chave] || [])]])),
  };
}

const inteiro = (v, min, max, atual) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return atual;
  return Math.min(max, Math.max(min, Math.round(n)));
};

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
    // Teto em 28: o dia 30 nao existe em fevereiro, e uma regra que some num
    // mes do ano e pior do que nao ter regra.
    out.vencimentoDiaDoMes = v === null || v === "" ? null : inteiro(v, 1, 28, base.vencimentoDiaDoMes ?? 5);
  }

  if (entrada.exigirPdf !== undefined) out.exigirPdf = !!entrada.exigirPdf;
  if (entrada.minimoRelatorios !== undefined) {
    out.minimoRelatorios = inteiro(entrada.minimoRelatorios, 1, 20, base.minimoRelatorios);
  }
  if (entrada.custoPorDevolucao !== undefined) {
    out.custoPorDevolucao = inteiro(entrada.custoPorDevolucao, 0, 25, base.custoPorDevolucao);
  }

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
    for (const item of ITENS_MAPEAMENTO) {
      const bruto = entrada.palavras[item.chave];
      const lista = (Array.isArray(bruto) ? bruto : String(bruto || "").split(","))
        .map((p) => String(p).trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 40);
      // ITEM SEM PALAVRA NENHUMA NUNCA SERIA DADO COMO COBERTO -- e a pessoa
      // veria a completude da equipe cair sem relacionar com o campo que ela
      // esvaziou. Vazio volta ao padrao, e a tela mostra o que ficou.
      palavras[item.chave] = lista.length ? [...new Set(lista)] : [...base.palavras[item.chave]];
    }
    out.palavras = palavras;
  }

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

  const mensal = new Date(base.getFullYear(), base.getMonth() + 1, regras.vencimentoDiaDoMes, 12, 0, 0, 0);
  return porRelatorio <= mensal ? porRelatorio : mensal;
}

const paraISO = (d) =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : null;

module.exports = { obter, salvar, padrao, validar, prazoDe, paraISO, CHAVE };
