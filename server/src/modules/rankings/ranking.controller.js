const rankingService = require("./ranking.service");
const mapeamentoService = require("./mapeamento.service");
const { success } = require("../../shared/helpers/response.helper");
const { ITENS_MAPEAMENTO, PESOS, FAIXAS_VOLUME, FAIXAS_EVIDENCIAS, CUSTO_POR_DEVOLUCAO, MINIMO_MAPEAMENTOS } =
  require("./pontuacao.externa");

class RankingController {
  // Um ranking de um mes. `?competencia=2026-09`; sem ela, o mes corrente.
  async obter(req, res) {
    const data = await rankingService.obter(req.params.equipe, req.query.competencia);
    return success(res, data);
  }

  async historico(req, res) {
    const data = await rankingService.historico(
      req.params.equipe,
      req.query.competencia,
      req.query.meses
    );
    return success(res, data);
  }

  // Quem concorre em cada ranking. A tela usa para montar as abas sem inventar
  // nome nenhum -- a lista sai do cadastro, nao do codigo.
  async equipes(req, res) {
    return success(res, await rankingService.equipes());
  }

  /**
   * A REGRA DA PONTUACAO EXTERNA, publicada.
   *
   * A tela mostra "por que voce esta nesta posicao", e para isso precisa dos
   * pesos. Eles vem do servidor, e nao repetidos no front: numero de regra
   * copiado na tela e o jeito mais rapido de a explicacao passar a mentir
   * quando alguem ajusta a formula.
   */
  async regras(req, res) {
    return success(res, {
      externo: {
        pesos: PESOS,
        faixasVolume: FAIXAS_VOLUME,
        faixasEvidencias: FAIXAS_EVIDENCIAS,
        custoPorDevolucao: CUSTO_POR_DEVOLUCAO,
        minimoMapeamentos: MINIMO_MAPEAMENTOS,
        itens: ITENS_MAPEAMENTO,
      },
    });
  }

  async listarPremiacoes(req, res) {
    return success(res, await rankingService.listarPremiacoes(req.query.competencia));
  }

  async registrarPremiacao(req, res) {
    return success(res, await rankingService.registrarPremiacao(req.body, req.user), 201);
  }

  async removerPremiacao(req, res) {
    return success(res, await rankingService.removerPremiacao(req.params.id));
  }

  // ── mapeamentos ──────────────────────────────────────────────────────────

  async listarMapeamentos(req, res) {
    return success(res, await mapeamentoService.listar(req.query, req.user));
  }

  async obterMapeamento(req, res) {
    return success(res, await mapeamentoService.obter(req.params.id, req.user));
  }

  async criarMapeamento(req, res) {
    return success(res, await mapeamentoService.criar(req.body, req.user), 201);
  }

  async atualizarMapeamento(req, res) {
    return success(res, await mapeamentoService.atualizar(req.params.id, req.body, req.user));
  }

  async validarMapeamento(req, res) {
    return success(res, await mapeamentoService.validar(req.params.id, req.body, req.user));
  }

  async removerMapeamento(req, res) {
    return success(res, await mapeamentoService.remover(req.params.id, req.user));
  }
}

module.exports = new RankingController();
