/**
 * INTEGRIDADE REFERENCIAL DO BANCO -- roda no fim do entrypoint, a cada subida.
 *
 * ── POR QUE ISTO EXISTE ─────────────────────────────────────────────────────
 *
 * Em 31/08/2026 duas conversas de clientes reais desapareceram da Central e
 * ninguem soube. O que sobrou no banco foram 30 linhas apontando para elas: 26
 * mensagens, 2 atendimentos (OS 146 e 149, do setor Tecnico) e 2 sessoes de
 * chatbot. O historico continuava gravado; so nao havia mais conversa para
 * exibi-lo, entao a Central simplesmente nao mostrava nada.
 *
 * O defeito ficou 32 horas invisivel. Nao houve erro no log, nao houve alerta,
 * nao houve tela quebrada -- a unica forma de descobrir foi rodar
 * `PRAGMA foreign_key_check` a mao, durante uma auditoria. Um dado de cliente
 * que some sem barulho e o pior tipo de defeito: quando alguem nota, ja e
 * tarde para saber o que aconteceu.
 *
 * O SQLite so aponta essas linhas quando perguntado. Perguntar custa
 * milissegundos e transforma "ninguem sabe" em uma linha gritante no log da
 * subida do container.
 *
 * ── NAO E FATAL, DE PROPOSITO ───────────────────────────────────────────────
 *
 * Orfao nao impede a API de atender: as outras conversas funcionam, e derrubar
 * o sistema por causa de historico solto trocaria um problema silencioso por
 * uma indisponibilidade barulhenta. O script SEMPRE sai com 0; quem chama
 * decide o que fazer com o texto.
 *
 * Uso:  node prisma/checar-integridade.js
 */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient({ log: [] });

async function main() {
  const violacoes = await prisma.$queryRawUnsafe("PRAGMA foreign_key_check");

  if (!violacoes.length) {
    console.log("[arka] integridade referencial: OK (nenhuma linha orfa)");
    return;
  }

  // Agrupa por tabela + pai: a lista crua traz uma linha por registro, e 26
  // mensagens orfas viravam 26 linhas iguais no log.
  const porGrupo = new Map();
  for (const v of violacoes) {
    const chave = `${v.table} -> ${v.parent}`;
    porGrupo.set(chave, (porGrupo.get(chave) || 0) + 1);
  }

  console.error("[arka] ================================================================");
  console.error("[arka] ATENCAO: o banco tem linhas orfas (integridade referencial).");
  console.error("[arka]");
  for (const [grupo, n] of porGrupo) {
    console.error(`[arka]   ${n} linha(s) em ${grupo}`);
  }
  console.error("[arka]");
  console.error("[arka] Isso significa historico gravado que a tela nao consegue mostrar.");
  console.error("[arka] Nada foi corrigido automaticamente -- apagar seria perder o dado.");
  console.error("[arka] Para inspecionar:  node prisma/checar-integridade.js --detalhe");
  console.error("[arka] ================================================================");

  if (process.argv.includes("--detalhe")) {
    console.error("\nlinhas (tabela, rowid, pai):");
    for (const v of violacoes) {
      console.error(`  ${v.table}\trowid=${v.rowid}\t-> ${v.parent}`);
    }
  }
}

main()
  .catch((e) => {
    // Falhar aqui nao pode custar a subida da API: este passo so OBSERVA.
    console.error("[arka] nao foi possivel conferir a integridade:", e.message);
  })
  .finally(() => prisma.$disconnect());
