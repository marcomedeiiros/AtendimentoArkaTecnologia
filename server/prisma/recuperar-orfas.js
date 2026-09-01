/**
 * RECUPERA O HISTORICO QUE FICOU ORFAO -- reconstroi a conversa que sumiu.
 *
 * ── O QUE ACONTECEU ─────────────────────────────────────────────────────────
 *
 * Em 31/08/2026 duas conversas desapareceram da tabela `conversas` sem levar os
 * filhos junto. O que sobrou no banco de producao:
 *
 *     26 mensagens (13 de cliente, 13 do bot)
 *      2 atendimentos -- OS 146 e OS 149, setor Tecnico
 *      2 sessoes de chatbot
 *
 * Tudo isso continua gravado e integro. So nao ha mais a linha de `conversas`
 * para a qual essas 30 linhas apontam, e a Central desenha a lista a partir de
 * `conversas` -- entao o atendimento inteiro de dois clientes reais ficou
 * invisivel, sem erro nenhum em tela.
 *
 * ── A ESCOLHA: RECONSTRUIR, E NAO APAGAR ────────────────────────────────────
 *
 * A saida mais curta seria `DELETE` nas linhas orfas e o banco voltaria a
 * passar no `foreign_key_check`. Seria trocar um dado invisivel por um dado
 * destruido -- e o que esta ali e conversa de cliente, com OS aberta.
 *
 * Este script faz o contrario: recria a linha de `conversas` COM O MESMO id,
 * e os 30 registros voltam a se pendurar nela sozinhos. Nada e apagado, nada e
 * inventado. Os campos vem de quem sobreviveu:
 *
 *     telefone, instancia   da sessao de chatbot orfa
 *     setor, status, datas  do atendimento mais recente daquela conversa
 *     nome do cliente       do cadastro de contatos, pelo telefone
 *     numeroTicket          reservado no contador, como uma conversa nova
 *
 * Quando nao ha sessao sobrevivente, o telefone e lido da propria mensagem.
 *
 * ── USO ─────────────────────────────────────────────────────────────────────
 *
 *   node prisma/recuperar-orfas.js                        simula a reconstrucao
 *   node prisma/recuperar-orfas.js --aplicar              reconstroi
 *   node prisma/recuperar-orfas.js --descartar            simula o descarte
 *   node prisma/recuperar-orfas.js --descartar --aplicar  descarta
 *
 * ── QUANDO DESCARTAR EM VEZ DE RECONSTRUIR ──────────────────────────────────
 *
 * Nem todo orfao e historico de cliente. Na producao da Arka, os 30 primeiros
 * eram TRAFEGO DE TESTE: telefones 5500900000001 e 5500000000001, uma conversa
 * roteirizada ("oi", "1", "1", "1") passeando pelo menu, sem contato
 * cadastrado. Reconstruir aquilo teria enfiado duas conversas falsas na
 * Central, com numero de ticket e OS de verdade.
 *
 * Por isso o script MOSTRA antes de agir, e o telefone aparece no relatorio:
 * quem roda decide, olhando, se aquilo e cliente ou residuo. O padrao continua
 * sendo reconstruir -- descartar dado exige pedir.
 *
 * IDEMPOTENTE: rodar de novo nao acha mais orfao e nao faz nada. E seguro
 * rodar em producao com a API no ar -- as escritas sao por conversa, dentro de
 * uma transacao.
 */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient({ log: [] });
const APLICAR = process.argv.includes("--aplicar");
const DESCARTAR = process.argv.includes("--descartar");

async function idsOrfaos() {
  const linhas = await prisma.$queryRawUnsafe(`
    SELECT DISTINCT conversa_id AS id FROM mensagens
      WHERE conversa_id NOT IN (SELECT id FROM conversas)
    UNION
    SELECT DISTINCT conversa_id FROM atendimentos
      WHERE conversa_id NOT IN (SELECT id FROM conversas)
    UNION
    SELECT DISTINCT conversa_id FROM sessoes_chatbot
      WHERE conversa_id NOT IN (SELECT id FROM conversas)
  `);
  return linhas.map((l) => l.id).filter(Boolean);
}

