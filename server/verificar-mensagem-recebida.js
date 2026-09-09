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
