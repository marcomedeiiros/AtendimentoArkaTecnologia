/**
 * TRANSFORMA OS TEMPOS DO BOT EM BLOCOS VISIVEIS no canvas.
 *
 * As duas regras de tempo -- "o cliente sumiu" e "ninguem assumiu na fila" --
 * sempre existiram, mas moravam dentro do `config.configuracoesGlobais` de uma
 * ANOTACAO. Pelo desenho do fluxo, ninguem descobria que o bot fecha a conversa
 * depois de 5 minutos calado: era preciso abrir a anotacao e saber o que
 * procurar. Este script cria um bloco `tipo: "espera"` para cada uma, com os
 * valores que JA estavam valendo naquele fluxo.
 *
 * NAO MUDA COMPORTAMENTO NENHUM. Os valores sao lidos de onde ja estavam, e o
 * motor le o bloco com a mesma precedencia (bloco > configuracoesGlobais >
 * legado > padrao). Um fluxo migrado se comporta exatamente como antes -- a
 * diferenca e que agora da para ver a regra.
 *
 * A anotacao NAO e apagada: ela guarda outras coisas (textos de fallback,
 * welcomeMessage, horario). Os campos de tempo ficam la como estavam, inertes,
 * porque o bloco vence.
 *
 * IDEMPOTENTE: fluxo que ja tem bloco de espera daquele modo e pulado.
 *
 * NAO RODA NO DEPLOY -- passo de dados no entrypoint ja derrubou a API uma vez.
 *
 *   node prisma/migrar-blocos-de-espera.js            # simulacao
 *   node prisma/migrar-blocos-de-espera.js --aplicar  # grava
 *
 * Na VM:
 *   docker exec arka-api node prisma/migrar-blocos-de-espera.js
 *   docker exec arka-api node prisma/migrar-blocos-de-espera.js --aplicar
 */
const { PrismaClient } = require("@prisma/client");
const { PADROES } = require("../src/modules/fluxos/fluxo.automacao");

const prisma = new PrismaClient();
const aplicar = process.argv.includes("--aplicar");

function cfgDe(passo) {
  return typeof passo.config === "string" ? JSON.parse(passo.config || "{}") : passo.config || {};
}

async function main() {
  const fluxos = await prisma.fluxo.findMany({ include: { passos: { orderBy: { ordem: "asc" } } } });
  const criados = [];

  for (const fluxo of fluxos) {
    const jaTem = (modo) =>
      fluxo.passos.some((p) => p.tipo === "espera" && (cfgDe(p).modo || "sem_resposta") === modo);

    // De onde vinham os valores efetivos ate agora.
    const anotacao = fluxo.passos.find((p) => cfgDe(p).configuracoesGlobais);
    const g = anotacao ? cfgDe(anotacao).configuracoesGlobais : {};
    const legado = g.notResponseMessage || {};
    const legadoMin = Number(legado.time);
    const temLegado = Number.isFinite(legadoMin) && legadoMin > 0;

    const sr = g.semResposta || {};
    const fp = g.filaPendentes || {};

    // Posicao: abaixo do bloco mais baixo, para nao cair em cima de nada.
    let y = Math.max(0, ...fluxo.passos.map((p) => (p.posY || 0) + (p.altura || 96))) + 60;
    let ordem = Math.max(0, ...fluxo.passos.map((p) => p.ordem || 0)) + 1;

    const novos = [];
    if (!jaTem("sem_resposta")) {
      novos.push({
        tipo: "espera",
        titulo: "Sem resposta",
        descricao: "O bot perguntou e o cliente sumiu.",
        config: {
          modo: "sem_resposta",
          minutos: Number(sr.minutos) || (temLegado ? Math.round(legadoMin) : PADROES.semResposta.minutos),
          mensagem:
            (typeof sr.mensagem === "string" && sr.mensagem.trim()) ||
            (temLegado && typeof legado.message === "string" && legado.message.trim()) ||
            PADROES.semResposta.mensagem,
          acao:
            sr.acao === "fila" || sr.acao === "encerrar"
              ? sr.acao
              : temLegado && Number(legado.type) !== 3
                ? "fila"
                : PADROES.semResposta.acao,
        },
      });
    }
    if (!jaTem("fila_pendentes")) {
      novos.push({
        tipo: "espera",
        titulo: "Espera na fila",
        descricao: "Ninguem assumiu a conversa em Pendentes.",
        config: {
          modo: "fila_pendentes",
          ativo: fp.ativo !== false,
          minutos: Number(fp.minutos) || PADROES.filaPendentes.minutos,
          mensagem:
            (typeof fp.mensagem === "string" && fp.mensagem.trim()) || PADROES.filaPendentes.mensagem,
          repetir: fp.repetir === true,
        },
      });
    }

    for (const n of novos) {
      criados.push({ fluxo: fluxo.nome, titulo: n.titulo, cfg: n.config });
      if (aplicar) {
        await prisma.passoFluxo.create({
          data: {
            fluxoId: fluxo.id,
            tipo: n.tipo,
            titulo: n.titulo,
            descricao: n.descricao,
            config: n.config,
            // Regra sobre a conversa, nao passo dela: sem fio de entrada nem de
            // saida (o mesmo que a anotacao sempre foi).
            targetId: null,
            posX: 40,
            posY: y,
            largura: 220,
            altura: 96,
            ordem: ordem++,
          },
        });
        y += 130;
      }
    }
  }

  if (!criados.length) {
    console.log("[arka] nada a fazer: os fluxos ja tem os blocos de espera.");
    return;
  }

  console.log(`[arka] ${criados.length} bloco(s) a criar:`);
  for (const c of criados) {
    const d = c.cfg;
    const detalhe =
      d.modo === "sem_resposta"
        ? `${d.minutos} min -> ${d.acao}`
        : `${d.ativo ? `${d.minutos} min` : "desligado"}${d.repetir ? ", repete" : ""}`;
    console.log(`   [${c.fluxo}] ${c.titulo}: ${detalhe}`);
  }
  console.log(
    aplicar
      ? "\n[arka] criados. Os valores sao os que JA estavam valendo -- nada mudou de comportamento."
      : "\n[arka] SIMULACAO -- nada foi gravado. Rode com --aplicar para efetivar."
  );
}

main()
  .catch((e) => {
    console.error("[arka] migracao dos blocos de espera FALHOU:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
