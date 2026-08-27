/**
 * LIMPEZA UNICA do setor que foi ADIVINHADO, e nao escolhido.
 *
 * Ate 2026-08-27 o sistema deduzia o setor por palavra-chave ("boleto" ->
 * Financeiro, "nao funciona" -> Tecnico) em tres lugares, e o antigo
 * `preencherSetor()` do backfill gravava esse palpite no historico -- a cada
 * subida do container, nao uma vez so. O resultado: conversas carimbadas
 * "Tecnico" sem o cliente ter escolhido nada no menu.
 *
 * A regra agora e outra: setor so existe por escolha do cliente (ver
 * setor.helper.resolverSetorDeclarado). Este script apaga o passivo.
 *
 * CONSERVADOR DE PROPOSITO -- so mexe em ciclo AINDA PENDENTE:
 *   - a OS atual esta "pendente" (ninguem assumiu);
 *   - e ninguem esta como atendente.
 * Atendimento em curso ou ja fechado NAO e tocado: ali o setor pode ter sido
 * definido a mao por um atendente, e reescrever isso seria trocar um palpite
 * por outro. Mensagem, CNPJ, empresa e historico nao sao tocados em hipotese
 * alguma -- este script so escreve na coluna `setor`.
 *
 * NAO RODA NO DEPLOY. Foi justamente um passo automatico no entrypoint que
 * criou o problema. Rode a mao, uma vez:
 *
 *   node prisma/limpar-setor-adivinhado.js            # simulacao (nao grava)
 *   node prisma/limpar-setor-adivinhado.js --aplicar  # grava
 *
 * Na VM (dentro do container da API):
 *   docker exec arka-api node prisma/limpar-setor-adivinhado.js
 *   docker exec arka-api node prisma/limpar-setor-adivinhado.js --aplicar
 */
const { PrismaClient } = require("@prisma/client");
const { SETOR_PADRAO } = require("../src/shared/helpers/setor.helper");

const prisma = new PrismaClient();
const aplicar = process.argv.includes("--aplicar");

async function main() {
  const candidatas = await prisma.conversa.findMany({
    where: {
      atendenteId: null,
      setor: { not: SETOR_PADRAO },
    },
    select: {
      id: true,
      cliente: true,
      telefone: true,
      setor: true,
      atendimentoAtualId: true,
      statusAtendimento: true,
    },
  });

  const alvos = [];
  for (const c of candidatas) {
    if (c.statusAtendimento !== "pendente") continue;
    // A OS atual precisa estar pendente tambem: e o que garante que este ciclo
    // ainda nao foi triado por gente.
    if (c.atendimentoAtualId) {
      const os = await prisma.atendimento.findUnique({
        where: { id: c.atendimentoAtualId },
        select: { status: true, atendenteId: true },
      });
      if (!os || os.status !== "pendente" || os.atendenteId) continue;
    }
    alvos.push(c);
  }

  if (!alvos.length) {
    console.log("[arka] nada a limpar: nenhuma conversa pendente com setor carimbado.");
    return;
  }

  console.log(`[arka] ${alvos.length} conversa(s) pendente(s) com setor sem escolha do cliente:`);
  for (const c of alvos) {
    console.log(`   ${c.telefone}  ${(c.cliente || "").slice(0, 28).padEnd(28)}  ${c.setor} -> ${SETOR_PADRAO}`);
  }

  if (!aplicar) {
    console.log("\n[arka] SIMULACAO -- nada foi gravado. Rode com --aplicar para efetivar.");
    return;
  }

  for (const c of alvos) {
    await prisma.conversa.update({
      where: { id: c.id },
      // `versao` incrementa para a Central aceitar a mudanca sem F5 (o front
      // descarta versao menor ou igual a que ja tem em tela).
      data: { setor: SETOR_PADRAO, versao: { increment: 1 } },
    });
    if (c.atendimentoAtualId) {
      await prisma.atendimento.update({
        where: { id: c.atendimentoAtualId },
        data: { setor: SETOR_PADRAO },
      });
    }
  }
  console.log(`\n[arka] ${alvos.length} conversa(s) e OS voltaram para "${SETOR_PADRAO}" (sem setor).`);
}

main()
  .catch((e) => {
    console.error("[arka] limpeza de setor FALHOU:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
