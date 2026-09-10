const prisma = require("../database/prisma.client");

class UsuarioRepository {
  findByEmail(email) {
    return prisma.usuario.findUnique({ where: { email } });
  }

  // `setoresExtras` E OBRIGATORIO NESTE SELECT, e nao um extra de conveniencia:
  // e daqui que sai o `req.user` do authMiddleware, e `podeAcessarSetor` decide
  // com cargo E extras. Sem a coluna aqui o campo chega `undefined`, a pessoa
  // fica so com o que o cargo da, e a tela de Gestao da Equipe passa a marcar
  // setores que nao concedem nada -- em silencio, porque o lado que NEGA
  // continua funcionando e nenhuma varredura de vazamento acusa.
  findById(id) {
    return prisma.usuario.findUnique({
      where: { id },
      select: {
        id: true, nome: true, email: true, cargo: true, ativo: true, setoresExtras: true,
        // Vao para a SESSAO (auth.me faz spread deste retorno). E o que permite
        // a tela de Relatorios mostrar os botoes de aprovar/devolver so para
        // quem supervisiona. Continua sendo so dica de interface: quem decide e
        // `mapeamentoService.ehSupervisor`, que le o banco a cada chamada --
        // assim tirar a marca de supervisor vale na hora, sem esperar o token
        // da pessoa expirar.
        equipeRanking: true,
      },
    });
  }

  // Todo mundo que tem conta, na ordem em que entrou. Sem senhaHash: esta lista
  // vai para a tela de Gestao da Equipe.
  listarTodos() {
    return prisma.usuario.findMany({
      orderBy: { criadoEm: "asc" },
      select: {
        id: true, nome: true, email: true, cargo: true, setoresExtras: true,
        ativo: true, ultimoAcessoEm: true, criadoEm: true,
        // COLUNA NOVA PRECISA ENTRAR AQUI TAMBEM.
        //
        // `select` explicito nao devolve o que nao for listado -- e o campo
        // ausente nao vira erro em lugar nenhum: `u.equipeRanking` fica
        // `undefined`, o DTO manda `null`, e a tela desenha "Nao concorre" para
        // todo mundo. Era isso que fazia os botoes de ranking parecerem que nao
        // salvavam: o servidor gravava certo e a listagem nunca contava.
        equipeRanking: true,
      },
    });
  }

  marcarAcesso(id) {
    return prisma.usuario.update({
      where: { id },
      data: { ultimoAcessoEm: new Date() },
      select: { id: true },
    });
  }

  async criar({ nome, email, senhaHash, cargo }) {
    const total = await this.contar();
    const ePrimeiro = total === 0;
    return prisma.usuario.create({
      data: {
        nome,
        email,
        senhaHash,
        // Conta nova entra como "Técnico" (papel comum). Precisa ser um dos
        // cargos que a tela de Equipe conhece (Administrador, Financeiro,
        // Técnico, Comercial) -- senao o <select> nao acha a opcao e exibe a
        // primeira ("Administrador"), dando a impressao de admin sem ser.
        cargo: ePrimeiro ? "Administrador" : cargo || "Técnico",
        ativo: ePrimeiro ? true : false,
      },
      select: { id: true, nome: true, email: true, cargo: true, ativo: true },
    });
  }

  atualizarStatus(id, ativo) {
    return prisma.usuario.update({
      where: { id },
      data: { ativo: Boolean(ativo) },
      select: { id: true, nome: true, email: true, cargo: true, ativo: true },
    });
  }

  atualizarCargo(id, cargo) {
    return prisma.usuario.update({
      where: { id },
      data: { cargo },
      select: { id: true, nome: true, email: true, cargo: true, ativo: true },
    });
  }

  // Setores EXTRAS -- os que a pessoa ve alem do que o cargo ja da. Guardados
  // separados por virgula ("Comercial,Financeiro"), como `Parceiro.contratos`;
  // `null` significa "nenhum extra", e nao "nenhum setor".
  atualizarSetoresExtras(id, setoresExtras) {
    return prisma.usuario.update({
      where: { id },
      data: { setoresExtras },
      select: { id: true, nome: true, email: true, cargo: true, ativo: true, setoresExtras: true },
    });
  }

  // So o hash muda. Nao devolve nada sensivel: quem chamou ja sabe de quem e a
  // conta, e o hash nunca deve sair do servidor.
  atualizarSenha(id, senhaHash) {
    return prisma.usuario.update({
      where: { id },
      data: { senhaHash },
      select: { id: true },
    });
  }

  // Edicao do proprio perfil (nome). NAO toca em cargo/ativo -- isso e gestao,
  // exclusiva de Administrador em outro fluxo.
  /**
   * OUTRA CONTA JA USA ESTE NOME?
   *
   * O nome NAO e unico no schema (so o e-mail e), e o ranking da sede cruza
   * a equipe com a pontuacao POR NOME -- e por nome que o atendimento guarda
   * o atendente. Dois homonimos marcados na sede recebiam a mesma linha: os
   * mesmos pontos, o mesmo ultimo atendimento, sem nada na tela indicando.
   * (auditoria-tela-rankings-10-09.md, achado 9)
   *
   * A comparacao ignora caixa e espaco nas pontas: "Marco Medeiros" e "marco
   * medeiros " sao a mesma pessoa para quem le a tabela, e e a tabela que
   * este guarda protege. Acento NAO e normalizado -- "Joao" e "João" sao
   * nomes diferentes, e adivinhar isso criaria recusa que ninguem entende.
   *
   * @param {string} nome
   * @param {string|null} exceto id que pode ficar com o nome (o proprio dono)
   */
  async nomeEmUso(nome, exceto = null) {
    const alvo = String(nome || "").trim().toLowerCase();
    if (!alvo) return false;
    // Comparacao em memoria: `mode: "insensitive"` do Prisma nao vale no
    // SQLite, e a tabela de usuarios tem dezenas de linhas -- ler os nomes
    // custa menos que manter uma coluna normalizada em sincronia.
    const todos = await prisma.usuario.findMany({ select: { id: true, nome: true } });
    return todos.some((u) => u.id !== exceto && String(u.nome || "").trim().toLowerCase() === alvo);
  }

