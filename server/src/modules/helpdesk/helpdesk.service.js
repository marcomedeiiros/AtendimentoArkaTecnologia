const conversaRepository = require("../../infrastructure/repositories/conversa.repository");
const configuracaoService = require("../configuracoes/configuracao.service");

const DIA = 86_400_000;
const ms = (d) => (d ? new Date(d).getTime() : null);
const media = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

/**
 * PERCENTIL -- o numero que a media esconde.
 *
 * Um dia com dez respostas em 2 minutos e UMA em 6 horas fecha com media de 35
 * minutos, e nenhum cliente esperou 35 minutos: dez esperaram 2 e um esperou
 * 360. A media descreve um atendimento que nao aconteceu com ninguem.
 *
 * O p50 (mediana) responde "como foi para o cliente do meio" e o p90 responde
 * "como foi para o cliente que se deu mal" -- e e o segundo que gera reclamacao,
 * cancelamento e a ligacao do dono da empresa.
 *
 * Metodo: RANK MAIS PROXIMO, sem interpolar. O valor devolvido e sempre um tempo
 * que existiu de verdade na amostra, e nao uma media entre dois vizinhos. Com as
 * amostras pequenas desta operacao (dezenas, nao milhares), um numero real e
 * mais facil de conferir contra a conversa do que um numero calculado.
 *
 * Ordena uma COPIA: `respostas` e `resolucoes` sao lidos depois pelo `media` e
 * pelo tamanho da amostra, e ordenar no lugar mudaria a lista de quem chamou.
 */
const percentil = (arr, p) => {
  if (!arr.length) return 0;
  const ordenado = [...arr].sort((a, b) => a - b);
  // Math.ceil sobre o tamanho, menos 1 para virar indice. O Math.max protege
  // p=0 (ceil(0) = 0 => indice -1).
  const i = Math.max(0, Math.ceil((p / 100) * ordenado.length) - 1);
  return ordenado[i];
};

