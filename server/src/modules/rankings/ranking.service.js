/**
 * OS DOIS RANKINGS DE DESEMPENHO -- e a regra que os mantem separados.
 *
 * ── A PONTUACAO DA SEDE NAO E CALCULADA AQUI ───────────────────────────────
 *
 * Vale repetir porque e a decisao mais importante deste arquivo: o ranking da
 * sede NAO tem formula propria. Ele pede `painelService.rankingDoMes(...)`, que
 * chama a MESMA `_ranking` do painel de parede e da Visao Geral, e apenas
 * FILTRA o resultado por quem esta na equipe da sede. Nao ha uma segunda conta
 * para manter em sincronia com a primeira -- e por isso nao ha o dia em que as
 * duas discordam.
 *
 * O ranking externo tem formula propria (pontuacao.externa.js) porque mede
 * outra coisa: relatorio de visita, e nao conversa avaliada pelo cliente.
 *
 * ── POR QUE OS DOIS NUNCA SE MISTURAM ──────────────────────────────────────
 *
 * Nao e so uma separacao de tela: os totais nem sao comparaveis. Na sede o teto
 * cresce com o volume (cada atendimento vale 1 ponto, sem limite); no externo o
 * teto e 100, fechado. Um mes forte na sede passa de 100 com facilidade, e uma
 * tabela unica faria a equipe externa parecer sempre pior por causa da escala,
 * nao do trabalho. Por isso nao existe endpoint que devolva os dois juntos
 * numa lista so.
 *
 * ── NADA DE RANKING E GUARDADO ─────────────────────────────────────────────
 *
 * O historico e RECALCULADO a cada consulta, a partir de atendimentos e
 * mapeamentos -- que nao mudam depois de fechados. Um retrato salvo por mes
 * seria uma segunda fonte da verdade, e a primeira vez que alguem corrigisse um
 * atendimento antigo as duas passariam a discordar em silencio.
 *
 * A UNICA coisa guardada e a PREMIACAO (quem ganhou, o que ganhou, quando), que
 * e justamente o que o calculo nao tem como saber.
 */
const prisma = require("../../infrastructure/database/prisma.client");
const painelService = require("../dashboard/painel.service");
const { pontuarExterno } = require("./pontuacao.externa");
const AppError = require("../../shared/errors/AppError");
const logger = require("../../config/logger");

const EQUIPES = ["sede", "externo"];
const ROTULOS = { sede: "Atendimento na Sede", externo: "Atendimento Fora da Sede" };

/**
 * "sede,externo" -> ["sede", "externo"].
 *
 * Uma pessoa pode concorrer nos dois -- ha quem atenda no chat e tambem visite
 * cliente. Os rankings continuam separados; o que muda e o mesmo nome poder
 * aparecer nas duas listas, com pontuacoes de reguas diferentes que nunca se
 * somam.
 *
 * Filtra pelo que EXISTE: um valor antigo ou digitado errado no banco nao pode
 * criar uma terceira equipe fantasma na tela.
 */
function equipesDe(valor) {
  return String(valor || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => EQUIPES.includes(s));
}

// "2026-09" -> { ano: 2026, mes: 9 }. Recusa o que nao for mes de verdade em vez
// de cair no mes atual: um filtro digitado errado que devolve dados do mes
// corrente e pior do que um erro, porque parece resposta.
function interpretarCompetencia(texto) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(texto || "").trim());
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12 || ano < 2000 || ano > 2100) return null;
  return { ano, mes };
}

const competenciaDe = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

function competenciaAnterior(comp) {
  const { ano, mes } = interpretarCompetencia(comp);
  const d = new Date(ano, mes - 2, 1);
  return competenciaDe(d);
}

/**
 * Ordena e numera as posicoes.
 *
 * Desempate: pontos, depois o criterio de VOLUME de cada ranking (atendimentos
 * numa ponta, mapeamentos aprovados na outra) e por fim o nome, que garante
 * ordem estavel -- sem ele, dois empates trocariam de lugar a cada F5 e a
 * equipe veria o podio "mudando sozinho".
 */
