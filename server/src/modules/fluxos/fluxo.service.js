const fluxoRepository = require("../../infrastructure/repositories/fluxo.repository");
const { mapFluxo, mapPasso } = require("../../shared/helpers/mapper.helper");
const { resumoAutomacoes } = require("./fluxo.automacao");
const AppError = require("../../shared/errors/AppError");

class FluxoService {
  /**
   * TODAS as automacoes do bot, fluxo a fluxo.
   *
   * Existe para responder de um lugar so a pergunta "o que o bot faz?". Antes,
   * a resposta estava espalhada entre variaveis de ambiente, a configuracao
   * global e textos embutidos no motor -- descobrir uma regra exigia ler
   * codigo. Agora cada regra sai do proprio fluxo (fluxo.automacao) e aparece
   * aqui com o valor que esta REALMENTE valendo.
   *
   * O estado ativo/pausado vem junto de proposito: fluxo pausado nao executa
   * nada, e essa e a primeira coisa que alguem precisa ver ao investigar "o bot
   * nao respondeu".
   */
  async resumoAutomacoes() {
    const fluxos = await fluxoRepository.findAll();
    return fluxos.map((f) => resumoAutomacoes(mapFluxo(f)));
  }

  async listar() {
    const fluxos = await fluxoRepository.findAll();
    return fluxos.map(mapFluxo);
  }

  async obter(id) {
    const fluxo = await fluxoRepository.findById(id);
    if (!fluxo) throw new AppError("Fluxo nao encontrado", 404, "NOT_FOUND");
    return mapFluxo(fluxo);
  }

  async criar(data) {
    const { passos, ...fluxoData } = data;
    const fluxo = await fluxoRepository.create(fluxoData, passos || []);
    return mapFluxo(fluxo);
  }

  async atualizar(id, data) {
    const existente = await fluxoRepository.findById(id);
    if (!existente) throw new AppError("Fluxo nao encontrado", 404, "NOT_FOUND");

    const { passos, ...fluxoData } = data;
    const fluxo = await fluxoRepository.update(id, fluxoData, passos);
    return mapFluxo(fluxo);
  }

  async remover(id) {
    const existente = await fluxoRepository.findById(id);
    if (!existente) throw new AppError("Fluxo nao encontrado", 404, "NOT_FOUND");
    await fluxoRepository.delete(id);
    return { removido: true };
  }

  // ── CRUD de BLOCO ────────────────────────────────────────────────────────
  //
  // O `PUT /fluxos/:id` continua existindo e continua sendo o caminho de salvar
  // o desenho inteiro (mover blocos, ligar fios, importar). O que estas
  // operacoes acrescentam e a edicao PONTUAL: mexer num bloco sem reescrever os
  // outros.
  //
  // Isso importa por dois motivos, e o segundo e o que pesa:
  //
  //   1. custo -- trocar uma virgula deixava de reescrever o fluxo todo;
  //   2. CONVIVENCIA -- com o fluxo inteiro no corpo, duas pessoas (ou duas
  //      abas) editando blocos DIFERENTES do mesmo fluxo se sobrescreviam: cada
  //      PUT carregava tambem a versao antiga do bloco da outra. Tocando so a
  //      propria linha, as duas edicoes sobrevivem.
  //
  // Todas devolvem o FLUXO inteiro, e nao so o bloco. E de proposito: o editor
  // precisa reconciliar ligacoes e ordem, e uma resposta parcial o obrigaria a
  // adivinhar o resto -- que e como o estado local desandava antes.

  async _exigirFluxo(id) {
    const fluxo = await fluxoRepository.findById(id);
    if (!fluxo) throw new AppError("Fluxo nao encontrado", 404, "NOT_FOUND");
    return fluxo;
  }

  async obterPasso(fluxoId, passoId) {
    await this._exigirFluxo(fluxoId);
    const passo = await fluxoRepository.findPasso(fluxoId, passoId);
    if (!passo) throw new AppError("Bloco nao encontrado neste fluxo", 404, "NOT_FOUND");
    return mapPasso(passo);
  }

