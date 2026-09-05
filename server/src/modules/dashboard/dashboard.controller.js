const dashboardService = require("./dashboard.service");
const painelService = require("./painel.service");
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
