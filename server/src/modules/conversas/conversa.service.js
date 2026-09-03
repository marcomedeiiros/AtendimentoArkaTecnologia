const conversaRepository = require("../../infrastructure/repositories/conversa.repository");
const instanciaRepository = require("../../infrastructure/repositories/instancia.repository");
const evolutionApi = require("../../infrastructure/external/evolution-api.client");
const transcricaoClient = require("../../infrastructure/external/transcricao.client");
const correcaoClient = require("../../infrastructure/external/correcao.client");
const midiaStorage = require("../../infrastructure/storage/midia.storage");
const fotos = require("./conversa.fotos");
const { mapConversa, mapAtendimento } = require("../../shared/helpers/mapper.helper");
// `mascararCnpj` saiu daqui: nenhuma mensagem deste service imprime mais os 14
// digitos -- o que confirma a identificacao e a razao social.
const { limparCnpj, documentoValido, normalizarTelefoneBr } = require("../../shared/helpers/cnpj.helper");
const {
  normalizarSetor,
  podeAcessarSetor,
  // `acharSetor` devolve o setor canonico que um valor representa, ou null. E o
  // que traduz CARGO em SETOR na transferencia -- os dois usam as mesmas strings
  // ("Tecnico", "Comercial", "Financeiro"), e "Administrador" nao e setor nenhum.
  acharSetor,
} = require("../../shared/helpers/setor.helper");
// So a janela de presenca: a Central precisa dizer quem esta online no seletor
// de transferencia, e duas janelas diferentes fariam as duas telas discordarem
// sobre a mesma pessoa.
const { JANELA_ONLINE_MS } = require("../equipe/equipe.service");
// Taxonomia de motivos de encerramento: a lista vive na Configuracao para ser
// revista sem deploy, entao quem valida a escolha precisa consultá-la.
const configuracaoService = require("../configuracoes/configuracao.service");
const parceiroRepository = require("../../infrastructure/repositories/parceiro.repository");
const usuarioRepository = require("../../infrastructure/repositories/usuario.repository");
const bus = require("../../shared/events/event-bus");
const AppError = require("../../shared/errors/AppError");
const env = require("../../config/env");
const logger = require("../../config/logger");

// Quantas mensagens acompanham um EVENTO (nao uma leitura). Mesmo numero de
// conversa.repository.findByIdParaEvento -- os dois caminhos entregam a mesma
// cauda, e o front trata as duas do mesmo jeito. Folgado o bastante para cobrir
// uma rajada do cliente entre dois eventos; o que escapar e reconciliado pela
// releitura periodica do AppContext.
const CAUDA_EVENTO = 30;

// Guard de autorizacao por setor para operacoes por id/mensagem.
//
// A leitura (listar/obter) ja filtrava por setor, mas TODA acao de escrita
// (atender, responder, apagar, mudar status/setor, remover...) recebia so o id
// vindo do front e agia sem conferir -- um IDOR classico: um Tecnico que nao
// PODE LER uma conversa do Financeiro ainda conseguia apaga-la ou responder ao
// cliente sabendo o id. Este guard fecha isso no servidor.
//
// `acesso` e o `req.user` inteiro (cargo + setores extras), do token ja
// validado e RECARREGADO DO BANCO a cada requisicao. Era so o cargo, uma
// string; virou o objeto quando o acesso deixou de sair inteiramente do cargo
// -- ver "SETORES EXTRAS POR PESSOA" em setor.helper.js. Quando null (chamadas
// internas do bot/n8n, que tem acesso total) o guard e um no-op de proposito.
function exigirAcessoSetor(acesso, setorConversa) {
  if (acesso && !podeAcessarSetor(acesso, setorConversa)) {
    throw new AppError("Sem permissao para acessar este setor", 403, "FORBIDDEN_SECTOR");
  }
}

// Quantas mensagens a listagem da Central carrega por conversa. Ela so usa a
// ultima para a previa; o excedente e folga para o merge do front nao ficar sem
// contexto quando um evento SSE chega junto.
const MENSAGENS_NA_LISTAGEM = 40;

class ConversaService {
  async listar(filtros = {}, acesso = null) {
    // A Central desenha a previa da conversa e busca o historico completo em
    // `GET /conversas/:id` quando alguem ABRE uma. Pedir tudo aqui custava
    // 2,6s e 87 MB por chamada em producao (medido em 01/09/2026) para entregar
    // 142 KB -- ver o comentario em conversa.repository.findAll.
    const conversas = await conversaRepository.findAll(filtros, {
      cauda: MENSAGENS_NA_LISTAGEM,
    });
    const dto = conversas.map(mapConversa);
    if (!acesso || acesso.cargo === "Administrador") return dto;
    return dto.filter((c) => podeAcessarSetor(acesso, c.setor));
  }

  /**
   * ESTADO DE TODAS AS CONVERSAS -- o retrato barato para reconciliar.
   *
   * Mesmo filtro de setor da listagem, de proposito: se este caminho enxergasse
   * um setor que `listar` esconde, ele contaria conversa de outro setor no
   * numerinho das abas -- vazamento por outra porta.
   *
   * Nao passa por `mapConversa`: o retrato ja e exatamente o conjunto de campos
   * que a tela precisa, e montar o DTO completo aqui derrotaria o proposito.
   */
  async listarEstados(acesso = null) {
    const estados = await conversaRepository.listarEstados();
    const normalizados = estados.map((c) => ({
      id: c.id,
      statusAtendimento: c.statusAtendimento,
      setor: c.setor || "Geral",
      atendenteId: c.atendenteId || null,
      naoLidas: c.naoLidas ?? 0,
      lido: !!c.lido,
      versao: c.versao ?? 0,
    }));
    if (!acesso || acesso.cargo === "Administrador") return normalizados;
    return normalizados.filter((c) => podeAcessarSetor(acesso, c.setor));
  }

  async obter(id, acesso = null) {
    const conversa = await conversaRepository.findById(id);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");
    const dto = mapConversa(conversa);
    exigirAcessoSetor(acesso, dto.setor);
    return dto;
  }

  /**
   * ASSUMIR O ATENDIMENTO.
   *
   * Operacao ATOMICA e idempotente. Antes era ler-depois-escrever: dois
   * atendentes clicando ao mesmo tempo recebiam 200 os dois, o ultimo UPDATE
   * vencia, e o primeiro seguia com a conversa marcada como sua na tela --
   * inclusive respondendo o cliente de outra pessoa. Agora quem decide o dono e
   * o banco (UPDATE condicional em conversa.repository.assumirAtomico); quem
   * perder recebe 409 e o estado real, ja atualizado, chega pelo SSE.
   *
   * Clicar duas vezes (ou reenviar por reconexao) NAO conflita: a condicao
   * aceita "vago OU ja e meu".
   */
  async atender(id, atendenteId = null, acesso = null) {
    const conversa = await conversaRepository.findById(id);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");
    exigirAcessoSetor(acesso, conversa.setor);

    // Nome de quem assumiu, guardado como historico (ver ultimoAtendenteNome no
    // schema): sobrevive a conversa voltar para a fila e alimenta a coluna
    // "Atendente" das Avaliacoes, que so existem depois do fechamento.
    let nomeAtendente = null;
    if (atendenteId) {
      const usuario = await usuarioRepository.findById(atendenteId).catch(() => null);
      nomeAtendente = usuario?.nome || null;
    }

    // Fio fechado que volta a ser atendido precisa de OS aberta para receber o
    // ciclo (o operador pode assumir uma conversa que o bot ja encerrou).
    await conversaRepository.garantirAtendimentoAberto(id, { setor: conversa.setor });

    const { assumido } = await conversaRepository.assumirAtomico(id, atendenteId, nomeAtendente);

    if (!assumido) {
      // Perdeu a corrida. Emitimos o estado REAL antes de recusar: assim o
      // painel de quem perdeu ja recebe o dono certo pelo stream, sem depender
      // do F5. (O front ainda relê a conversa no catch, porque a resposta de
      // erro so carrega codigo e mensagem -- ver error.middleware.)
      const real = await conversaRepository.findById(id);
      this._emitir(real);
      throw new AppError(
        `${real?.atendente?.nome || "Outro atendente"} assumiu esta conversa primeiro.`,
        409,
        "CONVERSA_JA_ATENDIDA"
      );
    }

    await conversaRepository.atualizarAtendimentoAtual(id, {
      status: "aberta",
      atendenteId: atendenteId || null,
      ...(nomeAtendente ? { atendenteNome: nomeAtendente } : {}),
      atendidoEm: new Date(),
    });

    // Auto-recuperacao da foto: se a Evolution estava fora (ou sem foto) quando
    // a conversa nasceu, tentamos de novo ao assumir o atendimento. Depois do
    // guard de concorrencia de proposito -- e chamada de rede, e nao pode
    // atrasar a decisao de quem fica com a conversa.
    //
    // `precisaRenovar` no lugar de `!fotoUrl`: o link do CDN do WhatsApp vence
    // em poucos dias e passa a responder 403. So olhar para "e nulo?" deixava
    // o link podre gravado para sempre (ver conversa.fotos).
    if (fotos.precisaRenovar(conversa.fotoUrl)) {
      const foto = await evolutionApi
        .fetchProfilePictureUrl(conversa.telefone, env.evolutionApi.instance)
        .catch(() => null);
      if (foto) await conversaRepository.update(id, { fotoUrl: foto });
    }

    return this._emitir(await conversaRepository.findById(id));
  }

