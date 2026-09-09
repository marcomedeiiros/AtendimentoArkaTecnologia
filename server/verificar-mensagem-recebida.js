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

  const instancia =
    (await prisma.instancia.findFirst()) ||
    (await prisma.instancia.create({
      data: { nome: `verificacao-${Date.now()}`, telefone: "5527900000000" },
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

  console.log("\n7. Citacao DERIVADA: aponta para o que o cliente acabou de receber");

  // O cenario real: o bot manda o menu e fica esperando. O cliente DIGITA a
  // resposta em vez de tocar no botao -- e o WhatsApp nao manda contextInfo.
  const menu = "*Atendimento Tecnico* Como podemos ajudar?";
  const perguntaBot = await prisma.mensagem.create({
    data: { conversaId: conversa.id, origem: "bot", texto: menu, status: "enviada" },
  });

  const ultima = await conversaRepository.ultimaMensagemNossa(conversa.id);
  conferir("com o bot conduzindo, e a fala dele", ultima?.id === perguntaBot.id);
  conferir("e ela traz o texto para montar o retrato", ultima?.texto === menu);

  await prisma.mensagem.update({
    where: { id: perguntaBot.id },
    data: { metadata: { deletada: true } },
  });
  conferir(
    "mensagem apagada nao vira citacao (a bolha ficaria vazia)",
    (await conversaRepository.ultimaMensagemNossa(conversa.id)) === null
  );
  await prisma.mensagem.update({ where: { id: perguntaBot.id }, data: { metadata: {} } });

  // ── O DEFEITO DE PRODUCAO (#OS00217, 18:56) ─────────────────────────────
  //
  // O atendente assume e fala. A partir dai o cliente responde a ELE -- era
  // aqui que a Central seguia citando a ultima fala do robo, tres turnos atras,
  // enquanto o WhatsApp do cliente mostrava a citacao do atendente.
  const doAtendente = await prisma.mensagem.create({
    data: { conversaId: conversa.id, origem: "equipe", texto: "opaaa" },
  });
  conferir(
    "com o atendente na conversa, e a fala DELE (nao a do bot)",
    (await conversaRepository.ultimaMensagemNossa(conversa.id))?.id === doAtendente.id,
    `veio ${(await conversaRepository.ultimaMensagemNossa(conversa.id))?.texto}`
  );

  // Nota interna nunca sai daqui: cita-la faria parecer que o cliente leu o que
  // a equipe escreveu em segredo. Mensagem de sistema tambem nao e fala.
  await prisma.mensagem.create({
    data: { conversaId: conversa.id, origem: "nota", texto: "cliente ja deu calote" },
  });
  await prisma.mensagem.create({
    data: { conversaId: conversa.id, origem: "sistema", texto: "Marco assumiu a conversa" },
  });
  conferir(
    "nota interna e aviso de sistema nao viram citacao",
    (await conversaRepository.ultimaMensagemNossa(conversa.id))?.id === doAtendente.id
  );

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

  console.log("\n8. E o ciclo inteiro no motor: o cliente DIGITA a resposta");

  // O caso que o relato pedia. Tocar no botao ja citava o menu (o WhatsApp manda
  // o contextInfo junto); digitar "1" chega como texto puro, sem contexto
  // nenhum -- e a mesma conversa ficava com metade das respostas citando e a
  // outra metade solta. Aqui a ligacao sai do NOSSO estado: a sessao diz que ha
  // pergunta em aberto, e a pergunta e a ultima fala do bot.
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
      // A consulta nova: a ultima mensagem que saiu daqui (bot OU atendente).
      ultimaMensagemNossa: async () => {
        const m = [...conv.mensagens]
          .reverse()
          .find((x) => x.origem === "bot" || x.origem === "equipe");
        return m && !m.metadata?.deletada ? { id: m.id, texto: m.texto } : null;
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
    "a resposta digitada aponta para a pergunta do bot",
    digitada?.respondendoAId === doBot?.id,
    `respondendoAId=${digitada?.respondendoAId} pergunta=${doBot?.id}`
  );
  conferir(
    "e leva o retrato, marcado como derivado",
    digitada?.metadata?.citacao?.derivada === true &&
      String(digitada?.metadata?.citacao?.texto || "").includes("Como podemos ajudar"),
    JSON.stringify(digitada?.metadata?.citacao)
  );
  // O setor volta canonizado ("Tecnico" -> "Técnico", ver setor.helper): citar e
  // rotear sao independentes, e a citacao derivada nao pode atrapalhar a escolha.
  conferir("a escolha continua roteando normalmente", conv.setor === "Técnico", conv.setor);

  // ── E AGORA O TURNO HUMANO, que e onde estava o defeito ─────────────────
  //
  // A escolha acima transferiu para a equipe, e isso grava
  // `aguardando: "humano"` na sessao -- verdadeiro, e nao e pergunta nenhuma.
  // Era exatamente aqui que a citacao congelava na ultima fala do robo.
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
    "a resposta ao ATENDENTE cita a fala dele, nao a do bot",
    aoHumano?.respondendoAId === opaaa.id,
    `respondendoAId=${aoHumano?.respondendoAId} (bot=${doBot?.id}, atendente=${opaaa.id})`
  );
  conferir(
    "e o retrato e o texto do atendente",
    aoHumano?.metadata?.citacao?.texto === "opaaa",
    JSON.stringify(aoHumano?.metadata?.citacao)
  );

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