function classificar(pessoas, volumeDe) {
  return pessoas
    .slice()
    .sort(
      (a, b) => b.pontos - a.pontos || volumeDe(b) - volumeDe(a) || a.nome.localeCompare(b.nome)
    )
    .map((p, i) => ({ posicao: i + 1, ...p }));
}

class RankingService {
  /**
   * Quem concorre em cada ranking, mais quem valida.
   *
   * O filtro e "tem alguma coisa gravada", e o recorte por equipe acontece em
   * memoria: com a lista em texto ("sede,externo"), um `where` por valor exato
   * deixaria de fora justamente quem esta nos dois. A tabela de usuarios tem
   * dezenas de linhas -- ler todas as marcadas custa menos que a consulta.
   */
  async equipes() {
    const usuarios = await prisma.usuario.findMany({
      where: { NOT: [{ equipeRanking: null }, { equipeRanking: "" }] },
      select: { id: true, nome: true, email: true, cargo: true, equipeRanking: true },
      orderBy: { nome: "asc" },
    });
    // Quem valida mapeamento e registra premio e o ADMINISTRADOR -- nao ha mais
    // marca separada. Ele NAO e excluido do ranking: se estiver numa equipe,
    // concorre nela, porque administrar o sistema nao impede atender cliente.
    const validadores = await prisma.usuario.findMany({
      where: { cargo: "Administrador", ativo: true },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    });
    return {
      sede: usuarios.filter((u) => equipesDe(u.equipeRanking).includes("sede")),
      externo: usuarios.filter((u) => equipesDe(u.equipeRanking).includes("externo")),
      supervisores: validadores,
    };
  }

  /**
   * RANKING DA SEDE -- a pontuacao do painel, recortada pela equipe.
   *
   * O supervisor e excluido mesmo que esteja marcado numa equipe: quem valida
   * nao concorre. E a regra fica AQUI, no servidor, e nao no filtro da tela --
   * senao bastaria abrir o endpoint direto para ver o supervisor no podio.
   */
  async _rankingSede(ano, mes, equipe) {
    const doMes = await painelService.rankingDoMes(ano, mes);
    const porNome = new Map(doMes.classificacao.map((p) => [p.nome, p]));

    // O ULTIMO ATENDIMENTO de cada um, de qualquer data.
    //
    // Veio junto quando o ranking virou aba da Visao Geral: a aba anterior
    // mostrava essa coluna, e some-la sem aviso seria tirar da tela uma
    // informacao que ninguem pediu para tirar. Uma consulta por pessoa, e o
    // time tem unidades -- nao milhares.
    const ultimos = await Promise.all(equipe.map((u) => painelService._ultimoAtendimento(u.nome)));
    const ultimoPorId = new Map(equipe.map((u, i) => [u.id, ultimos[i]]));

    const pessoas = equipe.map((u) => {
      // Sem linha no mes = nao atendeu. Zera, e continua na tabela: uma equipe
      // de tres em que um sumiu precisa mostrar os tres, senao ninguem percebe
      // que alguem parou.
      const p = porNome.get(u.nome);
      return {
        usuarioId: u.id,
        nome: u.nome,
        pontos: p?.pontos ?? 0,
        // As MESMAS parcelas que o painel ja devolve. Renomear aqui criaria um
        // vocabulario paralelo para a mesma conta.
        criterios: [
          { chave: "atendimentos", rotulo: "Atendimentos", valor: p?.atendimentos.valor ?? 0, pontos: p?.atendimentos.pontos ?? 0 },
          {
            chave: "nota",
            rotulo: "Avaliação média",
            valor: p?.nota.conta ? p.nota.valor : null,
            amostra: p?.nota.amostra ?? 0,
            conta: !!p?.nota.conta,
            minimo: doMes.minimoAvaliacoes,
            pontos: p?.nota.pontos ?? 0,
          },
          {
            chave: "agilidade",
            rotulo: "Tempo até assumir",
            valor: p?.agilidade.medioSeg ?? null,
            amostra: p?.agilidade.amostra ?? 0,
            pontos: p?.agilidade.pontos ?? 0,
          },
        ],
        registros: p?.atendimentos.valor ?? 0,
        ultimo: ultimoPorId.get(u.id) || null,
      };
    });

    return {
      pesos: doMes.pesos,
      minimoAvaliacoes: doMes.minimoAvaliacoes,
      classificacao: classificar(pessoas, (p) => p.registros),
    };
  }