  // Historico de OS do cliente. As mensagens de cada ciclo ja vao na conversa
  // (carimbadas com `atendimentoId`); aqui vem so o resumo de cada atendimento.
  async listarAtendimentos(id, acesso = null) {
    const conversa = await conversaRepository.findByIdBasico(id);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");
    exigirAcessoSetor(acesso, conversa.setor);
    const lista = await conversaRepository.listarAtendimentos(id);
    return lista.map(mapAtendimento);
  }

  /**
   * Inicia uma conversa a partir de um numero digitado pelo operador.
   *
   * Existia um buraco aqui: `POST /whatsapp/enviar` (usado pelo Envio em Massa)
   * dispara a mensagem, mas so registra a bolha se a conversa JA existir. Para
   * um numero novo, a mensagem saia no celular do cliente e nada aparecia na
   * Central -- a conversa so nascia quando ele respondesse, pelo webhook. Ou
   * seja: o atendente mandava e ficava sem trilha do que mandou.
   *
   * Aqui a conversa e criada JA ABERTA e atribuida a quem enviou. Aberta por
   * dois motivos: quem inicia esta assumindo o atendimento (nao faz sentido
   * entrar na fila de pendentes um contato que nos mesmos procuramos), e
   * `enviarMensagem` recusa mensagem da equipe fora de conversa aberta.
   *
   * O envio em si e delegado a `enviarMensagem`, para herdar de graca o
   * waMessageId, o status de entrega e a emissao no SSE.
   */
  async iniciarConversa({ telefone, nome, setor, texto, atendenteId = null, acesso = null }) {
    // Sem texto = ABRIR SEM ENVIAR. Nao e erro: e o modo em que o atendente
    // deixa o fio pronto (numero, nome, setor, dono) para falar depois. O
    // efeito colateral importante e o que NAO acontece -- nenhuma mensagem sai
    // para o WhatsApp, entao o cliente nao recebe nem fica sabendo.
    const conteudo = String(texto || "").trim();

    const numero = normalizarTelefoneBr(telefone);
    if (!numero) {
      throw new AppError(
        "Numero invalido. Use DDD + numero, por exemplo 27 99999-0000.",
        400,
        "TELEFONE_INVALIDO"
      );
    }

    const setorFinal = normalizarSetor(setor);
    // Nao deixa abrir conversa num setor que a pessoa nem poderia ler depois.
    exigirAcessoSetor(acesso, setorFinal);
    const nomeInstancia = env.evolutionApi.instance;
    const instancia = await instanciaRepository.findByNome(nomeInstancia);
    if (!instancia) {
      throw new AppError(
        "Nenhuma instancia do WhatsApp registrada. Conecte em Integracao WhatsApp antes de iniciar conversas.",
        400,
        "INSTANCIA_AUSENTE"
      );
    }

    // Reaproveita SEMPRE o fio do cliente (qualquer status): criar outra linha
    // deixaria o mesmo cliente duplicado na lista, cada metade com um pedaco do
    // historico. Se o ultimo atendimento ja estava fechado, isto abre uma OS
    // nova no mesmo fio -- o historico continua inteiro e so o ciclo muda.
    const existente = await conversaRepository.findByTelefone(instancia.id, numero);

    let conversaId;
    if (existente) {
      conversaId = existente.id;
      await conversaRepository.garantirAtendimentoAberto(existente.id, { setor: setorFinal });
      await conversaRepository.update(existente.id, {
        statusAtendimento: "aberta",
        setor: setorFinal,
        lido: true,
        naoLidas: 0,
        fechadoEm: null,
        // Nao rouba a conversa de quem ja estava nela.
        atendenteId: existente.atendenteId || atendenteId,
        atendidoEm: existente.atendidoEm || new Date(),
      });
      await conversaRepository.atualizarAtendimentoAtual(existente.id, {
        status: "aberta",
        setor: setorFinal,
        atendenteId: existente.atendenteId || atendenteId || null,
        atendidoEm: new Date(),
      });
    } else {
      const criada = await conversaRepository.create({
        instanciaId: instancia.id,
        // Sem nome informado, o proprio numero e o rotulo. O webhook atualiza
        // para o nome do perfil quando o cliente responder.
        cliente: String(nome || "").trim() || numero,
        telefone: numero,
        statusAtendimento: "aberta",
        setor: setorFinal,
        lido: true,
        naoLidas: 0,
        atendenteId,
        atendidoEm: new Date(),
      });
      conversaId = criada.id;

      // Foto de perfil e best-effort: se a Evolution estiver fora, a conversa
      // nasce sem foto e o avatar cai nas iniciais.
      const fotoUrl = await evolutionApi
        .fetchProfilePictureUrl(numero, nomeInstancia)
        .catch(() => null);
      if (fotoUrl) await conversaRepository.update(conversaId, { fotoUrl });
    }

    // ABRIR SEM ENVIAR: a conversa ja esta criada/reaberta acima, no setor e
    // com o dono certos. So falta anunciar -- nao ha mensagem para despachar.
    //
    // O evento sai pela cauda (`_emitir` sem `completo`), como todo o resto do
    // sistema: SSE e patch, nao redesenho. Ja a RESPOSTA leva o retrato
    // inteiro, porque quem chamou vai abrir esta conversa na tela em seguida e
    // precisa dela por completo.
    if (!conteudo) {
      const conversa = await conversaRepository.findById(conversaId);
      this._emitir(conversa);
      logger.info("Conversa aberta sem mensagem", {
        conversaId,
        criada: !existente,
        setor: setorFinal,
      });
      return { ...mapConversa(conversa), criada: !existente };
    }

    const dto = await this.enviarMensagem(conversaId, conteudo, "equipe");
    return { ...dto, criada: !existente };
  }

  // So a conversa ABERTA aceita mensagem do operador.
  //
  // Em "pendente" ninguem assumiu o atendimento ainda: responder dali passaria
  // por cima da fila e deixaria a conversa sem dono, alem de permitir que dois
  // atendentes respondessem o mesmo cliente sem saber um do outro. Em "fechada"
  // o atendimento ja foi encerrado.
  //
  // A checagem olha a origem porque o bot e o n8n tambem passam por aqui, com
  // origem "bot" -- e esses precisam continuar respondendo na fila.
  _exigirAberta(conversa, origem) {
    if (origem !== "equipe") return;
    if (conversa.statusAtendimento === "aberta") return;

    const motivo =
      conversa.statusAtendimento === "pendente"
        ? "Assuma a conversa em Atender antes de responder."
        : "Conversa fechada. Reabra antes de responder.";
    throw new AppError(motivo, 409, "CONVERSA_NAO_ABERTA");
  }

  // Guard de setor para operacoes que chegam por mensagemId: resolve a conversa
  // dona da mensagem e aplica a mesma regra das operacoes por conversa.
  async _exigirAcessoMensagem(mensagem, acesso) {
    if (!acesso) return; // chamada interna (bot/n8n): acesso total
    const conversa = await conversaRepository.findById(mensagem.conversaId);
    exigirAcessoSetor(acesso, conversa?.setor);
  }

