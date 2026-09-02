const prisma = require("../database/prisma.client");
const { comLock } = require("../../shared/helpers/lock.helper");

// Proximo numero da sequencia. Incremento atomico por linha: criacoes
// simultaneas nunca recebem o mesmo numero.
async function proximoNumero(chave, cliente = prisma) {
  const r = await cliente.contador.upsert({
    where: { chave },
    create: { chave, valor: 1 },
    update: { valor: { increment: 1 } },
  });
  return r.valor;
}

// Tudo que a Central precisa de uma conversa. Fica numa constante so para a
// listagem, a leitura por id e as escritas devolverem SEMPRE a mesma forma --
// quando cada consulta montava o seu include, o DTO mudava conforme o caminho
// e a tela recebia campos ora presentes, ora ausentes.
const INCLUDE_CONVERSA = {
  mensagens: { orderBy: { criadoEm: "asc" } },
  atendente: { select: { id: true, nome: true, cargo: true } },
  // Historico de OS do cliente (mais recente primeiro). Sao poucas linhas por
  // conversa e sem mensagens juntas: barato o bastante para vir na listagem e
  // evitar um round-trip extra so para desenhar o seletor de historico.
  atendimentos: { orderBy: { abertoEm: "desc" } },
};

// Toda escrita na conversa incrementa `versao`. E esse numero que o front usa
// para descartar uma atualizacao mais VELHA que a que ja tem em tela (resposta
// HTTP atrasada, evento SSE fora de ordem). Centralizado aqui de proposito: se
// cada service lembrasse de incrementar por conta propria, um esquecimento
// silencioso traria o problema de volta.
function comVersao(data) {
  return { ...data, versao: { increment: 1 } };
}

