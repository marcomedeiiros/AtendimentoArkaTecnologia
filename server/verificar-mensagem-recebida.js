/**
 * Verifica o que acontece com a mensagem que VEM DO CLIENTE: risquinho, reacao,
 * edicao, "apagar para todos" e citacao.
 *
 * Existe porque nenhum destes caminhos tinha cenario, e todos falhavam EM
 * SILENCIO -- sem erro, sem log, sem bolha vermelha. Ver
 * docs/auditoria-mensagens-recebidas.md.
 *
 * Roda contra o banco configurado em DATABASE_URL: cria uma conversa propria,
 * mexe so nela e a apaga no fim.
 *
 * Uso: node verificar-mensagem-recebida.js
 */
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "error";

const { PrismaClient } = require("@prisma/client");
const conversaRepository = require("./src/infrastructure/repositories/conversa.repository");
const whatsappService = require("./src/modules/whatsapp/whatsapp.service");
const bus = require("./src/shared/events/event-bus");
const { mapConversa } = require("./src/shared/helpers/mapper.helper");
const { ChatbotEngine } = require("./src/modules/chatbot/chatbot.engine");

const prisma = new PrismaClient();

let passou = 0;
let falhou = 0;

function conferir(titulo, condicao, detalhe = "") {
  if (condicao) {
    passou += 1;
    console.log(`  OK   ${titulo}`);
  } else {
    falhou += 1;
    console.log(`  FALHA ${titulo}${detalhe ? ` -- ${detalhe}` : ""}`);
  }
}