  async enviarMensagem(
    id,
    texto,
    origem = "equipe",
    respondendoAId = null,
    acesso = null,
    autor = null,
    // Metadata extra da bolha. Hoje so a marca de encaminhamento, vinda do
    // botao "Encaminhar" -- por isso opcional e sem valor padrao proprio.
    metadataExtra = null
  ) {
    // Leitura LEVE: nada aqui usa o historico -- so autorizacao (setor,
    // status), destino (telefone) e responsavel. A leitura completa custava
    // 65ms num fio de 800 mensagens contra 0,79ms desta (ver findByIdBasico).
    const conversa = await conversaRepository.findByIdBasico(id);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");
    exigirAcessoSetor(acesso, conversa.setor);
    this._exigirAberta(conversa, origem);

    // QUEM RESPONDE, ATENDE.
    //
    // Antes o responsavel so era gravado por quem clicava em "Atender". Quem
    // abria a conversa e ja respondia -- o caminho mais natural, e o normal
    // depois de reabrir uma conversa fechada -- atendia sem ficar registrado em
    // lugar nenhum. Resultado: a coluna "Atendente" das Avaliacoes ficava com
    // "-" mesmo em atendimento feito por pessoa, porque a nota chega no
    // fechamento e ali nao havia responsavel nenhum.
    //
    // Nao rouba conversa de ninguem: so assume quando esta sem responsavel.
    await this._registrarAtendente(conversa, origem, autor);

    // "Responder" do WhatsApp: cita a mensagem original na bolha do cliente.
    //
    // Duas coisas independentes saem daqui, e vale saber qual e qual quando o
    // recurso "nao funciona": o `quoted` (a citacao no APARELHO do cliente,
    // que exige o id da mensagem no WhatsApp) e o `respondendoAId` gravado na
    // mensagem local (a citacao na CENTRAL, que nao depende do WhatsApp).
    // A segunda vale mesmo quando a primeira nao e possivel.
    let quoted = null;
    if (respondendoAId) {
      const citada = await conversaRepository.findMensagem(respondendoAId);
      if (citada?.waMessageId) {
        quoted = {
          key: {
            remoteJid: `${conversa.telefone}@s.whatsapp.net`,
            fromMe: citada.origem !== "cliente",
            id: citada.waMessageId,
          },
          message: { conversation: citada.texto },
        };
      } else {
        // SEM `waMessageId` NAO HA COMO CITAR NO WHATSAPP -- e isso e um dado,
        // nao um detalhe. Acontece com mensagem que nunca chegou a sair (envio
        // com erro) e com o historico anterior ao rastreio de id. A resposta
        // segue normalmente, so que solta no aparelho do cliente; sem esta
        // linha, "as vezes o responder nao marca" nao teria por onde comecar.
        logger.warn("Resposta sem citacao no WhatsApp: a mensagem citada nao tem waMessageId", {
          conversaId: id,
          mensagemCitadaId: respondendoAId,
          existe: !!citada,
        });
      }
    }

    // CNPJ NA MENSAGEM DA EQUIPE: VINCULA EM SILENCIO.
    //
    // Aqui tambem se montava "Cliente identificado: ... - parceiro com contrato
    // ativo." -- a segunda das TRES copias da mesma regra que existiam no
    // projeto (as outras em chatbot.engine.validarCnpjRecebido e em
    // validarCnpjManual, abaixo, cada uma com uma redacao propria).
    //
    // E ela nao ficava na Central: `mensagensExtras` e percorrida por
    // `_entregarNoWhatsApp`, que manda cada item para o WhatsApp. O atendente
    // digitava um CNPJ na resposta e o cliente recebia, antes da resposta, uma
    // bolha "[Validacao Automatica Arka]" com o retorno da consulta.
    //
    // O vinculo continua -- ele e util e nao custa nada ao cliente. O que sai e
    // a narracao: a empresa identificada aparece no cabecalho do atendimento,
    // que le `conversa.empresa`.
    const cnpjNumeros = limparCnpj(texto);

    if (!conversa.cnpjVerificado && documentoValido(cnpjNumeros)) {
      const parceiro = await parceiroRepository.findAtivoByCnpj(cnpjNumeros);
      // `empresa` e o que a Central passa a exibir no lugar do numero. Fica
      // gravado aqui (e nao resolvido a cada leitura) para a identificacao
      // sobreviver mesmo que o cadastro do parceiro mude ou saia depois.
      await conversaRepository.update(id, {
        cnpj: cnpjNumeros,
        empresa: parceiro?.razaoSocial || null,
        cnpjVerificado: true,
        // Mesma classificacao dos outros dois pontos de gravacao (o motor e o
        // "validar CNPJ" da Central). Sem ela a Central so sabia "verificou?",
        // e chamava o avulso de "CLIENTE IDENTIFICADO".
        clienteTipo: parceiro ? "cadastrado" : "avulso",
      });
      logger.info("CNPJ identificado na mensagem da equipe", {
        conversaId: id,
        empresa: parceiro?.razaoSocial || null,
        cadastrado: !!parceiro,
      });
    }

    const msgLocal = await conversaRepository.addMensagem(
      id,
      origem === "equipe" ? "equipe" : "bot",
      texto.trim(),
      metadataExtra || null,
      null,
      { status: "enviando", respondendoAId: respondendoAId || null }
    );

    // A BOLHA APARECE ANTES DA IDA AO WHATSAPP.
    //
    // Antes, a resposta HTTP do atendente so voltava DEPOIS do round-trip para a
    // Evolution API: clicar em enviar travava a interface pelo tempo de uma
    // chamada externa, que nao tem prazo. Agora a mensagem ja esta gravada com
    // `status: "enviando"` -- o estado real, vindo do banco, nao uma bolha falsa
    // inventada no navegador -- e a entrega segue em segundo plano.
    //
    // O estado final continua sendo do backend: `vincularWaMessageId` grava
    // "enviada"/"erro" e os ACKs do WhatsApp levam a "entregue"/"lida", cada um
    // emitindo o patch de status (ver event-bus.emitStatusMensagem).
    const dto = await this._emitirLeve(id);

    this._entregarNoWhatsApp({
      telefone: conversa.telefone,
      texto: texto.trim(),
      quoted,
      mensagemId: msgLocal.id,
      conversaId: id,
    });

    return dto;
  }

  /**
   * Entrega no WhatsApp fora do caminho da resposta HTTP.
   *
   * Deliberadamente sem `await` de quem chama: uma falha aqui NAO pode virar
   * erro da requisicao do atendente, porque a mensagem ja esta gravada e
   * visivel. O que a falha faz e marcar a mensagem como "erro" -- que e
   * exatamente o que o atendente precisa ver na bolha.
   */
  async _entregarNoWhatsApp({ telefone, texto, quoted, mensagemId, conversaId }) {
    try {
      // `mensagensExtras` saiu daqui junto com a bolha de validacao de CNPJ que
      // era a sua unica usuaria -- e que fazia o cliente receber o retorno da
      // consulta a base de parceiros antes da resposta do atendente.
      const envio = await this._enviarWhatsApp(telefone, texto, quoted);
      await conversaRepository.vincularWaMessageId(
        mensagemId,
        envio.waMessageId,
        envio.ok ? "enviada" : "erro"
      );
      // A PRIMEIRA TRANSICAO SAI PELO CAMINHO NORMAL, nao so como patch.
      //
      // "enviando -> enviada" e a que tira o relogio da bolha, e ela nao pode
      // depender de um evento que o cliente talvez ignore: um painel aberto
      // antes deste deploy nao conhece `mensagem:status` e ficaria com o
      // relogio parado ate um F5. O retrato leve custa ~4ms e 11KB (a cauda do
      // historico, nao o fio inteiro), e QUALQUER versao do front sabe aplicar.
      //
      // Os ACKs seguintes (entregue/lida) continuam como patch de 113 bytes:
      // ali a mensagem ja esta na tela ha muito tempo.
      await this._emitirLeve(conversaId);
    } catch (e) {
      logger.error("Falha ao entregar mensagem no WhatsApp", {
        conversaId,
        mensagemId,
        message: e.message,
      });
      try {
        await conversaRepository.vincularWaMessageId(mensagemId, null, "erro");
        // Mesmo motivo do caminho feliz: a falha TEM de aparecer na bolha, e
        // nao pode depender de o painel conhecer o evento novo.
        await this._emitirLeve(conversaId);
      } catch { /* nada mais a fazer: o log acima ja registrou */ }
    }
  }

  /**
   * Emite a conversa com a CAUDA do historico e devolve o DTO.
   *
   * Usado onde a acao muda a conversa mas nao o passado dela (mandar mensagem,
   * mudar status). O front une o que chega com o que ja tem -- ver
   * findByIdParaEvento e utils/mesclarConversa.
   */
  async _emitirLeve(id) {
    const conversa = await conversaRepository.findByIdParaEvento(id);
    if (!conversa) return null;
    const dto = mapConversa({ ...conversa, __parcial: true });
    bus.emitConversa(dto);
    return dto;
  }

  /**
   * NOTA INTERNA -- o que a equipe escreve para a equipe, dentro da conversa.
   *
   * ── POR QUE UM CAMINHO PRÓPRIO, E NÃO UM PARÂMETRO DO `enviarMensagem` ──────
   *
   * `enviarMensagem` faz cinco coisas além de gravar texto: vincula CNPJ que
   * apareça na frase, monta a citação (`quoted`) para o aparelho do cliente,
   * grava a bolha com `status: "enviando"`, entrega na Evolution API e depois
   * concilia o status pelos ACKs do WhatsApp. Nenhuma dessas cinco faz sentido
   * para uma nota, e todas custam caro se saírem erradas.
   *
   * Passar um `ehNota` por dentro daquele método significaria um `if` novo em
   * cada uma das cinco etapas -- e basta UM deles ser esquecido, hoje ou em
   * qualquer mudança futura, para uma anotação interna ("cliente já deu golpe
   * antes", "checar se o boleto dele voltou") aparecer no celular do cliente.
   * Esse é o tipo de defeito que não dá para desfazer depois de acontecer.
   *
   * Aqui não existe caminho até a Evolution API. Não é uma checagem que pode
   * falhar: é a ausência da chamada.
   *
   * ── VALE EM QUALQUER CONVERSA ───────────────────────────────────────────────
   *
   * De propósito NÃO chama `_exigirAberta`. Os dois momentos em que mais se tem
   * o que anotar são justamente os que aquela regra barraria: a conversa ainda
   * na fila (o que já se descobriu antes de assumir) e a conversa recém-fechada
   * (o desfecho, que é o que a próxima pessoa precisa ler). O recorte por SETOR
   * continua valendo -- quem não pode ver a conversa não anota nela.
   */
  async adicionarNota(id, texto, acesso = null, autor = null) {
    const conversa = await conversaRepository.findByIdBasico(id);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");
    exigirAcessoSetor(acesso, conversa.setor);

    // O AUTOR VAI NO METADATA, e não embutido no texto.
    //
    // Gravar "Marco: cliente já ligou 3x" faria o nome virar parte do conteúdo:
    // não dá para reestilizar depois, não dá para filtrar por autor, e quem
    // editar a nota apaga a autoria sem querer. Guardado à parte, o nome é dado
    // e a tela decide como (e se) mostra.
    await conversaRepository.addMensagem(id, "nota", texto.trim(), {
      autorId: autor?.sub || null,
      autorNome: autor?.nome || null,
    });

    logger.info("Nota interna registrada", {
      conversaId: id,
      autor: autor?.nome || null,
    });

    // DEVOLVE A CONVERSA, e não a mensagem crua.
    //
    // Mesmo contrato do `enviarMensagem`: a Central aplica CONVERSA (ver
    // aplicarConversa / mesclarConversa, que dependem de `versao` para descartar
    // retrato velho). Devolver só a mensagem obrigaria quem chamou a costurá-la
    // no estado à mão, e essa costura é exatamente o que a versão monotônica
    // existe para evitar.
    //
    // A mesma chamada emite o evento SSE, então quem mais estiver com a conversa
    // aberta vê a nota sem F5.
    return this._emitirLeve(id);
  }

