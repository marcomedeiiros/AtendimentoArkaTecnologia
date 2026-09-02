/**
 * PAINEL DE PAREDE -- os numeros que a equipe ve o dia inteiro.
 *
 * ── POR QUE ESTE ARQUIVO NAO CHAMA O HELP DESK ──────────────────────────────
 *
 * O `helpdesk.service` ja calcula SLA, CSAT e backlog. Reaproveita-lo seria o
 * primeiro instinto -- e seria caro: ele carrega TODAS as conversas com TODAS
 * as mensagens para medir o tempo ate a primeira resposta pelo carimbo de cada
 * mensagem. Medido em producao em 01/09/2026: 2,6 s e 87 MB por chamada.
 *
 * Uma TV recarrega sozinha a cada 30 segundos, para sempre. Pagar 87 MB a cada
 * meio minuto numa VM de 1,6 GB de RAM nao e uma opcao.
 *
 * Entao este servico mede pela tabela `atendimentos`, que e pequena e indexada,
 * e NAO abre mensagem nenhuma. A consequencia e honesta e esta nos rotulos:
 *
 *     helpdesk  "1a resposta"     = ate a primeira MENSAGEM da equipe
 *     painel    "tempo ate assumir" = ate alguem CLICAR em atender (atendidoEm)
 *
 * Sao duas perguntas diferentes, e por isso tem dois nomes diferentes. Chamar
 * as duas de "primeira resposta" criaria duas telas com o mesmo rotulo e
 * numeros que nunca batem -- o jeito mais rapido de a equipe parar de confiar
 * nas duas.
 */
const prisma = require("../../infrastructure/database/prisma.client");
const equipeService = require("../equipe/equipe.service");
const configuracaoService = require("../configuracoes/configuracao.service");
const { podeAcessarSetor } = require("../../shared/helpers/setor.helper");

// Quantos tecnicos entram no ranking. Tres cabe na tela e ainda e disputavel:
// com dez, quem esta em setimo nao olha mais.
const TOP = 3;

// Minimo de notas para entrar no ranking por avaliacao. Sem isto, quem recebeu
// UMA nota 5 lidera para sempre e o ranking vira sorteio -- desmotiva mais do
// que motiva, que e o oposto do que esta tela existe para fazer.
const MINIMO_AVALIACOES = 3;

const inicioDoDia = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const inicioDoMes = () => {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
};

const media = (lista) => (lista.length ? lista.reduce((a, b) => a + b, 0) / lista.length : 0);

class PainelService {
  /**
   * @param {string|null} userCargo cargo de quem pediu. A FILA e recortada por
   *   ele; os agregados (ranking, CSAT, tempos, meta) sao da equipe inteira,
   *   que e o proposito da tela.
   */
  async obter(userCargo = null) {
    const desdeMes = inicioDoMes();
    const desdeHoje = inicioDoDia();

    const [doMes, fechadosHoje, fila, equipe, meta, carga] = await Promise.all([
      // So o que o ranking e os tempos precisam. Sem `include`: mensagem
      // nenhuma entra nesta consulta.
      prisma.atendimento.findMany({
        where: { abertoEm: { gte: desdeMes } },
        select: {
          atendenteId: true,
          atendenteNome: true,
          status: true,
          avaliacao: true,
          abertoEm: true,
          atendidoEm: true,
          fechadoEm: true,
        },
      }),
      prisma.atendimento.count({ where: { status: "fechada", fechadoEm: { gte: desdeHoje } } }),
      prisma.conversa.findMany({
        where: { statusAtendimento: "pendente", arquivada: false, oculta: false },
        select: {
          id: true,
          cliente: true,
          empresa: true,
          telefone: true,
          setor: true,
          numeroTicket: true,
          criadoEm: true,
          atualizadoEm: true,
        },
        orderBy: { atualizadoEm: "asc" },
      }),
      equipeService.listar(),
      configuracaoService.metaDiariaPainel(),
      // Carga de cada atendente: conversas ABERTAS por responsavel. Um
      // `groupBy` resolve; carregar as conversas para contar em memoria seria o
      // mesmo erro que custou 87 MB na listagem da Central.
      prisma.conversa.groupBy({
        by: ["atendenteId"],
        where: { statusAtendimento: "aberta", atendenteId: { not: null } },
        _count: { _all: true },
      }),
    ]);

    return {
      geradoEm: new Date().toISOString(),
      periodo: { desde: desdeMes.toISOString(), rotulo: "mês corrente" },
      ranking: this._ranking(doMes),
      csat: this._csat(doMes),
      tempos: this._tempos(doMes),
      hoje: { fechados: fechadosHoje, meta },
      equipe: this._equipe(equipe, carga),
      fila: this._fila(fila, userCargo),
    };
  }

