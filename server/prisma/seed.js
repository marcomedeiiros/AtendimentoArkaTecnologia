const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

const SEED_EQUIPE = [
  { nome: "Marina Souza", cargo: "Atendimento Especializado", status: "online" },
  { nome: "Diego Alves", cargo: "Suporte Tecnico N2", status: "offline" },
  { nome: "Bruna Lima", cargo: "Gerente Comercial", status: "online" },
];

const SEED_PARCEIROS = [
  { cnpj: "11222333000181", razaoSocial: "Empresa Exemplo LTDA", status: "ativo" },
  { cnpj: "00000000000191", razaoSocial: "Banco do Brasil SA", status: "ativo" },
];

const SEED_CONTATOS = [
  { nome: "Joao Pereira", telefone: "11987654321", email: "joao@email.com", tag: "cliente" },
  { nome: "Ricardo Nunes", telefone: "21991238877", tag: "cliente" },
  {
    nome: "Beatriz Santos",
    telefone: "31988771122",
    email: "beatriz@ex.com",
    empresa: "Empresa Exemplo LTDA",
    tag: "parceiro",
    favorito: true,
    observacoes: "Renovacao contratual em andamento.",
  },
];

// `descricao` = anotacao interna que aparece no editor de fluxos.
// `texto`     = o que o cliente recebe no WhatsApp.
// Sem `texto`, o bot acabava enviando a anotacao interna para o cliente.
async function seedFluxos() {
  const existente = await prisma.fluxo.findFirst();
  if (existente) return;

  const fluxo1 = await prisma.fluxo.create({
    data: {
      nome: "Fluxo 1: Atendimento de Orcamentos",
      gatilho: "orcamento, orcar, proposta",
      ativo: true,
      passos: {
        create: [
          { tipo: "gatilho", titulo: "Gatilho Recebido", descricao: 'Cliente digita "orcamento"', ordem: 0 },
          {
            tipo: "mensagem",
            titulo: "Perguntar CNPJ",
            descricao: "Solicita o CNPJ para consulta de cadastro",
            texto: "Claro, posso te ajudar com o orcamento! Para consultar seu cadastro, me informe o CNPJ da sua empresa (14 digitos).",
            config: { aguardar: "cnpj" },
            ordem: 1,
          },
          {
            tipo: "condicao",
            titulo: "Validar CNPJ do Cliente",
            descricao: "Verifica se possui contrato de parceiro ativo",
            texto: "Preciso de um CNPJ valido para consultar seu cadastro. Pode conferir e enviar de novo?",
            ordem: 2,
          },
          {
            tipo: "mensagem",
            titulo: "Resposta Inicial Bot",
            descricao: "Confirma que o orcamento esta sendo preparado",
            texto: "Perfeito! Ja estou preparando seu orcamento.",
            ordem: 3,
          },
          { tipo: "delay", titulo: "Aguardar 1.5s", descricao: "Simula digitacao humana", config: { ms: 1500 }, ordem: 4 },
          {
            tipo: "acao",
            titulo: "Desconto Automatico",
            descricao: "Se for parceiro -> aplica 15% de desconto automatico na proposta",
            config: { acao: "desconto_parceiro", percentual: 15 },
            ordem: 5,
          },
        ],
      },
    },
    include: { passos: true },
  });

  const passos1 = fluxo1.passos.sort((a, b) => a.ordem - b.ordem);
  for (let i = 0; i < passos1.length - 1; i++) {
    await prisma.passoFluxo.update({
      where: { id: passos1[i].id },
      data: { targetId: passos1[i + 1].id },
    });
  }

  const fluxo2 = await prisma.fluxo.create({
    data: {
      nome: "Fluxo 2: Reenvio de 2a Via de Boleto",
      gatilho: "boleto, 2a via, segunda via",
      ativo: true,
      passos: {
        create: [
          { tipo: "gatilho", titulo: "Gatilho Recebido", descricao: 'Cliente digita "boleto"', ordem: 0 },
          {
            tipo: "mensagem",
            titulo: "Solicitar CNPJ",
            descricao: "Pede o CNPJ para consultar titulos em aberto",
            texto: "Vou buscar a 2a via para voce. Me informe o CNPJ da empresa (14 digitos).",
            config: { aguardar: "cnpj" },
            ordem: 1,
          },
          { tipo: "delay", titulo: "Aguardar 2.0s", descricao: "Consulta no sistema ERP Arka", config: { ms: 2000 }, ordem: 2 },
          {
            tipo: "acao",
            titulo: "Gerar Linha Digitavel",
            descricao: "Envia codigo Pix / linha digitavel atualizada",
            config: { acao: "gerar_boleto" },
            ordem: 3,
          },
        ],
      },
    },
    include: { passos: true },
  });

  const passos2 = fluxo2.passos.sort((a, b) => a.ordem - b.ordem);
  for (let i = 0; i < passos2.length - 1; i++) {
    await prisma.passoFluxo.update({
      where: { id: passos2[i].id },
      data: { targetId: passos2[i + 1].id },
    });
  }

  await prisma.fluxo.create({
    data: {
      nome: "Fluxo 3: Consulta de Horario de Suporte",
      gatilho: "horario, funcionamento, expediente",
      ativo: true,
      passos: {
        create: [
          { tipo: "gatilho", titulo: "Gatilho Recebido", descricao: 'Cliente digita "horario"', ordem: 0 },
          {
            tipo: "mensagem",
            titulo: "Informa Horario",
            descricao: "Responde o horario de atendimento",
            texto: "Nosso atendimento funciona de segunda a sexta, das 8h as 18h.",
            ordem: 1,
          },
        ],
      },
    },
  });
}