  // Envia mídia (imagem/vídeo/documento/áudio/localização) pela Evolution e
  // registra a mensagem. `media` aceita URL pública ou base64 (data URL). Para
  // a bolha do operador renderizar de volta, guardamos a própria mídia em
  // metadata.url.
  async enviarMidia(id, payload, origem = "equipe", acesso = null, autor = null) {
    const conversa = await conversaRepository.findById(id);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");
    exigirAcessoSetor(acesso, conversa.setor);
    this._exigirAberta(conversa, origem);
    // Mandar foto/audio tambem e atender (mesma regra do texto).
    await this._registrarAtendente(conversa, origem, autor);

    let { tipo, media, mimetype, fileName, caption, latitude, longitude, name, address, encaminhada } = payload;
    // Defesa em profundidade: Áudio NUNCA possui legenda ou assinatura.
    if (tipo === "audio") {
      caption = null;
    } else if (typeof caption === "string") {
      caption = caption.replace(/\0/g, "").trim();
      if (!caption) caption = null;
    }
    const rotulos = {
      imagem: "[Imagem]", video: "[Vídeo]", documento: "[Documento]",
      audio: "[Áudio]", localizacao: "[Localização]",
    };

    // O front manda data URL (base64 com prefixo). A Evolution espera base64 cru
    // ou URL http; a bolha do operador renderiza a data URL. Separamos os dois.
    const ehDataUrl = typeof media === "string" && media.startsWith("data:");
    const paraEvolution = ehDataUrl ? media.split(",")[1] : media;
    const urlBolha = ehDataUrl || (typeof media === "string" && media.startsWith("http"))
      ? media
      : `data:${mimetype || "application/octet-stream"};base64,${media}`;

    // Os BYTES vao para o disco; o banco guarda so o caminho. Antes o data URL
    // base64 inteiro ficava no metadata -- o que inchava o banco e pesava em
    // toda leitura. Se a gravacao falhar, cai no comportamento antigo (inline),
    // para nunca perder a mensagem.
    let arquivoSalvo = null;
    if (tipo !== "localizacao" && ehDataUrl) {
      try {
        arquivoSalvo = await midiaStorage.salvarDataUrl(media, mimetype);
      } catch (e) {
        logger.warn("Falha ao gravar midia em disco; mantendo inline", { message: e.message });
      }
    }

    const marcaEncaminhada = encaminhada ? { encaminhada: true } : {};
    const metadata = tipo === "localizacao"
      ? { tipo, latitude, longitude, name, address, ...marcaEncaminhada }
      : {
          ...marcaEncaminhada,
          tipo,
          // `arquivo` (novo) ou `url` (legado/URL externa) -- o mapper e a rota
          // de midia entendem os dois.
          ...(arquivoSalvo ? { arquivo: arquivoSalvo.arquivo } : { url: urlBolha }),
          mimetype: mimetype || null,
          fileName: fileName || null,
          caption: caption || null,
        };

    // Cria a bolha ANTES de enviar (status "enviando"), para o ACK de
    // entrega/leitura (messages.update) casar depois pelo waMessageId -- igual ao
    // texto. Sem isso, a midia nunca ganhava os risquinhos.
    const msgLocal = await conversaRepository.addMensagem(
      id,
      origem,
      caption || rotulos[tipo] || "[Mídia]",
      metadata,
      null,
      { status: "enviando" }
    );

    let waMessageId = null;
    let envioOk = false;
    try {
      let r;
      if (tipo === "audio") {
        r = await evolutionApi.sendWhatsAppAudio(conversa.telefone, paraEvolution, env.evolutionApi.instance);
      } else if (tipo === "localizacao") {
        r = await evolutionApi.sendLocation(conversa.telefone, { latitude, longitude, name, address }, env.evolutionApi.instance);
      } else {
        // GIF animado no Baileys nao e entregue de forma confiavel nem como
        // "image" (estatico, some) nem como "video" (bytes de .gif viram video
        // invalido e o WhatsApp nao entrega). Enviamos como DOCUMENTO (.gif):
        // chega garantido e anima ao abrir. (Animacao inline exigiria converter
        // para MP4 com ffmpeg no servidor.)
        const ehGif = String(mimetype || "").toLowerCase() === "image/gif";
        const mediatype = ehGif
          ? "document"
          : tipo === "imagem" ? "image" : tipo === "video" ? "video" : "document";
        r = await evolutionApi.sendMedia(
          conversa.telefone,
          {
            mediatype,
            media: paraEvolution,
            mimetype,
            fileName: ehGif ? (fileName || "animacao.gif") : fileName,
            caption,
          },
          env.evolutionApi.instance
        );
      }
      waMessageId = r?.key?.id || null;
      envioOk = true;
    } catch (err) {
      // Nao derruba a operacao: marca a bolha como "erro" (igual ao texto),
      // em vez de estourar 502 e sumir com a mensagem.
      logger.warn("Falha ao enviar mídia pela Evolution", { id, message: err.message });
    }

    await conversaRepository.vincularWaMessageId(msgLocal.id, waMessageId, envioOk ? "enviada" : "erro");

    const atualizada = await conversaRepository.findById(id);
    return this._emitir(atualizada);
  }

  // Transcreve o audio de uma mensagem (fala -> texto) e guarda o resultado no
  // metadata, para nao pagar/reprocessar de novo no proximo F5. Sob demanda: so
  // roda quando o operador clica em "Transcrever".
  async transcreverAudio(mensagemId, acesso = null) {
    const mensagem = await conversaRepository.findMensagem(mensagemId);
    if (!mensagem) throw new AppError("Mensagem nao encontrada", 404, "NOT_FOUND");
    await this._exigirAcessoMensagem(mensagem, acesso);

    const meta = mensagem.metadata || {};
    if (meta.tipo !== "audio") {
      throw new AppError("Esta mensagem nao e um audio.", 400, "NAO_E_AUDIO");
    }
    // Ja transcrito antes: devolve o cache, sem chamar a API de novo.
    if (meta.transcricao) return { transcricao: meta.transcricao, cache: true };

    // Os bytes vem do disco (metadata.arquivo) ou do formato legado (url).
    // Se for um link http (raro), baixa antes de mandar transcrever.
    let media = await this._midiaComoDataUrl(meta);
    if (typeof media === "string" && media.startsWith("http")) {
      const resp = await fetch(media);
      const buf = Buffer.from(await resp.arrayBuffer());
      media = `data:${meta.mimetype || "audio/ogg"};base64,${buf.toString("base64")}`;
    }
    if (!media) throw new AppError("Audio indisponivel para transcrever.", 400, "AUDIO_INDISPONIVEL");

    const texto = await transcricaoClient.transcrever(media, meta.mimetype);
    const transcricao = texto || "(nao foi possivel entender o audio)";

    await conversaRepository.atualizarMetadata(mensagemId, { ...meta, transcricao });

    // Reemite a conversa para o painel refletir a transcricao em tempo real.
    const conversa = await conversaRepository.findById(mensagem.conversaId);
    if (conversa) this._emitir(conversa);

    return { transcricao, cache: false };
  }

  /**
   * CORRIGE O TEXTO QUE O ATENDENTE ESTA ESCREVENDO -- e nada mais.
   *
   * Nao toca em conversa, mensagem nem banco: entra uma frase, sai a frase
   * corrigida. Vive neste service pelo mesmo motivo que `transcreverAudio`: e um
   * recurso DA CENTRAL, e as rotas daqui ja estao atras do modulo
   * "atendimento" -- quem pode escrever para o cliente pode corrigir o que
   * escreveu. Um modulo de IA proprio criaria uma segunda permissao para
   * responder a mesma pergunta.
   *
   * Sem cache, de proposito: cada texto e diferente, e guardar rascunho de
   * mensagem nao enviada seria criar um deposito de coisas que ninguem pediu.
   */
  async corrigirTexto(texto) {
    return correcaoClient.corrigir(texto);
  }

  // Encaminha uma mensagem existente para outra conversa (o WhatsApp reenvia o
  // conteudo; nao existe "forward nativo" pela API, entao reenviamos o texto).
  async encaminharMensagem(mensagemId, conversaDestinoId, acesso = null) {
    const original = await conversaRepository.findMensagem(mensagemId);
    if (!original) throw new AppError("Mensagem nao encontrada", 404, "NOT_FOUND");

    // NOTA INTERNA NAO SE ENCAMINHA.
    //
    // `adicionarNota` nao tem caminho ate a Evolution API -- mas ESTE metodo
    // tem, e ele aceita qualquer mensagem por id. Encaminhar uma nota cairia no
    // `enviarMensagem` (ou no `enviarMidia`) logo abaixo e entregaria no
    // WhatsApp do cliente exatamente o que a equipe escreveu para nao ser lido
    // por ele. A porta dos fundos do mesmo comodo.
    //
    // Bloqueado no SERVICE, e nao so escondendo o botao na tela: a rota aceita
    // um id qualquer, e "a interface nao oferece" nunca foi controle de acesso.
    if (original.origem === "nota") {
      throw new AppError(
        "Nota interna nao pode ser encaminhada: ela nunca sai para o cliente",
        400,
        "NOTA_NAO_ENCAMINHAVEL"
      );
    }

    // Precisa poder ler a ORIGEM (senao encaminhar seria uma leitura disfarcada)
    // e escrever no DESTINO.
    await this._exigirAcessoMensagem(original, acesso);

    const destino = await conversaRepository.findById(conversaDestinoId);
    if (!destino) throw new AppError("Conversa de destino nao encontrada", 404, "NOT_FOUND");
    exigirAcessoSetor(acesso, destino.setor);

    const meta = original.metadata || null;
    if (meta?.tipo && meta.tipo !== "texto" && (meta.arquivo || meta.url)) {
      // Le do disco (ou do legado) para reenviar os bytes pela Evolution.
      const media = await this._midiaComoDataUrl(meta);
      if (media) {
        return this.enviarMidia(conversaDestinoId, {
          tipo: meta.tipo,
          media,
          mimetype: meta.mimetype,
          fileName: meta.fileName,
          caption: meta.caption,
          // Marca real: esta bolha nasceu de um encaminhamento nosso.
          encaminhada: true,
        });
      }
    }

    return this.enviarMensagem(conversaDestinoId, original.texto, "equipe", null, null, null, {
      encaminhada: true,
    });
  }