  /**
   * TOP 3 -- e por que ha DOIS podios, e nao um.
   *
   * Juntar volume e nota numa pontuacao unica obriga a inventar um peso ("cada
   * estrela vale quantos atendimentos?"), e o peso escolhido decide o vencedor.
   * Ninguem consegue explicar o proprio lugar num ranking assim, e ranking que
   * nao se explica nao motiva: gera desconfianca.
   *
   * Dois podios lado a lado dizem a verdade sem arbitrar: quem atendeu mais e
   * quem foi melhor avaliado. Da para liderar os dois, e da para ser
   * reconhecido em um sem ganhar o outro.
   */
  _ranking(atendimentos) {
    const porPessoa = new Map();
    for (const a of atendimentos) {
      // Sem responsavel = atendimento resolvido so pelo bot. Nao entra em
      // ranking de gente.
      const nome = a.atendenteNome || null;
      if (!nome) continue;
      if (!porPessoa.has(nome)) porPessoa.set(nome, { nome, fechados: 0, notas: [] });
      const p = porPessoa.get(nome);
      if (a.status === "fechada") p.fechados += 1;
      if (typeof a.avaliacao === "number") p.notas.push(a.avaliacao);
    }

    const pessoas = [...porPessoa.values()];

    const porVolume = pessoas
      .filter((p) => p.fechados > 0)
      .sort((a, b) => b.fechados - a.fechados || a.nome.localeCompare(b.nome))
      .slice(0, TOP)
      .map((p) => ({ nome: p.nome, valor: p.fechados }));

    const porNota = pessoas
      .filter((p) => p.notas.length >= MINIMO_AVALIACOES)
      .map((p) => ({ nome: p.nome, valor: media(p.notas), amostra: p.notas.length }))
      .sort((a, b) => b.valor - a.valor || b.amostra - a.amostra || a.nome.localeCompare(b.nome))
      .slice(0, TOP);

    // QUEM ESTA A CAMINHO -- so os nomes, nunca a nota.
    //
    // O minimo de avaliacoes protege o ranking, mas cobra um preco no comeco:
    // ate alguem juntar tres notas o podio inteiro fica vazio, e numa parede
    // um painel vazio parece painel quebrado. Uma operacao recem-comecada fica
    // dias assim -- justo os dias em que a equipe esta olhando mais.
    //
    // Entao o painel passa a mostrar quem esta perto de entrar: "David C. -- 1
    // de 3". Isso responde "por que nao aparece ninguem?" sem afrouxar a regra,
    // e transforma a espera em algo que anda.
    //
    // A NOTA DE QUEM AINDA NAO ENTROU NAO SAI DAQUI. Mandar a media de quem tem
    // uma avaliacao so seria o mesmo que abolir o minimo: a parede mostraria o
    // numero, e o numero e o que a equipe compara. Vai a CONTAGEM, e mais nada.
    const aCaminho = pessoas
      .filter((p) => p.notas.length > 0 && p.notas.length < MINIMO_AVALIACOES)
      .map((p) => ({ nome: p.nome, amostra: p.notas.length }))
      .sort((a, b) => b.amostra - a.amostra || a.nome.localeCompare(b.nome))
      .slice(0, TOP);

    return { porVolume, porNota, aCaminho, minimoAvaliacoes: MINIMO_AVALIACOES };
  }

