const rankingService = require("./ranking.service");
const mapeamentoService = require("./mapeamento.service");
const { success } = require("../../shared/helpers/response.helper");
const regrasRelatorio = require("./relatorio.regras");
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
   * O QUE A TELA DE RELATORIOS PRECISA SABER -- e o que ela NAO recebe aqui.
   *
   * ── O PAYLOAD SE CHAMAVA "AS REGRAS" E RESPONDIA OUTRA COISA ─────────────
   *
   * Ele montava os pesos, as faixas, o custo por devolucao e o minimo a partir
   * das CONSTANTES de `pontuacao.externa` -- os valores de fabrica --, e nao do
   * que o administrador configurou. Nada quebrava hoje (a tela usa apenas
   * `itens`), mas um payload que se chama "as regras" e responde outra coisa e
   * uma armadilha armada para o proximo a consumi-lo.
   * (auditoria-tela-rankings-10-09.md, achado 10)
   *
   * Agora o que e padrao mora DENTRO de `padrao`, e diz isso no nome.
   *
   * ── E POR QUE NAO MANDAR A REGUA EM VIGOR ────────────────────────────────
   *
   * Porque esta rota e mais larga que a tela de configuracao: ela abre para
   * quem lanca relatorio (`exigirRelatorioDeVisita`), e nao so para o
   * Administrador. A regua exata em vigor e restrita de proposito -- ver o
   * bloco de `GET /configuracao` nas rotas --, e quem PRECISA dela para
   * entender a propria posicao recebe no payload do ranking
   * (`GET /rankings/:equipe`), que exige o modulo "rankings".
   */
  async regras(req, res) {
    return success(res, {
      externo: {
        // O PADRAO, e com esse nome. Serve para a tela explicar a FORMA da
        // pontuacao (que ha faixa de volume, que devolucao desconta) sem
        // anunciar os numeros que estao valendo agora.
        padrao: {
          pesos: PESOS,
          faixasVolume: FAIXAS_VOLUME,
          faixasEvidencias: FAIXAS_EVIDENCIAS,
          custoPorDevolucao: CUSTO_POR_DEVOLUCAO,
          minimoMapeamentos: MINIMO_MAPEAMENTOS,
        },
        // Os itens EM VIGOR, e não a lista de fábrica: a tela desenha o
        // formulário de visita a partir daqui, e com a lista fixa um item
        // criado pela empresa não teria campo para ser preenchido.
        itens: (await regrasRelatorio.obter()).itens,
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
    return success(res, await rankingService.removerPremiacao(req.params.id, req.user));
  }

 // ── configuracao dos relatorios (so administrador) ───────────────────────

  /**
   * As regras EM VIGOR, mais o PADRAO e o catalogo do checklist.
   *
   * O padrao vai junto para a tela poder oferecer "restaurar" sem repetir os
   * numeros do servidor -- valor de regra copiado no front e o jeito mais
   * rapido de a tela passar a explicar uma conta que nao e mais a que roda.
   */
  async obterRegras(req, res) {
    return success(res, {
      regras: await regrasRelatorio.obter(),
      padrao: regrasRelatorio.padrao(),
    });
  }

  async salvarRegras(req, res) {
    return success(res, await regrasRelatorio.salvar(req.body, req.user));
  }

  // ── mapeamentos ──────────────────────────────────────────────────────────

  async listarMapeamentos(req, res) {
    return success(res, await mapeamentoService.listar(req.query, req.user));
  }

  async obterMapeamento(req, res) {
    return success(res, await mapeamentoService.obter(req.params.id, req.user));
  }

  /**
   * BAIXAR O PDF DO RELATORIO.
   *
   * Escreve na resposta direto, sem passar pelo `success()`: o corpo aqui sao
   * os bytes do arquivo, e nao um envelope JSON.
   *
   * `inline` e nao `attachment`: o navegador abre o PDF numa aba, que e o que
   * quem confere um relatorio quer -- e o botao de baixar continua ali dentro
   * do visualizador para quem precisa do arquivo.
   */
  async baixarMapeamento(req, res) {
    const { stream, tamanho, nome } = await mapeamentoService.arquivoDe(req.params.id, req.user);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", tamanho);
    // O nome vai codificado (RFC 5987): empresa com acento e o caso normal
    // aqui, e um byte fora do ASCII num cabecalho quebra a resposta inteira.
    res.setHeader(
      "Content-Disposition",
      `inline; filename="relatorio.pdf"; filename*=UTF-8''${encodeURIComponent(nome)}`
    );
    // Sem cache compartilhado: e documento de cliente, servido a partir de uma
    // permissao que muda de pessoa para pessoa.
    res.setHeader("Cache-Control", "private, no-store");
    return stream.pipe(res);
  }

  /**
   * LE O PDF antes de criar nada -- so para a tela sugerir os campos.
   *
   * Nao grava mapeamento e nao guarda arquivo: e uma leitura, e a resposta e
   * SUGESTAO. Quem confirma e a pessoa, no formulario.
   */
  async analisarMapeamento(req, res) {
    return success(res, await mapeamentoService.analisarArquivo(req.body?.arquivo));
  }

  async criarMapeamento(req, res) {
    return success(res, await mapeamentoService.criar(req.body, req.user), 201);
  }

  async atualizarMapeamento(req, res) {
    return success(res, await mapeamentoService.atualizar(req.params.id, req.body, req.user));
  }

  // DEVOLVER para correcao. Nao ha mais aprovar -- entregar e o fim do caminho,
  // e o supervisor so aponta problema quando ha (ver o service).
  async devolverMapeamento(req, res) {
    return success(res, await mapeamentoService.devolver(req.params.id, req.body, req.user));
  }

  /**
   * ABRIR UMA EVIDENCIA (foto avulsa).
   *
   * `inline`: o navegador mostra a imagem, que e o que quem confere o relatorio
   * quer. O mimetype vem do que foi gravado no upload, e nao do que o cliente
   * pede -- deixar o pedido escolher o tipo e como uma imagem vira "text/html".
   */
  async baixarEvidencia(req, res) {
    const { stream, tamanho, mimetype, nome } = await mapeamentoService.evidenciaDe(
      req.params.id,
      req.params.indice,
      req.user
    );
    res.setHeader("Content-Type", mimetype);
    res.setHeader("Content-Length", tamanho);
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(nome)}`);
    res.setHeader("Cache-Control", "private, no-store");
    return stream.pipe(res);
  }

  async removerMapeamento(req, res) {
    return success(res, await mapeamentoService.remover(req.params.id, req.user));
  }
}

module.exports = new RankingController();
