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
const {
  ITENS_MAPEAMENTO, PESOS, TETO_QUALIDADE, PONTOS_POR_RELATORIO,
  MINIMO_MAPEAMENTOS, CUSTO_POR_DEVOLUCAO,
} = require("./pontuacao.externa");
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

    // Quanto vale cada relatorio entregue. Substituiu a faixa de volume: a
    // pontuacao cresce o mes inteiro, sem teto (ver pontuacao.externa).
    pontosPorRelatorio: PONTOS_POR_RELATORIO,
    // O DIA EM QUE A COMPETENCIA FECHA.
    //
    // Ate ele, o mes esta em disputa: da para lancar e entregar visita
    // daquele mes. Depois, o mes esta fechado e a nota nao se mexe mais.
    // 31 quer dizer "o ultimo dia do mes", como no vencimento mensal.
    diaFechamento: 30,
    // A HORA em que ele fecha, no dia acima. "23:59" e o fim do dia: quem
    // fecha as 18h muda isto e a entrega para as 18h, e nao a meia-noite.
    horaFechamento: "23:59",
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


  if (entrada.pontosPorRelatorio !== undefined) {
    out.pontosPorRelatorio = inteiro(entrada.pontosPorRelatorio, 1, 100, base.pontosPorRelatorio);
  }
  if (entrada.diaFechamento !== undefined) {
    // Mesma regra do vencimento mensal: 31 significa o ultimo dia, seja ele
    // qual for -- a competencia nao pode SUMIR num mes de 30 dias.
    out.diaFechamento = inteiro(entrada.diaFechamento, 1, 31, base.diaFechamento);
  }
  if (entrada.horaFechamento !== undefined) {
    // HH:MM, e o que nao for isso mantem o que ja estava -- um horario
    // invalido nao pode virar "fecha em NaN" e travar a entrega de todo
    // mundo. Recusar seria pior: `validar` roda tambem na LEITURA.
    const bruto = String(entrada.horaFechamento || "").trim();
    out.horaFechamento = /^([01]\d|2[0-3]):[0-5]\d$/.test(bruto) ? bruto : base.horaFechamento;
  }
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
    /**
     * A CONFIGURACAO GRAVADA ANTES DISTO TEM `volume` NOS PESOS.
     *
     * `volume` deixou de ser fatia de 100 e virou ponto por relatorio. Uma
     * configuracao antiga chega aqui com cinco chaves somando 100, e recusa-la
     * deixaria a tela de Configuracao sem abrir -- `validar` roda tambem na
     * LEITURA. Entao o valor antigo de `volume` vira o ponto por relatorio
     * (quando ninguem mandou um) e as quatro parcelas de qualidade sao
     * reescaladas para somar o teto, mantendo a proporcao escolhida.
     */
    const antigo = entrada.pesos.volume;
    if (antigo !== undefined && entrada.pontosPorRelatorio === undefined) {
      out.pontosPorRelatorio = inteiro(antigo, 1, 100, base.pontosPorRelatorio);
    }
    const pesos = {};
    for (const chave of Object.keys(base.pesos)) {
      pesos[chave] = inteiro(entrada.pesos[chave], 0, 100, base.pesos[chave]);
    }
    const soma = Object.values(pesos).reduce((a, b) => a + b, 0);
    if (soma !== TETO_QUALIDADE) {
      // Vindo de uma configuracao antiga (com `volume` junto), reescala em vez
      // de recusar: o administrador nao digitou isto agora, e travar a leitura
      // seria quebrar a tela por causa de um formato velho.
      if (antigo !== undefined && soma > 0) {
        for (const chave of Object.keys(pesos)) {
          pesos[chave] = Math.round((pesos[chave] / soma) * TETO_QUALIDADE);
        }
        // A divisao pode sobrar ou faltar 1 ponto; o resto cai na completude,
        // que e a maior parcela -- e a que menos sente um ponto.
        const ajuste = TETO_QUALIDADE - Object.values(pesos).reduce((a, b) => a + b, 0);
        pesos.completude += ajuste;
      } else {
        throw new AppError(
          `Os pesos de qualidade precisam somar ${TETO_QUALIDADE}. Somaram ${soma}.`,
          400,
          "PESOS_NAO_SOMAM_TETO"
        );
      }
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
 * Dias corridos depois da visita, aparado pelo fim do mes e pelo dia util
 * (ver `aparar`).
 *
 * ── O VENCIMENTO MENSAL SAIU DAQUI ───────────────────────────────────────
 *
 * Havia uma segunda regra: "ate o dia N do mes SEGUINTE". Quando o prazo
 * passou a ficar dentro do mes da visita, ela deixou de conseguir esticar
 * qualquer coisa -- a aparagem chega primeiro, em toda configuracao -- e virou
 * um campo na tela que nao mexia em nada. Quem fecha o mes agora e
 * `diaFechamento`.
 */
function prazoDe(dataVisitaISO, regras) {
  const puro = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dataVisitaISO || ""));
  const base = puro
    ? new Date(Number(puro[1]), Number(puro[2]) - 1, Number(puro[3]), 12, 0, 0, 0)
    : new Date(dataVisitaISO);
  if (Number.isNaN(base.getTime())) return null;

  const porRelatorio = new Date(base);
  porRelatorio.setDate(porRelatorio.getDate() + (regras?.prazoDias ?? 3));

  return aparar(porRelatorio, base);
}

