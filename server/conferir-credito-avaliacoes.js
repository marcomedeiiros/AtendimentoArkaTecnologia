/**
 * DE QUEM SÃO AS NOTAS QUE JÁ ESTÃO NO BANCO -- e quais ficaram sem dono.
 *
 * ── POR QUE ISTO EXISTE ─────────────────────────────────────────────────────
 *
 * Até 10/09/2026, atender respondendo (o gesto comum) gravava o atendente só na
 * CONVERSA, e não na OS. A tela de Feedbacks preenchia o vazio com o
 * `ultimoAtendenteNome` da conversa -- que muda quando outra pessoa abre o mesmo
 * fio depois --, e o ranking da sede lia a OS como atendimento do bot: aquela
 * nota não pontuava para ninguém.
 *
 * O conserto vale daqui para frente. As notas JÁ gravadas continuam como estão,
 * e este script existe para você olhar o que sobrou, caso a caso.
 *
 * ── NÃO CORRIGE NADA, DE PROPÓSITO ──────────────────────────────────────────
 *
 * O preenchimento em massa é tentador e está errado: a única fonte disponível
 * para adivinhar o autor é o `ultimoAtendenteNome` da conversa, que é
 * exatamente o dado contaminado nos casos reabertos -- sairia reproduzindo o
 * erro, agora gravado em pedra. E cada linha corrigida MOVE PONTOS no ranking
 * do mês (tudo é recalculado a cada consulta), o que pode mudar uma premiação
 * já registrada.
 *
 * Então aqui se olha, e a correção é decidida por pessoa. `--detalhe` lista OS
 * por OS, com a OS, a data, a nota e o que se sabe.
 *
 * Uso:  node conferir-credito-avaliacoes.js [--detalhe] [--meses=3]
 */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient({ log: [] });

const args = process.argv.slice(2);
const detalhe = args.includes("--detalhe");
const meses = Number((args.find((a) => a.startsWith("--meses=")) || "").split("=")[1]) || 6;

const iso = (d) => (d ? new Date(d).toLocaleString("pt-BR") : "-");
const os = (n) => (n != null ? `OS${String(n).padStart(5, "0")}` : "OS?");

async function main() {
  const desde = new Date();
  desde.setMonth(desde.getMonth() - meses);

  const avaliadas = await prisma.atendimento.findMany({
    where: { avaliacao: { not: null }, abertoEm: { gte: desde } },
    select: {
      numeroOS: true,
      avaliacao: true,
      atendenteNome: true,
      atendidoEm: true,
      fechadoEm: true,
      abertoEm: true,
      status: true,
      conversa: { select: { cliente: true, empresa: true, ultimoAtendenteNome: true } },
    },
    orderBy: { abertoEm: "desc" },
  });

  console.log(`[arka] ${avaliadas.length} avaliacao(oes) nos ultimos ${meses} meses\n`);
  if (!avaliadas.length) return;

  // TRES ESTADOS, e cada um pede uma acao diferente.
  const semDono = [];      // OS sem atendente: a nota nao pontua para ninguem
  const divergentes = [];  // OS tem dono, e a conversa aponta outro nome
  const certas = [];

  for (const a of avaliadas) {
    const naOS = a.atendenteNome || null;
    const naConversa = a.conversa?.ultimoAtendenteNome || null;
    if (!naOS) semDono.push({ ...a, naConversa });
    else if (naConversa && naConversa !== naOS) divergentes.push({ ...a, naOS, naConversa });
    else certas.push(a);
  }

  console.log(`  ${certas.length} com atendente registrado na propria OS (nada a fazer)`);
  console.log(`  ${semDono.length} SEM atendente na OS`);
  console.log(`  ${divergentes.length} em que a OS e a conversa apontam pessoas DIFERENTES\n`);

  if (semDono.length) {
    console.log("── SEM ATENDENTE NA OS ─────────────────────────────────────────");
    console.log("Estas notas NAO pontuam para ninguem no ranking (a OS e lida como");
    console.log("atendimento do bot). Quando ha `atendidoEm`, alguem atendeu -- o nome");
    console.log("e que nao ficou. A coluna 'palpite' e o ultimo atendente da CONVERSA:");
    console.log("use como pista, nao como verdade (e o dado que muda quando outra");
    console.log("pessoa abre o fio depois).\n");
    const humanas = semDono.filter((a) => a.atendidoEm);
    const doBot = semDono.length - humanas.length;
    console.log(`  ${humanas.length} com marca de atendimento humano (vale investigar)`);
    console.log(`  ${doBot} sem atendimento humano -- provavelmente resolvidas pelo bot\n`);
    if (detalhe) {
      for (const a of humanas) {
        console.log(
          `  ${os(a.numeroOS)}  nota ${a.avaliacao}  ${iso(a.fechadoEm || a.abertoEm)}  ` +
            `${a.conversa?.empresa || a.conversa?.cliente || "-"}  palpite: ${a.naConversa || "-"}`
        );
      }
      console.log("");
    }
  }

  if (divergentes.length) {
    console.log("── OS E CONVERSA DISCORDAM ─────────────────────────────────────");
    console.log("A OS tem um nome e a conversa tem outro. Depois do conserto, a tela e");
    console.log("o ranking usam o da OS -- que e o certo: e quem fez o trabalho que o");
    console.log("cliente avaliou. Esta lista existe para conferir se alguma linha antiga");
    console.log("foi sobrescrita antes do conserto.\n");
    if (detalhe) {
      for (const a of divergentes) {
        console.log(
          `  ${os(a.numeroOS)}  nota ${a.avaliacao}  ${iso(a.fechadoEm || a.abertoEm)}  ` +
            `OS: ${a.naOS}   conversa: ${a.naConversa}`
        );
      }
      console.log("");
    }
  }

  if (!detalhe && (semDono.length || divergentes.length)) {
    console.log("Para ver linha por linha:  node conferir-credito-avaliacoes.js --detalhe");
  }
}

main()
  .catch((e) => {
    console.error("[arka] nao foi possivel conferir:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
