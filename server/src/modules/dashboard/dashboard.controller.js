const dashboardService = require("./dashboard.service");
const painelService = require("./painel.service");
const ciclo = require("../rankings/ciclo");
const premiados = require("../rankings/premiados");
const { success } = require("../../shared/helpers/response.helper");
const AppError = require("../../shared/errors/AppError");

/**
 * Qual ranking limpar/restaurar, validado na BORDA por allowlist.
 *
 * Sem "sede" implicito para valor desconhecido: um cliente antigo que mandasse
 * "Sede" ou um erro de digitacao zerariam a equipe errada em silencio. Ausente
 * e o unico caso que cai no padrao, para as chamadas de antes desta mudanca
 * (que nao mandavam corpo nenhum) continuarem significando o que significavam.
 */
const RANKINGS = ["sede", "externo"];
function rankingPedido(req) {
  const pedido = req.body?.ranking;
  if (pedido == null || pedido === "") return "sede";
  if (!RANKINGS.includes(pedido)) throw new AppError("Ranking inválido.", 400);
  return pedido;
}

class DashboardController {
  async obter(req, res) {
    const data = await dashboardService.obterMetricas();
    return success(res, data);
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
    // Salvo DEPOIS: `salvarRegras` recusa pesos que nao somam 100, e gravar o
    // ciclo antes deixaria metade do formulario aplicada num pedido que a
    // pessoa viu falhar.
    const cicloNovo = req.body?.ciclo ? await ciclo.salvar(req.body.ciclo, req.user) : await ciclo.obter();
    const premiadosNovo = req.body?.premiados
      ? await premiados.salvar(req.body.premiados, req.user)
      : await premiados.obter();
    return success(res, { ...regras, ciclo: cicloNovo, premiados: premiadosNovo });
  }

  // Zera o painel da equipe. NAO apaga atendimento nenhum: grava um instante e
  // as telas passam a contar dali (ver painel.service.marcoDeZeragem). O autor
  // vai junto para a autoria ficar no log -- "os numeros sumiram" sem rastro de
  // quem e quando e uma manha perdida procurando defeito onde houve decisao.
  async limparPainel(req, res) {
    const data = await painelService.limparPainel(rankingPedido(req), req.user);
    return success(res, data);
  }

  async restaurarPainel(req, res) {
    const data = await painelService.restaurarPainel(rankingPedido(req), req.user);
    return success(res, data);
  }
}

module.exports = new DashboardController();
