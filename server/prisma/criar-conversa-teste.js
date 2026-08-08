// Cria (ou recria) UMA conversa de teste na Central, para visualizar a tela sem
// depender de uma mensagem real chegando pelo WhatsApp. Roda sob demanda
// (npm run db:conversa-teste), nunca no seed. E idempotente: usa um telefone
// marcador; se a conversa de teste ja existir, ela e apagada e recriada limpa.
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const TELEFONE_TESTE = "5527999990000"; // numero claramente ficticio (marcador)

async function main() {
  // Usa a instancia padrao (a mesma que o seed cria). Sem instancia nao ha onde
  // pendurar a conversa.
  const nomeInstancia = process.env.WHATSAPP_INSTANCE || "arka-wapi-oficial";
  const instancia =
    (await prisma.instancia.findUnique({ where: { nome: nomeInstancia } })) ||
    (await prisma.instancia.findFirst());

  if (!instancia) {
    console.error("Nenhuma instancia encontrada. Rode antes: npm run db:seed");
    process.exit(1);
  }

  // Limpa uma execucao anterior (o cascade apaga as mensagens junto).
  await prisma.conversa.deleteMany({
    where: { instanciaId: instancia.id, telefone: TELEFONE_TESTE },
  });

  const agora = Date.now();
  const em = (minAtras) => new Date(agora - minAtras * 60_000);

  const conversa = await prisma.conversa.create({
    data: {
      instanciaId: instancia.id,
      cliente: "Cliente Teste",
      telefone: TELEFONE_TESTE,
      statusAtendimento: "pendente",
      setor: "Geral",
      lido: false,
      naoLidas: 2,
      criadoEm: em(10),
      mensagens: {
        create: [
          {
            origem: "cliente",
            texto: "Olá, boa tarde! Vim pela indicação de um amigo. 😊",
            criadoEm: em(10),
          },
          {
            origem: "bot",
            texto: "[🤖 Arka Tecnologia]: Olá! Seja bem-vindo(a). Um atendente já vai te responder.",
            status: "enviada",
            criadoEm: em(9),
          },
          {
            origem: "cliente",
            texto: "Consigo um orçamento para 3 pontos de câmera?",
            criadoEm: em(2),
          },
        ],
      },
    },
    include: { mensagens: true },
  });

  console.log("Conversa de teste criada:");
  console.log("  id:", conversa.id);
  console.log("  cliente:", conversa.cliente, "| telefone:", conversa.telefone);
  console.log("  status:", conversa.statusAtendimento, "| mensagens:", conversa.mensagens.length);
  console.log("Abra a Central de Atendimento e recarregue (F5) para vê-la na fila.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