/** Sabado ou domingo? */
function ehFimDeSemana(d) {
  const dia = d.getDay();
  return dia === 0 || dia === 6;
}

/**
 * O PRAZO FICA NO MES DA VISITA, E EM DIA UTIL.
 *
 * ── POR QUE O MES ────────────────────────────────────────────────────────
 *
 * O mes em disputa e o da visita, e a entrega dele fecha junto com ele. Um
 * prazo caindo no mes seguinte prometia um dia em que o relatorio daquele mes
 * ja nao pode mais ser entregue -- a tela dizia 05/10 para uma visita de
 * setembro, e no dia 05/10 a entrega estaria barrada.
 *
 * ── E POR QUE DIA UTIL ───────────────────────────────────────────────────
 *
 * A equipe nao trabalha no fim de semana. Um prazo no sabado e um dia a menos
 * disfarcado: quem cumpre entrega na sexta, e quem confia no que a tela
 * escreveu perde o prazo com o sistema fechado.
 *
 * Anda para TRAS, e nao para frente: o prazo e um limite: empurra-lo daria
 * folga que a regra nao concedeu. Voltar so nao pode passar da propria
 * visita -- nesse caso (visita no ultimo dia, que e um sabado) o prazo e o dia
 * da visita.
 */
function aparar(prazo, dataVisita) {
  const d = new Date(prazo);
  // Nao sai do mes da visita.
  const ultimoDoMes = new Date(dataVisita.getFullYear(), dataVisita.getMonth() + 1, 0, 12, 0, 0, 0);
  if (d > ultimoDoMes) d.setTime(ultimoDoMes.getTime());
  // Volta ate cair em dia util.
  while (ehFimDeSemana(d) && d > dataVisita) d.setDate(d.getDate() - 1);
  return d;
}

const paraISO = (d) =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : null;

/**
 * QUANDO A COMPETENCIA DAQUELE MES FECHA.
 *
 * Devolve o ultimo instante do dia de fechamento. Um dia que nao existe
 * naquele mes cai no ULTIMO dele -- a competencia nao pode sumir num mes
 * curto, que e o mesmo cuidado do vencimento mensal.
 *
 * @param {string} competencia "AAAA-MM"
 */
function fechamentoDaCompetencia(competencia, regras) {
  const [ano, mes] = String(competencia || "").split("-").map(Number);
  if (!ano || !mes) return null;
  const ultimo = new Date(ano, mes, 0).getDate();
  const dia = Math.min(regras?.diaFechamento ?? 30, ultimo);
  // A HORA vem da configuracao. O padrao "23:59" e o fim do dia, que era o
  // comportamento de antes -- quem nao mexer no campo nao sente diferenca.
  const [h, min] = String(regras?.horaFechamento || "23:59").split(":").map(Number);
  return new Date(ano, mes - 1, dia, Number.isFinite(h) ? h : 23, Number.isFinite(min) ? min : 59, 59, 999);
}

/** A competencia ja fechou? */
function competenciaFechada(competencia, regras, agora = new Date()) {
  const fim = fechamentoDaCompetencia(competencia, regras);
  return !!fim && agora > fim;
}

module.exports = {
  obter, salvar, padrao, validar, prazoDe, paraISO, CHAVE,
  fechamentoDaCompetencia, competenciaFechada,
  ehFimDeSemana,
};