class HelpDeskService {
  /**
   * Painel de suporte. So leitura, tudo derivado do que ja existe no banco.
   *
   * A UNIDADE DE MEDIDA aqui e o ATENDIMENTO (a OS), nao a conversa.
   *
   * Antes as duas coisas eram a mesma linha, entao contar conversas respondia
   * "quantos atendimentos houve". Agora a conversa e o fio permanente do
   * cliente: contar conversas fechadas passaria a responder "quantos clientes
   * estao sem atendimento em curso" -- e o volume do mes despencaria para o
   * numero de clientes distintos. Cada metrica abaixo passou a olhar a OS.
   */
  async obterMetricas() {
    // Metas de SLA configuraveis (tela do Help Desk); caem no padrao 15min/24h.
    const { respostaMin: SLA_RESPOSTA_MIN, resolucaoHoras: SLA_RESOLUCAO_HORAS } =
      await configuracaoService.slaHelpDesk();

    // A TAXONOMIA VIGENTE vai junto das metricas, e nao numa rota propria.
    //
    // Quem edita a lista e quem esta olhando a quebra "por que procuraram" --
    // mesma tela, mesma pessoa, mesmo instante. Uma segunda rota exigiria um
    // segundo modulo na matriz de permissoes so para preencher um editor que
    // vive ao lado de um dado ja carregado.
    //
    // E diferente de `porMotivo`: aquilo e o que JA foi usado; isto e o que
    // PODE ser escolhido. Um motivo recem-criado aparece aqui com zero uso, e um
    // motivo removido da lista continua aparecendo la, no historico -- que e o
    // comportamento correto para os dois.
    const motivosDisponiveis = await configuracaoService.motivosEncerramento();

    const [conversas, atendimentos] = await Promise.all([
      conversaRepository.findAll(),
      conversaRepository.listarTodosAtendimentos(),
    ]);

    const agora = Date.now();
    const inicioHoje = new Date();
    inicioHoje.setHours(0, 0, 0, 0);

    // Mensagens de cada OS. As anteriores a esta mudanca nao tem carimbo de
    // atendimento: caem na OS MAIS ANTIGA daquela conversa, que e o ciclo a que
    // de fato pertenciam quando conversa e atendimento eram a mesma coisa.
    const conversaPorId = new Map(conversas.map((c) => [c.id, c]));
    const setorDaConversa = new Map(conversas.map((c) => [c.id, c.setor || "Geral"]));
    const maisAntigaDaConversa = new Map(); // conversaId -> atendimentoId
    for (const a of atendimentos) {
      const atual = maisAntigaDaConversa.get(a.conversaId);
      if (!atual || ms(a.abertoEm) < atual.em) {
        maisAntigaDaConversa.set(a.conversaId, { id: a.id, em: ms(a.abertoEm) });
      }
    }
    const msgsPorAtendimento = new Map();
    for (const c of conversas) {
      const fallback = maisAntigaDaConversa.get(c.id)?.id || null;
      for (const m of c.mensagens || []) {
        const alvo = m.atendimentoId || fallback;
        if (!alvo) continue;
        if (!msgsPorAtendimento.has(alvo)) msgsPorAtendimento.set(alvo, []);
        msgsPorAtendimento.get(alvo).push(m);
      }
    }

    let pendente = 0;
    let aberta = 0;
    let fechada = 0;
    const volume = { hoje: 0, semana: 0, mes: 0, total: atendimentos.length };
    const respostas = []; // segundos ate a 1a resposta
    const resolucoes = []; // segundos ate fechar
    let dentroSlaResposta = 0;
    let dentroSlaResolucao = 0;
    let avaliacaoSoma = 0;
    let avaliacaoQtd = 0;
    let maisAntigoPendente = null;
    const setores = {};
    // Motivo de encerramento -> quantas OS fecharam por ele. So conta OS
    // FECHADA: chamado em curso ainda nao tem desfecho, e somá-lo aqui faria a
    // fatia "nao informado" crescer com o backlog em vez de com a falta de dado.
    const motivos = new Map();

    for (const a of atendimentos) {
      // OS orfa (conversa apagada) nao entra: sem o fio nao ha o que medir.
      if (!conversaPorId.has(a.conversaId)) continue;

      const st = a.status;
      if (st === "pendente") pendente++;
      else if (st === "aberta") aberta++;
      else if (st === "fechada") fechada++;

      const criado = ms(a.abertoEm);
      if (criado != null) {
        if (criado >= inicioHoje.getTime()) volume.hoje++;
        if (agora - criado <= 7 * DIA) volume.semana++;
        if (agora - criado <= 30 * DIA) volume.mes++;
      }

      if (st === "pendente" && criado != null && (maisAntigoPendente == null || criado < maisAntigoPendente)) {
        maisAntigoPendente = criado;
      }

      const setor = a.setor || setorDaConversa.get(a.conversaId) || "Geral";
      if (!setores[setor]) setores[setor] = { setor, total: 0, backlog: 0, fechadas: 0, respostas: [] };
      const sb = setores[setor];
      sb.total++;
      if (st === "pendente" || st === "aberta") sb.backlog++;
      if (st === "fechada") sb.fechadas++;

      // Tempo de 1a resposta: do 1o texto do cliente NESTE ciclo ate a 1a
      // resposta nossa (equipe ou bot) que veio depois. Ignora ciclo que o
      // cliente nunca escreveu ou que ninguem respondeu ainda.
      const msgs = msgsPorAtendimento.get(a.id) || [];
      const primeiroCliente = msgs.find((m) => m.origem === "cliente");
      if (primeiroCliente) {
        const t0 = ms(primeiroCliente.criadoEm);
        const resposta = msgs.find(
          (m) => (m.origem === "equipe" || m.origem === "bot") && ms(m.criadoEm) >= t0
        );
        if (resposta) {
          const seg = (ms(resposta.criadoEm) - t0) / 1000;
          if (seg >= 0) {
            respostas.push(seg);
            sb.respostas.push(seg);
            if (seg <= SLA_RESPOSTA_MIN * 60) dentroSlaResposta++;
          }
        }
      }

      // Tempo de resolucao: de quando foi atendido (ou aberto) ate fechar.
      if (st === "fechada" && a.fechadoEm) {
        const base = ms(a.atendidoEm) || criado;
        if (base != null) {
          const seg = (ms(a.fechadoEm) - base) / 1000;
          if (seg >= 0) {
            resolucoes.push(seg);
            if (seg <= SLA_RESOLUCAO_HORAS * 3600) dentroSlaResolucao++;
          }
        }
      }

      if (st === "fechada") {
        // NAO INFORMADO E UMA CATEGORIA, e nao uma linha escondida.
        //
        // Sao as OS fechadas antes de o campo existir, mais as que algum caminho
        // fechou sem passar pela escolha. Some-las em silencio faria as fatias
        // parecerem 100% de um total menor que o real -- e o relatorio
        // sugeriria uma cobertura que ele nao tem. Aparecendo na lista, o
        // tamanho desta fatia e o proprio termometro da qualidade do dado.
        const chave = a.motivo || "Não informado";
        motivos.set(chave, (motivos.get(chave) || 0) + 1);
      }

      if (a.avaliacao != null && a.avaliacao > 0) {
        avaliacaoSoma += a.avaliacao;
        avaliacaoQtd++;
      }
    }

    const porSetor = Object.values(setores)
      .map((s) => ({
        setor: s.setor,
        total: s.total,
        backlog: s.backlog,
        fechadas: s.fechadas,
        respostaMedioSeg: Math.round(media(s.respostas)),
        respostaAmostra: s.respostas.length,
      }))
      .sort((a, b) => b.backlog - a.backlog || b.total - a.total);

    // Motivos ordenados pelo que mais aparece: a leitura util desta lista e "o
    // que mais gera chamado", e ela comeca pelo topo. O percentual vem calculado
    // do servidor sobre o total de FECHADAS -- a mesma base para todas as
    // fatias, para elas somarem 100 e ninguem precisar refazer a conta na tela.
    const porMotivo = [...motivos.entries()]
      .map(([motivo, total]) => ({
        motivo,
        total,
        pct: fechada ? Math.round((total / fechada) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total || a.motivo.localeCompare(b.motivo));

    const totalOS = pendente + aberta + fechada;

    return {
      geradoEm: new Date().toISOString(),
      backlog: {
        pendente,
        aberta,
        total: pendente + aberta,
        maisAntigoMin: maisAntigoPendente != null ? Math.round((agora - maisAntigoPendente) / 60000) : null,
      },
      volume,
      tempos: {
        respostaMedioSeg: Math.round(media(respostas)),
        resolucaoMedioSeg: Math.round(media(resolucoes)),
        respostaAmostra: respostas.length,
        resolucaoAmostra: resolucoes.length,
        // A media CONTINUA acima, de proposito: quem ja se acostumou com ela
        // perderia a referencia se o numero sumisse de um deploy para o outro.
        // Os percentis entram ao lado, e a tela e que decide qual tem destaque.
        respostaP50Seg: Math.round(percentil(respostas, 50)),
        respostaP90Seg: Math.round(percentil(respostas, 90)),
        resolucaoP50Seg: Math.round(percentil(resolucoes, 50)),
        resolucaoP90Seg: Math.round(percentil(resolucoes, 90)),
      },
      sla: {
        respostaPct: respostas.length ? Math.round((dentroSlaResposta / respostas.length) * 100) : null,
        respostaLimiteMin: SLA_RESPOSTA_MIN,
        resolucaoPct: resolucoes.length ? Math.round((dentroSlaResolucao / resolucoes.length) * 100) : null,
        resolucaoLimiteHoras: SLA_RESOLUCAO_HORAS,
      },
      taxaResolucao: totalOS ? Math.round((fechada / totalOS) * 100) : 0,
      status: { pendente, aberta, fechada },
      csat: { media: avaliacaoQtd ? avaliacaoSoma / avaliacaoQtd : 0, total: avaliacaoQtd },
      porSetor,
      porMotivo,
      motivosDisponiveis,
      // Quantos clientes distintos estao em atendimento (o fio, nao o ciclo).
      clientes: conversas.length,
    };
  }
}

module.exports = new HelpDeskService();
