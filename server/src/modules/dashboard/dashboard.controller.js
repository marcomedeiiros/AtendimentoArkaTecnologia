const dashboardService = require("./dashboard.service");
const painelService = require("./painel.service");
const ciclo = require("../rankings/ciclo");
const premiados = require("../rankings/premiados");
const { success } = require("../../shared/helpers/response.helper");

class DashboardController {
  async obter(req, res) {
    const data = await dashboardService.obterMetricas();
    return success(res, data);
  }

  /**
   * RECOMECAR A CONTAGEM DA COMPETENCIA CORRENTE.
   *
   * ── O QUE ELE MUDA, E O QUE NAO ─────────────────────────────────────────
   *
   * Grava um piso para ESTA competencia: o ranking, o painel de parede e a
   * Visao Geral passam a contar dali. Nenhum atendimento e apagado -- e piso de
   * janela, e por isso da para desfazer.
   *
   * A COMPETENCIA E O INSTANTE SAO DO SERVIDOR, nunca do pedido. Aceita-los de
   * fora deixaria pedir piso em mes ja premiado, e o passado e o que nem o
   * ciclo mexe (ver o bloco das vigencias em `rankings/ciclo`).
   *
   * ── E ELE NAO ALCANCA A PROXIMA COMPETENCIA ────────────────────────────
   *
   * O reset que vale e o AUTOMATICO: na virada do ciclo a competencia seguinte
   * nasce limpa, sem herdar este corte. E a diferenca em relacao ao "Limpar
   * dados" que existiu até 11/09 e cortava deste mes em diante, para sempre
   * (ver o §11 e o §12 de `docs/auditoria-ranking-zerado-10-09.md`).
   *
   * ── NAO HA ROTA PARA DESFAZER, E ISSO FOI PEDIDO ───────────────────────
   *
   * O botao de "Restaurar dados" nao volta: o pedido foi explicito ("sem botao
   * de voltar essa pontuacao"). Desfazer continua possivel no servidor --
   * `node recomecar-contagem.js --ranking=sede --desfazer` --, e e por isso que
   * isto grava um piso em vez de apagar linha: a decisao de nao ter o botao nao
   * pode virar a decisao de perder o dado.
   */
  async recomecarContagem(req, res) {
    const data = await dashboardService.recomecarContagem(req.params.ranking, req.user);
    return success(res, data);
  }

  /**
   * A SATISFACAO DO CICLO, pronta -- ver `dashboardService.satisfacao`.
   *
   * Sem recorte por acesso, e de proposito: e agregado, nao conteudo, e o mesmo
   * numero que a parede mostra para a sala inteira. O recorte acidental que
   * existia (herdado da listagem da Central) era o defeito.
   */
  async satisfacao(req, res) {
    return success(res, await dashboardService.satisfacao());
  }

  // Painel de parede: um GET so devolve tudo que a TV desenha. A tela recarrega
  // sozinha e nao tem interacao -- varias chamadas por atualizacao dariam
  // metades do painel de instantes diferentes.
  async painel(req, res) {
    const data = await painelService.obter(req.user);
    return success(res, data);
  }

  // Ranking do time na Visao Geral: a MESMA pontuacao da parede (ver
  // painel.service.rankingEquipe), sem o corte no top 3 e com o ultimo
  // atendimento de cada pessoa.
  async rankingEquipe(req, res) {
    const data = await painelService.rankingEquipe();
    return success(res, data);
  }

  /**
   * AS REGRAS DO ATENDIMENTO NA SEDE -- em vigor, mais o padrao.
   *
   * O padrao vai junto para a tela poder oferecer "restaurar" sem repetir os
   * numeros do servidor num texto que envelhece sozinho.
   */
  async obterRegras(req, res) {
    return success(res, {
      regras: await painelService.regras(),
      padrao: painelService.regrasPadrao(),
      // O CICLO VAI NA MESMA RESPOSTA de proposito. Ele nao e regra da sede --
      // vale para os dois rankings --, mas quem o configura e a mesma pessoa,
      // na mesma tela, e dois pedidos para montar um formulario so dariam duas
      // formas de ele aparecer meio preenchido.
      ciclo: await ciclo.obter(),
      cicloPadrao: ciclo.PADRAO,
      // Pelo mesmo motivo do ciclo: nao e regra da sede, vale para os dois
      // rankings, mas quem configura e a mesma pessoa na mesma tela.
      premiados: await premiados.obter(),
      premiadosPadrao: premiados.PADRAO,
      // O TETO, para o formulario nao oferecer o que o resto do sistema recusa.
      // Era o achado 2 da auditoria: o campo aceitava 50, e o registro de
      // premio (e o desenho do podio) suportam 3 -- ver o bloco MAXIMO em
      // `rankings/premiados`. Vem do servidor, e nao cravado na tela, senao
      // sao dois numeros para manter iguais.
      premiadosMaximo: premiados.MAXIMO,
    });
  }

  async salvarRegras(req, res) {
    const regras = await painelService.salvarRegras(req.body, req.user);
    // Salvo DEPOIS, e a ORDEM importa: `salvarRegras` pode recusar o pedido
    // (regua toda zero -> REGUA_TODA_ZERO), e gravar o ciclo antes deixaria
    // metade do formulario aplicada num pedido que a pessoa viu falhar.
    //
    // O motivo escrito aqui era "recusa pesos que nao somam 100" -- regra que
    // saiu quando a pontuacao da sede perdeu o teto (c1627d6). A ordem
    // continua certa; a justificativa e que estava vencida.
    const cicloNovo = req.body?.ciclo ? await ciclo.salvar(req.body.ciclo, req.user) : await ciclo.obter();
    const premiadosNovo = req.body?.premiados
      ? await premiados.salvar(req.body.premiados, req.user)
      : await premiados.obter();
    return success(res, { ...regras, ciclo: cicloNovo, premiados: premiadosNovo });
  }

}

module.exports = new DashboardController();