  /** RANKING EXTERNO -- formula propria, ver pontuacao.externa.js. */
  async _rankingExterno(ano, mes, equipe) {
    const inicio = new Date(ano, mes - 1, 1, 0, 0, 0, 0);
    const fim = new Date(ano, mes, 1, 0, 0, 0, 0);
    // "Limpar dados de atendimento fora da sede" recomeca a contagem daqui. O
    // piso e por MES (ver painelService.pisoDoMes): a limpeza nao apaga meses
    // ja fechados, senao uma premiacao antiga apontaria para um ranking vazio.
    const desde = painelService.pisoDoMes(inicio, fim, await painelService.marcoDe("externo"));

    // Recortado pela DATA DA VISITA, e nao pela entrega: o mes em que o
    // trabalho foi feito e o mes que ele conta. Ancorar na entrega deixaria uma
    // visita do dia 30 cair no mes seguinte por causa do prazo do relatorio.
    const mapeamentos = await prisma.mapeamentoTecnico.findMany({
      where: { dataVisita: { gte: desde, lt: fim }, tecnicoId: { in: equipe.map((u) => u.id) } },
      select: {
        tecnicoId: true, status: true, resumo: true, itens: true,
        evidencias: true, devolucoes: true, prazoEm: true, entregueEm: true,
      },
    });

    const porTecnico = new Map(equipe.map((u) => [u.id, []]));
    for (const m of mapeamentos) porTecnico.get(m.tecnicoId)?.push(m);

    const pessoas = equipe.map((u) => {
      const p = pontuarExterno(porTecnico.get(u.id) || []);
      return {
        usuarioId: u.id,
        nome: u.nome,
        pontos: p.pontos,
        criterios: [
          { chave: "volume", rotulo: "Mapeamentos aprovados", valor: p.volume.valor, pontos: p.volume.pontos },
          { chave: "completude", rotulo: "Relatório completo", valor: p.completude.valor, conta: p.completude.conta, amostra: p.completude.amostra, sufixo: "%", pontos: p.completude.pontos },
          { chave: "prazo", rotulo: "Entregue no prazo", valor: p.prazo.valor, conta: p.prazo.conta, amostra: p.prazo.amostra, sufixo: "%", pontos: p.prazo.pontos },
          { chave: "evidencias", rotulo: "Evidências por visita", valor: p.evidencias.valor, conta: p.evidencias.conta, amostra: p.evidencias.amostra, pontos: p.evidencias.pontos },
          { chave: "retrabalho", rotulo: "Sem retorno para correção", valor: p.retrabalho.devolucoes, pontos: p.retrabalho.pontos },
        ],
        registros: p.volume.entregues,
      };
    });

    return { classificacao: classificar(pessoas, (p) => p.registros) };
  }