  // Edicao de mensagem propria, como no WhatsApp. Se a Evolution recusar
  // (versao sem suporte ou janela de 15 min expirada), nada e alterado.
  async editarMensagem(mensagemId, novoTexto, acesso = null) {
    const msg = await conversaRepository.findMensagem(mensagemId);
    if (!msg) throw new AppError("Mensagem nao encontrada", 404, "NOT_FOUND");
    await this._exigirAcessoMensagem(msg, acesso);
    if (msg.origem === "cliente") {
      throw new AppError("Só é possível editar mensagens enviadas por você", 400, "EDICAO_NAO_PERMITIDA");
    }

    const texto = String(novoTexto || "").trim();
    if (!texto) throw new AppError("Informe o novo texto", 400, "TEXTO_OBRIGATORIO");

    const conversa = await conversaRepository.findById(msg.conversaId);

    if (msg.waMessageId) {
      try {
        await evolutionApi.editarMensagem(
          {
            number: conversa.telefone,
            key: {
              remoteJid: `${conversa.telefone}@s.whatsapp.net`,
              fromMe: true,
              id: msg.waMessageId,
            },
            texto,
          },
          env.evolutionApi.instance
        );
      } catch (err) {
        throw new AppError(
          `Nao foi possivel editar no WhatsApp: ${err.message}`,
          502,
          "EDICAO_FALHOU"
        );
      }
    }

    await conversaRepository.editarMensagem(mensagemId, texto);
    return this._emitir(await conversaRepository.findById(msg.conversaId));
  }

  // Apaga a mensagem para todos. Nas mensagens que NOS enviamos, dispara o
  // "apagar para todos" do WhatsApp (some tambem no aparelho do cliente). Em
  // mensagem do cliente isso e impossivel pelo WhatsApp -- entao ela some so do
  // painel. Em ambos os casos removemos a linha aqui, entao some da Central.
  async apagarMensagem(mensagemId, acesso = null) {
    const msg = await conversaRepository.findMensagem(mensagemId);
    if (!msg) {
      // Ajuda a diagnosticar o "Mensagem nao encontrada": mostra o id recebido
      // (ex.: undefined = mensagem otimista ainda nao sincronizada).
      logger.warn("Apagar: mensagem nao encontrada no banco", { mensagemId });
      throw new AppError("Mensagem nao encontrada", 404, "NOT_FOUND");
    }

    // Consulta LEVE (so setor/telefone) para o check de acesso -- nao carrega o
    // historico inteiro da conversa so para apagar uma mensagem.
    const conversa = await conversaRepository.findByIdBasico(msg.conversaId);
    exigirAcessoSetor(acesso, conversa?.setor);
    const nossa = msg.origem !== "cliente";

    // Apaga do painel PRIMEIRO (rapido) e ja responde. O "apagar para todos" no
    // WhatsApp roda em SEGUNDO PLANO: nao trava o operador nem faz o apagar do
    // painel falhar se a Evolution demorar/recusar. Soft-delete: a linha continua
    // no banco marcada como apagada (Registro/Visao Geral mantem o log completo).
    await conversaRepository.marcarMensagemApagada(mensagemId);
    const dto = this._emitir(await conversaRepository.findById(msg.conversaId));

    if (msg.waMessageId && nossa && conversa) {
      evolutionApi
        .apagarMensagem(
          { id: msg.waMessageId, remoteJid: `${conversa.telefone}@s.whatsapp.net`, fromMe: true },
          env.evolutionApi.instance
        )
        .then((r) =>
          logger.info("Apagar para todos enviado a Evolution", {
            mensagemId,
            waMessageId: msg.waMessageId,
            resposta: r ? JSON.stringify(r).slice(0, 300) : "vazio",
          })
        )
        .catch((err) =>
          logger.warn("Nao foi possivel apagar no WhatsApp (apagado so no painel)", {
            mensagemId,
            message: err.message,
          })
        );
    } else {
      logger.info("Apagar so no painel (sem waMessageId ou nao e nossa)", {
        mensagemId,
        temWaId: !!msg.waMessageId,
        nossa,
      });
    }

    return dto;
  }

  // NAO existe mais `desvincularCnpj` aqui (nem a rota DELETE /conversas/:id/cnpj).
  //
  // O "X" que removia o CNPJ da conversa saiu da interface: uma vez identificado,
  // o cliente fica identificado. Existe UM caminho de correcao, e ele nao e um
  // clique solto em tela nenhuma: o proprio cliente responde "NAO" quando o bot
  // confirma o CNPJ anterior, e o motor desassocia a conversa e pergunta o novo
  // (chatbot.engine._desassociarCnpj).
  //
  // O outro caminho que existia -- desvincular o contato a mao em Clientes
  // (CNPJ) -- tambem foi removido, junto com a rota que ele chamava: eram duas
  // regras disputando o mesmo vinculo, e a manual nao tinha contexto nenhum.

  async solicitarCnpj(id, acesso = null) {
    const conversa = await conversaRepository.findById(id);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");
    exigirAcessoSetor(acesso, conversa.setor);
    const msg = "[Arka Tecnologia]: Para prosseguirmos e verificar beneficios de parceiro, informe o CNPJ da sua empresa:";
    return this.enviarMensagem(id, msg, "bot");
  }

  async validarCnpjManual(id, cnpj, acesso = null) {
    const conversa = await conversaRepository.findById(id);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");
    exigirAcessoSetor(acesso, conversa.setor);

    const cnpjLimpo = limparCnpj(cnpj);
    if (!documentoValido(cnpjLimpo)) {
      throw new AppError("CPF ou CNPJ invalido", 400, "INVALID_CNPJ");
    }

    const parceiro = await parceiroRepository.findAtivoByCnpj(cnpjLimpo);

    await conversaRepository.update(id, {
      cnpj: cnpjLimpo,
      empresa: parceiro?.razaoSocial || null,
      cnpjVerificado: true,
      clienteTipo: parceiro ? "cadastrado" : "avulso",
    });

    // A TERCEIRA COPIA DA MESMA REGRA SAIU DAQUI.
    //
    // Esta gravava a bolha E a mandava para o WhatsApp -- com uma redacao
    // propria, "(parceiro cadastrado)", diferente das outras duas. Tres
    // caminhos, tres textos, todos narrando ao cliente uma consulta interna que
    // ele nao pediu.
    //
    // Quem dispara isto e um atendente clicando em "validar CNPJ" na Central: o
    // resultado e para ELE, e ele o recebe pelo caminho de sempre -- a conversa
    // volta com `empresa` preenchida e o cabecalho do atendimento passa a
    // mostrar a razao social. Nao ha nada a dizer ao cliente.
    logger.info("CNPJ validado manualmente pela equipe", {
      conversaId: id,
      empresa: parceiro?.razaoSocial || null,
      cadastrado: !!parceiro,
    });

    return this._emitir(await conversaRepository.findById(id));
  }

  /**
   * Marca quem esta atendendo, quando a conversa esta sem responsavel.
   *
   * Grava as DUAS coisas de proposito: `atendenteId` (responsavel ATUAL, que e
   * limpo se a conversa voltar para a fila) e `ultimoAtendenteNome` (historico,
   * que sobrevive a isso e e o que alimenta a coluna "Atendente" das
   * avaliacoes). Sem o segundo, o relatorio esquece quem atendeu.
   *
   * Silencioso por design: e efeito colateral de responder/reabrir, nao a acao
   * pedida. Se falhar, a mensagem do operador nao pode deixar de sair.
   */
  async _registrarAtendente(conversa, origem, autor) {
    if (origem !== "equipe" || !autor?.sub) return;
    if (conversa.atendenteId) return; // ja tem responsavel: nao rouba
    try {
      const usuario = await usuarioRepository.findById(autor.sub);
      if (!usuario) return;
      await conversaRepository.update(conversa.id, {
        atendenteId: usuario.id,
        ultimoAtendenteNome: usuario.nome,
        atendidoEm: conversa.atendidoEm || new Date(),
      });
    } catch (e) {
      logger.warn("Nao foi possivel registrar o atendente", { id: conversa.id, message: e.message });
    }
  }

