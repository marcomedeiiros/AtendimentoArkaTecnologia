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
// A regra de expediente e do modulo de horario, e ela e consultada aqui pelo
// mesmo motivo que no motor: quem decide se estamos fora do horario e sempre o
// mesmo codigo, senao existiriam dois expedientes discordando.
const horarioAtendimento = require("./chatbot.horario");
const { comLock } = require("../../shared/helpers/lock.helper");
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
        // ── A MESMA FILA DO WEBHOOK ────────────────────────────────────────
        //
        // Este era o unico escritor de automacao FORA da fila
        // `instancia:telefone`: o recebimento de mensagem toma essa fila
        // (chatbot.engine:processarMensagemEntrada) e o disparo da pesquisa
        // tambem (conversa.service:_dispararPesquisaSatisfacao), mas a varredura
        // agia em paralelo com as duas. Resultado: a resposta do cliente que
        // chegasse junto do timeout podia ser sobrescrita pelo encerramento --
        // exatamente a corrida do relato.
        //
        // A fila e tomada AQUI, e nao dentro do motor: `encerrarAtendimento` e
        // `transferirParaHumano` tambem sao chamados pelo caminho do fluxo, que
        // JA roda dentro dela -- pedir a mesma chave duas vezes travaria a
        // conversa para sempre.
        const tratadasNaSessao = await comLock(
          `${sessao.instanciaId}:${sessao.telefone}`,
          () => tratarSessao(sessao)
        );
        tratadas += tratadasNaSessao;
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
    tratadas += await varrerForaDoHorario();
  } catch (error) {
    logger.warn("Falha na varredura de inatividade", { message: error.message });
  } finally {
    rodando = false;
  }

  if (tratadas) logger.info("Varredura de inatividade", { tratadas });
  return { tratadas };
}

/**
 * Uma sessao, dentro da fila do cliente. Devolve quantas acoes foram aplicadas
 * (0 ou 1).
 *
 * A sessao e RELIDA aqui dentro: a que veio da consulta pode ter minutos de
 * idade (a varredura processa ate 200 por vez, e cada uma espera a sua vez na
 * fila). Agir sobre o retrato antigo era decidir com estado vencido -- e o
 * `aguardandoDesde`/`concluidoEm` do relato aparecem justamente nesse intervalo.
 */