  /**
   * Um ranking fechado de um mes, com a evolucao em relacao ao mes anterior.
   *
   * A evolucao compara POSICAO, e nao pontos: "subiu de 3o para 2o" e o que a
   * pessoa quer saber. Comparar pontos diria "caiu 4 pontos" num mes em que
   * todo mundo caiu -- informacao que existe, mas nao responde a pergunta.
   */
  async obter(equipeChave, competencia) {
    if (!EQUIPES.includes(equipeChave)) {
      throw new AppError("Ranking desconhecido", 400, "RANKING_INVALIDO");
    }
    const comp = interpretarCompetencia(competencia) ? competencia : competenciaDe(new Date());
    const { ano, mes } = interpretarCompetencia(comp);

    const equipes = await this.equipes();
    const equipe = equipes[equipeChave];

    const atual =
      equipeChave === "sede"
        ? await this._rankingSede(ano, mes, equipe)
        : await this._rankingExterno(ano, mes, equipe);

    // Mes anterior so para saber a posicao de cada um. Uma consulta a mais, e
    // ela vale: sem ela a tela mostraria "1o lugar" sem dizer se isso e novo.
    const antes = interpretarCompetencia(competenciaAnterior(comp));
    const anterior =
      equipeChave === "sede"
        ? await this._rankingSede(antes.ano, antes.mes, equipe)
        : await this._rankingExterno(antes.ano, antes.mes, equipe);
    const posicaoAntes = new Map(anterior.classificacao.map((p) => [p.usuarioId, p.posicao]));
    const pontosAntes = new Map(anterior.classificacao.map((p) => [p.usuarioId, p.pontos]));

    const classificacao = atual.classificacao.map((p) => {
      const antesPos = posicaoAntes.get(p.usuarioId) ?? null;
      // Sem mes anterior nao ha movimento a declarar. "manteve" seria uma
      // afirmacao sobre uma comparacao que nao existe.
      const evolucao =
        antesPos == null ? "novo" : antesPos > p.posicao ? "subiu" : antesPos < p.posicao ? "caiu" : "manteve";
      return { ...p, anterior: { posicao: antesPos, pontos: pontosAntes.get(p.usuarioId) ?? null }, evolucao };
    });

    const marco = await painelService.marcoDe(equipeChave);
    const inicioMes = new Date(ano, mes - 1, 1);
    const fimMes = new Date(ano, mes, 1);

    const premiacoes = await prisma.premiacaoRanking.findMany({
      where: { ranking: equipeChave, competencia: comp },
      orderBy: { posicao: "asc" },
    });

    return {
      ranking: equipeChave,
      rotulo: ROTULOS[equipeChave],
      competencia: comp,
      competenciaAnterior: competenciaAnterior(comp),
      pesos: atual.pesos || null,
      minimoAvaliacoes: atual.minimoAvaliacoes ?? null,
      participantes: equipe.length,
      // Desde quando este ranking esta contando. `zeradoEm` e o marco (existe ou
      // nao, e o que decide se a tela mostra "Limpar" ou "Restaurar");
      // `zeradoNoMes` diz se ele realmente corta o mes que esta na tela.
      //
      // Sao coisas diferentes: em setembro, com uma limpeza feita em setembro,
      // julho aparece INTEIRO -- e um aviso "contando a partir de 3/set" em
      // cima da tabela de julho seria mentira. Quem sabe a regra e o servidor
      // (`pisoDoMes`); a tela so exibe a resposta, em vez de reimplementa-la.
      zeradoEm: marco ? marco.toISOString() : null,
      zeradoNoMes: !!marco && painelService.pisoDoMes(inicioMes, fimMes, marco) > inicioMes,
      supervisores: equipes.supervisores.map((u) => ({ id: u.id, nome: u.nome })),
      classificacao,
      premiacoes,
    };
  }

  /**
   * A EVOLUCAO de cada pessoa nos ultimos meses.
   *
   * Recalcula mes a mes -- sao poucas consultas pequenas, e o resultado nunca
   * envelhece. A alternativa (gravar um retrato por mes) so pareceria mais
   * barata ate a primeira divergencia entre o retrato e a verdade.
   */
  async historico(equipeChave, competencia, meses = 6) {
    if (!EQUIPES.includes(equipeChave)) {
      throw new AppError("Ranking desconhecido", 400, "RANKING_INVALIDO");
    }
    const comp = interpretarCompetencia(competencia) ? competencia : competenciaDe(new Date());
    const limite = Math.min(Math.max(Number(meses) || 6, 2), 12);

    const equipes = await this.equipes();
    const equipe = equipes[equipeChave];

    const competencias = [];
    let cursor = comp;
    for (let i = 0; i < limite; i += 1) {
      competencias.unshift(cursor);
      cursor = competenciaAnterior(cursor);
    }

    const porPessoa = new Map(equipe.map((u) => [u.id, { usuarioId: u.id, nome: u.nome, meses: [] }]));
    for (const c of competencias) {
      const { ano, mes } = interpretarCompetencia(c);
      const r =
        equipeChave === "sede"
          ? await this._rankingSede(ano, mes, equipe)
          : await this._rankingExterno(ano, mes, equipe);
      for (const p of r.classificacao) {
        porPessoa.get(p.usuarioId)?.meses.push({
          competencia: c,
          pontos: p.pontos,
          posicao: p.posicao,
          registros: p.registros,
        });
      }
    }

    return { ranking: equipeChave, competencias, pessoas: [...porPessoa.values()] };
  }

