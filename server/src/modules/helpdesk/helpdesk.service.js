const conversaRepository = require("../../infrastructure/repositories/conversa.repository");
const configuracaoService = require("../configuracoes/configuracao.service");

const DIA = 86_400_000;
const ms = (d) => (d ? new Date(d).getTime() : null);
const media = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

class HelpDeskService {
  // Painel de suporte: tudo derivado das conversas/mensagens que ja existem no
  // banco -- nao ha tabela propria. So leitura.
  async obterMetricas() {
    // Metas de SLA configuraveis (tela do Help Desk); caem no padrao 15min/24h.
    const { respostaMin: SLA_RESPOSTA_MIN, resolucaoHoras: SLA_RESOLUCAO_HORAS } =
      await configuracaoService.slaHelpDesk();
    const conversas = await conversaRepository.findAll();
    const agora = Date.now();
    const inicioHoje = new Date();
    inicioHoje.setHours(0, 0, 0, 0);

    let pendente = 0;
    let aberta = 0;
    let fechada = 0;
    const volume = { hoje: 0, semana: 0, mes: 0, total: conversas.length };
    const respostas = []; // segundos ate a 1a resposta
    const resolucoes = []; // segundos ate fechar
    let dentroSlaResposta = 0;
    let dentroSlaResolucao = 0;
    let avaliacaoSoma = 0;
    let avaliacaoQtd = 0;
    let maisAntigoPendente = null;
    const setores = {};

    for (const c of conversas) {
      const st = c.statusAtendimento;
      if (st === "pendente") pendente++;
      else if (st === "aberta") aberta++;
      else if (st === "fechada") fechada++;

      const criado = ms(c.criadoEm);
      if (criado != null) {
        if (criado >= inicioHoje.getTime()) volume.hoje++;
        if (agora - criado <= 7 * DIA) volume.semana++;
        if (agora - criado <= 30 * DIA) volume.mes++;
      }

      if (st === "pendente" && criado != null && (maisAntigoPendente == null || criado < maisAntigoPendente)) {
        maisAntigoPendente = criado;
      }

      const setor = c.setor || "Geral";
      if (!setores[setor]) setores[setor] = { setor, total: 0, backlog: 0, fechadas: 0, respostas: [] };
      const sb = setores[setor];
      sb.total++;
      if (st === "pendente" || st === "aberta") sb.backlog++;
      if (st === "fechada") sb.fechadas++;

      // Tempo de 1a resposta: do 1o texto do cliente ate a 1a resposta nossa
      // (equipe ou bot) que veio depois. Ignora conversa que o cliente nunca
      // escreveu ou que ninguem respondeu ainda.
      const msgs = c.mensagens || [];
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

      // Tempo de resolucao: de quando foi atendida (ou criada) ate fechar.
      if (st === "fechada" && c.fechadoEm) {
        const base = ms(c.atendidoEm) || criado;
        if (base != null) {
          const seg = (ms(c.fechadoEm) - base) / 1000;
          if (seg >= 0) {
            resolucoes.push(seg);
            if (seg <= SLA_RESOLUCAO_HORAS * 3600) dentroSlaResolucao++;
          }
        }
      }

      if (c.avaliacao != null && c.avaliacao > 0) {
        avaliacaoSoma += c.avaliacao;
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
      taxaResolucao: conversas.length ? Math.round((fechada / conversas.length) * 100) : 0,
      status: { pendente, aberta, fechada },
      csat: { media: avaliacaoQtd ? avaliacaoSoma / avaliacaoQtd : 0, total: avaliacaoQtd },
      porSetor,
    };
  }
}

module.exports = new HelpDeskService();
