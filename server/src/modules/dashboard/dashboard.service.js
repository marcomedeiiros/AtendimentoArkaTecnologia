const prisma = require("../../infrastructure/database/prisma.client");
const conversaRepository = require("../../infrastructure/repositories/conversa.repository");
const parceiroRepository = require("../../infrastructure/repositories/parceiro.repository");
const equipeService = require("../equipe/equipe.service");
const painelService = require("./painel.service");
const ciclo = require("../rankings/ciclo");
const piso = require("../rankings/piso.competencia");
const AppError = require("../../shared/errors/AppError");

/**
 * QUEM E PROMOTOR E QUEM E DETRATOR -- a regua da satisfacao.
 *
 * ── POR QUE ISTO MUDOU DE LADO ─────────────────────────────────────────────
 *
 * Estes dois numeros viviam na TELA (`Dashboard.jsx`: `nota >= 4`, `nota <= 2`),
 * e eram a unica definicao deles no sistema. E definicao de negocio: e ela que
 * decide o que a empresa chama de cliente satisfeito. Mudar para "promotor e so
 * nota 5" era editar um `.jsx` -- e nenhuma outra tela acompanharia.
 * (auditoria-regra-no-front-end-10-09.md, F1)
 *
 * A nota 3 fica de fora dos dois de proposito: e a resposta de quem nao esta
 * insatisfeito nem defende ninguem. Somar o neutro a qualquer um dos lados
 * inflaria o indicador que a empresa usa para decidir.
 */
const PROMOTOR_MINIMO = 4;
const DETRATOR_MAXIMO = 2;

class DashboardService {
  async obterMetricas() {
    // A equipe vem do service, nao de uma contagem SQL: "online" e uma janela
    // de tempo sobre o ultimo acesso, calculada la. Duplicar essa regra aqui
    // faria o Dashboard e a Gestao da Equipe divergirem com o tempo.
    // A contagem vem dos ATENDIMENTOS (as OS), nao das conversas. A conversa
    // virou o fio permanente do cliente: contar conversas fechadas responderia
    // "quantos clientes estao sem atendimento em curso", e nao "quantos
    // atendimentos foram finalizados" -- que e o rotulo do cartao.
    const [statusCounts, parceirosAtivos, equipe, validacoesCnpj, contatos] = await Promise.all([
      conversaRepository.countAtendimentosByStatus(),
      prisma.parceiro.count({ where: { status: "ativo" } }),
      equipeService.listar(),
      prisma.conversa.count({ where: { cnpjVerificado: true } }),
      prisma.contato.count(),
    ]);
    const equipeOnline = equipe.filter((m) => m.status === "online").length;

    const mapStatus = Object.fromEntries(statusCounts.map((s) => [s.status, s._count.id]));

    const atendimentosAtivos =
      (mapStatus.pendente || 0) + (mapStatus.aberta || 0);

    return {
      clientesWhatsapp: contatos,
      atendimentosAtivos,
      atendimentosFinalizados: mapStatus.fechada || 0,
      validacoesCnpj,
      parceirosAtivos,
      equipeOnline,
      totalEquipe: equipe.length,
      filaAguardando: mapStatus.pendente || 0,
    };
  }

  /**
   * Recomeca a contagem da competencia CORRENTE de um ranking.
   *
   * A allowlist e aqui, e nao so na rota: este servico e chamado de dois
   * caminhos (a rota e o script `recomecar-contagem.js`), e um ranking
   * inventado nao pode criar uma terceira chave de configuracao no banco.
   */
  async recomecarContagem(ranking, autor = null) {
    if (!piso.RANKINGS.includes(ranking)) {
      throw new AppError("Ranking desconhecido", 400, "RANKING_INVALIDO");
    }
    // A COMPETENCIA SAI DO RELOGIO DO SERVIDOR, com o ciclo configurado -- e
    // nao do pedido. Ver o bloco no controller.
    const competencia = ciclo.competenciaDe(new Date(), await ciclo.obter());
    const quem = autor?.nome || autor?.email || autor?.sub || null;
    return piso.definir(ranking, competencia, quem);
  }

