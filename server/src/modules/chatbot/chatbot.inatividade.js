// Varredor de sessoes paradas -- O RELOGIO DA AUTOMACAO.
//
// O motor do chatbot so acorda quando chega mensagem do cliente, e boa parte do
// fluxo depende exatamente do contrario: da AUSENCIA de mensagem. Sem alguem
// olhando o relogio, nada disso dispararia.
//
// Duas coisas passam por aqui:
//
//   1. CLIENTE NAO RESPONDEU AO BOT -- o bot fez uma pergunta obrigatoria (CNPJ,
//      opcao do menu) e o cliente sumiu (`semResposta`, 5 min por padrao);
//   2. ESPERA PELA AVALIACAO -- os minutos entre perguntar a nota e desistir dela;
//   3. ESPERA NA FILA DE PENDENTES -- ninguem assumiu a conversa (`filaPendentes`,
//      10 min por padrao). NAO se confunde com o item 1: aqui nao ha pergunta
//      nenhuma pendente, o cliente esta esperando um atendente.
//
// Por que aqui e nao no navegador: o prazo tem de correr com a aba fechada, com
// o operador deslogado e atravessando restart do servidor. Um `setTimeout` no
// front (ou um timer por sessao aqui dentro) morreria em qualquer uma dessas
// situacoes e deixaria a avaliacao pendente para sempre. O estado esta todo no
// banco; esta varredura so le o relogio.
const prisma = require("../../infrastructure/database/prisma.client");
const conversaRepository = require("../../infrastructure/repositories/conversa.repository");
const instanciaRepository = require("../../infrastructure/repositories/instancia.repository");
const chatbotEngine = require("./chatbot.engine");
const fluxoRepository = require("../../infrastructure/repositories/fluxo.repository");
const configuracaoService = require("../configuracoes/configuracao.service");
const logger = require("../../config/logger");

const INTERVALO_MS = Number(process.env.CHATBOT_INATIVIDADE_INTERVALO_MS) || 60 * 1000;

let timer = null;
let rodando = false;

async function varrer() {
  // Evita sobreposicao se uma varredura demorar mais que o intervalo.
  if (rodando) return { ignorado: "em_execucao" };
  rodando = true;

  let tratadas = 0;
  try {
    // So o motor local encerra conversa por conta propria. Nos outros modos quem
    // manda e o n8n ou o atendente, e fechar por tras deles seria invasivo.
    const modo = await configuracaoService.modoAtendimento();
    if (modo !== "local") return { modo, tratadas: 0 };

    const sessoes = await prisma.sessaoChatbot.findMany({
      where: { ativo: true, fluxoAtualId: { not: null } },
      take: 200,
    });

    for (const sessao of sessoes) {
      try {
        const conversa = await conversaRepository.findById(sessao.conversaId);
        if (!conversa) continue;

        // FLUXO PAUSADO = NENHUMA ACAO AUTOMATICA.
        //
        // A checagem e feita AQUI, no instante de executar, e nao quando a
        // espera comecou: pausar o fluxo durante os 5 minutos tem de valer. Sem
        // isto, uma pesquisa disparada antes da pausa continuaria cobrando
        // resposta de um bot que a tela mostra desligado.
        const fluxo = await fluxoRepository.findById(sessao.fluxoAtualId);
        if (!fluxo || !fluxo.ativo) {
          logger.debug("Acao automatica ignorada: fluxo pausado ou removido", {
            sessaoId: sessao.id,
            fluxoId: sessao.fluxoAtualId,
          });
          continue;
        }

        const instancia = await instanciaRepository.findById(sessao.instanciaId);

        // ESPERA PELA AVALIACAO: a conversa aqui esta FECHADA (a pesquisa fecha
        // desde ja), entao ela nao passa pelo filtro de "pendente" abaixo.
        if (chatbotEngine.aguardandoAvaliacao(sessao)) {
          const tratou = await chatbotEngine.aplicarTimeoutAvaliacao(sessao, {
            conversa,
            instanciaId: sessao.instanciaId,
            instanceName: instancia?.nome,
          });
          if (tratou) tratadas += 1;
          continue;
        }

        // Atendente ja assumiu: nao e mais conversa do bot.
        if (conversa.statusAtendimento !== "pendente") continue;

        const resultado = await chatbotEngine.aplicarInatividade(sessao, {
          conversa,
          instanciaId: sessao.instanciaId,
          instanceName: instancia?.nome,
        });
        if (resultado) tratadas += 1;
      } catch (error) {
        // Uma sessao problematica nao pode parar a varredura das outras.
        logger.warn("Falha ao aplicar inatividade na sessao", {
          sessaoId: sessao.id,
          message: error.message,
        });
      }
    }
    // ── ESPERA NA FILA DE PENDENTES ──────────────────────────────────────────
    //
    // Consulta separada de proposito: depois de transferir para humano, a sessao
    // fica com `fluxoAtualId` nulo e nao aparece na busca acima. E, mais
    // importante, o criterio e outro -- aqui o que conta e ha quanto tempo a
    // conversa esta na fila, nao ha quanto tempo o cliente esta calado.
    tratadas += await varrerEsperaNaFila();
  } catch (error) {
    logger.warn("Falha na varredura de inatividade", { message: error.message });
  } finally {
    rodando = false;
  }

  if (tratadas) logger.info("Varredura de inatividade", { tratadas });
  return { tratadas };
}

/**
 * Avisa quem esta esperando ha tempo demais na fila.
 *
 * A regra e do FLUXO (`configuracoesGlobais.filaPendentes`) e so roda com o
 * fluxo ATIVO. Qual fluxo? O que atendeu aquela conversa -- guardado em
 * `sessao.contexto.fluxoOrigemId` na transferencia. Sem essa pista (conversa
 * antiga, ou que caiu na fila sem passar por fluxo), usamos o unico fluxo ativo
 * que define a regra; havendo varios, nao adivinhamos.
 */
async function varrerEsperaNaFila() {
  const pendentes = await prisma.conversa.findMany({
    where: { statusAtendimento: "pendente", atendenteId: null },
    select: { id: true, instanciaId: true },
    take: 200,
  });
  if (pendentes.length === 0) return 0;

  const ativos = (await fluxoRepository.findAtivos()) || [];
  if (ativos.length === 0) return 0; // nenhum fluxo ativo = nenhuma automacao
  const unicoAtivo = ativos.length === 1 ? ativos[0] : null;

  let avisadas = 0;
  for (const { id, instanciaId } of pendentes) {
    try {
      const conversa = await conversaRepository.findById(id);
      if (!conversa) continue;

      const origemId = conversa.sessao?.contexto?.fluxoOrigemId || null;
      const fluxo = (origemId && ativos.find((f) => f.id === origemId)) || unicoAtivo;
      // Fluxo de origem pausado (ou ambiguo): nada e enviado.
      if (!fluxo) continue;

      const instancia = await instanciaRepository.findById(instanciaId);
      const avisou = await chatbotEngine.aplicarEsperaFila(conversa, fluxo, {
        instanceName: instancia?.nome,
      });
      if (avisou) avisadas += 1;
    } catch (error) {
      logger.warn("Falha ao avisar espera na fila", { conversaId: id, message: error.message });
    }
  }
  return avisadas;
}

function iniciar() {
  if (timer) return timer;
  timer = setInterval(() => { varrer(); }, INTERVALO_MS);
  // Nao segura o processo aberto no shutdown.
  if (timer.unref) timer.unref();
  logger.info("Varredor de inatividade do chatbot iniciado", { intervaloMs: INTERVALO_MS });
  return timer;
}

function parar() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { iniciar, parar, varrer };
