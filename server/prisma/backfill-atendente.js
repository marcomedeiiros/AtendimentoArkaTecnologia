/**
 * Backfill do histórico de atendente (`ultimoAtendenteNome`).
 *
 * O campo é novo, então conversas antigas ficaram sem ele -- e a coluna
 * "Atendente" das Avaliações aparece como "-". Este script recupera o nome a
 * partir do que já está gravado na conversa:
 *
 *   1. O responsável atual (`atendenteId`), quando ainda existe.
 *   2. As mensagens de SISTEMA, que registram quem agiu:
 *        "Fulano fechou o atendimento"
 *        "Fulano devolveu a conversa para a fila (Pendente)"
 *        "Conversa transferida para Fulano"
 *      Usamos a mais RECENTE -- é quem de fato conduziu o atendimento.
 *
 * Só preenche onde está vazio: nunca sobrescreve dado já gravado. Rodar mais de
 * uma vez é seguro (idempotente).
 *
 * Uso (na pasta server):
 *   node prisma/backfill-atendente.js           -> mostra o que faria (simulação)
 *   node prisma/backfill-atendente.js --aplicar -> grava de verdade
 */
const prisma = require("../src/infrastructure/database/prisma.client");

const APLICAR = process.argv.includes("--aplicar");

// Da mensagem de sistema para o nome de quem agiu.
const PADROES = [
  /^Conversa transferida para (.+)$/i,
  /^(.+?) fechou o atendimento$/i,
  /^(.+?) devolveu a conversa para a fila/i,
  /^(.+?) assumiu o atendimento$/i,
  /^(.+?) reabriu o atendimento$/i,
];

function nomeDaMensagem(texto) {
  const limpo = String(texto || "").trim();
  for (const re of PADROES) {
    const m = limpo.match(re);
    if (m && m[1]) {
      const nome = m[1].trim();
      // Nome plausível: evita capturar frases longas por engano.
      if (nome && nome.length <= 80) return nome;
    }
  }
  return null;
}

async function main() {
  const conversas = await prisma.conversa.findMany({
    where: { ultimoAtendenteNome: null },
    include: {
      atendente: { select: { nome: true } },
      mensagens: {
        where: { origem: "sistema" },
        orderBy: { criadoEm: "desc" },
        select: { texto: true },
      },
    },
  });

  console.log(`Conversas sem historico de atendente: ${conversas.length}`);
  if (!conversas.length) return;

  let encontrados = 0;
  for (const c of conversas) {
    // 1) responsável atual; 2) mensagem de sistema mais recente que revele o nome
    let nome = c.atendente?.nome || null;
    if (!nome) {
      for (const msg of c.mensagens) {
        nome = nomeDaMensagem(msg.texto);
        if (nome) break;
      }
    }
    if (!nome) continue;

    encontrados += 1;
    console.log(`  ${APLICAR ? "gravando" : "encontrado"}: ${c.cliente || c.telefone} -> ${nome}`);
    if (APLICAR) {
      await prisma.conversa.update({ where: { id: c.id }, data: { ultimoAtendenteNome: nome } });
    }
  }

  console.log(
    `\n${encontrados} conversa(s) com atendente identificado; ${conversas.length - encontrados} sem rastro (seguem com "-").`
  );
  if (!APLICAR) console.log('Simulação. Rode de novo com --aplicar para gravar.');
}

main()
  .catch((e) => {
    console.error("Falhou:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