// Bancos criados antes da separacao texto/descricao ficaram com os passos sem
// `texto`, e o bot acabava mandando a anotacao interna para o cliente. Aqui so
// preenchemos o que ainda esta vazio -- textos editados pelo usuario ficam intactos.
const TEXTOS_PADRAO = {
  "Perguntar CNPJ": {
    texto: "Claro, posso te ajudar com o orcamento! Para consultar seu cadastro, me informe o CNPJ da sua empresa (14 digitos).",
    config: { aguardar: "cnpj" },
  },
  "Validar CNPJ do Cliente": {
    texto: "Preciso de um CNPJ valido para consultar seu cadastro. Pode conferir e enviar de novo?",
  },
  "Resposta Inicial Bot": {
    texto: "Perfeito! Ja estou preparando seu orcamento.",
  },
  "Solicitar CNPJ": {
    texto: "Vou buscar a 2a via para voce. Me informe o CNPJ da empresa (14 digitos).",
    config: { aguardar: "cnpj" },
  },
  "Informa Horario": {
    texto: "Nosso atendimento funciona de segunda a sexta, das 8h as 18h.",
  },
};

async function backfillTextosFluxos() {
  const passos = await prisma.passoFluxo.findMany({
    where: { texto: null, titulo: { in: Object.keys(TEXTOS_PADRAO) } },
  });

  for (const passo of passos) {
    const padrao = TEXTOS_PADRAO[passo.titulo];
    await prisma.passoFluxo.update({
      where: { id: passo.id },
      data: {
        texto: padrao.texto,
        config: padrao.config ? { ...(passo.config || {}), ...padrao.config } : passo.config,
      },
    });
  }

  if (passos.length) {
    console.log(`Backfill: ${passos.length} passo(s) receberam o texto de cliente.`);
  }
}

async function main() {
  const instanciaNome = process.env.WHATSAPP_INSTANCE || "arka-wapi-oficial";
  const webhookSecret = process.env.WEBHOOK_SECRET || "arka-webhook-secret";

  const instancia = await prisma.instancia.upsert({
    where: { nome: instanciaNome },
    update: {},
    create: {
      nome: instanciaNome,
      conectado: false,
      webhookSecret,
    },
  });

  const adminEmail = process.env.ADMIN_EMAIL || "admin@arkatecnologia.com.br";
  const adminPassword = process.env.ADMIN_PASSWORD || "Admin@123";
  const senhaHash = await bcrypt.hash(adminPassword, 10);

  await prisma.usuario.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      nome: process.env.ADMIN_NOME || "Administrador Arka",
      email: adminEmail,
      senhaHash,
      cargo: "Administrador",
    },
  });

  for (const membro of SEED_EQUIPE) {
    const existente = await prisma.equipe.findFirst({ where: { nome: membro.nome } });
    if (!existente) {
      await prisma.equipe.create({ data: membro });
    }
  }

  for (const parceiro of SEED_PARCEIROS) {
    await prisma.parceiro.upsert({
      where: { cnpj: parceiro.cnpj },
      update: {},
      create: parceiro,
    });
  }

  for (const contato of SEED_CONTATOS) {
    const existente = await prisma.contato.findFirst({ where: { telefone: contato.telefone } });
    if (!existente) {
      await prisma.contato.create({ data: contato });
    }
  }

  await seedFluxos();
  await backfillTextosFluxos();

  const conversaExistente = await prisma.conversa.findFirst({ where: { instanciaId: instancia.id } });
  if (!conversaExistente) {
    await prisma.conversa.create({
      data: {
        instanciaId: instancia.id,
        cliente: "Joao Pereira",
        telefone: "5511987654321",
        statusAtendimento: "pendente",
        lido: false,
        mensagens: {
          create: [
            {
              origem: "cliente",
              texto: "Oi, boa tarde! Gostaria de um orcamento para a minha empresa.",
            },
          ],
        },
      },
    });
  }

  console.log("Seed concluido com sucesso.");
}

main()
  .catch((error) => {
    console.error("Erro no seed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