  // ── PREMIACAO ────────────────────────────────────────────────────────────

  async listarPremiacoes(competencia = null) {
    const where = interpretarCompetencia(competencia) ? { competencia } : {};
    return prisma.premiacaoRanking.findMany({
      where,
      orderBy: [{ competencia: "desc" }, { ranking: "asc" }, { posicao: "asc" }],
    });
  }

  /**
   * Registra (ou atualiza) o premio de uma posicao.
   *
   * `pontos` e `usuarioNome` sao gravados como RETRATO do fechamento, e nao
   * relidos depois: e o numero que justificou o premio, e ele precisa continuar
   * legivel mesmo que a formula mude no ano seguinte ou a pessoa saia da
   * empresa. O resto do sistema recalcula; este registro nao.
   */
  async registrarPremiacao(dados, autor = null) {
    const { ranking, competencia, posicao } = dados;
    if (!EQUIPES.includes(ranking)) throw new AppError("Ranking desconhecido", 400, "RANKING_INVALIDO");
    if (!interpretarCompetencia(competencia)) throw new AppError("Competência inválida (use AAAA-MM)", 400, "COMPETENCIA_INVALIDA");
    if (![1, 2, 3].includes(Number(posicao))) throw new AppError("Posição deve ser 1, 2 ou 3", 400, "POSICAO_INVALIDA");

    // O vencedor NAO vem do corpo da requisicao: e lido do ranking calculado.
    // Aceitar um id do cliente deixaria premiar quem nao ganhou.
    const r = await this.obter(ranking, competencia);
    const vencedor = r.classificacao.find((p) => p.posicao === Number(posicao));
    if (!vencedor) throw new AppError("Não há ninguém nessa posição neste mês", 400, "SEM_VENCEDOR");
    // ZERO PONTO NAO E PODIO.
    //
    // A classificacao lista a equipe INTEIRA, inclusive quem nao produziu no
    // mes -- e isso e proposital, porque uma equipe de tres em que um sumiu
    // precisa mostrar os tres. O efeito colateral, se ninguem barrar aqui, e
    // que um mes vazio ainda tem "1o lugar": daria para registrar premio de um
    // mes em que nao houve trabalho nenhum, com o nome de quem por acaso ficou
    // primeiro no criterio de desempate alfabetico.
    if (!vencedor.pontos) {
      throw new AppError(
        `${vencedor.nome} não pontuou em ${competencia}. Não há prêmio a registrar nessa posição.`,
        400,
        "SEM_PONTUACAO"
      );
    }

    const registro = {
      ranking,
      competencia,
      posicao: Number(posicao),
      usuarioId: vencedor.usuarioId,
      usuarioNome: vencedor.nome,
      pontos: vencedor.pontos,
      premio: dados.premio ? String(dados.premio).trim() : null,
      valor: dados.valor ? String(dados.valor).trim() : null,
      entregueEm: dados.entregueEm ? new Date(dados.entregueEm) : null,
      observacao: dados.observacao ? String(dados.observacao).trim() : null,
    };

    const salvo = await prisma.premiacaoRanking.upsert({
      where: { ranking_competencia_posicao: { ranking, competencia, posicao: Number(posicao) } },
      update: registro,
      create: registro,
    });
    logger.info("Premiacao registrada", {
      ranking, competencia, posicao, vencedor: vencedor.nome,
      por: autor?.nome || autor?.sub || "desconhecido",
    });
    return salvo;
  }

  async removerPremiacao(id) {
    await prisma.premiacaoRanking.deleteMany({ where: { id } });
    return { removido: true };
  }
}

module.exports = new RankingService();
module.exports.EQUIPES = EQUIPES;
module.exports.interpretarCompetencia = interpretarCompetencia;
module.exports.competenciaDe = competenciaDe;
module.exports.competenciaAnterior = competenciaAnterior;
