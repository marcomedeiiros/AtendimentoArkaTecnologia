const prisma = require("../database/prisma.client");

// Proximo numero da sequencia. Incremento atomico por linha: criacoes
// simultaneas nunca recebem o mesmo numero.
async function proximoNumero(chave) {
  const r = await prisma.contador.upsert({
    where: { chave },
    create: { chave, valor: 1 },
    update: { valor: { increment: 1 } },
  });
  return r.valor;
}

class ConversaRepository {
  findAll(filtros = {}) {
    const where = {};
    if (filtros.status) where.statusAtendimento = filtros.status;
    if (filtros.instanciaId) where.instanciaId = filtros.instanciaId;
    // Arquivadas/ocultas continuam no banco; so somem da listagem quando o
    // filtro correspondente estiver desligado.
    if (filtros.arquivada !== undefined) where.arquivada = filtros.arquivada;
    if (filtros.oculta !== undefined) where.oculta = filtros.oculta;
    if (filtros.favorita !== undefined) where.favorita = filtros.favorita;
    if (filtros.busca) {
      where.OR = [
        { cliente: { contains: filtros.busca } },
        { telefone: { contains: filtros.busca } },
        { cnpj: { contains: filtros.busca } },
      ];
    }

    return prisma.conversa.findMany({
      where,
      include: {
        mensagens: { orderBy: { criadoEm: "asc" } },
        atendente: { select: { id: true, nome: true, cargo: true } },
      },
      orderBy: { atualizadoEm: "desc" },
    });
  }

  findById(id) {
    return prisma.conversa.findUnique({
      where: { id },
      include: {
        mensagens: { orderBy: { criadoEm: "asc" } },
        sessao: true,
        atendente: { select: { id: true, nome: true, cargo: true } },
      },
    });
  }

  // MEMORIA DO CONTATO: ultimo CNPJ confirmado por este telefone em atendimentos
  // anteriores. Cada atendimento novo nasce sem CNPJ, entao sem isto o cliente
  // recorrente precisa digitar tudo de novo. Busca leve (so os campos usados).
  async ultimoCnpjDoTelefone(telefone, ignorarConversaId = null) {
    if (!telefone) return null;
    return prisma.conversa.findFirst({
      where: {
        telefone,
        cnpj: { not: null },
        cnpjVerificado: true,
        ...(ignorarConversaId ? { id: { not: ignorarConversaId } } : {}),
      },
      orderBy: { atualizadoEm: "desc" },
      select: { cnpj: true, cliente: true, atualizadoEm: true },
    });
  }

  // Contatos do WhatsApp que informaram CNPJ (agrupados por CNPJ). Alimenta a
  // tela Clientes (CNPJ): mostra QUEM daquela empresa ja falou com a gente.
  // Consulta leve (so os campos exibidos) e sem N+1: uma unica ida ao banco.
  async contatosPorCnpj() {
    const linhas = await prisma.conversa.findMany({
      where: { cnpj: { not: null }, cnpjVerificado: true },
      orderBy: { atualizadoEm: "desc" },
      select: { cnpj: true, cliente: true, telefone: true, atualizadoEm: true },
    });

    // Um mesmo telefone costuma ter varias conversas: fica a mais recente.
    const porCnpj = new Map();
    for (const l of linhas) {
      if (!l.cnpj) continue;
      if (!porCnpj.has(l.cnpj)) porCnpj.set(l.cnpj, new Map());
      const contatos = porCnpj.get(l.cnpj);
      if (!contatos.has(l.telefone)) {
        contatos.set(l.telefone, {
          nome: l.cliente || null,
          telefone: l.telefone,
          em: l.atualizadoEm,
        });
      }
    }
    return porCnpj;
  }

  // Desfaz o vinculo entre um telefone e um CNPJ: limpa o CNPJ das conversas
  // daquele contato. Usado ao "desmarcar" um contato na tela Clientes (CNPJ) --
  // ex.: a pessoa informou o CNPJ errado. Devolve quantas conversas mudaram.
  async limparCnpjDoContato(telefone, cnpj) {
    const r = await prisma.conversa.updateMany({
      where: { telefone, cnpj },
      data: { cnpj: null, cnpjVerificado: false },
    });
    return r.count;
  }

  // Versao LEVE: so os campos escalares (sem carregar todas as mensagens). Para
  // checagens rapidas (setor/telefone) sem o custo de puxar o historico inteiro.
  findByIdBasico(id) {
    return prisma.conversa.findUnique({
      where: { id },
      select: { id: true, setor: true, telefone: true, statusAtendimento: true },
    });
  }