  _csat(atendimentos) {
    const notas = atendimentos.filter((a) => typeof a.avaliacao === "number").map((a) => a.avaliacao);
    // O TOTAL vai junto da media, sempre. "4,8" com tres respostas e uma
    // afirmacao muito mais fraca do que "4,8" com duzentas, e quem le a tela
    // precisa conseguir distinguir as duas sem perguntar a ninguem.
    return { media: notas.length ? media(notas) : null, total: notas.length };
  }

  _tempos(atendimentos) {
    const ateAssumir = [];
    const ateResolver = [];
    for (const a of atendimentos) {
      if (a.atendidoEm) ateAssumir.push((new Date(a.atendidoEm) - new Date(a.abertoEm)) / 1000);
      if (a.fechadoEm) ateResolver.push((new Date(a.fechadoEm) - new Date(a.abertoEm)) / 1000);
    }
    return {
      assumirMedioSeg: Math.round(media(ateAssumir)),
      assumirAmostra: ateAssumir.length,
      resolverMedioSeg: Math.round(media(ateResolver)),
      resolverAmostra: ateResolver.length,
    };
  }

  /**
   * Quem esta online agora e quantas conversas cada um carrega.
   *
   * A carga sao as conversas ABERTAS (alguem assumiu), e nao a fila: fila e de
   * ninguem, e somar a fila na carga de todo mundo faria a tela sugerir que a
   * equipe esta afogada quando o que falta e alguem clicar em atender.
   *
   * Quem esta offline nao aparece. Este painel fica numa TV o dia inteiro, e
   * uma lista com quem nao esta trabalhando vira placar de ausencia -- o
   * contrario do que a tela se propoe a fazer.
   */
  _equipe(equipe, carga) {
    const porId = new Map(carga.map((c) => [c.atendenteId, c._count._all]));
    return equipe
      .filter((m) => m.status === "online")
      .map((m) => ({ id: m.id, nome: m.nome, cargo: m.cargo, abertas: porId.get(m.id) || 0 }))
      .sort((a, b) => b.abertas - a.abertas || a.nome.localeCompare(b.nome));
  }

  /**
   * A FILA RESPEITA O SETOR DE QUEM ESTA VENDO.
   *
   * Escrito sem isto, este metodo devolvia a fila inteira -- e o
   * `verificar-escopo-dados` reprovou na hora, dizendo exatamente o que tinha
   * acontecido: "GET /api/dashboard/painel -> VAZOU Tecnico/pendente,
   * Financeiro/pendente, Geral/pendente". Um atendente do Financeiro passaria a
   * ler, numa TV, o nome e a empresa dos clientes do Tecnico.
   *
   * Os NUMEROS agregados continuam da equipe toda: media da casa, ranking da
   * casa, meta da casa. Nenhum deles identifica um cliente, e recortar o
   * ranking por setor destruiria a tela -- ela existe justamente para a equipe
   * se ver como equipe.
   */
  _fila(conversas, userCargo) {
    const agora = Date.now();
    const visiveis =
      !userCargo || userCargo === "Administrador"
        ? conversas
        : conversas.filter((c) => podeAcessarSetor(userCargo, c.setor || "Geral"));
    return visiveis.map((c) => ({
      id: c.id,
      cliente: c.empresa || c.cliente,
      telefone: c.telefone,
      setor: c.setor || "Geral",
      ticket: c.numeroTicket,
      // Espera contada a partir da ULTIMA movimentacao, nao da criacao: a
      // conversa e um fio permanente por cliente, e `criadoEm` e de meses atras.
      esperaMin: Math.max(0, Math.round((agora - new Date(c.atualizadoEm)) / 60000)),
      // O INSTANTE, e nao so o numero de minutos.
      //
      // A TV recarrega a cada 30 s, mas o relogio dela bate a cada 20 s. Com
      // apenas `esperaMin`, uma fila parada mostraria "3 min" congelado ate a
      // proxima carga -- numa tela que existe para dar sensacao de tempo real,
      // um numero que nao anda parece tela travada. Com o instante, o navegador
      // recalcula sozinho entre uma atualizacao e outra.
      esperaDesde: new Date(c.atualizadoEm).toISOString(),
    }));
  }
}

module.exports = new PainelService();
