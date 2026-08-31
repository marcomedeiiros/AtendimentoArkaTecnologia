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
// O MESMO casamento de telefone da producao (nono digito, formatacao livre):
// uma versao simplificada aqui faria o teste concordar consigo mesmo.
const { mesmoTelefoneBr } = require("../../shared/helpers/cnpj.helper");

const TELEFONE_TESTE = "0000000000";
const MAX_MENSAGENS = 40;

function criarAmbiente({ fluxo, nomeCliente, horario, filas, agora, pesquisaAtiva = true, cnpjAnterior = null, parceiro = null, telefone = TELEFONE_TESTE }) {
  const respostas = [];
  const estado = {
    conversa: {
      id: "sim-conversa",
      instanciaId: "sim-instancia",
      cliente: nomeCliente,
      telefone,
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
      // O motor usa esta leitura no caminho de recebimento e nas emissoes: em
      // producao ela traz so a cauda do historico, aqui a conversa de teste
      // inteira (que tem poucas mensagens). O que importa e existir com o mesmo
      // contrato -- sem ela o simulador quebraria num caminho que o cliente real
      // percorre em toda mensagem.
      findByIdParaEvento: async () => estado.conversa,
      findByTelefone: async () => estado.conversa,
      // Em producao esta e a leitura SEM historico do caminho de recebimento.
      findByTelefoneParaMotor: async () => estado.conversa,
      create: async () => estado.conversa,
      existeMensagemWa: async () => false,
      addMensagem: async (_id, origem, texto) => {
        // `criadoEm` existe para o mesmo contrato de producao: e por ele que
        // `respondeuDepoisDe` sabe se o cliente respondeu a pergunta do bot.
        estado.conversa.mensagens.push({ origem, texto, criadoEm: new Date(agoraMs()) });
        if (origem === "bot") respostas.push(texto);
        return { id: `sim-msg-${estado.conversa.mensagens.length}` };
      },
      // Mesma pergunta que o motor faz em producao antes de encerrar por
      // inatividade: "chegou mensagem do cliente depois do pedido do bot?".
      respondeuDepoisDe: async (_id, desde) =>
        estado.conversa.mensagens.some(
          (m) => m.origem === "cliente" && m.criadoEm && m.criadoEm > new Date(desde)
        ),
      vincularWaMessageId: async () => {},
      update: async (_id, dados) => Object.assign(estado.conversa, dados),
      // OS (Atendimento): no simulador nao ha banco nem historico para manter --
      // o teste do fluxo so quer saber o que o bot responde. Precisam existir
      // porque o motor real chama estes metodos ao transferir/encerrar.
      garantirAtendimento: async () => null,
      garantirAtendimentoAberto: async () => ({ atendimento: null, nova: false }),
      atualizarAtendimentoAtual: async () => null,
      atualizarAtendimento: async () => null,
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
      // UPDATE condicional de producao: aqui a sessao e unica e nao ha varredura
      // concorrente, entao a reivindicacao sempre sucede -- o que importa e o
      // metodo existir com o mesmo contrato ({ count }).
      reivindicarInatividade: async () => {
        if (!estado.sessao || estado.sessao.inatividadeEm) return { count: 0 };
        estado.sessao.inatividadeEm = new Date(agoraMs());
        return { count: 1 };
      },
    },
    // ── PARCEIRO: NENHUM POR PADRAO, E UM FALSO QUANDO O TESTE PEDIR ────────
    //
    // A consulta real ao banco de parceiros continua fora: ela traria dado de
    // cliente para dentro de um teste. O que faltava era conseguir exercitar o
    // caminho de quem ESTA cadastrado -- sem isso, todo CNPJ da simulacao caia
    // em "avulso" e a metade do fluxo tecnico (confirmacao do cadastro ->
    // identificacao -> descricao) nunca era percorrida por ninguem.
    //
    // `opcoes.parceiro` e um cadastro INVENTADO pelo cenario ({ cnpj,
    // razaoSocial }). Casa por digitos, para o teste poder escrever o CNPJ com
    // ou sem pontuacao como o cliente faz.
    parceiroRepository: {
      findAtivoByCnpj: async (cnpj) => {
        if (!parceiro) return null;
        const soDigitos = (v) => String(v || "").replace(/[^0-9]/g, "");
        return soDigitos(cnpj) === soDigitos(parceiro.cnpj) ? parceiro : null;
      },
      // MEMORIA DO PERFIL: o cadastro reconhece o cliente pelo TELEFONE, no
      // primeiro contato. O cenario liga isso passando `parceiro.telefones` --
      // e o casamento usa o helper real (nono digito e formatacao inclusos), e
      // nao uma comparacao simplificada que mentiria sobre producao.
      findAtivoByTelefone: async (telefone) => {
        if (!parceiro?.telefones) return null;
        const casou = String(parceiro.telefones)
          .split(/[,;/|\r\n]+/)
          .some((n) => mesmoTelefoneBr(telefone, n));
        return casou ? parceiro : null;
      },
    },
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
    // O INSTANTE EM QUE O MOTOR DECIDE -- e o mesmo dos carimbos acima.
    //
    // Sem isto, `agora` servia so para datar as mensagens do teste, e a checagem
    // de expediente do motor continuava lendo o relogio real: o cenario "sexta
    // as 20h, fora do horario" passava ou falhava conforme a HORA em que alguem
    // rodasse o script. Ver ChatbotEngine.agora.
    agora: () => new Date(agoraMs()),
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
      // AQUI O PARAMETRO SE PERDIA. `criarAmbiente` aceita `agora` desde sempre,
      // mas `simular` nunca o repassava -- entao passar `agora` nas opcoes nao
      // tinha efeito nenhum, e nao havia como testar "fora do horario" ou
      // "mudanca de dia" num instante fixo.
      agora: opcoes.agora instanceof Date ? opcoes.agora : null,
      // Permite testar o contato recorrente: `cnpjAnterior` simula um CNPJ ja
      // confirmado por este telefone em atendimento anterior.
      cnpjAnterior: opcoes.cnpjAnterior || null,
      // Cadastro inventado para o cenario: permite testar o caminho do cliente
      // COM contrato. Ver parceiroRepository acima.
      // TELEFONE DO CENARIO. Ele era fixo, e por isso nao havia como exercitar a
      // MEMORIA DO PERFIL -- que casa o numero do cliente com o `telefones` do
      // cadastro do parceiro. Sem poder trocar o numero, o teste nao distinguia
      // "reconhecido pelo cadastro" de "desconhecido".
      telefone: String(opcoes.telefone || "").trim() || TELEFONE_TESTE,
      parceiro:
        opcoes.parceiro && opcoes.parceiro.cnpj
          ? {
              cnpj: String(opcoes.parceiro.cnpj),
              razaoSocial: String(opcoes.parceiro.razaoSocial || ""),
              // `telefones` liga a memoria por perfil no cenario. Como no
              // cadastro real, e texto livre e pode ter mais de um numero.
              telefones: opcoes.parceiro.telefones ? String(opcoes.parceiro.telefones) : null,
            }
          : null,
    });

    const turnos = [];
    for (const bruta of mensagens) {
      const entrada = String(bruta ?? "");
      respostas.length = 0;

      const resultado = await engine.processarMensagemEntrada({
        instanciaId: estado.conversa.instanciaId,
        instanceName: "simulacao",
        telefone: estado.conversa.telefone,
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