  findByTelefone(instanciaId, telefone) {
    return prisma.conversa.findFirst({
      where: {
        instanciaId,
        telefone,
        statusAtendimento: { in: ["pendente", "aberta"] },
      },
      include: {
        mensagens: { orderBy: { criadoEm: "asc" } },
        sessao: true,
        atendente: { select: { id: true, nome: true, cargo: true } },
      },
      orderBy: { atualizadoEm: "desc" },
    });
  }

  async create(data) {
    // Numero unico e sequencial para TODA conversa (exibido como OS00001).
    const numeroTicket = data.numeroTicket ?? (await proximoNumero("ticket"));
    return prisma.conversa.create({
      data: { ...data, numeroTicket },
      include: {
        mensagens: true,
        atendente: { select: { id: true, nome: true, cargo: true } },
      },
    });
  }

  update(id, data) {
    return prisma.conversa.update({
      where: { id },
      data,
      include: {
        mensagens: { orderBy: { criadoEm: "asc" } },
        atendente: { select: { id: true, nome: true, cargo: true } },
      },
    });
  }

  delete(id) {
    return prisma.conversa.delete({ where: { id } });
  }

  // Cria a mensagem E "toca" a conversa na mesma transacao. Sem o update, o
  // @updatedAt nao muda ao chegar mensagem nova e a conversa nao sobe na lista
  // (ordenada por atualizadoEm). Mensagem do cliente ainda incrementa o
  // contador de nao-lidas usado pelo badge numerico.
  async addMensagem(conversaId, origem, texto, metadata = null, waMessageId = null, extras = {}) {
    const [mensagem] = await prisma.$transaction([
      prisma.mensagem.create({
        data: { conversaId, origem, texto, metadata, waMessageId, ...extras },
      }),
      prisma.conversa.update({
        where: { id: conversaId },
        data:
          origem === "cliente"
            ? { atualizadoEm: new Date(), naoLidas: { increment: 1 }, lido: false }
            : { atualizadoEm: new Date() },
      }),
    ]);
    return mensagem;
  }

  // Vincula o id da Evolution a mensagem recem-criada, para o ACK
  // (messages.update) conseguir encontra-la depois.
  vincularWaMessageId(id, waMessageId, status = "enviada") {
    return prisma.mensagem.update({
      where: { id },
      data: { waMessageId, status },
    });
  }

  // Nao rebaixa o status: um "entregue" atrasado nao pode apagar um "lida".
  async atualizarStatusPorWaId(waMessageId, status) {
    const ordem = { enviando: 0, enviada: 1, entregue: 2, lida: 3 };
    const msg = await prisma.mensagem.findUnique({ where: { waMessageId } });
    if (!msg) return null;
    if (status !== "erro" && (ordem[status] ?? 0) <= (ordem[msg.status] ?? -1)) {
      return msg;
    }
    return prisma.mensagem.update({ where: { id: msg.id }, data: { status } });
  }

  findMensagem(id) {
    return prisma.mensagem.findUnique({ where: { id } });
  }

  atualizarMetadata(id, metadata) {
    return prisma.mensagem.update({ where: { id }, data: { metadata } });
  }

  editarMensagem(id, texto) {
    return prisma.mensagem.update({
      where: { id },
      data: { texto, editadaEm: new Date() },
    });
  }

  removerMensagem(id) {
    return prisma.mensagem.delete({ where: { id } });
  }

  // "Apagar para todos" NAO remove a linha do banco: o Registro (Visao Geral)
  // precisa do log completo de tudo que foi enviado e recebido. Em vez disso,
  // marca a mensagem como deletada dentro do metadata (campo Json que ja existe,
  // sem migracao). O mapper expoe a flag `deletada` e o chat ao vivo mostra
  // "Mensagem apagada" no lugar do conteudo, enquanto o texto original continua
  // gravado para a transcricao/CSV.
  async marcarMensagemApagada(id) {
    const msg = await prisma.mensagem.findUnique({ where: { id } });
    const metadata = {
      ...(msg?.metadata || {}),
      deletada: true,
      deletadaEm: new Date().toISOString(),
    };
    return prisma.mensagem.update({ where: { id }, data: { metadata } });
  }

  zerarNaoLidas(id) {
    return prisma.conversa.update({
      where: { id },
      data: { naoLidas: 0, lido: true },
      include: { mensagens: { orderBy: { criadoEm: "asc" } } },
    });
  }

  // Usado para descartar webhooks reentregues pela Evolution API.
  existeMensagemWa(waMessageId) {
    if (!waMessageId) return Promise.resolve(null);
    return prisma.mensagem.findUnique({
      where: { waMessageId },
      select: { id: true },
    });
  }

  countByStatus() {
    return prisma.conversa.groupBy({
      by: ["statusAtendimento"],
      _count: { id: true },
    });
  }
}

module.exports = new ConversaRepository();
