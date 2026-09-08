/**
 * SESSOES DE CHATBOT ORFAS -- as que ficaram vivas depois do ciclo fechar.
 *
 * ── O QUE ACONTECEU ─────────────────────────────────────────────────────────
 *
 * `conversa.service:atualizarStatus` -- o fechamento feito por um ATENDENTE pela
 * Central -- nunca tocava em `sessaoChatbot`. (O fechamento feito pelo BOT
 * sempre desligou: ver chatbot.engine:fecharConversa.) Entao cada atendimento
 * encerrado na Central deixava para tras uma sessao `ativo: true` apontando para
 * uma conversa `fechada`.
 *
 * Medido em producao antes do conserto: 11 sessoes ativas, TODAS com a conversa
 * em `fechada`.
 *
 * O preco era pago pelo cliente no proximo contato dele. A mensagem abria um
 * ciclo novo -- OS emitida, conversa de volta em `pendente` -- e em seguida batia
 * na sessao morta do ciclo anterior:
 *
 *   - sessao em `humano`  -> silencio por ate 240 min (o TTL humano);
 *   - sessao em `opcao`   -> o bot retomava um passo de um chamado ja encerrado.
 *
 * Em nenhum dos dois a triagem rodava, e a OS chegava na fila sem setor, sem
 * CNPJ e sem descricao. Passado o TTL o mesmo cliente voltava a ser atendido
 * normalmente, o que fazia a falha parecer intermitente e sem causa.
 *
 * ── POR QUE ESTE SCRIPT EXISTE, SE O BUG JA FOI CORRIGIDO ───────────────────
 *
 * O conserto tem duas partes -- o fechamento passou a desligar a sessao, e o
 * motor passou a ignorar sessao orfa quando o ciclo reabre -- e nenhuma das duas
 * limpa o que JA ESTA GRAVADO. As sessoes orfas dentro do TTL continuariam
 * engolindo mensagem depois do deploy, ate envelhecerem sozinhas.
 *
 * Rodar isto e OPCIONAL depois do deploy (o guard do motor cobre o caso), e e o
 * que devolve o atendimento normal aos clientes afetados imediatamente.
 *
 * ── SEGURANCA ───────────────────────────────────────────────────────────────
 *
 * So mexe em sessao cuja conversa esta `fechada`. Sessao de conversa `pendente`
 * ou `aberta` e legitima -- alguem pode estar no meio de um menu agora -- e nao
 * e tocada.
 *
 * A pesquisa de satisfacao em curso e PRESERVADA (`avaliacao_nota` /
 * `avaliacao_comentario`): ela roda de proposito sobre uma conversa fechada, e
 * a nota do cliente ainda tem para onde ir. Sem esta excecao o script apagaria a
 * pesquisa de quem esta respondendo neste minuto.
 *
 * Uso:
 *   node corrigir-sessoes-orfas.js           # so mostra o que faria
 *   node corrigir-sessoes-orfas.js --aplicar # aplica
 *
 * No container:
 *   docker exec arka-api node /app/corrigir-sessoes-orfas.js
 *   docker exec arka-api node /app/corrigir-sessoes-orfas.js --aplicar
 */

const prisma = require("./src/infrastructure/database/prisma.client");

// A pesquisa roda sobre conversa fechada de proposito. Ver o cabecalho.
const DA_PESQUISA = ["avaliacao_nota", "avaliacao_comentario"];

// Os mesmos TTLs do motor (chatbot.config): so para o relatorio dizer quais
// estavam de fato engolindo mensagem, e quais o TTL ja cobria.
const TTL_MIN = { humano: Number(process.env.CHATBOT_HUMANO_TTL_MIN) || 240 };
const TTL_PADRAO_MIN = Number(process.env.CHATBOT_SESSAO_TTL_MIN) || 30;

async function main() {
  const aplicar = process.argv.includes("--aplicar");

  const sessoes = await prisma.sessaoChatbot.findMany({
    where: { ativo: true },
    select: {
      id: true,
      telefone: true,
      aguardando: true,
      atualizadoEm: true,
      conversa: { select: { id: true, statusAtendimento: true } },
    },
  });

  const agora = Date.now();
  const orfas = [];
  const preservadas = [];

  for (const s of sessoes) {
    // Sessao sem conversa nao deveria existir (`conversaId` e obrigatorio e
    // unico), mas se existir ela tambem nao tem ciclo para conduzir.
    const status = s.conversa?.statusAtendimento ?? "(sem conversa)";
    if (s.conversa && status !== "fechada") {
      preservadas.push({ s, status, razao: "ciclo em curso" });
      continue;
    }
    if (DA_PESQUISA.includes(s.aguardando)) {
      preservadas.push({ s, status, razao: "pesquisa de satisfacao em curso" });
      continue;
    }
    orfas.push({ s, status });
  }

  console.log(`Sessoes ativas: ${sessoes.length}`);
  console.log(`  orfas (conversa fechada, sem pesquisa): ${orfas.length}`);
  console.log(`  preservadas: ${preservadas.length}\n`);

  if (preservadas.length) {
    console.log("PRESERVADAS (nao serao tocadas):");
    for (const { s, status, razao } of preservadas) {
      console.log(
        `  ...${s.telefone.slice(-4)}  aguardando=${s.aguardando}  conversa=${status}  -> ${razao}`
      );
    }
    console.log("");
  }

  if (!orfas.length) {
    console.log("Nada a fazer.");
    return;
  }

  console.log("ORFAS:");
  for (const { s, status } of orfas) {
    const idadeMin = Math.round((agora - new Date(s.atualizadoEm)) / 60000);
    const ttl = TTL_MIN[s.aguardando] ?? TTL_PADRAO_MIN;
    // "ENGOLINDO": dentro do TTL, entao a sessao ainda esta ativa de verdade e a
    // proxima mensagem deste cliente nao acionaria o bot. Fora do TTL o motor ja
    // a descartaria sozinho -- limpar e so higiene.
    const efeito = idadeMin > ttl ? "ja expirada (higiene)" : ">>> ENGOLINDO MENSAGEM";
    console.log(
      `  ...${s.telefone.slice(-4)}  aguardando=${s.aguardando}  idade=${idadeMin}min  ttl=${ttl}min  conversa=${status}  ${efeito}`
    );
  }
  console.log("");

  if (!aplicar) {
    console.log("Simulacao. Rode com --aplicar para desligar estas sessoes.");
    return;
  }

  const { count } = await prisma.sessaoChatbot.updateMany({
    where: { id: { in: orfas.map((o) => o.s.id) } },
    data: {
      ativo: false,
      aguardando: null,
      fluxoAtualId: null,
      passoAtualId: null,
      aguardandoDesde: null,
      inatividadeEm: null,
      contexto: {},
    },
  });

  console.log(`${count} sessao(oes) desligada(s).`);
  console.log(
    "Os clientes afetados voltam a receber a triagem completa na proxima mensagem."
  );
}

main()
  .catch((e) => {
    console.error("Falhou:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
