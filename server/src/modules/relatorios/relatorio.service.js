// RELATORIOS POR EMPRESA (CNPJ) -- o que cada cliente consumiu num periodo.
//
// POR QUE ISTO VIVE NO SERVIDOR, e nao e derivado no painel.
//
// A tela do Dashboard ja recebe `conversas` com o historico de OS dentro, e
// montar o relatorio ali sairia de graca. Seria errado: `conversaService.listar`
// FILTRA POR SETOR quem nao e Administrador. Um Tecnico geraria o PDF de uma
// empresa sem os chamados que o Financeiro atendeu -- e o documento vai para o
// cliente, que nao tem como saber que esta faltando metade. Um relatorio
// incompleto e pior que relatorio nenhum, porque ninguem duvida dele.
//
// Aqui a consulta e por CNPJ, nao por setor, e o gate e o modulo "dashboard"
// (mesmo da Visao Geral, onde a aba vive).
//
// A ANCORA E O FECHAMENTO. O periodo recorta por `fechadoEm`, nao por
// `abertoEm`: o pedido e "o que foi tratado", e um chamado so foi tratado
// quando fechou. Consequencia assumida: uma OS aberta em marco e fechada em
// abril conta no relatorio de ABRIL.
const prisma = require("../../infrastructure/database/prisma.client");
const parceiroRepository = require("../../infrastructure/repositories/parceiro.repository");
const configuracaoService = require("../configuracoes/configuracao.service");
const { limparCnpj } = require("../../shared/helpers/cnpj.helper");
const AppError = require("../../shared/errors/AppError");

// Sao Paulo e UTC-3 o ano inteiro desde 2019 (o horario de verao foi extinto
// pelo Decreto 9.772/2019). Por isso da para montar a janela com o deslocamento
// fixo, sem depender do fuso do processo -- que no container e UTC.
//
// Se o horario de verao voltar, ESTE e o ponto a corrigir: a janela de "hoje"
// passaria a comecar uma hora antes em parte do ano.
const OFFSET_BR = "-03:00";

const PERIODOS = ["dia", "7dias", "mes", "ano"];

