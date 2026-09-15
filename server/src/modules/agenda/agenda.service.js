const repo = require("../../infrastructure/repositories/compromisso.repository");
const usuarioRepository = require("../../infrastructure/repositories/usuario.repository");
const { mapCompromisso } = require("../../shared/helpers/mapper.helper");
const AppError = require("../../shared/errors/AppError");
const { dataBrasilia } = require("../../shared/helpers/cnpj.helper");
const { CORES } = require("./agenda.dto");

// Fuso de Brasilia, nao UTC. Com `toISOString()`, das 21h em diante o "hoje"
// virava AMANHA -- e a limpeza abaixo passava a considerar o proprio dia como
// passado, apagando compromisso concluido hoje mesmo.
function hojeISO() {
  return dataBrasilia();
}

class AgendaService {
  async listar() {
    const itens = await repo.findAll();
    return itens.map(mapCompromisso);
  }

  /**
   * A QUEM DA PARA ATRIBUIR UM COMPROMISSO -- so id e nome.
   *
   * Existe porque `GET /equipe` exige o modulo "equipe", e quem tem a Agenda
   * quase nunca tem aquele: o seletor de responsavel viria vazio para a maior
   * parte da equipe, e "atribuir" viraria um campo que nao funciona.
   *
   * Devolve o MINIMO: nome e id, dos ativos. A tela de Equipe manda e-mail,
   * cargo, setores, ultimo acesso e presenca -- nada disso e preciso para
   * escolher um nome numa lista, e entregar a mais e ampliar o que vaza se esta
   * rota um dia escapar. Inativo fica de fora: nao se atribui trabalho a quem
   * nao entra mais no painel.
   */
  async pessoasAtribuiveis() {
    const todos = await usuarioRepository.listarTodos();
    return todos
      .filter((u) => u.ativo)
      .map((u) => ({ id: u.id, nome: u.nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }

  /**
   * O NOME DO RESPONSAVEL E RESOLVIDO AQUI, e nao aceito do corpo.
   *
   * O DTO deixa passar so o `responsavelId`. O nome sai do cadastro da equipe,
   * na hora de gravar -- se viesse do painel, a tela poderia escrever um nome
   * que o banco de usuarios desmente, e ninguem cruzaria os dois para
   * descobrir. Id que nao existe e recusado com 400, e nao gravado como um
   * ponteiro para lugar nenhum.
   *
   * Grava o nome JUNTO com o id de proposito (mesma razao do `atendenteNome` na
   * OS): quando a pessoa sai da equipe, o compromisso continua sabendo de quem
   * era, em vez de virar um traco mudo.
   *
   * Devolve `{}` quando `responsavelId` nem veio no corpo -- e a diferenca
   * entre "nao mexa nisso" e "tire o responsavel" (`null`), que um update
   * parcial precisa saber distinguir.
   */
  async _camposDoResponsavel(dados) {
    if (!("responsavelId" in dados)) return {};
    const id = dados.responsavelId || null;
    if (!id) return { responsavelId: null, responsavelNome: null };

    const usuario = await usuarioRepository.findById(id).catch(() => null);
    if (!usuario) {
      throw new AppError("Responsavel nao encontrado na equipe", 400, "RESPONSAVEL_INVALIDO");
    }
    return { responsavelId: usuario.id, responsavelNome: usuario.nome };
  }

  /**
   * A cor, reconferida aqui -- e nao so no DTO.
   *
   * Defesa em profundidade, como o resto do projeto: a borda valida com Zod e o
   * servico confere de novo, porque nem toda chamada vem por HTTP (script de
   * manutencao, importacao, um caminho novo que alguem ligue direto no
   * service). Cor fora da lista vira `null` -- automatica --, que e o estado
   * seguro: a tela ainda sabe pintar.
   */
  _corValida(cor) {
    if (!cor) return null;
    return CORES.includes(cor) ? cor : null;
  }

  /**
   * O fim do compromisso longo, normalizado.
   *
   * Duas coisas acontecem aqui, e as duas existem para manter UM invariante:
   * "nulo = de um dia so".
   *
   *   fim igual ao inicio    vira null. Sao a mesma coisa, e guardar as duas
   *                          formas obrigaria toda leitura a comparar os dois
   *                          campos antes de saber se o compromisso e longo.
   *   fim antes do inicio    e recusado. O DTO ja barra na borda; aqui e a
   *                          segunda barreira, para o caminho que nao vem por
   *                          HTTP (script, importacao). Sem ela, o item nao
   *                          desenharia barra nenhuma e sumiria da tela sem
   *                          dizer por que.
   */
  _fimValido(data, dataFim) {
    if (!dataFim || dataFim === data) return null;
    if (dataFim < data) {
      throw new AppError("A data final nao pode ser antes da inicial", 400, "DATA_FIM_INVALIDA");
    }
    return dataFim;
  }

  // O autor vem do token (nao do corpo), so para saber quem criou.
  async criar(dados, autor) {
    const { responsavelId, ...resto } = dados;
    const criado = await repo.create({
      ...resto,
      cor: this._corValida(dados.cor),
      dataFim: this._fimValido(dados.data, dados.dataFim),
      ...(await this._camposDoResponsavel(dados)),
      usuarioId: autor?.sub || null,
      usuarioNome: autor?.nome || null,
    });
    return mapCompromisso(criado);
  }

  async atualizar(id, dados) {
    const existente = await repo.findById(id);
    if (!existente) throw new AppError("Compromisso nao encontrado", 404, "NOT_FOUND");
    // Nao mexe em usuarioId/usuarioNome: continua sendo de quem criou.
    const { responsavelId, ...resto } = dados;
    const atualizado = await repo.update(id, {
      ...resto,
      // `"cor" in dados` separa "não mexa" de "volte para automática" (null),
      // igual ao responsável logo abaixo.
      ...("cor" in dados ? { cor: this._corValida(dados.cor) } : {}),
      ...("dataFim" in dados ? { dataFim: this._fimValido(dados.data, dados.dataFim) } : {}),
      ...(await this._camposDoResponsavel(dados)),
    });
    return mapCompromisso(atualizado);
  }

  async definirConcluido(id, concluido) {
    const existente = await repo.findById(id);
    if (!existente) throw new AppError("Compromisso nao encontrado", 404, "NOT_FOUND");
    const atualizado = await repo.update(id, { concluido });
    return mapCompromisso(atualizado);
  }

  /**
   * Remarcar: muda a data (e a hora, quando vier) e mais nada.
   *
   * O arrastar do calendario cai aqui. Nao aceita nenhum outro campo -- ver
   * `remarcarSchema`. `hora` so entra quando informada, para arrastar entre
   * dias nao apagar o horario que ja estava marcado.
   *
   * ── ARRASTAR UM COMPROMISSO LONGO MOVE A BARRA INTEIRA ──────────────────
   *
   * Uma migracao de 20 a 23 arrastada para o dia 25 vira 25 a 28, e nao "25 a
   * 23" (impossivel) nem "25 a 25" (a duracao apagada em silencio). Quem
   * arrasta esta dizendo "isto acontece mais tarde", nao "isto agora dura menos
   * um dia" -- e a duracao e o dado que ninguem espera perder num gesto de
   * mover. O deslocamento e calculado em dias inteiros sobre o calendario de
   * Brasilia, pelo mesmo motivo que `somarDias` existe no painel.
   */
  async remarcar(id, { data, hora }) {
    const existente = await repo.findById(id);
    if (!existente) throw new AppError("Compromisso nao encontrado", 404, "NOT_FOUND");

    let dataFim;
    if (existente.dataFim) {
      const dias = (a, b) =>
        Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000);
      const duracao = dias(existente.data, existente.dataFim);
      const fim = new Date(`${data}T12:00:00Z`);
      fim.setUTCDate(fim.getUTCDate() + duracao);
      dataFim = fim.toISOString().slice(0, 10);
    }

    const atualizado = await repo.update(id, {
      data,
      ...(hora ? { hora } : {}),
      ...(dataFim ? { dataFim } : {}),
    });
    return mapCompromisso(atualizado);
  }

  /**
   * Esticar: muda so o FIM.
   *
   * E o outro gesto do calendario -- puxar a borda direita da barra. Separado
   * de `remarcar` porque a pergunta e outra: ali a data inteira anda, aqui o
   * inicio fica onde esta e a barra cresce ou encolhe.
   *
   * Fim igual ao inicio vira `null` (de volta a um dia so), pela mesma regra de
   * `_fimValido`: um invariante so para "isto e longo?".
   */
  async esticar(id, { dataFim }) {
    const existente = await repo.findById(id);
    if (!existente) throw new AppError("Compromisso nao encontrado", 404, "NOT_FOUND");
    const atualizado = await repo.update(id, {
      dataFim: this._fimValido(existente.data, dataFim),
    });
    return mapCompromisso(atualizado);
  }

  async remover(id) {
    const existente = await repo.findById(id);
    if (!existente) throw new AppError("Compromisso nao encontrado", 404, "NOT_FOUND");
    await repo.delete(id);
    return { removido: true };
  }

  async limparConcluidosAntigos() {
    const r = await repo.deleteConcluidosAntigos(hojeISO());
    return { removidos: r.count };
  }
}

module.exports = new AgendaService();