async function tratarSessao(sessaoLida) {
  const sessao = await prisma.sessaoChatbot.findUnique({ where: { id: sessaoLida.id } });
  if (!sessao?.ativo || !sessao.fluxoAtualId) return 0;

  const conversa = await conversaRepository.findById(sessao.conversaId);
  if (!conversa) return 0;

  // FLUXO PAUSADO = NENHUMA ACAO AUTOMATICA.
  //
  // A checagem e feita AQUI, no instante de executar, e nao quando a espera
  // comecou: pausar o fluxo durante os 5 minutos tem de valer. Sem isto, uma
  // pesquisa disparada antes da pausa continuaria cobrando resposta de um bot
  // que a tela mostra desligado.
  const fluxo = await fluxoRepository.findById(sessao.fluxoAtualId);
  if (!fluxo || !fluxo.ativo) {
    logger.debug("Acao automatica ignorada: fluxo pausado ou removido", {
      sessaoId: sessao.id,
      fluxoId: sessao.fluxoAtualId,
    });
    return 0;
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
    return tratou ? 1 : 0;
  }

  // Atendente ja assumiu: nao e mais conversa do bot.
  if (conversa.statusAtendimento !== "pendente") return 0;

  // A AUTOMACAO JA TERMINOU? Nao ha inatividade a cobrar de quem cumpriu a sua
  // parte. A checagem tambem existe dentro de `aplicarInatividade` (que e
  // publico); aqui ela economiza o resto da varredura e deixa o motivo no log.
  if (sessao.concluidoEm) {
    logger.debug("Inatividade ignorada: automacao ja concluida", {
      sessaoId: sessao.id,
      conversaId: conversa.id,
      concluidoEm: sessao.concluidoEm,
    });
    return 0;
  }

  const resultado = await chatbotEngine.aplicarInatividade(sessao, {
    conversa,
    instanciaId: sessao.instanciaId,
    instanceName: instancia?.nome,
  });
  return resultado ? 1 : 0;
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

/**
 * ENCERRA O QUE CHEGOU FORA DO EXPEDIENTE.
 *
 * Antes, a mensagem que chegava as 22h recebia o aviso de fora do horario e a
 * conversa ia para Pendentes -- e ficava. De manha a fila amanhecia com clientes
 * da madrugada misturados aos de agora, todos com a mesma cara de "esperando
 * atendimento", e a metrica de espera na fila contava a noite inteira como
 * demora da equipe. O cliente, do lado dele, tinha lido que sua mensagem seria
 * recebida e esperava um retorno que ninguem prometeu.
 *
 * Agora o aviso pede que ele volte no expediente e diz que o atendimento sera
 * encerrado; este varredor cumpre o que aquele texto prometeu.
 *
 * ── POR QUE `foraDoHorario` E CHECADO DE NOVO AQUI ──────────────────────────
 *
 * Este e o guard que faz a diferenca entre "encerrar quem chegou de madrugada" e
 * "descartar cliente as 08:01". Uma mensagem das 07:56 recebe o aviso (ainda
 * fora do expediente) e ficaria marcada para encerrar as 08:01 -- quando a
 * equipe JA CHEGOU e aquele cliente e o primeiro da fila. Sem esta checagem, o
 * primeiro atendimento de toda manha seria fechado na cara de quem madrugou.
 *
 * Dentro do expediente o varredor nao faz nada, e a conversa segue na fila para
 * ser atendida como qualquer outra.
 */
async function varrerForaDoHorario() {
  const horario = await configuracaoService.horarioAtendimento();
  // Prazo zerado desliga o recurso (e a mensagem some do aviso -- ver
  // chatbot.horario.mensagemFora).
  if (!horario.encerrarAposMin) return 0;
  // Dentro do expediente nao ha nada a encerrar. Ver o bloco acima.
  if (!horarioAtendimento.foraDoHorario(horario)) return 0;

  const pendentes = await prisma.conversa.findMany({
    where: { statusAtendimento: "pendente", atendenteId: null },
    select: { id: true, instanciaId: true, telefone: true },
    take: 200,
  });
  if (pendentes.length === 0) return 0;

  const limite = Date.now() - horario.encerrarAposMin * 60 * 1000;
  let encerradas = 0;

  for (const { id, instanciaId, telefone } of pendentes) {
    try {
      const conversa = await conversaRepository.findById(id);
      if (!conversa) continue;

      // A MARCA E O CRITERIO, e nao "esta pendente ha X minutos".
      //
      // `foraHorarioEm` so existe em conversa que passou pelo bloco de fora do
      // horario do motor -- ou seja, em cliente que RECEBEU o aviso. Usar a
      // idade na fila fecharia tambem a conversa que entrou durante o
      // expediente e atravessou o fim do dia esperando um atendente: essa
      // pessoa nunca leu que seria encerrada, e fechar com ela na fila seria
      // exatamente o descaso que este trabalho veio corrigir.
      const foraHorarioEm = conversa.sessao?.contexto?.foraHorarioEm || null;
      if (!foraHorarioEm) continue;

      const marcado = new Date(foraHorarioEm).getTime();
      if (Number.isNaN(marcado) || marcado > limite) continue;

      const instancia = await instanciaRepository.findById(instanciaId);
      // MESMA FILA do webhook e das outras automacoes: sem ela, a mensagem do
      // cliente chegando neste exato instante corre em paralelo com o
      // encerramento -- a corrida que `comLock` existe para eliminar.
      await comLock(`${instanciaId}:${telefone}`, async () => {
        // RELE dentro da fila: entre a listagem e a vez desta conversa, um
        // atendente pode ter assumido (vira "aberta") ou o cliente pode ter
        // escrito de novo. Decidir pelo retrato antigo fecharia um atendimento
        // que ja tem gente dentro.
        const atual = await conversaRepository.findById(id);
        if (!atual || atual.statusAtendimento !== "pendente" || atual.atendenteId) return;

        // `fecharConversa` encerra a conversa e a OS, desliga a sessao e grava o
        // motivo automatico. NAO dispara pesquisa de satisfacao -- ela vive em
        // `encerrarAtendimento`, um degrau acima, e perguntar "de 1 a 5, que
        // nota voce da?" a quem nunca foi atendido envenenaria o CSAT com a
        // opiniao de quem so viu o robo.
        await chatbotEngine.fecharConversa(
          { conversa: atual, telefone, instanciaId, instanceName: instancia?.nome },
          { motivo: "fora_do_horario" }
        );
        encerradas += 1;
        logger.info("Atendimento encerrado por chegar fora do horario", {
          conversaId: id,
          avisadoEm: foraHorarioEm,
        });
      });
    } catch (error) {
      logger.warn("Falha ao encerrar conversa fora do horario", {
        conversaId: id,
        message: error.message,
      });
    }
  }
  return encerradas;
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