async function main() {
  const eventos = [];
  bus.on("conversa", (e) => eventos.push(e));

  // O RAMO `create` NUNCA RODAVA NA VM, E POR ISSO ESTAVA QUEBRADO EM DOIS.
  //
  // `findFirst` acha uma instancia em qualquer banco que ja tenha sido usado --
  // e a VM sempre tem. O `create` era o caminho do banco VAZIO, e ninguem
  // passava por ele: `webhookSecret` e obrigatorio no schema e faltava, e
  // `telefone` nao existe no model `Instancia`. Duas linhas de erro do Prisma
  // antes da primeira assercao.
  //
  // Consequencia pratica: este script nao rodava em maquina nova nem em banco
  // limpo -- exatamente onde se quer rodar a verificacao antes de confiar numa
  // mudanca. Os outros tres scripts que criam instancia (escopo-dados,
  // grupos-nao-atendem, setores-extras) sempre fizeram certo; era so aqui.
  const instancia =
    (await prisma.instancia.findFirst()) ||
    (await prisma.instancia.create({
      data: { nome: `verificacao-${Date.now()}`, webhookSecret: `verificacao-${Date.now()}` },
    }));

  const conversa = await prisma.conversa.create({
    data: {
      instanciaId: instancia.id,
      cliente: "Cliente da verificacao",
      telefone: `5527${Date.now().toString().slice(-9)}`,
      statusAtendimento: "aberta",
    },
  });

  const waCliente = `VERIF_CLI_${Date.now()}`;
  const waNossa = `VERIF_NOS_${Date.now()}`;

  const msgCliente = await prisma.mensagem.create({
    data: {
      conversaId: conversa.id,
      origem: "cliente",
      texto: "o pc ligou e nao pediu senha",
      waMessageId: waCliente,
      metadata: { tipo: "imagem", arquivo: "foto.jpg", mimetype: "image/jpeg" },
    },
  });
  const msgNossa = await prisma.mensagem.create({
    data: {
      conversaId: conversa.id,
      origem: "equipe",
      texto: "",
      waMessageId: waNossa,
      status: "enviada",
      metadata: { tipo: "imagem", arquivo: "print.png", mimetype: "image/png" },
    },
  });

  const ack = (waMessageId, fromMe, status = "DELIVERY_ACK") =>
    whatsappService._processarAck({
      event: "messages.update",
      data: { key: { id: waMessageId, fromMe }, status },
    });
  const status = async (id) =>
    (await prisma.mensagem.findUnique({ where: { id }, select: { status: true } })).status;

  console.log("\n1. Risquinho (ACK de entrega/leitura)");

  await ack(waCliente, false);
  conferir(
    "ACK com fromMe:false nao carimba a mensagem do cliente",
    (await status(msgCliente.id)) === null
  );

  // Sem `fromMe` no payload (versoes que o omitem): quem decide e a `origem`.
  await whatsappService._processarAck({
    event: "messages.update",
    data: { key: { id: waCliente }, status: "READ" },
  });
  conferir(
    "ACK sem fromMe tambem para na origem da linha",
    (await status(msgCliente.id)) === null
  );

  await ack(waNossa, true);
  conferir(
    "ACK na NOSSA mensagem continua funcionando",
    (await status(msgNossa.id)) === "entregue",
    `status=${await status(msgNossa.id)}`
  );

  const patches = eventos.filter((e) => e.type === "mensagem:status");
  conferir(
    "so a nossa mensagem gerou patch de status",
    patches.length === 1 && patches[0].mensagemId === msgNossa.id,
    `${patches.length} patch(es)`
  );

  const dto = mapConversa(await conversaRepository.findById(conversa.id));
  conferir(
    "o retrato completo nao traz status em bolha de cliente",
    dto.mensagens.find((m) => m.id === msgCliente.id).status === null
  );

  console.log("\n2. Reacao do cliente (nao pode apagar o metadata)");

  const alvo = await conversaRepository.findMensagemPorWaId(waCliente);
  conferir("findMensagemPorWaId devolve metadata", alvo.metadata != null);
  conferir("findMensagemPorWaId devolve conversaId", alvo.conversaId === conversa.id);

  await whatsappService._processarReacao(
    { waMessageId: waCliente, emoji: "👍" },
    `${conversa.telefone}@s.whatsapp.net`
  );
  const aposReacao = (await prisma.mensagem.findUnique({ where: { id: msgCliente.id } })).metadata;
  conferir("a midia sobrevive a reacao", aposReacao?.arquivo === "foto.jpg", JSON.stringify(aposReacao));
  conferir("a reacao foi de fato gravada", (aposReacao?.reacoes || []).length === 1);

  console.log("\n3. Edicao feita pelo cliente no aparelho");

  const editado = "o pc ligou e PEDIU senha";
  const rEdicao = await whatsappService.processarWebhook(
    {
      event: "messages.update",
      data: {
        key: { id: waCliente, fromMe: false, remoteJid: `${conversa.telefone}@s.whatsapp.net` },
        message: {
          editedMessage: {
            message: {
              protocolMessage: {
                key: { id: waCliente },
                type: "MESSAGE_EDIT",
                editedMessage: { conversation: editado },
              },
            },
          },
        },
      },
    },
    instancia.nome
  );
  const depoisEdicao = await prisma.mensagem.findUnique({ where: { id: msgCliente.id } });
  conferir("o webhook de edicao e processado", rEdicao.processado === true, JSON.stringify(rEdicao));
  conferir("o texto novo substitui o antigo", depoisEdicao.texto === editado, depoisEdicao.texto);
  conferir("a bolha fica marcada como editada", depoisEdicao.editadaEm != null);
  conferir(
    "o mapper expoe `editada` para a tela",
    mapConversa(await conversaRepository.findById(conversa.id)).mensagens.find(
      (m) => m.id === msgCliente.id
    ).editada === true
  );

  // A Evolution reentrega webhooks: a mesma edicao nao pode contar duas vezes.
  const repetida = await whatsappService.processarWebhook(
    {
      event: "messages.update",
      data: {
        key: { id: waCliente, fromMe: false },
        message: {
          protocolMessage: { key: { id: waCliente }, type: 14, editedMessage: { conversation: editado } },
        },
      },
    },
    instancia.nome
  );
  conferir("edicao reentregue nao regrava", repetida.motivo === "edicao_repetida", repetida.motivo);

  console.log("\n4. Apagar para todos, feito pelo cliente");

  const rApagar = await whatsappService.processarWebhook(
    {
      event: "messages.upsert",
      data: {
        key: { id: `VERIF_REV_${Date.now()}`, fromMe: false, remoteJid: `${conversa.telefone}@s.whatsapp.net` },
        message: { protocolMessage: { key: { id: waCliente }, type: "REVOKE" } },
      },
    },
    instancia.nome
  );
  const depoisApagar = await prisma.mensagem.findUnique({ where: { id: msgCliente.id } });
  conferir("o webhook de revogacao e processado", rApagar.processado === true, JSON.stringify(rApagar));
  conferir("a mensagem fica marcada como apagada", depoisApagar.metadata?.deletada === true);
  conferir(
    "o texto original continua no banco (o Registro precisa dele)",
    depoisApagar.texto === editado
  );

  console.log("\n5. Alvo desconhecido e mensagem normal nao podem virar protocolo");

  const orfao = await whatsappService.processarWebhook(
    {
      event: "messages.update",
      data: {
        key: { id: "NAO_EXISTE", fromMe: false },
        message: { protocolMessage: { key: { id: "NAO_EXISTE" }, type: "REVOKE" } },
      },
    },
    instancia.nome
  );
  conferir("protocolo sem alvo sai em silencio", orfao.motivo === "protocolo_sem_alvo", orfao.motivo);

  conferir(
    "mensagem de texto comum nao e confundida com protocolo",
    whatsappService.extrairProtocolo({
      data: { key: { id: "x" }, message: { conversation: "bom dia" } },
    }) === null
  );
  conferir(
    "protocolo que nao sabemos tratar e ignorado",
    whatsappService.extrairProtocolo({
      data: { message: { protocolMessage: { type: "HISTORY_SYNC_NOTIFICATION" } } },
    }) === null
  );

  console.log("\n6. Citacao recebida (o retrato do trecho citado)");

  // Citar uma mensagem NOSSA que e midia sem legenda: o retrato tem de dizer o
  // TIPO. Isto dependia de `metadata`, que o `select` nao trazia -- a bolha caia
  // em "respondeu algo que nao temos" mesmo com a original no banco.
  const original = await conversaRepository.findMensagemPorWaId(waNossa, conversa.id);
  conferir("a original citada e encontrada dentro da conversa", original?.id === msgNossa.id);
  conferir(
    "e o tipo da midia citada esta acessivel para montar o retrato",
    original?.metadata?.tipo === "imagem",
    JSON.stringify(original?.metadata)
  );
  conferir(
    "a busca e escopada: id de outra conversa nao casa",
    (await conversaRepository.findMensagemPorWaId(waNossa, "outra-conversa")) === null
  );
  conferir(
    "toque em botao traz a citacao no contextInfo",
    whatsappService.extrairCitacao({
      data: {
        message: {
          buttonsResponseMessage: {
            selectedDisplayText: "Suporte tecnico",
            contextInfo: { stanzaId: waNossa, quotedMessage: { conversation: "Escolha uma opcao" } },
          },
        },
      },
    })?.stanzaId === waNossa
  );
  conferir(
    "contextInfo so de criptografia NAO vira citacao",
    whatsappService.extrairCitacao({
      data: {
        message: { conversation: "isso" },
        contextInfo: { deviceListMetadata: {}, messageSecret: "abc" },
      },
    }) === null
  );

  console.log("\n7. Citacao derivada ANTIGA: o historico continua desenhando");

  // A CITACAO DERIVADA FOI REMOVIDA (auditoria-citacao-no-chat-10-09.md), e com
  // ela a consulta `ultimaMensagemNossa` -- por isso as checagens que a
  // exercitavam sairam daqui.
  //
  // O que SOBRA e o que continua importando: as mensagens que ja estao no banco
  // com `metadata.citacao.derivada = true` seguem com o retrato gravado na
  // linha, e portanto seguem desenhando a citacao na tela. A mudanca vale para
  // o que chega dali em diante, nao para o passado -- e o mapper tem de
  // continuar entregando aquele retrato, senao conversas antigas perderiam
  // pedaco do contexto sem ninguem ter pedido isso.
  const menu = "*Atendimento Tecnico* Como podemos ajudar?";
  const perguntaBot = await prisma.mensagem.create({
    data: { conversaId: conversa.id, origem: "bot", texto: menu, status: "enviada" },
  });

  // E o retrato derivado atravessa o mapper com a marca de origem.
  const comDerivada = await prisma.mensagem.create({
    data: {
      conversaId: conversa.id,
      origem: "cliente",
      texto: "1",
      respondendoAId: perguntaBot.id,
      metadata: { citacao: { texto: menu, derivada: true } },
    },
  });
  const bolha = mapConversa(await conversaRepository.findById(conversa.id)).mensagens.find(
    (m) => m.id === comDerivada.id
  );
  conferir("a bolha recebe o texto citado", bolha.citacao?.texto === menu);
  conferir("e a marca de que o retrato foi derivado", bolha.citacao?.derivada === true);
  conferir("a ligacao por id tambem vai junto", bolha.respondendoAId === perguntaBot.id);

  console.log("\n8. No motor: texto puro do cliente NAO gera citacao");

  // ── ESTA SECAO AFIRMAVA O CONTRARIO, E FOI INVERTIDA DE PROPOSITO ─────────
  //
  // Ela travava a citacao derivada: garantia que digitar "1" apontasse para a
  // pergunta do bot, e que a resposta seguinte apontasse para a fala do
  // atendente. Era o comportamento pedido em 09/09 e retirado em 10/09, quando
  // a producao mostrou o custo (#OS00222: de cinco mensagens do cliente, tres
  // citavam coisa sem relacao, e duas citacoes repetidas em bolhas seguidas).
  //
  // As checagens foram INVERTIDAS, nao apagadas. Apagar deixaria o caminho
  // livre para a citacao derivada voltar na proxima mudanca do motor sem que
  // nada reclamasse -- e ela e, por construcao, invisivel na tela: desenha
  // igual a uma citacao real. O que trava o comportamento tem de ser um teste.
  //
  // A REGRA QUE ESTAS CHECAGENS GARANTEM: sem `contextInfo` do aparelho, nao ha
  // citacao. Nem do bot, nem do atendente, nem com a sessao em `humano`.
  //
  // O que continua citando, e tem teste proprio em verificar-botoes.js: a
  // resposta por BOTAO, porque ali o WhatsApp manda o contexto de verdade.
  const FLUXO = {
    id: "f1", nome: "Menu", gatilho: "*", ativo: true,
    passos: [
      {
        id: "p1", tipo: "mensagem", titulo: "Menu", ordem: 0,
        texto: "*Atendimento Tecnico* Como podemos ajudar?",
        config: {
          exibicao: "text",
          opcoes: [
            { id: "mp_1", palavrasChave: ["1"], esperaEscolha: true, acao: "transferir", setor: "Tecnico", botao: "Tenho contrato" },
          ],
        },
      },
    ],
  };

  const conv = {
    id: "c-derivada", instanciaId: "i1", cliente: "F", telefone: "5527911112222",
    statusAtendimento: "pendente", setor: "Geral", atendimentoAtualId: "os1",
    cnpj: null, cnpjVerificado: false, mensagens: [], atendimentos: [{ id: "os1" }],
  };
  let sessao = null;
  let seq = 0;

  const motor = new ChatbotEngine({
    fluxoRepository: {
      findAtivos: async () => [FLUXO], findById: async () => FLUXO,
      findByGatilho: async () => null, createLog: async () => {},
    },
    conversaRepository: {
      findById: async () => conv, findByIdParaEvento: async () => conv,
      findByTelefone: async () => conv, findByTelefoneParaMotor: async () => conv,
      create: async () => conv, existeMensagemWa: async () => false,
      addMensagem: async (_i, origem, texto, meta, waId, extra) => {
        const m = { id: "m" + ++seq, origem, texto, metadata: meta || null, waMessageId: waId || null, ...(extra || {}) };
        conv.mensagens.push(m);
        return m;
      },
      findMensagemPorWaId: async (waId) => conv.mensagens.find((m) => m.waMessageId === waId) || null,
      editarMensagem: async (id, texto) => {
        const m = conv.mensagens.find((x) => x.id === id);
        if (m) { m.texto = texto; m.editadaEm = new Date(); }
        return m;
      },
      // ── ARMADILHA DELIBERADA ────────────────────────────────────────────
      //
      // A consulta foi removida do repositorio junto com a citacao derivada. O
      // duble fica aqui, e EXPLODE, porque a chamada original era
      // `ultimaMensagemNossa?.(...)` -- com o encadeamento opcional, um metodo
      // ausente devolve `undefined` em silencio e a citacao derivada voltaria
      // sem nenhum teste reclamando. Melhor falhar alto.
      ultimaMensagemNossa: async () => {
        throw new Error(
          "citacao derivada removida (auditoria-citacao-no-chat-10-09.md): o motor nao " +
            "deve consultar a ultima mensagem nossa para montar citacao. A bolha do " +
            "cliente cita se e somente se ele citou no aparelho."
        );
      },
      respondeuDepoisDe: async () => false,
      vincularWaMessageId: async (id, waId) => {
        const m = conv.mensagens.find((x) => x.id === id);
        if (m) m.waMessageId = waId;
      },
      update: async (_i, d) => Object.assign(conv, d),
      garantirAtendimento: async () => null,
      garantirAtendimentoAberto: async () => ({ atendimento: null }),
      atualizarAtendimentoAtual: async () => null, atualizarAtendimento: async () => null,
      definirMotivoAtualSeVazio: async () => null, definirMotivoSeVazio: async () => null,
      ultimoCnpjDoTelefone: async () => null, ultimaMensagemBotComErro: async () => null,
    },
    sessaoRepository: {
      findByTelefone: async () => sessao, findByConversa: async () => sessao,
      upsert: async (a, b, c, d) => {
        sessao = { id: "s1", instanciaId: a, conversaId: b, telefone: c, ...(sessao || {}), ...d, atualizadoEm: new Date() };
        return sessao;
      },
      update: async (_i, d) => { sessao = { ...sessao, ...d, atualizadoEm: new Date() }; return sessao; },
      reivindicarInatividade: async () => ({ count: 0 }),
    },
    parceiroRepository: { findAtivoByCnpj: async () => null, findAtivoByTelefone: async () => null },
    evolutionApi: {
      sendText: async () => ({ key: { id: "WA_MENU" } }),
      sendButtons: async () => ({ key: { id: "WA_MENU" } }),
      sendList: async () => ({ key: { id: "WA_MENU" } }),
      sendPoll: async () => ({ key: { id: "WA_MENU" } }),
      fetchProfilePictureUrl: async () => null, getBase64FromMediaMessage: async () => null,
    },
    n8nClient: { encaminharMensagem: async () => ({ encaminhado: false }) },
    configuracaoService: {
      modoAtendimento: async () => "local",
      horarioAtendimento: async () => ({ ativo: false }),
      filasParaSetor: async () => ({}),
      pesquisaSatisfacao: async () => ({ ativo: false }),
    },
    bus: { emitConversa: () => {} },
  });

  const receber = (texto, id) =>
    motor.processarMensagemEntrada({
      instanciaId: "i1", instanceName: "v", telefone: conv.telefone,
      texto, nomeCliente: "F", waMessageId: id,
      // Texto puro: NENHUM contexto vem do WhatsApp.
      botaoId: null, midia: null, citacao: null, encaminhada: null,
    });

  await receber("oi", "W1");
  const doBot = conv.mensagens.find((m) => m.origem === "bot");
  conferir("o bot fez a pergunta e ficou esperando", !!doBot && !!sessao?.aguardando);

  await receber("1", "W2");
  const digitada = conv.mensagens.filter((m) => m.origem === "cliente").pop();
  conferir(
    "a resposta digitada NAO aponta para a pergunta do bot",
    digitada?.respondendoAId == null,
    `respondendoAId=${digitada?.respondendoAId} (deveria ser nulo)`
  );
  conferir(
    "e NAO leva retrato nenhum -- o WhatsApp nao mandou citacao",
    digitada?.metadata?.citacao == null,
    JSON.stringify(digitada?.metadata?.citacao)
  );
  // O setor volta canonizado ("Tecnico" -> "Técnico", ver setor.helper). Citar e
  // rotear sempre foram independentes, e retirar a citacao nao pode mexer na
  // escolha -- e a razao de esta checagem continuar aqui, inalterada.
  conferir("a escolha continua roteando normalmente", conv.setor === "Técnico", conv.setor);

  // ── E AGORA O TURNO HUMANO, que e o caso da captura de 10/09 ────────────
  //
  // A escolha acima transferiu para a equipe, e isso grava
  // `aguardando: "humano"` na sessao. Depois o atendente fala e o cliente
  // escreve de novo -- foi essa combinacao que produziu as bolhas citando
  // "pronto" e "so me dizer" em #OS00222, inclusive em mensagens que abriam
  // assunto novo. Com a citacao derivada fora, nada disso pode acontecer.
  conferir(
    "a transferencia deixou a sessao em 'humano'",
    sessao?.aguardando === "humano",
    String(sessao?.aguardando)
  );

  const opaaa = {
    id: "m-atendente", origem: "equipe", texto: "opaaa", metadata: null, waMessageId: "WA_ATD",
  };
  conv.mensagens.push(opaaa);

  await receber("ajuda eu", "W3");
  const aoHumano = conv.mensagens.filter((m) => m.origem === "cliente").pop();
  conferir(
    "a mensagem depois da fala do atendente tambem NAO cita",
    aoHumano?.respondendoAId == null,
    `respondendoAId=${aoHumano?.respondendoAId} (bot=${doBot?.id}, atendente=${opaaa.id})`
  );
  conferir(
    "e nao ha retrato do texto do atendente",
    aoHumano?.metadata?.citacao == null,
    JSON.stringify(aoHumano?.metadata?.citacao)
  );

  // ── E A CITACAO REAL CONTINUA FUNCIONANDO ──────────────────────────────
  //
  // Esta e a metade que o pedido PRESERVA, e sem ela a mudanca teria jogado
  // fora o recurso todo: quando o cliente cita de verdade no aparelho, o
  // `stanzaId` chega e a bolha tem de mostrar o trecho citado.
  await motor.processarMensagemEntrada({
    instanciaId: "i1", instanceName: "v", telefone: conv.telefone,
    texto: "isso mesmo", nomeCliente: "F", waMessageId: "W4",
    botaoId: null, midia: null, encaminhada: null,
    citacao: { stanzaId: "WA_ATD" },
  });
  const citouDeVerdade = conv.mensagens.filter((m) => m.origem === "cliente").pop();
  conferir(
    "citou no aparelho -> a bolha aponta para a mensagem citada",
    citouDeVerdade?.respondendoAId === opaaa.id,
    `respondendoAId=${citouDeVerdade?.respondendoAId} esperado=${opaaa.id}`
  );
  conferir(
    "e leva o retrato do trecho, sem marca de derivado",
    citouDeVerdade?.metadata?.citacao?.texto === "opaaa" &&
      !citouDeVerdade?.metadata?.citacao?.derivada,
    JSON.stringify(citouDeVerdade?.metadata?.citacao)
  );

  console.log("\n9. Edicao ACHATADA: mesmo waMessageId com texto novo e edicao, nao reentrega");

  // ── O QUE ESTAS CHECAGENS TRAVAM ──────────────────────────────────────────
  //
  // Parte das versoes da Evolution entrega a edicao do cliente SEM
  // `protocolMessage`: uma mensagem comum, com o id da original e o texto novo.
  // Ela batia no dedupe e saia como `mensagem_duplicada` -- em silencio, com a
  // bolha continuando a mostrar o texto ANTERIOR. Ver
  // docs/auditoria-perda-mensagens-11-09.md §4, caso F.
  //
  // A terceira checagem e a mais importante das tres: ela garante que o
  // conserto nao vire corrupcao. O texto de midia e de botao e REESCRITO depois
  // de gravado (rotulo no lugar do id), entao comparar texto cru com texto
  // reescrito acusaria "edicao" em qualquer reentrega -- e ai a bolha passaria a
  // ser sobrescrita com o id tecnico. Por isso so texto puro edita.
  const r1 = await motor.processarMensagemEntrada({
    instanciaId: "i1", instanceName: "v", telefone: conv.telefone,
    texto: "isso mesmo, corrigido", nomeCliente: "F", waMessageId: "W4",
    botaoId: null, midia: null, encaminhada: null, citacao: null,
  });
  const editada = conv.mensagens.find((m) => m.waMessageId === "W4");
  conferir("texto diferente no mesmo id -> a mensagem e EDITADA", r1?.motivo === "edicao_aplicada", r1?.motivo);
  conferir("e a bolha passa a mostrar o texto novo", editada?.texto === "isso mesmo, corrigido", editada?.texto);
  conferir("com o carimbo de editada", !!editada?.editadaEm);

  const r2 = await motor.processarMensagemEntrada({
    instanciaId: "i1", instanceName: "v", telefone: conv.telefone,
    texto: "isso mesmo, corrigido", nomeCliente: "F", waMessageId: "W4",
    botaoId: null, midia: null, encaminhada: null, citacao: null,
  });
  conferir("texto IGUAL continua sendo reentrega descartada", r2?.motivo === "mensagem_duplicada", r2?.motivo);

  const r3 = await motor.processarMensagemEntrada({
    instanciaId: "i1", instanceName: "v", telefone: conv.telefone,
    texto: "mp_1", nomeCliente: "F", waMessageId: "W4",
    botaoId: "mp_1", midia: null, encaminhada: null, citacao: null,
  });
  conferir("resposta de BOTAO nunca edita (o rotulo reescreve o texto)", r3?.motivo === "mensagem_duplicada", r3?.motivo);
  conferir("e o texto editado continua intacto", editada?.texto === "isso mesmo, corrigido", editada?.texto);

  console.log("\n10. A citacao NAO atravessa conversas");

  // ── O QUE ESTAS CHECAGENS TRAVAM ──────────────────────────────────────────
  //
  // O `respondendoAId` do envio vem da INTERFACE, e a interface ja errou: em
  // 11/09/2026 o "Respondendo" vazava entre conversas (o PainelChat guardava a
  // citacao e nao era remontado ao trocar de fio). O servidor aceitava o id
  // solto e gravava o vinculo -- uma bolha citando mensagem que aquele cliente
  // nunca viu.
  //
  // A guarda do front existe (`key` por conversa), e esta e a segunda: mesmo
  // que a tela erre de novo, o vinculo nao se forma. Duas guardas independentes
  // de proposito, que e a regra de validacao do projeto.
  const outraConversa = await prisma.conversa.create({
    data: {
      instanciaId: instancia.id,
      cliente: "Outro cliente",
      telefone: `5511${Date.now().toString().slice(-9)}`,
      statusAtendimento: "aberta",
    },
  });
  const msgDaOutra = await prisma.mensagem.create({
    data: { conversaId: outraConversa.id, origem: "cliente", texto: "mensagem de outro fio" },
  });

  conferir(
    "mensagem de outra conversa e RECUSADA quando escopada",
    (await conversaRepository.findMensagem(msgDaOutra.id, conversa.id)) === null
  );
  conferir(
    "e a mesma mensagem e encontrada na conversa dela",
    (await conversaRepository.findMensagem(msgDaOutra.id, outraConversa.id))?.id === msgDaOutra.id
  );
  conferir(
    "sem escopo continua achando (os outros chamadores dependem disso)",
    (await conversaRepository.findMensagem(msgDaOutra.id))?.id === msgDaOutra.id
  );
  conferir(
    "id inexistente nao estoura",
    (await conversaRepository.findMensagem("nao-existe", conversa.id)) === null
  );

  await prisma.mensagem.deleteMany({ where: { conversaId: outraConversa.id } });
  await prisma.conversa.delete({ where: { id: outraConversa.id } });

  await prisma.mensagem.deleteMany({ where: { conversaId: conversa.id } });
  await prisma.conversa.delete({ where: { id: conversa.id } });

  console.log(`\n${passou} passaram, ${falhou} falharam.`);
  process.exitCode = falhou > 0 ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