// Tudo que sobrou apontando para uma conversa que nao existe mais.
async function retratoDe(conversaId) {
  const [sessao] = await prisma.$queryRawUnsafe(
    "SELECT instancia_id, telefone, criado_em FROM sessoes_chatbot WHERE conversa_id = ? LIMIT 1",
    conversaId
  );
  const atendimentos = await prisma.$queryRawUnsafe(
    "SELECT id, numero_os, setor, status, atendente_id, atendente_nome, aberto_em, atendido_em, fechado_em FROM atendimentos WHERE conversa_id = ? ORDER BY aberto_em DESC",
    conversaId
  );
  const [msg] = await prisma.$queryRawUnsafe(
    "SELECT count(*) AS n, min(criado_em) AS primeira, max(criado_em) AS ultima FROM mensagens WHERE conversa_id = ?",
    conversaId
  );
  return { sessao, atendimentos, mensagens: msg };
}

async function main() {
  const orfaos = await idsOrfaos();

  if (!orfaos.length) {
    console.log("Nenhuma linha orfa. Nada a recuperar.");
    return;
  }

  console.log(`${orfaos.length} conversa(s) a reconstruir.\n`);

  // Instancia de fallback: quando nao ha sessao, ha uma so instancia no sistema.
  const instancias = await prisma.instancia.findMany({ select: { id: true, nome: true } });

  for (const id of orfaos) {
    const { sessao, atendimentos, mensagens } = await retratoDe(id);
    const atual = atendimentos[0] || null;

    const telefone = sessao?.telefone || null;
    const instanciaId = sessao?.instancia_id || (instancias.length === 1 ? instancias[0].id : null);

    if (!instanciaId) {
      console.log(`  ${id.slice(0, 8)}  PULADA: nao da para deduzir a instancia (ha ${instancias.length} cadastradas).`);
      continue;
    }
    if (!telefone) {
      console.log(`  ${id.slice(0, 8)}  PULADA: sem sessao sobrevivente, telefone desconhecido.`);
      continue;
    }

    const contato = await prisma.contato.findFirst({ where: { telefone }, select: { nome: true } });
    const nome = contato?.nome || `Recuperado ${telefone}`;
    const criadoEm = sessao?.criado_em ? new Date(sessao.criado_em) : new Date(Number(mensagens?.primeira) || Date.now());

    console.log(
      `  ${id.slice(0, 8)}  tel ${telefone}  ${Number(mensagens?.n || 0)} mensagens  ${atendimentos.length} OS  -> ` +
        (DESCARTAR ? "DESCARTAR (apaga tudo desta conversa)" : `"${nome}"`)
    );
    if (atual) console.log(`              OS ${atual.numero_os} (${atual.setor || "sem setor"}, ${atual.status}) vira o atendimento atual`);

    if (DESCARTAR) {
      if (!APLICAR) continue;
      // Ordem: filhos primeiro. Nao ha conversa para cascatear.
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("DELETE FROM mensagens WHERE conversa_id = ?", id);
        await tx.$executeRawUnsafe("DELETE FROM atendimentos WHERE conversa_id = ?", id);
        await tx.$executeRawUnsafe("DELETE FROM sessoes_chatbot WHERE conversa_id = ?", id);
      });
      continue;
    }

    if (!APLICAR) continue;

    await prisma.$transaction(async (tx) => {
      // Reserva o numero de ticket do mesmo contador que numera as conversas
      // novas: assim a conversa recuperada aparece na Central como AK000NN e
      // nao colide com nada ja emitido.
      const contador = await tx.contador.upsert({
        where: { chave: "ticket" },
        create: { chave: "ticket", valor: 1 },
        update: { valor: { increment: 1 } },
      });

      await tx.conversa.create({
        data: {
          id, // O MESMO id: e o que faz as 30 linhas voltarem a se pendurar.
          instanciaId,
          telefone,
          cliente: nome,
          setor: atual?.setor || "Geral",
          statusAtendimento: atual?.status || "fechada",
          ultimoAtendenteNome: atual?.atendente_nome || null,
          atendimentoAtualId: atual?.id || null,
          numeroTicket: contador.valor,
          criadoEm,
          atendidoEm: atual?.atendido_em ? new Date(atual.atendido_em) : null,
          fechadoEm: atual?.fechado_em ? new Date(atual.fechado_em) : null,
        },
      });
    });
  }

  const sobraram = await prisma.$queryRawUnsafe("PRAGMA foreign_key_check");
  console.log(
    APLICAR
      ? `\nAplicado. Linhas orfas restantes: ${sobraram.length}`
      : `\nSimulacao apenas -- nada foi gravado. Rode com --aplicar para valer.`
  );
}

main()
  .catch((e) => {
    console.error("ERRO:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