  /**
   * Nomes repetidos que JA existem, agrupados -- para o diagnostico da subida.
   *
   * O guarda acima impede novos; este conta os que entraram antes dele. Sem
   * isto, "o nome e unico" seria uma crenca sobre dados que ninguem olhou.
   */
  async nomesRepetidos() {
    const todos = await prisma.usuario.findMany({ select: { id: true, nome: true } });
    const porNome = new Map();
    for (const u of todos) {
      const chave = String(u.nome || "").trim().toLowerCase();
      if (!chave) continue;
      porNome.set(chave, [...(porNome.get(chave) || []), u.nome]);
    }
    return [...porNome.entries()]
      .filter(([, nomes]) => nomes.length > 1)
      .map(([, nomes]) => ({ nome: nomes[0], quantas: nomes.length }));
  }

  /**
   * O NOME VELHO SEGUE O DONO no historico denormalizado.
   *
   * ── QUAIS COLUNAS, E POR QUE SO ESTAS ───────────────────────────────────
   *
   * Tres colunas guardam o nome de quem trabalhou, e as tres respondem "quem
   * e essa pessoa AGORA":
   *
   *   Atendimento.atendenteNome        e a CHAVE do ranking da sede -- sem
   *                                    mover, a pontuacao passada vai a zero;
   *   MapeamentoTecnico.tecnicoNome    o nome exibido nos relatorios de visita
   *                                    (o ranking externo cruza por id);
   *   Conversa.ultimoAtendenteNome     o "por ultimo, quem atendeu" da Central.
   *
   * ── E QUAIS FICAM COMO ESTAO, DE PROPOSITO ──────────────────────────────
   *
   * `PremiacaoRanking.usuarioNome` e `MapeamentoTecnico.validadoPorNome` sao
   * RETRATO de um ato: "o premio de setembro foi dado a esta pessoa", "este
   * relatorio foi devolvido por aquela". Um registro do que aconteceu nao muda
   * porque alguem trocou o nome depois -- e a premiacao guarda de proposito o
   * numero e o nome do fechamento (ver `ranking.service.registrarPremiacao`).
   *
   * A troca e por NOME EXATO, e nao por id: os historicos sao justamente as
   * linhas que nao tem id do usuario. Se houver homonimo antigo no banco (o
   * guarda de `nomeEmUso` impede novos), esta troca move o historico dos dois
   * -- e e por isso que `checar-integridade` grita quando encontra um.
   */
  async renomearHistorico(de, para) {
    const antigo = String(de || "").trim();
    const novo = String(para || "").trim();
    if (!antigo || !novo || antigo === novo) return { atendimentos: 0, mapeamentos: 0, conversas: 0 };

    const [atendimentos, mapeamentos, conversas] = await prisma.$transaction([
      prisma.atendimento.updateMany({ where: { atendenteNome: antigo }, data: { atendenteNome: novo } }),
      prisma.mapeamentoTecnico.updateMany({ where: { tecnicoNome: antigo }, data: { tecnicoNome: novo } }),
      prisma.conversa.updateMany({
        where: { ultimoAtendenteNome: antigo },
        data: { ultimoAtendenteNome: novo },
      }),
    ]);
    return {
      atendimentos: atendimentos.count,
      mapeamentos: mapeamentos.count,
      conversas: conversas.count,
    };
  }

  atualizarNome(id, nome) {
    return prisma.usuario.update({
      where: { id },
      data: { nome },
      // `equipeRanking` PRECISA estar aqui, pela mesma razao do `setoresExtras`
      // no findById: a resposta desta funcao vira a lista de modulos do menu
      // (auth.service.atualizarPerfil). Sem a coluna, o campo chega `undefined`,
      // a equipe deixa de conceder o modulo -- e Relatorios sumiria do menu de
      // quem acabou de trocar o proprio nome, sem erro nenhum em lugar nenhum.
      select: { id: true, nome: true, email: true, cargo: true, ativo: true, equipeRanking: true },
    });
  }

  // Hash atual, so para conferir a senha antiga antes de trocar. Fica isolado
  // para o hash nunca vazar junto de findById/listagens.
  senhaHashDe(id) {
    return prisma.usuario.findUnique({ where: { id }, select: { senhaHash: true } });
  }

  contar() {
    return prisma.usuario.count();
  }

  // Administradores ATIVOS -- usado para nao deixar excluir/rebaixar o ultimo,
  // o que travaria a gestao (ninguem mais aprova, troca cargo ou exclui).
  contarAdminsAtivos() {
    return prisma.usuario.count({ where: { cargo: "Administrador", ativo: true } });
  }

  remover(id) {
    // Conversas atendidas por essa pessoa nao somem: o atendenteId vira null
    // (onDelete: SetNull no schema). So a conta e apagada.
    return prisma.usuario.delete({ where: { id } });
  }
}

module.exports = new UsuarioRepository();