/** "YYYY-MM-DD" de hoje em Brasilia, independente do fuso do processo. */
function hojeBr(agora = new Date()) {
  // en-CA formata como YYYY-MM-DD, que e exatamente o que precisamos.
  return agora.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function _dias(iso, quantidade) {
  const d = new Date(`${iso}T12:00:00${OFFSET_BR}`); // meio-dia evita borda
  d.setDate(d.getDate() + quantidade);
  return d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

/**
 * A JANELA DO PERIODO, em instantes reais.
 *
 * Devolve `[inicio, fim)` como Date -- fim EXCLUSIVO, para nao depender de
 * ".999 milissegundos" e nao perder um chamado fechado no ultimo instante do
 * dia. Todas as janelas sao de CALENDARIO em Brasilia, e nao "as ultimas 24h":
 * o cliente que recebe um relatorio mensal espera o mes fechado, nao os ultimos
 * trinta dias contados a partir da hora em que alguem clicou no botao.
 */
function janela(periodo, referenciaIso = null, agora = new Date()) {
  const hoje = referenciaIso || hojeBr(agora);
  const [ano, mes] = hoje.split("-");

  let inicioIso;
  let fimIso; // exclusivo
  if (periodo === "dia") {
    inicioIso = hoje;
    fimIso = _dias(hoje, 1);
  } else if (periodo === "7dias") {
    // Sete dias INCLUINDO hoje: de D-6 ate o fim de D.
    inicioIso = _dias(hoje, -6);
    fimIso = _dias(hoje, 1);
  } else if (periodo === "mes") {
    inicioIso = `${ano}-${mes}-01`;
    const proximo = new Date(`${ano}-${mes}-01T12:00:00${OFFSET_BR}`);
    proximo.setMonth(proximo.getMonth() + 1);
    fimIso = proximo.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  } else if (periodo === "ano") {
    inicioIso = `${ano}-01-01`;
    fimIso = `${Number(ano) + 1}-01-01`;
  } else {
    throw new AppError(
      `Periodo invalido. Use: ${PERIODOS.join(", ")}.`,
      400,
      "PERIODO_INVALIDO"
    );
  }

  return {
    inicio: new Date(`${inicioIso}T00:00:00${OFFSET_BR}`),
    fim: new Date(`${fimIso}T00:00:00${OFFSET_BR}`),
    inicioIso,
    // O rotulo mostra o ultimo dia INCLUIDO, nao o limite exclusivo -- "01/09 a
    // 30/09" e o que o cliente entende; "01/09 a 01/10" pareceria erro.
    fimIso: _dias(fimIso, -1),
    periodo,
  };
}

const ROTULO_PERIODO = {
  dia: "Diário",
  "7dias": "Últimos 7 dias",
  mes: "Mensal",
  ano: "Anual",
};

// Categoria explicita para OS fechada sem motivo escolhido. Mesmo rotulo do
// Help Desk: dois nomes para a mesma ausencia fariam os dois paineis parecerem
// discordar sobre o mesmo dado.
const SEM_MOTIVO = "Não informado";

/**
 * As OS fechadas do periodo, ja com o CNPJ da conversa dona.
 *
 * `select` enxuto de proposito. O Help Desk faz `conversaRepository.findAll()`
 * sem cauda e paga 2,6 s e 87 MB por chamada (medido em 01/09/2026) porque
 * arrasta TODAS as mensagens de TODAS as conversas. Um relatorio nao precisa de
 * mensagem nenhuma: precisa de data, motivo, setor, atendente e nota.
 */
async function _osFechadas({ inicio, fim }, cnpjs = null) {
  const where = {
    status: "fechada",
    fechadoEm: { gte: inicio, lt: fim },
    conversa: { cnpj: { not: null } },
  };
  if (cnpjs) where.conversa = { cnpj: { in: cnpjs } };

  return prisma.atendimento.findMany({
    where,
    select: {
      id: true,
      numeroOS: true,
      setor: true,
      motivo: true,
      atendenteNome: true,
      avaliacao: true,
      avaliacaoStatus: true,
      feedback: true,
      abertoEm: true,
      atendidoEm: true,
      fechadoEm: true,
      conversa: { select: { cnpj: true, empresa: true, cliente: true, telefone: true } },
    },
    orderBy: { fechadoEm: "asc" },
  });
}

function _duracaoHoras(de, ate) {
  if (!de || !ate) return null;
  const ms = new Date(ate).getTime() - new Date(de).getTime();
  return ms > 0 ? ms / 3_600_000 : null;
}

function _agregar(lista) {
  const porMotivo = new Map();
  const porSetor = new Map();
  const duracoes = [];
  const notas = [];

  for (const os of lista) {
    const motivo = (os.motivo || "").trim() || SEM_MOTIVO;
    porMotivo.set(motivo, (porMotivo.get(motivo) || 0) + 1);
    const setor = os.setor || "Geral";
    porSetor.set(setor, (porSetor.get(setor) || 0) + 1);

    const h = _duracaoHoras(os.abertoEm, os.fechadoEm);
    if (h != null) duracoes.push(h);
    if (os.avaliacao > 0) notas.push(os.avaliacao);
  }

  const ordenar = (mapa) =>
    [...mapa.entries()]
      .map(([nome, total]) => ({
        nome,
        total,
        // Percentual sobre as OS DESTA empresa. Reaproveitar a base global do
        // Help Desk faria as fatias do relatorio nao somarem 100.
        pct: lista.length ? Math.round((total / lista.length) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.total - a.total);

  return {
    totalOS: lista.length,
    porMotivo: ordenar(porMotivo),
    porSetor: ordenar(porSetor),
    duracaoMediaHoras: duracoes.length
      ? Math.round((duracoes.reduce((a, b) => a + b, 0) / duracoes.length) * 10) / 10
      : null,
    // CSAT so quando ha amostra que signifique alguma coisa. Com uma nota so,
    // "satisfacao 5,0" e ruido -- o painel de parede usa o mesmo minimo de 3.
    avaliacaoMedia:
      notas.length >= 3
        ? Math.round((notas.reduce((a, b) => a + b, 0) / notas.length) * 10) / 10
        : null,
    avaliacoesRecebidas: notas.length,
  };
}

class RelatorioService {
  /**
   * MAPA DE TODOS OS CLIENTES no periodo.
   *
   * Parte da lista de Clientes (CNPJ) -- e nao das conversas -- porque o pedido
   * e "todos os cnpjs que estao dentro de Clientes (CNPJ)". Empresa sem nenhum
   * chamado no periodo aparece com zero, e isso e informacao: e o cliente que
   * nao precisou de suporte (ou o que foi esquecido).
   */
  async mapaClientes({ periodo = "mes", referencia = null } = {}) {
    const j = janela(periodo, referencia);
    const parceiros = await parceiroRepository.findAll();
    const ativos = parceiros.filter((p) => p.status !== "inativo");

    const cnpjs = ativos.map((p) => limparCnpj(p.cnpj));
    const os = cnpjs.length ? await _osFechadas(j, cnpjs) : [];

    const porCnpj = new Map();
    for (const item of os) {
      const c = limparCnpj(item.conversa?.cnpj || "");
      if (!c) continue;
      if (!porCnpj.has(c)) porCnpj.set(c, []);
      porCnpj.get(c).push(item);
    }

    const clientes = ativos.map((p) => {
      const c = limparCnpj(p.cnpj);
      const lista = porCnpj.get(c) || [];
      const ag = _agregar(lista);
      return {
        cnpj: c,
        razaoSocial: p.razaoSocial,
        totalOS: ag.totalOS,
        porMotivo: ag.porMotivo,
        duracaoMediaHoras: ag.duracaoMediaHoras,
        avaliacaoMedia: ag.avaliacaoMedia,
        ultimoFechamento: lista.length ? lista[lista.length - 1].fechadoEm : null,
      };
    });

    // Quem teve chamado primeiro: o relatorio existe para olhar movimento, e
    // uma lista alfabetica esconde os tres clientes que consumiram o mes todo.
    clientes.sort((a, b) => b.totalOS - a.totalOS || a.razaoSocial.localeCompare(b.razaoSocial));

    return {
      periodo: { ...j, rotulo: ROTULO_PERIODO[periodo] },
      totalEmpresas: clientes.length,
      totalOS: os.length,
      clientes,
    };
  }

  /**
   * O RELATORIO DE UMA EMPRESA -- e o que alimenta o PDF.
   *
   * Devolve a lista de chamados alem dos agregados: o cliente quer ver a conta
   * (quantos e por que) E o extrato (quais).
   */
  async relatorioEmpresa(cnpjBruto, { periodo = "mes", referencia = null } = {}) {
    const cnpj = limparCnpj(cnpjBruto);
    if (!cnpj) throw new AppError("Informe o CNPJ", 400, "CNPJ_OBRIGATORIO");

    const parceiro = await parceiroRepository.findByCnpj(cnpj);
    if (!parceiro) {
      throw new AppError(
        "Empresa nao encontrada em Clientes (CNPJ).",
        404,
        "PARCEIRO_INEXISTENTE"
      );
    }

    const j = janela(periodo, referencia);
    const lista = await _osFechadas(j, [cnpj]);
    const ag = _agregar(lista);

    return {
      empresa: {
        cnpj,
        razaoSocial: parceiro.razaoSocial,
        email: parceiro.email || null,
        cidades: parceiro.cidades || null,
        contratos: parceiro.contratos || null,
      },
      periodo: { ...j, rotulo: ROTULO_PERIODO[periodo] },
      resumo: {
        totalOS: ag.totalOS,
        duracaoMediaHoras: ag.duracaoMediaHoras,
        avaliacaoMedia: ag.avaliacaoMedia,
        avaliacoesRecebidas: ag.avaliacoesRecebidas,
      },
      porMotivo: ag.porMotivo,
      porSetor: ag.porSetor,
      chamados: lista.map((o) => ({
        os: o.numeroOS != null ? `OS${String(o.numeroOS).padStart(5, "0")}` : "-",
        setor: o.setor || "Geral",
        // Ausencia de motivo e um FATO do periodo, nao um buraco a esconder:
        // sai nomeada, igual ao Help Desk.
        motivo: (o.motivo || "").trim() || SEM_MOTIVO,
        atendente: o.atendenteNome || null,
        avaliacao: o.avaliacao > 0 ? o.avaliacao : null,
        abertoEm: o.abertoEm,
        fechadoEm: o.fechadoEm,
        duracaoHoras: (() => {
          const h = _duracaoHoras(o.abertoEm, o.fechadoEm);
          return h == null ? null : Math.round(h * 10) / 10;
        })(),
        contato: o.conversa?.cliente || null,
      })),
      // A taxonomia vigente viaja junto para a tela poder mostrar motivos com
      // zero uso no periodo -- "nenhum chamado de Backup neste mes" tambem e
      // resposta. Mesma fonte do fechamento e do Help Desk.
      motivosDisponiveis: await configuracaoService.motivosEncerramento(),
    };
  }
}

module.exports = new RelatorioService();
module.exports.janela = janela;
module.exports.PERIODOS = PERIODOS;
module.exports.SEM_MOTIVO = SEM_MOTIVO;