  async atualizarStatus(id, status, acesso = null, autor = null, motivo = null) {
    const conversa = await conversaRepository.findById(id);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");
    exigirAcessoSetor(acesso, conversa.setor);

    const mudouStatus = conversa.statusAtendimento !== status;
    const data = { statusAtendimento: status };
    // Espelho do mesmo estado na OS em curso (ver model Atendimento). Montado
    // junto com `data` para nao existir caminho em que a conversa muda e a OS
    // fica para tras.
    const dataOS = { status };
    if (status === "fechada") {
      // MOTIVO OBRIGATORIO -- mas so quando quem fecha e uma PESSOA.
      //
      // `mudouStatus` importa: fechar o que ja esta fechado (duplo clique, ou o
      // painel reenviando o estado) nao pode exigir motivo de novo nem apagar o
      // que ja foi escolhido.
      //
      // E `autor` importa mais ainda: os fechamentos do bot NAO passam por aqui
      // (o engine escreve direto no repositorio, ver _motivoAutomatico la), mas
      // existem outras chamadas internas sem autor humano. Exigir motivo delas
      // travaria o sistema numa regra que so faz sentido para quem tem uma tela
      // na frente.
      if (mudouStatus && autor?.sub) {
        const permitidos = await configuracaoService.motivosEncerramento();
        const escolhido = String(motivo || "").trim();
        if (!escolhido) {
          throw new AppError(
            "Escolha o motivo do encerramento para fechar o atendimento",
            400,
            "MOTIVO_OBRIGATORIO"
          );
        }
        // A LISTA E VALIDADA NO SERVIDOR, e nao so montada na tela.
        //
        // Sem isto, qualquer texto enviado direto para a rota viraria um "motivo"
        // novo, e a taxonomia -- que existe justamente para ser um conjunto
        // fechado e somavel -- viraria campo livre com grafias divergentes
        // ("boleto", "Boleto", "financeiro/boleto") impossiveis de agrupar.
        if (!permitidos.includes(escolhido)) {
          throw new AppError(
            "Motivo de encerramento invalido: escolha um da lista",
            400,
            "MOTIVO_INVALIDO"
          );
        }
        dataOS.motivo = escolhido;
      }
      data.fechadoEm = new Date();
      data.lido = true;
      data.naoLidas = 0;
      dataOS.fechadoEm = data.fechadoEm;
    } else if (status === "aberta") {
      // Reabertura: limpa o fechamento e garante marca de atendimento. REABRIR
      // continua na MESMA OS (e a continuacao do atendimento); OS nova so
      // quando o cliente inicia um ciclo novo depois do fechamento.
      data.fechadoEm = null;
      dataOS.fechadoEm = null;
      // O MOTIVO SAI JUNTO COM O FECHAMENTO.
      //
      // Reabrir continua a MESMA OS, e o motivo descreve como ela TERMINOU --
      // um ciclo reaberto nao terminou. Mantê-lo aqui deixaria a OS aberta
      // carregando um desfecho que ainda nao aconteceu, e o relatorio contaria
      // como resolvido por "Backup e restauracao" um chamado que segue em curso.
      // No proximo fechamento a pessoa escolhe de novo, ja sabendo como acabou.
      dataOS.motivo = null;
      data.atendidoEm = conversa.atendidoEm || new Date();
      dataOS.atendidoEm = data.atendidoEm;
      // Quem reabre assume, se ninguem assumiu. Antes a conversa voltava a
      // ficar aberta SEM responsavel, e o atendimento inteiro corria anonimo --
      // era um dos caminhos que deixava a coluna "Atendente" vazia na avaliacao.
      if (!conversa.atendenteId && autor?.sub) {
        data.atendenteId = autor.sub;
        dataOS.atendenteId = autor.sub;
        if (autor.nome) {
          data.ultimoAtendenteNome = autor.nome;
          dataOS.atendenteNome = autor.nome;
        }
      }
    } else if (status === "pendente") {
      // Volta para a fila: perde o responsavel -- a badge some enquanto pendente.
      data.atendenteId = null;
      dataOS.atendenteId = null;
    }

    // Linha antiga (de antes das OS) ainda nao tem atendimento nenhum: cria o
    // primeiro para o espelho abaixo ter onde escrever. Nao abre ciclo novo --
    // "Reabrir" continua a MESMA OS, so limpando o fechamento.
    await conversaRepository.garantirAtendimento(id);
    await conversaRepository.update(id, data);
    await conversaRepository.atualizarAtendimentoAtual(id, dataOS);

    // Aviso de sistema no chat, com o nome de quem fez a acao (nao vai para o
    // WhatsApp do cliente). So quando o status muda de fato e ha um autor
    // humano -- fechamentos automaticos do bot nao geram aviso.
    const nome = autor?.nome;
    if (nome && mudouStatus) {
      if (status === "pendente") {
        await conversaRepository.addMensagem(id, "sistema", `${nome} devolveu a conversa para a fila (Pendente)`);
      } else if (status === "fechada") {
        await conversaRepository.addMensagem(id, "sistema", `${nome} fechou o atendimento`);
      }
    }

    const recarregada = await conversaRepository.findById(id);
    const dto = this._emitir(recarregada);

    // Ao FECHAR (atendimento humano), dispara a pesquisa de satisfacao: pergunta
    // a nota de 1 a 5 e o comentario. Best-effort e nao-bloqueante - um erro na
    // pesquisa nunca deve impedir o fechamento pedido pelo atendente. O motor
    // respeita o modo "local", o toggle e nao repergunta se ja tem nota.
    if (status === "fechada" && mudouStatus) {
      this._dispararPesquisaSatisfacao(recarregada).catch((e) =>
        logger.warn("Falha ao iniciar pesquisa de satisfacao", { id, message: e.message })
      );
    }

    return dto;
  }

  // Ponte para o motor do chatbot: require tardio para evitar ciclo de import
  // (o engine nao depende deste service, mas manter o require local e mais seguro).
  async _dispararPesquisaSatisfacao(conversa) {
    const chatbotEngine = require("../chatbot/chatbot.engine");
    const { comLock } = require("../../shared/helpers/lock.helper");
    // MESMA FILA do webhook (instancia:telefone).
    //
    // Esta pesquisa roda em SEGUNDO PLANO depois do fechamento. Sem a fila, uma
    // mensagem do cliente chegando nesse exato intervalo era processada em
    // paralelo: abria um atendimento novo e, logo em seguida, a pesquisa fechava
    // esse atendimento recem-aberto. Serializar as duas coisas elimina a corrida
    // na origem -- e o guard de ciclo no engine e a segunda linha de defesa.
    //
    // A fila e tomada AQUI e nao dentro do engine porque o caminho do fluxo
    // (encerrarAtendimento) ja roda dentro dela: pedir a mesma chave duas vezes
    // travaria a conversa para sempre.
    await comLock(`${conversa.instanciaId}:${conversa.telefone}`, () =>
      // instanceName fica null de proposito: o engine cai no env.evolutionApi.instance,
      // mesma instancia usada por _enviarWhatsApp neste service (setup single-instance).
      chatbotEngine.iniciarPesquisaSatisfacao({
        conversa,
        telefone: conversa.telefone,
        instanciaId: conversa.instanciaId,
        instanceName: null,
      })
    );
  }

  /**
   * PARA QUEM DA PARA TRANSFERIR ESTA CONVERSA.
   *
   * ── POR QUE ISTO EXISTE, EM VEZ DE REUSAR /api/equipe ─────────────────────
   *
   * O seletor de transferencia usava a lista global da equipe, que vem de
   * `GET /api/equipe`. Essa rota e guardada por `exigirModulo("equipe")` -- o
   * modulo da tela de GESTAO DA EQUIPE, que na matriz de permissoes e do grupo
   * A e, por padrao, so o Comercial tem.
   *
   * Resultado: Tecnico e Financeiro levavam 403. E o erro nao aparecia, porque
   * o AppContext carrega tudo com `Promise.allSettled` e transforma promessa
   * rejeitada em lista vazia. Na tela: "Nenhum outro operador com conta" -- com
   * a base cheia de operadores.
   *
   * A consulta nunca foi o problema: `equipe.service.listar()` nao filtra cargo
   * nenhum. O problema era a PORTA. Transferir uma conversa tinha passado a
   * depender do modulo de ADMINISTRAR a equipe, que e outra coisa: quem atende
   * precisa saber para quem mandar, nao precisa da tela de gestao.
   *
   * Por isso a correcao NAO e dar o modulo "equipe" ao Tecnico -- isso abriria
   * a tela de gestao junto, e com ela a listagem de e-mails da equipe. E esta
   * rota, sob `atendimento` (o modulo que ele ja precisa ter para estar nesta
   * tela), devolvendo SO o que serve para escolher um destino: id, nome, cargo
   * e presenca. Sem e-mail, sem data de criacao, sem nada de gestao.
   *
   * `conversaId` e opcional. Quando vem, cada operador recebe tambem
   * `podeVerConversa`: e o mesmo `podeAcessarSetor` que decide a leitura, e
   * serve para a tela avisar antes que transferir para um colega de outro setor
   * manda a conversa para alguem que nao vai conseguir abri-la. Ninguem e
   * ESCONDIDO por isso -- a decisao continua sendo de quem atende.
   */
  async listarAtendentes(conversaId = null, acesso = null) {
    let setor = null;
    if (conversaId) {
      const conversa = await conversaRepository.findById(conversaId);
      if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");
      // Quem nao enxerga a conversa nao tem por que saber para quem ela poderia
      // ir: o guard de setor vale aqui pela mesma razao que vale na leitura.
      exigirAcessoSetor(acesso, conversa.setor);
      setor = conversa.setor;
    }

    const usuarios = await usuarioRepository.listarTodos();
    const agora = Date.now();

    return usuarios
      // Conta desativada nao pode receber conversa: ela nao entra no painel
      // para atender. Este e o unico filtro -- e ele nao e sobre cargo.
      .filter((u) => u.ativo)
      .map((u) => {
        const visto = u.ultimoAcessoEm ? new Date(u.ultimoAcessoEm).getTime() : 0;
        return {
          id: u.id,
          nome: u.nome,
          cargo: u.cargo,
          // Mesmo vocabulario e mesma janela que a Gestao da Equipe usa, para
          // as duas telas nao discordarem sobre quem esta online.
          status: agora - visto < JANELA_ONLINE_MS ? "online" : "offline",
          ...(setor !== null ? { podeVerConversa: podeAcessarSetor(u, setor) } : {}),
        };
      });
  }