class ConversaRepository {
  /**
   * @param {object} filtros
   * @param {object} [opcoes]
   * @param {number} [opcoes.cauda] quantas mensagens trazer por conversa (as
   *   MAIS RECENTES). Sem isto, vem o historico inteiro -- que e o que o Help
   *   Desk precisa para medir tempo ate a primeira resposta, e o que a Central
   *   NAO precisa.
   */
  async findAll(filtros = {}, opcoes = {}) {
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
        { empresa: { contains: filtros.busca } },
      ];
    }

    // ── A LISTAGEM LEVA A CAUDA, NAO O HISTORICO INTEIRO ──────────────────
    //
    // `INCLUDE_CONVERSA` traz `mensagens` sem limite, e por muito tempo esta
    // consulta trouxe TODAS as mensagens de TODAS as conversas -- inclusive os
    // blobs base64 da midia antiga, que vivem em `metadata`.
    //
    // Medido em producao em 01/09/2026, com 11 conversas e 1.975 mensagens:
    //
    //     2.633 ms e 87,18 MB materializados no servidor
    //       142 KB de resposta na rede
    //
    // Ou seja: 600 vezes mais dado carregado do que entregue -- o DTO descarta
    // quase tudo logo em seguida. E o custo cresce a cada mensagem nova; o
    // comentario de `listarEstados` mediu 628 ms quando foi escrito.
    //
    // A tela nao precisa disso: ela desenha a previa da conversa na lista e,
    // quando alguem ABRE uma, o `AtendimentoView` busca a conversa completa em
    // `GET /conversas/:id`. `parcial: true` (posto pelo mapper a partir de
    // `__parcial`) e o contrato que ja existia para dizer ao front "isto e um
    // recorte, nao apague o que voce tem".
    const cauda = Number(opcoes.cauda) > 0 ? Number(opcoes.cauda) : null;

    const linhas = await prisma.conversa.findMany({
      where,
      include: cauda
        ? {
            ...INCLUDE_CONVERSA,
            // `desc` + `take` pega as ULTIMAS: com `asc` o take pegaria o
            // comeco da conversa, que e justamente a parte que a lista nao usa.
            mensagens: { orderBy: { criadoEm: "desc" }, take: cauda },
          }
        : INCLUDE_CONVERSA,
      orderBy: { atualizadoEm: "desc" },
    });

    if (!cauda) return linhas;

    return linhas.map((c) => ({
      ...c,
      // Volta a ordem cronologica que o resto do codigo espera.
      mensagens: c.mensagens.slice().reverse(),
      __parcial: c.mensagens.length >= cauda,
    }));
  }

  findById(id) {
    return prisma.conversa.findUnique({
      where: { id },
      include: { ...INCLUDE_CONVERSA, sessao: true },
    });
  }

  /**
   * A CONVERSA PARA UM EVENTO DE TEMPO REAL -- com a CAUDA do historico, nao ele
   * inteiro.
   *
   * Todo evento SSE carregava a conversa completa: para avisar de UMA mensagem
   * nova, o servidor lia, remapeava e serializava TODAS as mensagens. Medido
   * neste banco: 6ms/18KB com 50 mensagens, 214ms/1,07MB com 3000 -- e isso
   * multiplicado por cada ACK do WhatsApp (ate 4 por mensagem enviada) e por
   * cada aba aberta. O custo de avisar crescia com o tamanho do historico, que e
   * exatamente o que nao pode acontecer num painel de atendimento.
   *
   * Mandar so a cauda e seguro porque o merge do front (utils/mesclarConversa)
   * ja trata mensagem ausente como "continua valendo o que eu tenho": mensagem
   * nunca some no servidor (o apagar e soft-delete). O DTO vai marcado com
   * `parcial: true` para a regra ficar explicita do outro lado.
   *
   * 30 e folgado de proposito: cobre uma rajada do cliente entre dois eventos.
   * Quem precisa do fio inteiro (abrir a conversa, buscar, exportar) continua
   * usando `findById`.
   */
  async findByIdParaEvento(id, limite = 30) {
    const conversa = await prisma.conversa.findUnique({
      where: { id },
      include: {
        // desc + take = os N mais RECENTES (asc + take daria os N mais antigos,
        // que e o oposto do que a tela precisa).
        mensagens: { orderBy: { criadoEm: "desc" }, take: limite },
        atendente: { select: { id: true, nome: true, cargo: true } },
        atendimentos: { orderBy: { abertoEm: "desc" } },
      },
    });
    if (!conversa) return null;
    // O mapper e a tela leem a lista em ordem cronologica.
    conversa.mensagens.reverse();
    return conversa;
  }

  // MEMORIA DO CONTATO: ultimo CNPJ confirmado por este telefone.
  //
  // NAO EXCLUI CONVERSA NENHUMA, e isso e deliberado. Havia aqui um parametro
  // `ignorarConversaId`, herdado de quando cada atendimento criava uma linha de
  // conversa nova (o CNPJ ficava na linha antiga, e ignorar a atual so evitava
  // a auto-referencia). Com "uma conversa por cliente", o CNPJ do atendimento
  // anterior passou a morar NA MESMA LINHA -- e o filtro, que antes nao custava
  // nada, passou a esconder a unica memoria que existia: a consulta devolvia
  // sempre null e o bot nunca reconhecia o cliente recorrente.
  //
  // Hoje o motor consulta primeiro o CNPJ da propria conversa; esta busca e a
  // rede de seguranca para o mesmo numero em outra instancia ou em duplicatas
  // ainda nao consolidadas.
  async ultimoCnpjDoTelefone(telefone) {
    if (!telefone) return null;
    return prisma.conversa.findFirst({
      where: { telefone, cnpj: { not: null }, cnpjVerificado: true },
      orderBy: { atualizadoEm: "desc" },
      select: { cnpj: true, empresa: true, cliente: true, atualizadoEm: true },
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

  // NAO EXISTE MAIS `limparCnpjDoContato`.
  //
  // Ele limpava o CNPJ de TODAS as conversas de um telefone de uma vez, por
  // `updateMany` -- fora dos caminhos que emitem SSE e sem passar por `update`.
  // Era a peca de baixo do "X" da tela Clientes/CNPJ.
  //
  // A desassociacao acontece agora conversa a conversa, pelo `update` normal do
  // repositorio, quando o CLIENTE diz no fluxo que o CNPJ nao e o dele. Ver
  // chatbot.engine._desassociarCnpj.

  /**
   * RETRATO DE ESTADO DE TODAS AS CONVERSAS -- alguns bytes por linha.
   *
   * Existe para a Central conseguir se reconciliar com frequencia. A releitura
   * completa (`findAll`) traz todas as conversas COM todas as mensagens: medido,
   * 10 conversas de 800 mensagens custam 628ms de servidor e 2,76 MB. Por causa
   * desse preco a reconciliacao roda a cada 5 MINUTOS -- e uma conversa que o
   * SSE perdeu ficava esse tempo todo na aba errada. Foi o que aconteceu em
   * 2026-08-28: o bot encerrou o atendimento, o banco gravou `fechada`, e a
   * Central seguiu mostrando "Pendente" ate alguem apertar F5.
   *
   * Aqui vem so o que decide ABA e BADGE: status, responsavel, setor e a versao
   * (que e como o front sabe se o retrato e mais novo que o dele). Sem mensagem
   * nenhuma. Da para chamar de minuto em minuto sem competir com o trafego real.
   */
  listarEstados() {
    return prisma.conversa.findMany({
      select: {
        id: true,
        statusAtendimento: true,
        setor: true,
        atendenteId: true,
        naoLidas: true,
        lido: true,
        versao: true,
      },
    });
  }

  // Versao LEVE: so os campos escalares (sem carregar todas as mensagens). Para
  // checagens rapidas (setor/telefone) sem o custo de puxar o historico inteiro.
  findByIdBasico(id) {
    return prisma.conversa.findUnique({
      where: { id },
      select: {
        id: true,
        setor: true,
        telefone: true,
        statusAtendimento: true,
        atendimentoAtualId: true,
        // Campos que o caminho de ENVIO precisa antes de gravar a mensagem:
        // autorizacao (setor/status), destino (telefone) e "quem responde,
        // atende" (atendenteId/atendidoEm). Reunidos aqui para o envio deixar de
        // carregar a conversa inteira so para ler cinco escalares -- medido, a
        // leitura completa de um fio de 800 mensagens custa 65ms contra 0,79ms
        // desta.
        atendenteId: true,
        atendidoEm: true,
        cnpj: true,
        versao: true,
      },
    });
  }

  /**
   * O FIO do cliente naquela instancia -- em QUALQUER status.
   *
   * Antes esta busca ignorava conversa fechada, e era exatamente isso que
   * duplicava o cliente na lista: fechado o atendimento, a proxima mensagem
   * dele criava uma conversa nova, com outro numero, e o historico anterior
   * ficava numa linha separada que ninguem reencontrava. Agora ha um fio so por
   * (instancia, telefone) e o que muda a cada ciclo e a OS (ver Atendimento).
   *
   * Com base ainda nao consolidada pode haver mais de uma linha para o mesmo
   * numero; nesse caso vale a MAIS ANTIGA (a que carrega o historico), e o
   * backfill consolida o resto.
   */
  findByTelefone(instanciaId, telefone) {
    return prisma.conversa.findFirst({
      where: { instanciaId, telefone },
      include: { ...INCLUDE_CONVERSA, sessao: true },
      orderBy: { criadoEm: "asc" },
    });
  }

  /**
   * A CONVERSA PARA O MOTOR DO BOT -- sem o historico.
   *
   * Esta e a PRIMEIRA consulta de toda mensagem que chega, e ela carregava o
   * fio inteiro pelo `INCLUDE_CONVERSA`. Medido em producao: 1,85s de
   * processamento para uma mensagem em que o bot nem roda o fluxo (a conversa
   * ja estava com um atendente). O custo de RECEBER crescia com o tamanho do
   * historico -- e mensagens antigas com midia inline deixam essas linhas
   * enormes.
   *
   * O motor nao le `conversa.mensagens` em passo nenhum (conferido: nenhuma
   * ocorrencia no engine nem na varredura de inatividade). O que ele usa sao os
   * escalares -- telefone, status, setor, CNPJ, responsavel -- mais a sessao,
   * que diz em que ponto do fluxo o cliente esta.
   *
   * `atendimentos` vem junto porque o ciclo (OS) decide se a proxima mensagem
   * abre um chamado novo; sao poucas linhas e nao carregam mensagens.
   */
  findByTelefoneParaMotor(instanciaId, telefone) {
    return prisma.conversa.findFirst({
      where: { instanciaId, telefone },
      include: {
        sessao: true,
        atendente: { select: { id: true, nome: true, cargo: true } },
        atendimentos: { orderBy: { abertoEm: "desc" } },
      },
      orderBy: { criadoEm: "asc" },
    });
  }

  /**
   * Cria o fio do cliente ja com o primeiro Atendimento (OS) aberto.
   *
   * Tudo numa transacao: uma conversa sem atendimento atual ficaria sem numero
   * de OS na tela e sem lugar para pendurar as mensagens do ciclo.
   */
  async create(data) {
    const { mensagens, ...campos } = data;
    // Mensagem inicial vinha aninhada (`mensagens: { create: ... }`). Ela agora
    // e criada DEPOIS do atendimento, para nascer ja carimbada com a OS.
    const primeira = mensagens?.create || null;

    const criada = await prisma.$transaction(async (tx) => {
      const numeroTicket = campos.numeroTicket ?? (await proximoNumero("ticket", tx));
      const conversa = await tx.conversa.create({ data: { ...campos, numeroTicket } });

      const atendimento = await tx.atendimento.create({
        data: {
          conversaId: conversa.id,
          // A OS reaproveita o mesmo contador do ticket: os numeros ja
          // divulgados aos clientes continuam validos e nunca colidem.
          numeroOS: numeroTicket,
          setor: conversa.setor || null,
          status: conversa.statusAtendimento,
          atendenteId: conversa.atendenteId || null,
          atendenteNome: conversa.ultimoAtendenteNome || null,
          abertoEm: conversa.criadoEm,
          atendidoEm: conversa.atendidoEm || null,
        },
      });

      if (primeira) {
        await tx.mensagem.create({
          data: { ...primeira, conversaId: conversa.id, atendimentoId: atendimento.id },
        });
      }

      return tx.conversa.update({
        where: { id: conversa.id },
        data: { atendimentoAtualId: atendimento.id },
      });
    });

    return this.findById(criada.id);
  }

  update(id, data) {
    return prisma.conversa.update({
      where: { id },
      data: comVersao(data),
      include: INCLUDE_CONVERSA,
    });
  }

  /**
   * ASSUMIR O ATENDIMENTO, de forma atomica.
   *
   * Antes `atender` era ler-depois-escrever: dois atendentes clicando juntos
   * recebiam 200 os dois, o ultimo UPDATE vencia e o primeiro continuava vendo a
   * conversa como sua. Aqui o dono e decidido pelo BANCO, num unico UPDATE
   * condicional: so muda a linha que ainda esta sem responsavel (ou que ja e de
   * quem esta pedindo). Quem perder recebe 0 linhas afetadas e o service devolve
   * 409 com o estado real.
   */
  async assumirAtomico(id, atendenteId, nomeAtendente) {
    const agora = new Date();
    // Vago, ou ja e meu (clique repetido / reconexao nao pode dar conflito).
    // Montado condicionalmente porque `{ atendenteId: undefined }` no Prisma
    // significa "sem filtro" -- o guard viraria um `updateMany` sem condicao.
    const livreOuMeu = atendenteId
      ? [{ atendenteId: null }, { atendenteId }]
      : [{ atendenteId: null }];
    const r = await prisma.conversa.updateMany({
      where: { id, OR: livreOuMeu },
      data: {
        statusAtendimento: "aberta",
        lido: true,
        naoLidas: 0,
        atendenteId: atendenteId || null,
        ...(nomeAtendente ? { ultimoAtendenteNome: nomeAtendente } : {}),
        versao: { increment: 1 },
      },
    });
    if (r.count === 0) return { assumido: false };

    // `atendidoEm` so na primeira vez: reabrir nao pode reescrever o inicio.
    await prisma.conversa.updateMany({
      where: { id, atendidoEm: null },
      data: { atendidoEm: agora },
    });
    return { assumido: true };
  }

  /**
   * TRANSFERIR, de forma atomica -- a troca de dono num UPDATE condicional.
   *
   * `donoEsperado` e de quem a conversa PRECISA ser para a troca valer. Ou
   * seja: o service leu que o dono era X e decidiu com base nisso; aqui o banco
   * confere que continua sendo X no instante da escrita. Se alguem transferiu
   * no meio, a condicao nao casa, nenhuma linha muda, e o service devolve 409
   * com o estado real em vez de sobrescrever a decisao do outro.
   *
   * ── POR QUE ISTO NAO PODIA CONTINUAR SENDO UM `update` ────────────────────
   *
   * `definirAtendente` era ler-depois-escrever, igual ao `atender` de antes:
   *
   *     const conversa = await findById(id);      // dono = A
   *     ...                                        // <- outra requisicao passa aqui
   *     await update(id, { atendenteId: novo });   // grava por cima
   *
   * Dois cliques (ou dois atendentes) passavam os dois: o ultimo UPDATE vencia,
   * e o historico ganhava DUAS mensagens "Conversa transferida para ...", cada
   * uma para uma pessoa diferente. A tela de quem perdeu seguia mostrando a
   * transferencia que ela mesma fez.
   *
   * `null` em `donoEsperado` quer dizer "a conversa tem de estar SEM dono" --
   * e o caso de atribuir uma conversa da fila.
   */
  async transferirAtomico(id, donoEsperado, novoAtendenteId, nomeAtendente) {
    const r = await prisma.conversa.updateMany({
      // `atendenteId: null` no where do Prisma e um filtro de verdade (IS NULL),
      // e nao "sem filtro" -- isso so vale para `undefined`. Por isso da para
      // passar o esperado direto, inclusive quando ele e null.
      where: { id, atendenteId: donoEsperado ?? null },
      data: {
        atendenteId: novoAtendenteId || null,
        ...(nomeAtendente ? { ultimoAtendenteNome: nomeAtendente } : {}),
        versao: { increment: 1 },
      },
    });
    return { transferido: r.count > 0 };
  }

  delete(id) {
    return prisma.conversa.delete({ where: { id } });
  }

  // ---------------------------------------------------------- atendimentos ---

  listarAtendimentos(conversaId) {
    return prisma.atendimento.findMany({
      where: { conversaId },
      orderBy: { abertoEm: "desc" },
    });
  }

  /**
   * Abre uma OS NOVA no fio do cliente e passa a ser a atual.
   *
   * E o que substitui a antiga "conversa nova a cada atendimento": o historico
   * fica onde sempre esteve (a conversa) e so o ciclo muda.
   */
  async abrirAtendimento(conversaId, { setor = null, status = "pendente", atendenteId = null, atendenteNome = null } = {}) {
    const atendimento = await prisma.$transaction(async (tx) => {
      const numeroOS = await proximoNumero("ticket", tx);
      const novo = await tx.atendimento.create({
        data: { conversaId, numeroOS, setor, status, atendenteId, atendenteNome },
      });
      await tx.conversa.update({
        where: { id: conversaId },
        data: { atendimentoAtualId: novo.id, versao: { increment: 1 } },
      });
      return novo;
    });
    return atendimento;
  }

  // Escreve numa OS ESPECIFICA. Usado quando o alvo nao e "a OS atual" -- o
  // caso da pesquisa de satisfacao, que avalia o ciclo que acabou de fechar
  // mesmo que outro ja tenha comecado. Silencioso se a OS nao existir mais.
  async atualizarAtendimento(atendimentoId, data) {
    if (!atendimentoId) return null;
    try {
      return await prisma.atendimento.update({ where: { id: atendimentoId }, data });
    } catch {
      return null;
    }
  }

  // Espelha na OS atual o que mudou na conversa (status, responsavel, nota).
  // Silencioso quando a conversa ainda nao tem OS: bases antigas so ganham a
  // primeira no proximo ciclo, e nada disso pode derrubar a operacao pedida.
  async atualizarAtendimentoAtual(conversaId, data) {
    const conversa = await prisma.conversa.findUnique({
      where: { id: conversaId },
      select: { atendimentoAtualId: true },
    });
    if (!conversa?.atendimentoAtualId) return null;
    return prisma.atendimento.update({
      where: { id: conversa.atendimentoAtualId },
      data,
    });
  }

  /**
   * Grava o motivo de encerramento SO SE a OS ainda nao tiver um.
   *
   * Existe porque um mesmo ciclo pode ser fechado por dois caminhos, e eles nao
   * valem a mesma coisa. Quando o atendente fecha pela Central, ele ESCOLHE um
   * motivo da lista; logo em seguida a pesquisa de satisfacao roda em segundo
   * plano e toca a mesma OS. Uma escrita crua ali substituiria "Financeiro e
   * boleto", dito por uma pessoa que atendeu o chamado, por "Encerrado pelo
   * fluxo" -- e o relatorio passaria a atribuir ao robo o desfecho de todo
   * atendimento humano que teve pesquisa.
   *
   * A condicao vai no WHERE, e nao num `if` depois de ler: entre a leitura e a
   * escrita cabe o outro caminho de fechamento, e essa janela e exatamente o
   * caso que este metodo existe para fechar. `updateMany` nao reclama quando
   * nenhuma linha casa -- e "nenhuma linha casou" aqui e o resultado desejado.
   */
  async definirMotivoSeVazio(atendimentoId, motivo) {
    if (!atendimentoId || !motivo) return 0;
    const { count } = await prisma.atendimento.updateMany({
      where: { id: atendimentoId, motivo: null },
      data: { motivo },
    });
    return count;
  }

  // Mesma regra, mirando a OS em curso da conversa.
  async definirMotivoAtualSeVazio(conversaId, motivo) {
    const conversa = await prisma.conversa.findUnique({
      where: { id: conversaId },
      select: { atendimentoAtualId: true },
    });
    return this.definirMotivoSeVazio(conversa?.atendimentoAtualId, motivo);
  }

  /**
   * Garante que a conversa TEM uma OS, sem abrir ciclo novo.
   *
   * Rede de seguranca para linhas anteriores a esta mudanca (criadas quando
   * conversa e atendimento eram a mesma coisa): elas ainda nao tem OS nenhuma, e
   * qualquer espelho em `atualizarAtendimentoAtual` seria silenciosamente
   * ignorado. Diferente de `garantirAtendimentoAberto`, aqui uma OS FECHADA
   * satisfaz a condicao -- reabrir uma conversa e continuar o mesmo atendimento,
   * nao comecar outro.
   */
  garantirAtendimento(conversaId) {
    // Serializado por conversa: sem isso, duas requisicoes simultaneas leem
    // "sem OS" ao mesmo tempo e criam duas, deixando uma orfa e o numero de OS
    // pulando sem motivo. Mesma fila em memoria que o webhook ja usa.
    return comLock(`conversa:${conversaId}`, async () => {
      const conversa = await prisma.conversa.findUnique({
        where: { id: conversaId },
        select: { atendimentoAtualId: true, setor: true, statusAtendimento: true },
      });
      if (!conversa || conversa.atendimentoAtualId) return null;
      return this.abrirAtendimento(conversaId, {
        setor: conversa.setor || null,
        status: conversa.statusAtendimento,
      });
    });
  }

  /**
   * Garante que existe uma OS ABERTA para receber o proximo ciclo.
   *
   * Chamado quando o cliente volta a escrever num fio ja fechado: se a OS atual
   * esta fechada (ou nem existe), abre outra. Devolve `{ atendimento, nova }`.
   */
  garantirAtendimentoAberto(conversaId, { setor = null } = {}) {
    // Mesma fila por conversa: dois atendentes assumindo ao mesmo tempo um fio
    // ja encerrado nao podem abrir duas OS para o mesmo ciclo.
    return comLock(`conversa:${conversaId}`, async () => {
      const conversa = await prisma.conversa.findUnique({
        where: { id: conversaId },
        select: { atendimentoAtualId: true, setor: true },
      });
      if (!conversa) return null;

      if (conversa.atendimentoAtualId) {
        const atual = await prisma.atendimento.findUnique({
          where: { id: conversa.atendimentoAtualId },
        });
        if (atual && atual.status !== "fechada") return { atendimento: atual, nova: false };
      }

      const atendimento = await this.abrirAtendimento(conversaId, {
        setor: setor || conversa.setor || null,
        status: "pendente",
      });
      return { atendimento, nova: true };
    });
  }

  // ------------------------------------------------------------- mensagens ---

  // Cria a mensagem E "toca" a conversa na mesma transacao. Sem o update, o
  // @updatedAt nao muda ao chegar mensagem nova e a conversa nao sobe na lista
  // (ordenada por atualizadoEm). Mensagem do cliente ainda incrementa o
  // contador de nao-lidas usado pelo badge numerico. A mensagem nasce carimbada
  // com a OS atual, e e esse carimbo que recorta o historico por atendimento.
  async addMensagem(conversaId, origem, texto, metadata = null, waMessageId = null, extras = {}) {
    const conversa = await prisma.conversa.findUnique({
      where: { id: conversaId },
      select: { atendimentoAtualId: true },
    });

    const [mensagem] = await prisma.$transaction([
      prisma.mensagem.create({
        data: {
          conversaId,
          atendimentoId: conversa?.atendimentoAtualId || null,
          origem,
          texto,
          metadata,
          waMessageId,
          ...extras,
        },
      }),
      prisma.conversa.update({
        where: { id: conversaId },
        data:
          origem === "cliente"
            ? { atualizadoEm: new Date(), naoLidas: { increment: 1 }, lido: false, versao: { increment: 1 } }
            : { atualizadoEm: new Date(), versao: { increment: 1 } },
      }),
    ]);
    return mensagem;
  }

  /**
   * Toda escrita em MENSAGEM tambem envelhece a conversa.
   *
   * O front descarta retrato com versao <= a que tem em tela. Editar, apagar,
   * transcrever ou confirmar o envio de uma mensagem muda a conversa aos olhos
   * de quem olha, mas mexia so na tabela de mensagens -- a versao ficava igual e
   * o painel dos OUTROS atendentes descartava o evento, voltando a exigir F5.
   */
  async _tocarConversaDaMensagem(mensagemId) {
    const msg = await prisma.mensagem.findUnique({
      where: { id: mensagemId },
      select: { conversaId: true },
    });
    if (!msg) return;
    await prisma.conversa.update({
      where: { id: msg.conversaId },
      data: { versao: { increment: 1 } },
    });
  }

  // Vincula o id da Evolution a mensagem recem-criada, para o ACK
  // (messages.update) conseguir encontra-la depois.
  async vincularWaMessageId(id, waMessageId, status = "enviada") {
    const msg = await prisma.mensagem.update({
      where: { id },
      data: { waMessageId, status },
    });
    await this._tocarConversaDaMensagem(id);
    return msg;
  }

  // Nao rebaixa o status: um "entregue" atrasado nao pode apagar um "lida".
  async atualizarStatusPorWaId(waMessageId, status) {
    const ordem = { enviando: 0, enviada: 1, entregue: 2, lida: 3 };
    const msg = await prisma.mensagem.findUnique({ where: { waMessageId } });
    if (!msg) return null;
    // ACK que nao muda nada (repetido ou atrasado) devolve `conversa: null`:
    // sem mudanca real nao ha o que emitir, e emitir mesmo assim era gastar uma
    // leitura completa da conversa para reenviar o status que o front ja tinha.
    if (status !== "erro" && (ordem[status] ?? 0) <= (ordem[msg.status] ?? -1)) {
      return { mensagem: msg, conversa: null };
    }
    const atualizada = await prisma.mensagem.update({ where: { id: msg.id }, data: { status } });
    // O risquinho mudou: a conversa precisa de versao nova, senao o front
    // descarta o evento como "igual ao que ja tenho".
    //
    // Devolvemos `setor` e a `versao` nova junto porque o ACK vira um PATCH de
    // status (ver event-bus.emitStatusMensagem): o stream precisa do setor para
    // o guard e o front precisa da versao para ordenar. Sao os dois campos que
    // faltavam para nao ter de reler a conversa inteira so por causa de um
    // icone de entrega.
    const conversa = await prisma.conversa.update({
      where: { id: msg.conversaId },
      data: { versao: { increment: 1 } },
      select: { id: true, setor: true, versao: true },
    });
    return { mensagem: atualizada, conversa };
  }

  findMensagem(id) {
    return prisma.mensagem.findUnique({ where: { id } });
  }

  async atualizarMetadata(id, metadata) {
    const msg = await prisma.mensagem.update({ where: { id }, data: { metadata } });
    await this._tocarConversaDaMensagem(id);
    return msg;
  }

  async editarMensagem(id, texto) {
    const msg = await prisma.mensagem.update({
      where: { id },
      data: { texto, editadaEm: new Date() },
    });
    await this._tocarConversaDaMensagem(id);
    return msg;
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
    const atualizada = await prisma.mensagem.update({ where: { id }, data: { metadata } });
    await this._tocarConversaDaMensagem(id);
    return atualizada;
  }

  zerarNaoLidas(id) {
    return prisma.conversa.update({
      where: { id },
      data: { naoLidas: 0, lido: true, versao: { increment: 1 } },
      include: INCLUDE_CONVERSA,
    });
  }

  /**
   * O CLIENTE FALOU DEPOIS DE `desde`?
   *
   * Existe para uma pergunta so, e ela e a do encerramento por inatividade: "o
   * cliente respondeu A PERGUNTA que o bot fez?" -- e nao "o cliente ja mandou
   * alguma mensagem alguma vez". A diferenca e o bug: a decisao era tomada em
   * cima de `sessoes_chatbot.atualizado_em`, um carimbo da linha da sessao, e
   * nenhum caminho de resposta era obrigado a toca-lo.
   *
   * `origem: "cliente"` de proposito: mensagem do bot ("automacao") e do
   * atendente ("equipe") nao contam como resposta do cliente.
   *
   * Roda no instante de agir, e nao quando a espera comecou -- por isso fecha a
   * corrida entre a resposta que acabou de chegar e o timeout que ia disparar.
   */
  async respondeuDepoisDe(conversaId, desde) {
    if (!conversaId || !desde) return false;
    const msg = await prisma.mensagem.findFirst({
      where: { conversaId, origem: "cliente", criadoEm: { gt: new Date(desde) } },
      select: { id: true },
    });
    return !!msg;
  }

  /**
   * A BOLHA QUE FALHOU, para a tentativa seguinte reaproveitar.
   *
   * Sem isto, cada retentativa criaria uma mensagem nova: numa indisponibilidade
   * de meia hora, a varredura de 60s empilharia 30 bolhas identicas com
   * `status: "erro"` na conversa do cliente. Reaproveitando a linha, o operador
   * ve UMA mensagem que vira "enviada" quando o envio finalmente passa.
   */
  ultimaMensagemBotComErro(conversaId, texto) {
    return prisma.mensagem.findFirst({
      where: { conversaId, origem: "bot", status: "erro", texto },
      orderBy: { criadoEm: "desc" },
      select: { id: true },
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

  /**
   * A mensagem local que corresponde a um id do WhatsApp -- DENTRO de uma conversa.
   *
   * E o que resolve a citacao RECEBIDA: quando o cliente responde citando, o
   * WhatsApp manda apenas `contextInfo.stanzaId`, que e o id da mensagem no
   * aparelho. Como todo envio nosso guarda o `waMessageId` que a Evolution
   * devolveu (ver vincularWaMessageId) e toda mensagem recebida guarda o
   * `key.id` do webhook, esse id sempre volta para uma mensagem nossa.
   *
   * `findFirst` com a conversa no filtro, e nao `findUnique` pelo indice: o
   * unique de `waMessageId` e GLOBAL, e casar sem escopo permitiria, em teoria,
   * uma citacao apontar para mensagem de outro fio -- que apareceria na bolha
   * como se fosse desta conversa.
   */
  findMensagemPorWaId(waMessageId, conversaId = null) {
    if (!waMessageId) return Promise.resolve(null);
    return prisma.mensagem.findFirst({
      where: { waMessageId: String(waMessageId), ...(conversaId ? { conversaId } : {}) },
      select: { id: true, origem: true, texto: true },
    });
  }

  countByStatus() {
    return prisma.conversa.groupBy({
      by: ["statusAtendimento"],
      _count: { id: true },
    });
  }

  // Contagem por status das OS (e nao dos fios): "quantos atendimentos foram
  // finalizados" e uma pergunta sobre ciclos. Com a conversa unica por cliente,
  // contar conversas fechadas passaria a responder "quantos clientes estao sem
  // atendimento em curso" -- outra coisa.
  countAtendimentosByStatus() {
    return prisma.atendimento.groupBy({
      by: ["status"],
      _count: { id: true },
    });
  }

  listarTodosAtendimentos() {
    return prisma.atendimento.findMany({ orderBy: { abertoEm: "desc" } });
  }
}

module.exports = new ConversaRepository();