  /**
   * A SATISFACAO DO CICLO -- e por que ela saiu da tela.
   *
   * ── OS TRES DEFEITOS QUE ISTO FECHA ───────────────────────────────────────
   *
   * A Visao Geral montava este painel a partir de `conversas`, a lista da
   * Central. Tres consequencias, todas silenciosas:
   *
   *   1. A lista e RECORTADA POR SETOR para quem nao e Administrador
   *      (`conversa.service.listar`). Entao a "media de avaliacao" de um
   *      Tecnico era a media do setor Tecnico, com rotulo de media geral e
   *      nada na tela dizendo isso. Duas pessoas na mesma tela, no mesmo
   *      minuto, liam numeros diferentes -- e o `api.js` ja avisava desse
   *      perigo em cima de `RelatoriosAPI`, para os relatorios por CNPJ;
   *   2. nao havia JANELA DE TEMPO: somava tudo que estivesse carregado,
   *      enquanto a parede (`_csat`) somava o ciclo. Mesma pergunta, dois
   *      numeros que nunca coincidiam;
   *   3. a regua (quem e promotor, quem e detrator) existia so no cliente.
   *
   * ── O ESCOPO E A EMPRESA INTEIRA, e isso e deliberado ─────────────────────
   *
   * O recorte por setor protege o CONTEUDO da conversa -- quem falou o que, com
   * quem. Um agregado de satisfacao nao expoe conteudo, e ja e publico nesta
   * operacao: o painel de parede mostra o CSAT da empresa para a sala inteira,
   * e `/api/dashboard` (os cartoes de cima desta mesma tela) sempre contou a
   * empresa toda. O que era defeito nao era o escopo -- era o escopo ACIDENTAL,
   * herdado de uma listagem feita para outra finalidade, e invisivel.
   *
   * A JANELA e o ciclo corrente, a MESMA da parede e do ranking, e vai no
   * payload para a tela poder escrever "de 01/09 a 28/10" em vez de deixar quem
   * le supor.
   */
  async satisfacao() {
    const { inicio, fim, personalizada, transicao } = await painelService.cicloCorrente();

    // Por OS, e nao por conversa: a conversa e o fio permanente do cliente e
    // guarda so a avaliacao do ciclo em curso -- contar conversas esconderia
    // todo o historico de feedback do mesmo cliente.
    const avaliadas = await prisma.atendimento.findMany({
      where: { avaliacao: { not: null }, abertoEm: { gte: inicio, lt: fim } },
      select: { avaliacao: true, setor: true },
    });

    const total = avaliadas.length;
    const notas = avaliadas.map((a) => a.avaliacao);
    const distribuicao = [1, 2, 3, 4, 5].map((nota) => ({
      nota,
      qtd: notas.filter((n) => n === nota).length,
    }));

    const porSetorMapa = new Map();
    for (const a of avaliadas) {
      const setor = a.setor || "Geral";
      const atual = porSetorMapa.get(setor) || { setor, soma: 0, qtd: 0 };
      atual.soma += a.avaliacao;
      atual.qtd += 1;
      porSetorMapa.set(setor, atual);
    }

    return {
      janela: {
        inicio: inicio.toISOString(),
        fim: fim.toISOString(),
        personalizada: !!personalizada,
        transicao: !!transicao,
      },
      // `null` quando nao ha nota, e nunca `0`: zero seria uma afirmacao ("foi
      // mal") sobre um ciclo em que nao houve o que julgar. A tela ja distingue
      // os dois casos -- era o cliente que devolvia 0 aqui.
      media: total ? Math.round((notas.reduce((s, n) => s + n, 0) / total) * 100) / 100 : null,
      total,
      distribuicao,
      promotores: notas.filter((n) => n >= PROMOTOR_MINIMO).length,
      detratores: notas.filter((n) => n <= DETRATOR_MAXIMO).length,
      neutros: notas.filter((n) => n > DETRATOR_MAXIMO && n < PROMOTOR_MINIMO).length,
      porSetor: [...porSetorMapa.values()]
        .map((s) => ({ setor: s.setor, qtd: s.qtd, media: Math.round((s.soma / s.qtd) * 100) / 100 }))
        .sort((a, b) => b.media - a.media),
      // A REGUA VIAJA, para a tela poder explicar o numero sem repetir a regra.
      regua: { promotorMinimo: PROMOTOR_MINIMO, detratorMaximo: DETRATOR_MAXIMO },
      escopo: "empresa",
    };
  }
}

module.exports = new DashboardService();
