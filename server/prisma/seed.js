// Seed ESTRUTURAL apenas: cria o que o sistema precisa para subir (a instancia
// do WhatsApp e o usuario administrador).
//
// Nada de dados de exemplo. Equipe, parceiros, contatos, fluxos e conversas sao
// cadastrados por voce pelo painel -- ou vem do WhatsApp real (a agenda e
// importada da Evolution ao conectar). Antes o seed recriava esses registros a
// cada execucao e eles "voltavam" mesmo depois de apagados na tela.
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  const instanciaNome = process.env.WHATSAPP_INSTANCE || "arka-wapi-oficial";
  const webhookSecret = process.env.WEBHOOK_SECRET || "arka-webhook-secret";

  await prisma.instancia.upsert({
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
    // Sincroniza a senha com o .env: antes era `update: {}`, entao trocar
    // ADMIN_PASSWORD nao surtia efeito nenhum num banco ja existente.
    update: { senhaHash, ativo: true },
    create: {
      nome: process.env.ADMIN_NOME || "Administrador Arka",
      email: adminEmail,
      senhaHash,
      cargo: "Administrador",
    },
  });

  console.log("Seed concluido: instancia e usuario administrador prontos.");
  console.log("Cadastre equipe, parceiros e fluxos pelo painel.");
}

main()
  .catch((error) => {
    console.error("Erro no seed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
