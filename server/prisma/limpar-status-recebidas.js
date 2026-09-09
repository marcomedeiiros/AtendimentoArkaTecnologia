// Limpeza unica: apaga o `status` (o risquinho) das mensagens RECEBIDAS.
//
// O ACK do WhatsApp casava a mensagem so pelo `waMessageId`, e mensagem recebida
// tambem guarda o dela -- entao "entregue"/"lida" acabava gravado na bolha do
// CLIENTE. A tela nunca chegou a mostrar isso de forma estavel (o mapper anula o
// status de quem tem `origem: "cliente"`), mas a coluna ficou suja, e qualquer
// leitura que nao passe pelo mapper -- relatorio, exportacao, consulta futura --
// veria a mentira.
//
// A gravacao errada ja nao acontece mais (guardas em `_processarAck` e em
// `atualizarStatusPorWaId`). Isto so varre o que ficou para tras.
//
// Idempotente: rodar de novo nao altera nada.
// Uso: node prisma/limpar-status-recebidas.js
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const { count } = await prisma.mensagem.updateMany({
    where: { origem: "cliente", status: { not: null } },
    data: { status: null },
  });
  console.log(
    count === 0
      ? "Nada a limpar: nenhuma mensagem recebida com risquinho."
      : `Risquinho removido de ${count} mensagem(ns) recebida(s).`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