  /**
   * DEFINE (OU LIMPA) O RESPONSAVEL PELA CONVERSA.
   *
   * ── QUEM PODE TRANSFERIR: QUALQUER PESSOA COM ACESSO AO SETOR ─────────────
   *
   * Regra atual, e ela e uma so: `exigirAcessoSetor`. Quem enxerga a conversa
   * pode trocar o responsavel dela -- para um colega, para si mesmo (o "puxar
   * para si"), ou remover a atribuicao.
   *
   * ISTO E UMA REVERSAO DELIBERADA, pedida pela operacao em 2026-08-28.
   *
   * Por algumas horas a regra exigiu tambem ser o dono (ou Administrador). A
   * intencao era boa -- ninguem tira do colega a conversa que ele esta
   * atendendo. Na pratica travou o uso normal: quem precisava assumir uma
   * conversa que estava com outra pessoa (o colega saiu para almocar, entrou em
   * reuniao, atendeu no lugar errado) batia em 403 e nao tinha o que fazer sem
   * chamar um Administrador. Numa equipe pequena isso custa mais do que o
   * problema que resolvia.
   *
   * O QUE SEGUE VALENDO, de proposito:
   *
   *   - `exigirAcessoSetor`: alguem do Financeiro nao mexe em conversa do
   *     Tecnico. Isso e escopo de DADOS, nao etiqueta de equipe -- a pessoa nem
   *     deveria ver a conversa. Se um dia precisar cair, e outro pedido.
   *   - a troca ATOMICA e o 409: duas pessoas transferindo ao mesmo tempo para
   *     destinos diferentes continuam nao sobrescrevendo uma a outra em
   *     silencio (ver abaixo). Agora que qualquer um transfere, isso importa
   *     MAIS, nao menos.
   *   - o registro de QUEM transferiu: com a trava de dono, o autor era sempre
   *     o dono ou um admin e dava para deduzir. Sem ela, nao da -- entao o aviso
   *     no historico passa a dizer quem fez a troca quando a conversa muda de
   *     mao, e o log guarda autor e destino.
   *
   * `autorId` continua vindo do TOKEN (req.user.sub), nunca do corpo: ele
   * alimenta o registro de autoria, e id mandado pelo cliente e so um campo
   * JSON que qualquer um digita.
   *
   * ── E POR QUE A TROCA E ATOMICA ───────────────────────────────────────────
   *
   * Ler o dono e depois gravar por cima e uma corrida: dois cliques (ou dois
   * atendentes) passavam os dois, e o historico ganhava DUAS mensagens
   * "Conversa transferida para ...", cada uma para uma pessoa diferente. A
   * troca vai para `transferirAtomico`, que so grava se o dono ainda for o que
   * foi lido -- mesma solucao ja usada em `assumirAtomico`.
   */
  async definirAtendente(id, atendenteId, acesso = null, autorId = null) {
    const conversa = await conversaRepository.findById(id);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");
    exigirAcessoSetor(acesso, conversa.setor);

    const donoAtual = conversa.atendenteId || null;

    // AQUI EXISTIA O 403 "NAO_E_O_RESPONSAVEL".
    //
    // Ele exigia ser o dono da conversa (ou Administrador) para trocar o
    // responsavel. Removido a pedido da operacao: travava quem precisava assumir
    // uma conversa que estava com um colega ausente. Ver o cabecalho deste
    // metodo. O guard de SETOR, acima, continua sendo a autorizacao real.

    let novoId = null;
    let nome = null;
    // O SETOR VAI COM A CONVERSA.
    //
    // Transferir para alguem de outro setor entregava a conversa a quem nao
    // conseguia abri-la: `podeAcessarSetor` deixa cada cargo ver so o proprio
    // setor, e a conversa continuava no setor antigo. O modal avisava
    // ("nao enxerga o setor desta conversa") e o operador transferia mesmo
    // assim, porque era o certo a fazer -- so que o destinatario ficava sem ver.
    //
    // Agora a conversa MUDA de setor junto. Isso nao contraria "setor so por
    // escolha" (o bot nunca adivinha setor): uma transferencia feita por uma
    // pessoa E uma escolha explicita, do mesmo tipo que a do cliente no menu.
    //
    // `acharSetor` do CARGO: as strings sao as mesmas ("Tecnico", "Comercial",
    // "Financeiro"). Devolve null para "Administrador" -- que nao tem setor e
    // portanto nao move a conversa para lugar nenhum.
    let setorDestino = null;
    if (typeof atendenteId === "string" && atendenteId.trim()) {
      const usuario = await usuarioRepository.findById(atendenteId.trim());
      if (!usuario) throw new AppError("Atendente nao encontrado", 400, "ATENDENTE_INVALIDO");
      novoId = usuario.id;
      nome = usuario.nome;
      setorDestino = acharSetor(usuario.cargo);
    }

    // IDEMPOTENCIA. Transferir para quem ja e o dono nao e erro -- e um clique
    // repetido, um reenvio, uma reconexao. Devolve o estado atual sem gravar
    // nada e, principalmente, SEM um segundo aviso no historico. Sem isto, o
    // duplo-clique deixava duas linhas identicas no fio da conversa.
    if (novoId === donoAtual) {
      return mapConversa(conversa);
    }

    // Guarda tambem o nome como historico (ver ultimoAtendenteNome no schema):
    // ao remover a atribuicao, o relatorio continua sabendo quem atendeu.
    await conversaRepository.garantirAtendimento(id);

    const { transferido } = await conversaRepository.transferirAtomico(id, donoAtual, novoId, nome);
    if (!transferido) {
      // O dono mudou entre a leitura e a escrita. Duas situacoes MUITO
      // diferentes cabem aqui, e tratar as duas como erro seria errado:
      const agora = await conversaRepository.findById(id);

      // (a) alguem ja colocou a conversa exatamente onde esta requisicao queria.
      //     E o duplo-clique: os dois pedidos leem o mesmo dono, o primeiro
      //     grava, o segundo encontra a condicao vencida. Nao ha nada a
      //     corrigir -- o resultado pedido E o estado atual. Devolve sucesso
      //     sem gravar de novo e, principalmente, sem um segundo aviso no fio.
      if ((agora?.atendenteId || null) === novoId) return mapConversa(agora);

      // (b) alguem transferiu para OUTRA pessoa. Ai e conflito de verdade: nao
      //     sobrescreve a decisao do outro, e devolve 409 para a tela mostrar a
      //     verdade em vez da intencao.
      throw new AppError(
        "Esta conversa acabou de ser transferida por outra pessoa. Recarregue para ver quem esta com ela.",
        409,
        "TRANSFERENCIA_CONFLITO"
      );
    }

    // A conversa muda de setor quando o destino e de outro setor. `null` em
    // `setorDestino` (Administrador, ou remocao da atribuicao) nao move nada --
    // tirar o setor de uma conversa por causa de um escalonamento seria perder
    // triagem que alguem ja fez.
    const setorAtual = normalizarSetor(conversa.setor);
    const setorNovo = setorDestino && setorDestino !== setorAtual ? setorDestino : null;
    if (setorNovo) {
      await conversaRepository.update(id, { setor: setorNovo });
      logger.info("Setor da conversa alterado pela transferencia", {
        conversaId: id,
        de: setorAtual,
        para: setorNovo,
        porUsuarioId: autorId || null,
      });
    }

    // A OS em curso acompanha a transferencia: e ela que o historico mostra. O
    // setor vai junto pelo mesmo motivo -- Conversa, OS e Feedback leem o mesmo
    // campo, e as tres telas precisam concordar sem F5.
    await conversaRepository.atualizarAtendimentoAtual(id, {
      atendenteId: novoId,
      ...(nome ? { atendenteNome: nome } : {}),
      ...(setorNovo ? { setor: setorNovo } : {}),
    });

    // QUEM FEZ A TROCA entra no registro.
    //
    // Com a trava de dono, o autor era necessariamente o dono anterior ou um
    // Administrador -- dava para deduzir de quem partiu. Agora que qualquer
    // pessoa do setor transfere, nao da: sem isto, uma conversa mudava de mao e
    // o historico nao dizia por ordem de quem.
    //
    // So aparece quando a conversa TINHA dono e ele mudou. Atribuir uma conversa
    // da fila (o caso comum) segue com o aviso curto de antes.
    let autorNome = null;
    if (autorId && donoAtual && donoAtual !== autorId) {
      const autor = await usuarioRepository.findById(autorId).catch(() => null);
      autorNome = autor?.nome || null;
    }

    logger.info("Responsavel da conversa alterado", {
      conversaId: id,
      de: donoAtual,
      para: novoId,
      porUsuarioId: autorId || null,
    });

    // Aviso de sistema no chat quando ha um novo responsavel. Fica so no
    // historico interno -- nao vai para o WhatsApp do cliente.
    //
    // Tres frases, porque sao tres acontecimentos diferentes:
    //
    //   "Conversa transferida para Carla"            -> saiu da fila (sem dono antes)
    //   "Conversa transferida para Carla por Alice"  -> Alice passou a de outra pessoa
    //   "Conversa assumida por Bruno"                -> Bruno puxou para si
    //
    // A terceira existe porque "transferida para Bruno por Bruno" e o que sai
    // quando alguem assume a conversa de um colega -- redundante e confuso para
    // quem le o historico depois.
    if (novoId) {
      let texto = `Conversa transferida para ${nome}`;
      if (autorNome && novoId === autorId) texto = `Conversa assumida por ${autorNome}`;
      else if (autorNome) texto = `Conversa transferida para ${nome} por ${autorNome}`;
      // A mudanca de setor entra na MESMA linha, e nao numa segunda mensagem:
      // e um acontecimento so, e duas linhas seguidas sobre a mesma troca
      // poluem o historico.
      if (setorNovo) texto += ` (setor ${setorAtual} -> ${setorNovo})`;
      await conversaRepository.addMensagem(id, "sistema", texto);
    }

    // Recarrega para o DTO/stream ja saírem com o aviso incluido.
    //
    // `setorAnterior` viaja QUANDO o setor mudou: e o que faz a conversa SAIR da
    // tela de quem ficou no setor de origem, em vez de congelar la (ver
    // conversa.stream). Sem isto, transferir do Comercial para o Tecnico deixava
    // a conversa parada na lista do Comercial ate alguem apertar F5.
    return this._emitir(await conversaRepository.findById(id), { setorAnterior: setorNovo ? setorAtual : null });
  }

