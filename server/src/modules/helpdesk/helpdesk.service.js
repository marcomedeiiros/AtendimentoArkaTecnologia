const conversaRepository = require("../../infrastructure/repositories/conversa.repository");
const configuracaoService = require("../configuracoes/configuracao.service");

const DIA = 86_400_000;
const ms = (d) => (d ? new Date(d).getTime() : null);
const media = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

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
      // Quantos clientes distintos estao em atendimento (o fio, nao o ciclo).
      clientes: conversas.length,
    };
  }
}

module.exports = new HelpDeskService();
