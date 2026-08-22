// Simulador de fluxo: conversa de teste contra o motor REAL.
//
// Roda `ChatbotEngine` com dependencias falsas - conversa e sessao em memoria,
// nada de WhatsApp, nada de banco, nenhum log de execucao gravado. A logica
// exercitada e byte a byte a mesma que atende o cliente de verdade; e por isso
// que o motor recebe as dependencias por injecao em vez de importar os
// repositorios direto. Uma copia da orquestracao aqui envelheceria sozinha e o
// teste passaria a mentir sobre o comportamento do bot.
//
// Stateless de proposito: cada chamada recebe a lista completa de mensagens do
// cliente e reproduz a conversa desde o inicio. Sem sessao de teste no servidor
// para expirar, vazar ou colidir entre dois operadores testando ao mesmo tempo.
const { ChatbotEngine } = require("./chatbot.engine");
const AppError = require("../../shared/errors/AppError");

const TELEFONE_TESTE = "0000000000";
const MAX_MENSAGENS = 40;

function criarAmbiente({ fluxo, nomeCliente, horario, filas, agora, pesquisaAtiva = true, cnpjAnterior = null }) {
  const respostas = [];
  const estado = {
    conversa: {
      id: "sim-conversa",
      instanciaId: "sim-instancia",
      cliente: nomeCliente,
      telefone: TELEFONE_TESTE,
      statusAtendimento: "pendente",
      setor: "Geral",
      cnpj: null,
      cnpjVerificado: false,
      mensagens: [],
    },
    sessao: null,
  };

  const agoraMs = () => (agora ? agora.getTime() : Date.now());

  const deps = {
    // O fluxo em teste e o unico ativo: assim o resultado nao depende de outros
    // fluxos cadastrados, e o gatilho continua sendo exercitado de verdade.
    fluxoRepository: {
      findAtivos: async () => (fluxo.ativo === false ? [] : [fluxo]),
      findById: async (id) => (id === fluxo.id ? fluxo : null),
      findByGatilho: async () => null,
      createLog: async () => {},
    },
    conversaRepository: {
      findById: async () => estado.conversa,
      findByTelefone: async () => estado.conversa,
      create: async () => estado.conversa,
      existeMensagemWa: async () => false,
      addMensagem: async (_id, origem, texto) => {
        estado.conversa.mensagens.push({ origem, texto });
        if (origem === "bot") respostas.push(texto);
        return { id: `sim-msg-${estado.conversa.mensagens.length}` };
      },
      vincularWaMessageId: async () => {},
      update: async (_id, dados) => Object.assign(estado.conversa, dados),
      // Memoria de contato recorrente: no teste nao ha atendimento anterior
      // (a nao ser que o operador passe `cnpjAnterior` nas opcoes).
      ultimoCnpjDoTelefone: async () => (cnpjAnterior ? { cnpj: cnpjAnterior } : null),
    },
    sessaoRepository: {
      findByTelefone: async () => estado.sessao,
      findByConversa: async () => estado.sessao,
      upsert: async (instanciaId, conversaId, telefone, dados) => {
        estado.sessao = {
          id: "sim-sessao",
          instanciaId,
          conversaId,
          telefone,
          criadoEm: new Date(agoraMs()),
          ...(estado.sessao || {}),
          ...dados,
          atualizadoEm: new Date(agoraMs()),
        };
        return estado.sessao;
      },
      update: async (_id, dados) => {
        estado.sessao = { ...estado.sessao, ...dados, atualizadoEm: new Date(agoraMs()) };
        return estado.sessao;
      },
    },
    // Sem consulta de parceiro nem ERP na simulacao: o teste e do desenho do
    // fluxo, e bater no banco de parceiros traria dado real para dentro do teste.
    parceiroRepository: { findAtivoByCnpj: async () => null },
    mockErp: {
      aplicarDescontoParceiro: async () => ({ mensagem: "[simulação] desconto de parceiro aplicado" }),
      gerarBoleto: async () => ({
        mensagem: "[simulação] boleto gerado",
        linhaDigitavel: "00000.00000 00000.000000 00000.000000 0 00000000000000",
        pixCopiaCola: "[simulação] pix",
        vencimento: "00/00/0000",
      }),
    },
    // Nada sai para o WhatsApp.
    evolutionApi: {
      sendText: async () => ({ key: { id: "sim" } }),
      sendButtons: async () => ({ key: { id: "sim" } }),
      sendList: async () => ({ key: { id: "sim" } }),
      fetchProfilePictureUrl: async () => null,
    },
    n8nClient: { encaminharMensagem: async () => ({ encaminhado: false }) },
    // Forca o modo local: senao o teste ficaria refem da configuracao da tela e
    // nao responderia nada quando o painel estivesse em n8n/humano.
    configuracaoService: {
      modoAtendimento: async () => "local",
      horarioAtendimento: async () => horario,
      filasParaSetor: async () => filas,
      // Pesquisa de satisfacao no "Testar": por padrao ligada, para o operador
      // ver as perguntas de nota/comentario ao encerrar. Passe
      // `pesquisaSatisfacao: false` nas opcoes para testar so o desenho do fluxo.
      pesquisaSatisfacao: async () =>
        !pesquisaAtiva
          ? { ativo: false }
          : {
              ativo: true,
              pedirComentario: true,
              mensagemNota:
                "Antes de encerrar: de 1 a 5, que nota voce da para este atendimento? (1 = pessimo, 5 = otimo)",
              mensagemComentario:
                'Obrigado! Em poucas palavras, o que foi bom ou o que podemos melhorar? (ou responda "pular")',
              mensagemAgradecimento:
                "Sua avaliacao foi registrada. Obrigado pelo seu feedback!",
              mensagemNotaInvalida: "Por favor, responda apenas com um numero de 1 a 5.",
            },
    },
    // Nada de SSE: nao existe conversa real para empurrar ao front.
    bus: { emitConversa: () => {} },
  };

  return { engine: new ChatbotEngine(deps), estado, respostas };
}