  // Favoritar / fixar / arquivar / ocultar. Nenhuma delas apaga a conversa:
  // arquivada e oculta apenas somem da listagem quando o filtro esta desligado.
  async atualizarFlags(id, flags, acesso = null) {
    const conversa = await conversaRepository.findById(id);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");
    exigirAcessoSetor(acesso, conversa.setor);

    const data = {};
    for (const campo of ["favorita", "fixada", "arquivada", "oculta"]) {
      if (flags[campo] !== undefined) data[campo] = flags[campo];
    }
    if (Object.keys(data).length === 0) return mapConversa(conversa);

    const atualizada = await conversaRepository.update(id, data);
    return this._emitir(atualizada);
  }

  async marcarLido(id, acesso = null) {
    const conversa = await conversaRepository.findById(id);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");
    exigirAcessoSetor(acesso, conversa.setor);
    const atualizada = await conversaRepository.zerarNaoLidas(id);
    return this._emitir(atualizada);
  }

  async atualizarSetor(id, setor, acesso = null) {
    const conversa = await conversaRepository.findById(id);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");
    // Precisa poder mexer na conversa de ORIGEM. O destino fica livre de
    // proposito: triar/encaminhar uma conversa "Geral" para o setor certo e
    // justamente o fluxo esperado, e mover nao expoe conteudo nenhum.
    exigirAcessoSetor(acesso, conversa.setor);
    const atualizada = await conversaRepository.update(id, { setor });
    return this._emitir(atualizada);
  }

  async avaliarAtendimento(id, { avaliacao, feedback }, acesso = null) {
    const conversa = await conversaRepository.findById(id);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");
    exigirAcessoSetor(acesso, conversa.setor);
    const nota = Number(avaliacao) || null;
    const texto = feedback ? String(feedback).trim() : null;

    await conversaRepository.garantirAtendimento(id);
    const atualizada = await conversaRepository.update(id, { avaliacao: nota, feedback: texto });
    // A nota pertence ao CICLO: com um fio unico por cliente, guardar so na
    // conversa faria cada novo atendimento apagar a nota do anterior.
    await conversaRepository.atualizarAtendimentoAtual(id, { avaliacao: nota, feedback: texto });
    return this._emitir(atualizada);
  }

  async remover(id, acesso = null) {
    const conversa = await conversaRepository.findById(id);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");
    exigirAcessoSetor(acesso, conversa.setor);
    await conversaRepository.delete(id);
    bus.emitDelete(id);
    return { removido: true };
  }

  // Mapeia, publica no barramento (SSE) e devolve o DTO. Fonte unica de emissao
  // para as operacoes administrativas desta tela.
  // Bytes da midia de uma mensagem, para a rota que serve /midia. Devolve
  // { buffer, mimetype, fileName } ou null quando a mensagem nao tem midia
  // embutida (ex.: ja e uma URL http externa).
  // Data URL da midia de uma mensagem, venha ela do disco (metadata.arquivo) ou
  // do formato legado (metadata.url base64). Usado por quem precisa dos BYTES em
  // base64: encaminhar (reenvia pela Evolution) e transcrever audio.
  async _midiaComoDataUrl(meta) {
    if (!meta) return null;
    if (meta.arquivo) {
      const aberto = await midiaStorage.abrirParaLeitura(meta.arquivo);
      if (!aberto) return null;
      const partes = [];
      for await (const p of aberto.stream) partes.push(p);
      const buf = Buffer.concat(partes);
      return `data:${meta.mimetype || "application/octet-stream"};base64,${buf.toString("base64")}`;
    }
    return meta.url || null;
  }

  // `faixa` (opcional) vem do cabecalho Range: entrega so o pedaco pedido, que e
  // o que permite ao player descobrir a duracao e procurar dentro do arquivo.
  async obterMidiaBruta(mensagemId, faixa = null) {
    const msg = await conversaRepository.findMensagem(mensagemId);
    const meta = msg?.metadata;
    if (!meta) return null;

    // Novo: arquivo no disco -> devolve um STREAM (nao carrega na memoria).
    if (meta.arquivo) {
      const aberto = await midiaStorage.abrirParaLeitura(meta.arquivo, faixa);
      if (aberto) {
        return {
          stream: aberto.stream,
          tamanho: aberto.tamanho,
          total: aberto.total,
          inicio: aberto.inicio,
          fim: aberto.fim,
          parcial: !!aberto.parcial,
          mimetype: meta.mimetype || "application/octet-stream",
          fileName: meta.fileName || null,
        };
      }
      return null;
    }

    // Legado: data URL base64 guardada no banco.
    const url = meta.url;
    if (typeof url !== "string" || !url.startsWith("data:")) return null;
    const virgula = url.indexOf(",");
    if (virgula === -1) return null;
    const cabecalho = url.slice(5, virgula); // "image/png;base64"
    const mimetype = (cabecalho.split(";")[0] || "application/octet-stream").trim();
    let buffer;
    try {
      buffer = Buffer.from(url.slice(virgula + 1), "base64");
    } catch {
      return null;
    }
    // Legado tambem respeita faixa: o player nao sabe (nem precisa saber) se o
    // arquivo veio do disco ou do banco.
    const total = buffer.length;
    if (faixa && total > 0) {
      const inicio = Math.min(Math.max(0, Number(faixa.inicio) || 0), total - 1);
      const fimPedido = Number.isFinite(faixa.fim) ? Number(faixa.fim) : total - 1;
      const fim = Math.min(Math.max(inicio, fimPedido), total - 1);
      return {
        buffer: buffer.subarray(inicio, fim + 1),
        tamanho: fim - inicio + 1,
        total, inicio, fim, parcial: true,
        mimetype, fileName: meta.fileName || null,
      };
    }
    return { buffer, tamanho: total, total, mimetype, fileName: meta.fileName || null };
  }

  /**
   * Emite a conversa e devolve o DTO (que tambem e a resposta HTTP da acao).
   *
   * A LISTA DE MENSAGENS VAI CORTADA NA CAUDA. Toda acao -- atender, marcar
   * lido, mudar setor, avaliar -- reserializava o historico inteiro so para
   * anunciar que um campo escalar mudou: medido, 69ms de `mapConversa` num fio
   * de 1000 mensagens, 182ms em 3000. O corte nao perde nada porque os dois
   * consumidores do DTO passam pelo mesmo merge (`utils/mesclarConversa`, via
   * SSE e via `aplicarConversa`), e ele mantem o que a tela ja tem quando o
   * retrato vem marcado como `parcial`.
   *
   * `completo: true` para quem realmente precisa do fio inteiro numa resposta
   * -- hoje ninguem, mas a porta fica aberta e explicita em vez de alguem
   * "consertar" o corte sem entender por que ele existe.
   *
   * Quem serve o historico e a LEITURA (`obter`/`listar`), que segue completa:
   * e de la que a Central carrega a conversa e a busca varre as mensagens.
   */
  _emitir(conversa, { completo = false, setorAnterior = null } = {}) {
    if (!conversa) return null;
    const dto = mapConversa(
      completo
        ? conversa
        : { ...conversa, mensagens: (conversa.mensagens || []).slice(-CAUDA_EVENTO), __parcial: true }
    );
    // `setorAnterior` so viaja quando ESTA emissao mudou o setor: e por ele que o
    // stream avisa quem perdeu o acesso a tirar a conversa da tela.
    bus.emitConversa(dto, { setorAnterior });
    return dto;
  }

  // Envia e devolve o id da mensagem na Evolution, necessario para casar os
  // ACKs de entrega/leitura (messages.update) com a mensagem local.
  async _enviarWhatsApp(telefone, texto, quoted = null) {
    try {
      const r = await evolutionApi.sendText(telefone, texto, env.evolutionApi.instance, quoted);
      return { ok: true, waMessageId: r?.key?.id || null };
    } catch {
      // nao bloqueia operacao administrativa se Evolution estiver offline
      return { ok: false, waMessageId: null };
    }
  }
}

module.exports = new ConversaService();