  async criarPasso(fluxoId, dados) {
    await this._exigirFluxo(fluxoId);
    return mapFluxo(await fluxoRepository.criarPasso(fluxoId, dados));
  }

  /**
   * PATCH de um bloco.
   *
   * A peneira abaixo e o coracao disto: so vai para o UPDATE o campo que o
   * cliente MANDOU. Sem ela, um PATCH com `{ texto: "novo" }` gravaria
   * `config: null`, `targetId: null` e `posX: null` junto -- apagando a
   * configuracao e a ligacao do bloco por omissao. Um PATCH que apaga o que nao
   * foi citado nao e um PATCH.
   *
   * O `undefined` do Prisma significa "nao mexa nesta coluna"; o `null`
   * significa "grave NULL". Como o Zod remove do resultado a chave que nao veio,
   * `in` distingue os dois com precisao: quem nao veio nao entra no objeto.
   */
  async atualizarPasso(fluxoId, passoId, dados) {
    await this._exigirFluxo(fluxoId);
    const passo = await fluxoRepository.findPasso(fluxoId, passoId);
    if (!passo) throw new AppError("Bloco nao encontrado neste fluxo", 404, "NOT_FOUND");

    const campos = {};
    const copiar = (chaveDto, coluna, transformar = (v) => v) => {
      if (chaveDto in dados) campos[coluna] = transformar(dados[chaveDto]);
    };

    copiar("titulo", "titulo");
    copiar("texto", "texto", (v) => v ?? null);
    copiar("config", "config", (v) => v ?? null);
    copiar("x", "posX", (v) => v ?? null);
    copiar("y", "posY", (v) => v ?? null);
    copiar("w", "largura", (v) => v ?? null);
    copiar("h", "altura", (v) => v ?? null);
    copiar("ordem", "ordem", (v) => v ?? 0);

    // `desc` e `descricao` sao o MESMO campo com dois nomes: o mapper emite os
    // dois (o canvas le `desc`, o painel le `descricao`) e o editor pode mandar
    // qualquer um dos dois. `descricao` ganha quando vierem juntos e diferentes.
    if ("desc" in dados) campos.descricao = dados.desc ?? null;
    if ("descricao" in dados) campos.descricao = dados.descricao ?? null;

    // Ligacao para um bloco que nao existe NESTE fluxo nao e gravada: seria um
    // fio para lugar nenhum, e o motor pararia a conversa ali sem dizer por que.
    if ("targetId" in dados) {
      const alvo = dados.targetId || null;
      if (alvo) {
        const destino = await fluxoRepository.findPasso(fluxoId, alvo);
        if (!destino) {
          throw new AppError("O bloco de destino nao existe neste fluxo", 400, "TARGET_INVALIDO");
        }
        if (alvo === passoId) {
          throw new AppError("Um bloco nao pode apontar para ele mesmo", 400, "TARGET_INVALIDO");
        }
      }
      campos.targetId = alvo;
    }

    if (!Object.keys(campos).length) {
      // Nada a gravar. Devolve o estado atual em vez de um UPDATE vazio -- que
      // so serviria para mexer em `atualizadoEm` sem nada ter mudado.
      return mapFluxo(await fluxoRepository.findById(fluxoId));
    }

    return mapFluxo(await fluxoRepository.atualizarPasso(fluxoId, passoId, campos));
  }

  async removerPasso(fluxoId, passoId) {
    await this._exigirFluxo(fluxoId);
    const passo = await fluxoRepository.findPasso(fluxoId, passoId);
    if (!passo) throw new AppError("Bloco nao encontrado neste fluxo", 404, "NOT_FOUND");
    return mapFluxo(await fluxoRepository.removerPasso(fluxoId, passoId));
  }

  async reordenarPassos(fluxoId, ids) {
    await this._exigirFluxo(fluxoId);
    return mapFluxo(await fluxoRepository.reordenarPassos(fluxoId, ids));
  }
}

module.exports = new FluxoService();