class ChatbotSimulador {
  /**
   * Reproduz uma conversa de teste contra o fluxo informado.
   *
   * @param {object} fluxo         fluxo com passos, como vem do repositorio
   * @param {string[]} mensagens   mensagens do cliente, em ordem
   * @returns {Promise<object>}    transcricao turno a turno + estado final
   */
  async simular(fluxo, mensagens = [], opcoes = {}) {
    if (!fluxo) throw new AppError("Fluxo nao encontrado", 404, "NOT_FOUND");
    if (!Array.isArray(mensagens)) throw new AppError("mensagens deve ser uma lista", 400, "INVALID");
    if (mensagens.length > MAX_MENSAGENS) {
      throw new AppError(
        `Simulação aceita no máximo ${MAX_MENSAGENS} mensagens`,
        400,
        "LIMITE_MENSAGENS"
      );
    }

    const { engine, estado, respostas } = criarAmbiente({
      fluxo,
      nomeCliente: String(opcoes.nomeCliente || "").trim() || "Cliente Teste",
      // Horario liberado por padrao: o operador esta testando o desenho do fluxo,
      // e barrar por expediente atrapalharia. Quem quiser testar o "fora de
      // horario" passa `respeitarHorario`.
      horario: opcoes.respeitarHorario ? opcoes.horario : { ativo: false },
      filas: opcoes.filas || {},
      pesquisaAtiva: opcoes.pesquisaSatisfacao !== false,
      // Permite testar o contato recorrente: `cnpjAnterior` simula um CNPJ ja
      // confirmado por este telefone em atendimento anterior.
      cnpjAnterior: opcoes.cnpjAnterior || null,
    });

    const turnos = [];
    for (const bruta of mensagens) {
      const entrada = String(bruta ?? "");
      respostas.length = 0;

      const resultado = await engine.processarMensagemEntrada({
        instanciaId: estado.conversa.instanciaId,
        instanceName: "simulacao",
        telefone: TELEFONE_TESTE,
        texto: entrada,
        nomeCliente: estado.conversa.cliente,
      });

      const passoAtualId = estado.sessao?.passoAtualId || null;
      const passoAtual = (fluxo.passos || []).find((p) => p.id === passoAtualId) || null;

      turnos.push({
        entrada,
        respostas: [...respostas],
        aguardando: estado.sessao?.ativo ? estado.sessao.aguardando || null : null,
        passoAtualId,
        passoAtualTitulo: passoAtual?.titulo || null,
        status: estado.conversa.statusAtendimento,
        setor: estado.conversa.setor || null,
        transferido: !!resultado?.transferido,
        encerrado: !!resultado?.encerrado,
        filaId: resultado?.filaId ?? null,
        motivo: resultado?.motivo || null,
      });

      // Conversa fechada ou entregue ao humano: o bot nao responde mais nada, e
      // continuar mandando mensagem so produziria turnos vazios enganosos.
      if (resultado?.encerrado || resultado?.transferido) break;
    }

    return {
      fluxo: { id: fluxo.id, nome: fluxo.nome, gatilho: fluxo.gatilho, ativo: fluxo.ativo },
      turnos,
      finalizado: turnos.some((t) => t.encerrado || t.transferido),
    };
  }
}

module.exports = new ChatbotSimulador();
module.exports.TELEFONE_TESTE = TELEFONE_TESTE;
module.exports.MAX_MENSAGENS = MAX_MENSAGENS;
