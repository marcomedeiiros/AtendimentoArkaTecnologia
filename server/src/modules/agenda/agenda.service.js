const repo = require("../../infrastructure/repositories/compromisso.repository");
const usuarioRepository = require("../../infrastructure/repositories/usuario.repository");
const { mapCompromisso } = require("../../shared/helpers/mapper.helper");
const AppError = require("../../shared/errors/AppError");
const { dataBrasilia } = require("../../shared/helpers/cnpj.helper");

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

  // O autor vem do token (nao do corpo), so para saber quem criou.
  async criar(dados, autor) {
    const { responsavelId, ...resto } = dados;
    const criado = await repo.create({
      ...resto,
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
   */
  async remarcar(id, { data, hora }) {
    const existente = await repo.findById(id);
    if (!existente) throw new AppError("Compromisso nao encontrado", 404, "NOT_FOUND");
    const atualizado = await repo.update(id, { data, ...(hora ? { hora } : {}) });
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
