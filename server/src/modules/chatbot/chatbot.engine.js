const fluxoRepository = require("../../infrastructure/repositories/fluxo.repository");
const conversaRepository = require("../../infrastructure/repositories/conversa.repository");
const sessaoRepository = require("../../infrastructure/repositories/sessao.repository");
const parceiroRepository = require("../../infrastructure/repositories/parceiro.repository");
const evolutionApi = require("../../infrastructure/external/evolution-api.client");
const mockErp = require("../../infrastructure/external/mock-erp.service");
const {
  limparCnpj,
  cnpjValido,
  mascararCnpj,
  partesBrasilia,
  sleep,
} = require("../../shared/helpers/cnpj.helper");
const { comLock } = require("../../shared/helpers/lock.helper");
// PARAMETROS DA AUTOMACAO: quem manda e o FLUXO, nao o codigo. Ver
// fluxos/fluxo.automacao.js -- todo texto, tentativa e prazo do bot sai de la.
const { paramsCnpj, paramsAvaliacao, paramsTempos } = require("../fluxos/fluxo.automacao");
// Setor do atendimento: so por DECLARACAO (opcao escolhida no menu, mapa de
// filas, ou o que a conversa ja tem). Nunca deduzido do texto -- ver setor.helper.
const {
  resolverSetorDeclarado,
  setorDaOpcaoEscolhida,
  SETOR_PADRAO,
} = require("../../shared/helpers/setor.helper");
const { mapConversa } = require("../../shared/helpers/mapper.helper");
const configuracaoService = require("../configuracoes/configuracao.service");
const n8nClient = require("../../infrastructure/external/n8n.client");
const bus = require("../../shared/events/event-bus");
const logger = require("../../config/logger");
const env = require("../../config/env");
const { sessao: cfgSessao, limites, palavrasChave } = require("./chatbot.config");

// Blocos que NAO sao passos da conversa: sao regras SOBRE ela. O motor nunca
// "entra" neles -- a anotacao e um post-it, e o bloco de espera e um relogio
// lido pela varredura (ver fluxo.automacao.blocoEspera).
const NAO_CAMINHAVEIS = ["comentario", "espera"];

// Dependencias em um objeto injetavel. O motor usa `this.deps.*` em vez dos
// modulos direto para que o simulador (chatbot.simulador.js) possa rodar
// EXATAMENTE este codigo com conversa/sessao em memoria e sem tocar o WhatsApp.
// Sem essa costura, testar um fluxo exigiria reimplementar a orquestracao em
// outro lugar - e uma copia que envelhece sozinha mente sobre o bot.
const DEPENDENCIAS_PADRAO = {
  fluxoRepository,
  conversaRepository,
  sessaoRepository,
  parceiroRepository,
  evolutionApi,
  mockErp,
  n8nClient,
  configuracaoService,
  bus,
};

// Estados possiveis de `sessao.aguardando`:
//   cnpj   -> proxima mensagem do cliente e tratada como CNPJ
//   cnpj_confirma -> cliente recorrente: proxima mensagem e "sim"/"nao" para o
//             CNPJ que ele ja usou em atendimentos anteriores
//   menu   -> proxima mensagem e tratada como escolha numerica do menu de FLUXOS
//   opcao  -> proxima mensagem e casada com as opcoes do passo atual
//             (`config.opcoes`, vindo de fluxos importados)
//   humano -> conversa transferida; o bot fica calado ate expirar ou ser atendida
//   avaliacao_nota       -> proxima mensagem e a nota (1..5) da pesquisa de satisfacao
//   avaliacao_comentario -> proxima mensagem e o comentario livre da pesquisa
const AGUARDANDO = {
  CNPJ: "cnpj",
  // Cliente recorrente: em vez de pedir o CNPJ de novo, o bot mostra o que ele
  // ja usou antes e espera "sim"/"nao" (ver memoria de contato em pedirCnpj).
  CNPJ_CONFIRMA: "cnpj_confirma",
  MENU: "menu",
  OPCAO: "opcao",
  HUMANO: "humano",
  AVALIACAO_NOTA: "avaliacao_nota",
  AVALIACAO_COMENTARIO: "avaliacao_comentario",
};

// Gatilho que casa com qualquer primeira mensagem (fluxo de boas-vindas).
const GATILHO_CURINGA = "*";

function escaparRegex(texto) {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

class ChatbotEngine {
  constructor(deps = {}) {
    this.deps = { ...DEPENDENCIAS_PADRAO, ...deps };
  }

  normalizarTexto(texto) {
    return String(texto || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  }

  extrairTextoMensagem(texto) {
    return String(texto || "").trim();
  }

  // Substitui as variaveis do texto do passo. O motor nunca fazia isso: tanto o
  // "{{name}}" dos fluxos importados quanto o "{{cliente.nome}}" que os botoes
  // de variavel do editor inserem iam crus para o WhatsApp. Chave desconhecida
  // vira string vazia - um placeholder tecnico vazando para o cliente e pior
  // que a lacuna - e fica registrada no log para dar para investigar.
  interpolar(texto, contexto = {}) {
    const str = String(texto ?? "");
    if (!str.includes("{{")) return str;

    const conversa = contexto.conversa || {};
    const cnpj = conversa.cnpj || contexto.cnpjValidacao?.cnpj || null;
    const parceiro = contexto.cnpjValidacao?.parceiro || null;

    const valores = {
      name: conversa.cliente,
      // Forma curta, usada pelos textos configurados no fluxo ("Ei {{cliente}}!").
      cliente: conversa.cliente,
      "cliente.nome": conversa.cliente,
      "cliente.telefone": conversa.telefone,
      "cliente.cnpj": cnpj ? mascararCnpj(cnpj) : "",
      "parceiro.status": parceiro
        ? "parceiro com contrato ativo"
        : cnpj
          ? "sem contrato de parceiro ativo"
          : "",
      "parceiro.razaoSocial": parceiro?.razaoSocial || "",
      // Fuso de Brasilia: esta variavel vai no TEXTO que o cliente recebe.
      "data.hoje": new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }),
      "atendente.nome": conversa.atendente?.nome || "",
      "empresa.nome": "",
    };

    return str.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_tudo, chave) => {
      const valor = valores[chave];
      if (valor === undefined) {
        logger.warn("Variavel desconhecida no texto do passo", { chave });
        return "";
      }
      return String(valor ?? "");
    });
  }

  // Texto que efetivamente vai para o cliente. `descricao` e anotacao interna
  // do editor de fluxos e so entra como fallback para fluxos antigos que nao
  // tem `texto` preenchido.
  textoDoPasso(passo, contexto = {}) {
    const bruto =
      passo.texto ||
      passo.config?.mensagem ||
      passo.descricao ||
      passo.titulo ||
      "";
    return this.interpolar(bruto, contexto);
  }

  // "Fluxo 2: Reenvio de 2a Via de Boleto" -> "Reenvio de 2a Via de Boleto"
  rotuloDoFluxo(fluxo) {
    return String(fluxo.nome || "").replace(/^fluxo\s*\d+\s*[:\-]\s*/i, "").trim() || fluxo.nome;
  }

  // Um fluxo pode ter varios gatilhos separados por virgula, ponto-e-virgula ou |.
  gatilhosDoFluxo(fluxo) {
    return String(fluxo.gatilho || "")
      .split(/[,;|]/)
      .map((g) => this.normalizarTexto(g))
      .filter(Boolean);
  }

  // Casa por inicio de palavra (aceita plural) em vez de substring solta, e
  // devolve o fluxo do gatilho mais especifico quando mais de um bate.
  detectarGatilho(texto, fluxos) {
    const normalizado = this.normalizarTexto(texto);
    let melhor = null;

    for (const fluxo of fluxos) {
      for (const gatilho of this.gatilhosDoFluxo(fluxo)) {
        if (gatilho === GATILHO_CURINGA) continue; // tratado no fallback
        const regex = new RegExp(`(^|[^\\p{L}\\p{N}])${escaparRegex(gatilho)}`, "u");
        if (regex.test(normalizado) && (!melhor || gatilho.length > melhor.tamanho)) {
          melhor = { fluxo, tamanho: gatilho.length };
        }
      }
    }

    return melhor?.fluxo || null;
  }

  // Fluxo de boas-vindas: um bot de menu precisa abrir em QUALQUER mensagem, nao
  // numa palavra-chave. Sem isso o cliente teria que adivinhar o gatilho para o
  // menu aparecer. Marca-se com o gatilho "*", que nao colide com palavra real.
  fluxoPadrao(fluxos) {
    return fluxos.find((f) => this.gatilhosDoFluxo(f).includes(GATILHO_CURINGA)) || null;
  }

  detectarComando(texto) {
    const normalizado = this.normalizarTexto(texto);
    for (const [comando, termos] of Object.entries(palavrasChave)) {
      const bateu = termos.some((termo) => {
        const t = this.normalizarTexto(termo);
        return normalizado === t || new RegExp(`(^|[^\\p{L}\\p{N}])${escaparRegex(t)}([^\\p{L}\\p{N}]|$)`, "u").test(normalizado);
      });
      if (bateu) return comando;
    }
    return null;
  }

  ordenarPassos(passos) {
    return [...passos].sort((a, b) => a.ordem - b.ordem);
  }

  // ------------------------------------------------- opcoes (ramificacoes) ---

  // Um passo do editor visual tem UMA saida (`targetId`). Fluxos importados de
  // editores de chatbot ramificam: cada opcao do menu tem suas palavras-chave e
  // seu proprio destino. Essas saidas extras ficam em `config.opcoes`, gravado
  // pelo import (client/src/components/flow/fluxoJson.js).
  opcoesDoPasso(passo) {
    const opcoes = passo?.config?.opcoes;
    if (!Array.isArray(opcoes)) return [];
    return opcoes.filter((o) => o && typeof o === "object");
  }

  // O bloco de "Configuracoes" do fluxo importado guarda os textos de fallback
  // do proprio fluxo (nao entendi / transferindo / despedida). Sao textos do
  // FLUXO, escritos por quem montou o bot, e nao mensagens que o motor inventa.
  configuracoesGlobais(fluxo) {
    for (const passo of fluxo?.passos || []) {
      const cfg = passo.config?.configuracoesGlobais;
      if (cfg && typeof cfg === "object") return cfg;
    }
    return null;
  }

  // Casa a resposta do cliente com as opcoes do passo. Prefere a palavra-chave
  // mais longa que bater, para "menu inicial" ganhar de "menu" e "cliente
  // avulso" ganhar de "cliente". Igualdade exata sempre ganha de conter.
  // Sem nenhum acerto, cai na opcao curinga (o `type: "US"` da origem, usado
  // nas perguntas abertas: "descreva sua solicitacao").
  casarOpcao(texto, opcoes) {
    const alvo = this.normalizarTexto(texto);
    if (!alvo) return null;

    let melhor = null;
    for (const opcao of opcoes) {
      for (const palavra of opcao.palavrasChave || []) {
        const termo = this.normalizarTexto(palavra);
        if (!termo) continue;
        const exato = alvo === termo;
        const contido = new RegExp(
          `(^|[^\\p{L}\\p{N}])${escaparRegex(termo)}([^\\p{L}\\p{N}]|$)`,
          "u"
        ).test(alvo);
        if (!exato && !contido) continue;
        const peso = (exato ? 1000 : 0) + termo.length;
        if (!melhor || peso > melhor.peso) melhor = { opcao, peso };
      }
    }
    if (melhor) return melhor.opcao;

    return opcoes.find((o) => !o.esperaEscolha) || null;
  }

  proximoPasso(passos, passoAtual) {
    if (!passoAtual) return passos[0] || null;
    if (passoAtual.targetId) {
      return passos.find((p) => p.id === passoAtual.targetId) || null;
    }
    // Um passo com `config.opcoes` descreve TODAS as suas saidas ali. Sem
    // targetId ele e terminal: cair no proximo por `ordem` faria o bot seguir
    // por um caminho que nao existe no desenho do fluxo (o VENDEDOR, que so
    // transfere para atendente, emendaria no bloco seguinte da lista).
    if (this.opcoesDoPasso(passoAtual).length) return null;
    const idx = passos.findIndex((p) => p.id === passoAtual.id);
    if (idx < 0) return null;
    // PULA O QUE NAO E PASSO DA CONVERSA.
    //
    // `comentario` (anotacao) e `espera` (o relogio do bot) sao REGRAS sobre a
    // conversa, nao lugares aonde ir. Sem este filtro, um passo sem targetId
    // emendava no bloco seguinte da lista -- e bastava alguem arrastar uma
    // anotacao para o meio do fluxo para o bot "entrar" nela e o cliente ficar
    // sem resposta. O risco ja existia; com o bloco de espera ele deixaria de
    // ser teorico.
    for (let i = idx + 1; i < passos.length; i++) {
      if (!NAO_CAMINHAVEIS.includes(passos[i].tipo)) return passos[i];
    }
    return null;
  }

  // Um passo de mensagem pode pedir CNPJ explicitamente via config.aguardar.
  // A heuristica pelo texto existe so para os fluxos criados antes disso.
  passoAguardaCnpj(passo) {
    if (passo.config?.aguardar) return passo.config.aguardar === AGUARDANDO.CNPJ;
    const alvo = this.normalizarTexto(
      `${passo.titulo || ""} ${passo.descricao || ""} ${passo.texto || ""}`
    );
    return alvo.includes("cnpj");
  }

  // ----------------------------------------------- horario de atendimento ---

  // "18:30" -> 1110 minutos. Fora do formato devolve null e a checagem e
  // ignorada, em vez de bloquear o atendimento por causa de um typo na config.
  _minutosDoDia(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }

  // Fora do horario definido em Configuracoes. Desligado por padrao: quem nao
  // configurar nada continua sendo atendido a qualquer hora, como antes.
  // Suporta janela que atravessa a meia-noite (ex.: 22:00 as 06:00).
  foraDoHorario(horario, agora = new Date()) {
    if (!horario?.ativo) return false;

    const inicio = this._minutosDoDia(horario.inicio);
    const fim = this._minutosDoDia(horario.fim);
    if (inicio === null || fim === null) return false;

    const dias = horario.dias?.length ? horario.dias : [1, 2, 3, 4, 5];
    // Hora e dia da semana no fuso de BRASILIA, nao do processo: o container roda
    // em UTC, e com getHours() um expediente de 08:00-18:00 valia das 05:00 as
    // 15:00 -- o bot calava no meio da tarde. Na sexta as 21h, getDay() ja dizia
    // sabado e o expediente "acabava" um dia antes.
    const { minutosDoDia: minutos, diaSemana } = partesBrasilia(agora);

    if (inicio <= fim) {
      return !dias.includes(diaSemana) || minutos < inicio || minutos >= fim;
    }
    // Janela virando o dia: o "dia" vale para o trecho depois do inicio.
    const dentro =
      (minutos >= inicio && dias.includes(diaSemana)) ||
      (minutos < fim && dias.includes((diaSemana + 6) % 7));
    return !dentro;
  }

  // ------------------------------------------------------- inatividade ---

  // `notResponseMessage` do fluxo: depois de N minutos parado, avisa e encerra.
  // Roda pelo varredor (chatbot.inatividade.js), nao por mensagem recebida - o
  // motor so acordava com mensagem do cliente, e e justamente a ausencia dela
  // que precisa ser detectada aqui.
  configuracaoInatividade(fluxo) {
    const cfg = this.configuracoesGlobais(fluxo)?.notResponseMessage;
    const minutos = Number(cfg?.time);
    if (!cfg || !Number.isFinite(minutos) || minutos <= 0) return null;
    return {
      minutos,
      mensagem: typeof cfg.message === "string" ? cfg.message.trim() : "",
      // type 3 no editor de origem = encerrar o atendimento.
      encerrar: Number(cfg.type) === 3,
    };
  }

  // Aplica o timeout de inatividade em uma sessao que ficou parada esperando
  // resposta do cliente. Devolve null quando ainda nao deu o tempo.
  async aplicarInatividade(sessao, { conversa, instanciaId, instanceName }) {
    if (!sessao?.ativo || !sessao.fluxoAtualId) return null;
    // Conversa com atendente humano nao e problema do bot.
    if (sessao.aguardando === AGUARDANDO.HUMANO) return null;

    const fluxo = await this.deps.fluxoRepository.findById(sessao.fluxoAtualId);
    // FLUXO PAUSADO = SEM AUTOMACAO (defesa em profundidade: o varredor ja
    // confere, mas este metodo e publico e nao pode depender de quem chama).
    if (!fluxo || !fluxo.ativo) return null;

    // Parametros do FLUXO. `semResposta` e o bloco novo; sem ele, cai no
    // `notResponseMessage` que os fluxos exportados ja trazem (ver paramsTempos).
    const cfg = paramsTempos(fluxo).semResposta;

    const parado = Date.now() - new Date(sessao.atualizadoEm || sessao.criadoEm).getTime();
    if (parado < cfg.minutos * 60 * 1000) return null;

    // O ESTADO MUDOU ENQUANTO O RELOGIO CORRIA?
    //
    // A varredura le a sessao e so entao age. Entre uma coisa e outra o cliente
    // pode ter respondido, o atendente pode ter assumido, ou a conversa pode ter
    // sido fechada. Reconferimos AGORA -- disparar o timeout em cima de uma
    // conversa que ja andou seria mandar "nao entendemos sua demanda" para
    // alguem que acabou de ser atendido.
    const agora = await this.deps.sessaoRepository.findByConversa(conversa.id);
    if (!agora?.ativo || agora.aguardando !== sessao.aguardando) return null;
    if (new Date(agora.atualizadoEm).getTime() !== new Date(sessao.atualizadoEm).getTime()) return null;
    const convAgora = await this.deps.conversaRepository.findById(conversa.id);
    if (!convAgora || convAgora.statusAtendimento !== "pendente") return null;
    if (convAgora.atendenteId) return null;

    const ctx = { conversa: convAgora, telefone: sessao.telefone, instanciaId, instanceName };
    const texto = cfg.mensagem ? this.interpolar(cfg.mensagem, ctx) : null;

    logger.info("Etapa encerrada: cliente nao respondeu ao bot", {
      conversaId: conversa.id,
      minutos: cfg.minutos,
      acao: cfg.acao,
      aguardava: sessao.aguardando,
    });

    // "encerrar" fecha a OS -- e o que combina com "abra um chamado novamente":
    // a proxima mensagem do cliente abre um atendimento novo.
    //
    // SEM PESQUISA DE SATISFACAO: este e o fechamento por ABANDONO. O cliente
    // parou de responder ao BOT, ninguem o atendeu, e nao existe atendimento
    // para ele avaliar.
    if (cfg.acao === "encerrar") {
      return this.encerrarAtendimento(ctx, texto, {
        pesquisa: false,
        motivo: "sem_resposta",
      });
    }

    if (texto) await this.enviarBot(conversa.id, sessao.telefone, texto, instanceName);
    return this.transferirParaHumano(ctx, { motivo: "sem_resposta" });
  }

  sessaoExpirada(sessao) {
    if (!sessao?.ativo) return false;
    const ttl =
      sessao.aguardando === AGUARDANDO.HUMANO ? cfgSessao.ttlHumanoMs : cfgSessao.ttlMs;
    const ultimaAtividade = new Date(sessao.atualizadoEm || sessao.criadoEm).getTime();
    return Date.now() - ultimaAtividade > ttl;
  }

  async registrarLog(instanciaId, fluxoId, passo, conversaId, mensagem, sucesso, inicio) {
    try {
      await this.deps.fluxoRepository.createLog({
        instanciaId,
        fluxoId,
        conversaId,
        passoId: passo?.id || null,
        tipo: passo?.tipo || "sistema",
        titulo: passo?.titulo || "Execucao",
        mensagem,
        sucesso,
        duracaoMs: Date.now() - inicio,
      });
    } catch (error) {
      // Log de auditoria nunca deve derrubar o atendimento.
      logger.warn("Falha ao gravar log de execucao", { message: error.message });
    }
  }

  /**
   * Mensagem do BOT -- e ela se identifica como tal.
   *
   * `origem: "bot"` ja separava do cliente no banco, mas a API entregava tudo
   * como "equipe" e a tela nao tinha como saber que aquilo era automacao. O
   * `metadata.automacao` deixa a marca explicita e persistida: e por ela que a
   * Central sabe que NAO deve tocar o som de mensagem nova nem contar como
   * atividade do cliente quando o proprio bot pede a avaliacao.
   */
  async enviarBot(conversaId, telefone, texto, instanceName) {
    const msg = await this.deps.conversaRepository.addMensagem(
      conversaId,
      "bot",
      texto,
      { automacao: true },
      null,
      { status: "enviando" }
    );
    try {
      const r = await this.deps.evolutionApi.sendText(
        telefone,
        texto,
        instanceName || env.evolutionApi.instance
      );
      // Guardar o id da Evolution e o que permite os ACKs de entrega/leitura
      // (messages.update) encontrarem esta mensagem depois.
      await this.deps.conversaRepository.vincularWaMessageId(msg.id, r?.key?.id || null, "enviada");
    } catch (error) {
      logger.warn("Falha ao enviar WhatsApp", { telefone, message: error.message });
      await this.deps.conversaRepository.vincularWaMessageId(msg.id, null, "erro");
    }
    await this._emitirConversa(conversaId);
    return texto;
  }

  // Valor que o clique de um botao/linha "digita" para o motor: o numero da
  // opcao (casa com palavrasChave em casarOpcao). Fallback: 1a palavra-chave.
  _valorOpcao(op) {
    const num = (op.palavrasChave || []).find((k) => /^\d+$/.test(k));
    return num || (op.palavrasChave || [])[0] || String(op.rotulo || "").split(",")[0] || "";
  }

  // Rotulo amigavel do botao: tenta extrair da linha do menu (ex.: "1️⃣- Setor
  // Técnico" -> "Setor Técnico"); senao usa uma palavra-chave legivel/numero.
  _rotuloOpcao(op, texto) {
    const num = (op.palavrasChave || []).find((k) => /^\d+$/.test(k));
    if (num && texto) {
      const re = new RegExp(`(?:^|\\n)\\s*${num}[^-\\n]*[-–]\\s*(.+)`, "u");
      const m = texto.match(re);
      if (m && m[1].trim()) return m[1].trim();
    }
    const kw = (op.palavrasChave || []).find((k) => !/^\d+$/.test(k));
    return kw || num || String(op.rotulo || "").split(",")[0] || "Opção";
  }

  // Remove do corpo as linhas de opcao numeradas (ex.: "1️⃣- Setor Técnico"),
  // deixando so o cabecalho -- as opcoes viram BOTOES. Se sobrar vazio, usa um
  // cabecalho padrao. (No fallback de texto puro, mandamos o texto ORIGINAL com
  // os numeros, para o cliente nunca ficar sem opcao.)
  _corpoInterativo(texto) {
    const linhas = String(texto || "").split("\n");
    const semOpcoes = linhas.filter((l) => !/^\s*\d+[^\p{L}\n]*[-–]/u.test(l));
    const corpo = semOpcoes.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    return corpo || "Escolha uma opção:";
  }

  // Envia um menu como mensagem INTERATIVA (botoes se ate 3 opcoes, senao lista).
  // Corpo = texto SEM as linhas numeradas (buttons-only). Se a instancia Baileys
  // recusar/nao renderizar, cai para texto puro COM os numeros -- fallback que
  // nunca deixa o cliente sem menu.
  async enviarBotComOpcoes(conversaId, telefone, texto, opcoes, instanceName) {
    // Botoes/listas interativos SO funcionam na API OFICIAL do WhatsApp. Na
    // integracao atual (Baileys/Evolution) o WhatsApp nao renderiza e a Baileys
    // chega a estourar ("this.isZero is not a function"). Por isso o padrao e
    // mandar o menu em TEXTO (com as opcoes numeradas, que o cliente digita).
    // Para ligar os botoes ao migrar para a API oficial: WHATSAPP_BOTOES_INTERATIVOS=true.
    if (process.env.WHATSAPP_BOTOES_INTERATIVOS !== "true") {
      return this.enviarBot(conversaId, telefone, texto, instanceName);
    }

    const inst = instanceName || env.evolutionApi.instance;
    const corpo = this._corpoInterativo(texto);
    const msg = await this.deps.conversaRepository.addMensagem(conversaId, "bot", texto, null, null, {
      status: "enviando",
    });
    const itens = opcoes.slice(0, 10).map((op) => ({
      id: this._valorOpcao(op),
      titulo: this._rotuloOpcao(op, texto),
    }));

    const marcar = (r, status) =>
      this.deps.conversaRepository.vincularWaMessageId(msg.id, r?.key?.id || null, status);

    try {
      let r;
      if (itens.length <= 3) {
        // Evolution v2 exige title/description/footer nao-vazios.
        r = await this.deps.evolutionApi.sendButtons(
          telefone,
          {
            title: "Atendimento",
            description: corpo,
            footer: "Selecione uma opção",
            buttons: itens.map((i) => ({ type: "reply", displayText: i.titulo.slice(0, 20), id: i.id })),
          },
          inst
        );
      } else {
        // Evolution v2 exige title + footerText, e a `description` de CADA linha
        // nao pode ser vazia (validado pela API).
        r = await this.deps.evolutionApi.sendList(
          telefone,
          {
            title: "Atendimento",
            description: corpo,
            buttonText: "Ver opções",
            footerText: "Selecione uma opção",
            sections: [
              {
                title: "Opções",
                rows: itens.map((i) => ({
                  title: i.titulo.slice(0, 24),
                  description: "Toque para selecionar",
                  rowId: i.id,
                })),
              },
            ],
          },
          inst
        );
      }
      await marcar(r, "enviada");
    } catch (error) {
      logger.warn("Falha ao enviar menu interativo; caindo para texto", {
        telefone,
        message: error.message,
      });
      try {
        const r = await this.deps.evolutionApi.sendText(telefone, texto, inst);
        await marcar(r, "enviada");
      } catch {
        await marcar(null, "erro");
      }
    }
    await this._emitirConversa(conversaId);
    return texto;
  }

  // Publica a conversa atualizada no barramento para o SSE empurrar ao front.
  // Best-effort: uma falha aqui nunca deve interromper o atendimento.
  /**
   * @param {string} conversaId
   * @param {object} [preCarregada] conversa JA lida (de findByIdParaEvento).
   *   O caminho de recebimento lia a conversa e, uma linha depois, este metodo
   *   lia DE NOVO -- duas consultas completas seguidas para a mesma coisa.
   */
  async _emitirConversa(conversaId, preCarregada = null) {
    if (preCarregada) {
      try {
        this.deps.bus.emitConversa(mapConversa({ ...preCarregada, __parcial: true }));
      } catch (error) {
        logger.warn("Falha ao emitir conversa no SSE", { conversaId, message: error.message });
      }
      return;
    }
    try {
      // CAUDA DO HISTORICO, e nao ele inteiro.
      //
      // Este metodo e chamado em quase todo passo do bot (mensagem enviada,
      // menu, CNPJ, transferencia, avaliacao). Lendo a conversa completa, cada
      // aviso custava proporcionalmente ao tamanho do fio -- 214ms e 1MB num
      // historico de 3000 mensagens, para anunciar uma linha nova. O merge do
      // front reconstroi o resto (ver findByIdParaEvento).
      const repo = this.deps.conversaRepository;
      const conversa = repo.findByIdParaEvento
        ? await repo.findByIdParaEvento(conversaId)
        : await repo.findById(conversaId); // simulador e testes com stub reduzido
      if (conversa) this.deps.bus.emitConversa(mapConversa({ ...conversa, __parcial: true }));
    } catch (error) {
      logger.warn("Falha ao emitir conversa no SSE", { conversaId, message: error.message });
    }
  }

  // MEMORIA DO CONTATO RECORRENTE.
  //
  // Quando o fluxo pede o CNPJ, primeiro olhamos se ESTE telefone ja confirmou
  // um CNPJ em atendimento anterior. Se sim, em vez de mandar o cliente digitar
  // tudo de novo, o bot mostra o que ele ja usou e pede so "sim"/"nao".
  //
  // Devolve { aguardando, resposta } para o passo usar. Sem memoria, cai no
  // comportamento antigo (pedir o CNPJ digitado).
  // Configuravel PELO FLUXO (passo.config), portanto guardado no banco:
  //   memoriaCnpj: false            -> desliga a memoria neste passo
  //   mensagemConfirmarCnpj: "..."  -> texto proprio; aceita {{cnpj}} e {{empresa}}
  async _pedirOuConfirmarCnpj(conversa, textoDoPasso, passo = null) {
    const pedirNormal = { aguardando: AGUARDANDO.CNPJ, resposta: textoDoPasso };
    const cfg = paramsCnpj(passo);
    if (!cfg.memoria) return pedirNormal;
    try {
      // POR QUE A CONVERSA ATUAL CONTA COMO MEMORIA.
      //
      // Esta consulta nasceu quando CADA atendimento criava uma linha de
      // conversa nova: o CNPJ ficava na linha ANTIGA, e passar `conversa.id`
      // como `ignorarConversaId` apenas evitava a auto-referencia.
      //
      // Com "uma conversa por cliente", o fio e reaproveitado entre
      // atendimentos -- o CNPJ do atendimento anterior mora NA MESMA LINHA. O
      // `ignorarConversaId` deixou de proteger contra auto-referencia e passou
      // a filtrar a unica memoria existente: a consulta devolvia sempre null e
      // o bot nunca perguntava "o CNPJ continua sendo este?".
      //
      // Entao a memoria e, nesta ordem: o CNPJ da PROPRIA conversa (o caso
      // normal hoje) e, como rede de seguranca, o de outra conversa do mesmo
      // telefone (outra instancia, ou duplicata ainda nao consolidada).
      const daPropriaConversa =
        conversa.cnpjVerificado && conversa.cnpj
          ? { cnpj: conversa.cnpj, empresa: conversa.empresa }
          : null;
      const anterior =
        daPropriaConversa ||
        (await this.deps.conversaRepository.ultimoCnpjDoTelefone(conversa.telefone));
      if (!anterior?.cnpj) return pedirNormal;

      const parceiro = await this.deps.parceiroRepository.findAtivoByCnpj(anterior.cnpj);
      const cnpjFmt = mascararCnpj(anterior.cnpj);
      // `anterior.empresa` e a razao social gravada quando o CNPJ foi
      // identificado: ela sobrevive mesmo se a empresa sair do cadastro depois.
      const empresaNome = parceiro?.razaoSocial || anterior.empresa || "";

      // Dois modelos porque a pergunta muda: com razao social conhecida se
      // confirma A EMPRESA; sem ela, so resta mostrar o numero.
      const modelo = empresaNome ? cfg.mensagemConfirmar : cfg.mensagemConfirmarSemEmpresa;

      return {
        aguardando: AGUARDANDO.CNPJ_CONFIRMA,
        resposta: modelo
          .replace(/\{\{\s*cnpj\s*\}\}/g, cnpjFmt)
          // No modelo padrao com empresa o cabecalho ja traz o emoji; num
          // modelo proprio (passo.config) o nome entra como veio.
          .replace(/\{\{\s*empresa\s*\}\}/g, empresaNome || ""),
        cnpjSugerido: anterior.cnpj,
      };
    } catch (e) {
      // Memoria e conveniencia: se a consulta falhar, o atendimento nao para.
      logger.warn("Falha ao consultar CNPJ anterior do contato", { message: e.message });
      return pedirNormal;
    }
  }

  /**
   * DESASSOCIAR o CNPJ DESTA CONVERSA -- e so isto.
   *
   * O cliente disse que o CNPJ oferecido nao e o dele. A conversa volta para
   * "CNPJ pendente" e o bot pede outro.
   *
   * O QUE ESTE METODO NAO FAZ, de proposito: apagar a empresa do cadastro de
   * Clientes, ou mexer no CNPJ de qualquer OUTRA conversa. O historico daquele
   * CNPJ continua inteiro no banco -- "nao e o meu CNPJ" e uma correcao de
   * vinculo, nunca uma exclusao de cliente.
   *
   * E o unico caminho de desassociacao do sistema: a acao manual equivalente
   * (o "X" na tela Clientes/CNPJ) foi removida justamente para que isto
   * acontecesse so aqui, dentro da etapa do fluxo que pergunta.
   */
  async _desassociarCnpj(conversa) {
    if (!conversa?.cnpj && !conversa?.cnpjVerificado) return false;
    await this.deps.conversaRepository.update(conversa.id, {
      cnpj: null,
      empresa: null,
      cnpjVerificado: false,
    });
    // O objeto em memoria segue sendo usado no resto do passo: sem isto, a
    // consulta da memoria logo adiante reofereceria o CNPJ recem-recusado.
    conversa.cnpj = null;
    conversa.empresa = null;
    conversa.cnpjVerificado = false;
    await this._emitirConversa(conversa.id);
    logger.info("CNPJ desassociado da conversa (cadastro preservado)", {
      conversaId: conversa.id,
    });
    return true;
  }

  /**
   * QUATRO ESTADOS, e nao dois.
   *
   * Antes isto devolvia so `valido: true|false`, e o fluxo tratava igual coisas
   * que o cliente vive de forma bem diferente:
   *
   *   resposta_invalida -> ele nem tentou mandar um CNPJ ("quero falar com
   *                        alguem"). Repetir "CNPJ invalido" aqui e grosseiro e
   *                        nao ajuda: o certo e dizer que nao entendemos.
   *   invalido          -> ele tentou, mas o numero nao fecha (digitou errado).
   *   avulso            -> CNPJ correto, empresa fora da nossa lista.
   *   cadastrado        -> CNPJ correto e parceiro conhecido.
   *
   * A mensagem de cada estado vem do FLUXO (fluxo.automacao), nunca daqui.
   */
  async validarCnpjRecebido(conversa, texto, cfg = paramsCnpj(null)) {
    const cnpjLimpo = limparCnpj(texto);

    // Poucos digitos = o cliente respondeu outra coisa, nao um CNPJ torto.
    // O limiar e generoso de proposito: quem digita 13 digitos ERROU o CNPJ;
    // quem escreveu uma frase com um numero solto nao estava tentando.
    if (cnpjLimpo.length < 11) {
      return {
        valido: false,
        estado: "resposta_invalida",
        cnpj: cnpjLimpo,
        mensagem: cfg.mensagemRespostaInvalida,
      };
    }

    if (cnpjLimpo.length !== 14 || !cnpjValido(cnpjLimpo)) {
      return { valido: false, estado: "invalido", cnpj: cnpjLimpo, mensagem: cfg.mensagemInvalido };
    }

    const parceiro = await this.deps.parceiroRepository.findAtivoByCnpj(cnpjLimpo);
    // `empresa` e o nome que a Central mostra no lugar do numero do CNPJ.
    // Gravado aqui, no momento da identificacao, para nao depender de o
    // parceiro continuar cadastrado depois.
    await this.deps.conversaRepository.update(conversa.id, {
      cnpj: cnpjLimpo,
      empresa: parceiro?.razaoSocial || null,
      cnpjVerificado: true,
    });

    // Sem os 14 digitos na bolha: quem identifica o cliente e a razao social.
    const mensagem = parceiro
      ? `Cliente identificado: ${parceiro.razaoSocial} - parceiro com contrato ativo.`
      : cfg.mensagemNaoCadastrado;

    return {
      valido: true,
      estado: parceiro ? "cadastrado" : "avulso",
      cnpj: cnpjLimpo,
      parceiro,
      mensagem,
    };
  }

  // ---------------------------------------------------------------- menu ---

  // Sem gatilho reconhecido nao ha o que enviar: o motor so responde pelo texto
  // dos passos do fluxo. A conversa vai para a fila e um atendente assume.
  async enviarMenu(ctx) {
    return this.transferirParaHumano(ctx, { avisar: false, motivo: "sem_gatilho" });
  }

  // Aceita "2", "2)" ou "opcao 2".
  interpretarEscolhaMenu(texto, opcoes) {
    const match = this.normalizarTexto(texto).match(/\d+/);
    if (!match) return null;
    const indice = Number(match[0]) - 1;
    return opcoes[indice] || null;
  }

  // ------------------------------------------------------------ handoff ---

  async transferirParaHumano(
    // eslint-disable-next-line no-unused-vars
    ctx,
    { avisar = true, motivo = "solicitado", setor = null, filaId = null } = {}
  ) {
    const { conversa, telefone, instanciaId, instanceName } = ctx;

    if (avisar) {
    }

    const dados = { statusAtendimento: "pendente", lido: false };

    // SETOR DO ATENDIMENTO -- gravado, nunca adivinhado.
    //
    // Este metodo e alcancado por caminhos que NAO sao escolha do cliente: menu
    // sem gatilho, timeout de "cliente nao respondeu", ramificacao sem destino.
    // Deduzir o setor do texto aqui era o que fazia uma conversa nova -- em que
    // o cliente so disse "meu computador travou" -- nascer como Tecnico sem
    // ninguem ter escolhido nada.
    //
    // `setorAtual` preserva o que o cliente JA escolheu no menu: um handoff no
    // meio do caminho nao pode rebaixar a conversa de volta para "sem setor".
    const setorFinal = resolverSetorDeclarado({
      setorExplicito: setor,
      setorDaFila: null,
      setorAtual: conversa.setor,
    });
    dados.setor = setorFinal;

    // Fila e um ciclo em curso: precisa de OS aberta para o atendente assumir.
    await this.deps.conversaRepository.garantirAtendimentoAberto(conversa.id, { setor: setorFinal });
    await this.deps.conversaRepository.update(conversa.id, dados);
    await this.deps.conversaRepository.atualizarAtendimentoAtual(conversa.id, {
      status: "pendente",
      setor: setorFinal,
    });

    await this.deps.sessaoRepository.upsert(instanciaId, conversa.id, telefone, {
      fluxoAtualId: null,
      passoAtualId: null,
      aguardando: AGUARDANDO.HUMANO,
      ativo: true,
      // `fluxoOrigemId` fica guardado porque `fluxoAtualId` e zerado aqui (o bot
      // parou de conduzir). Sem essa pista, a varredura nao saberia de QUAL
      // fluxo vem a regra de espera na fila -- nem se ele esta pausado.
      contexto: { fluxoOrigemId: ctx.fluxo?.id || null },
    });

    await this._emitirConversa(conversa.id);

    logger.info("Conversa transferida para atendimento humano", {
      conversaId: conversa.id,
      motivo,
      filaId,
      setor,
    });

    return {
      processado: true,
      conversaId: conversa.id,
      aguardando: AGUARDANDO.HUMANO,
      transferido: true,
      motivo,
      filaId,
    };
  }

  // Encerramento pedido pelo FLUXO (opcao com acao "encerrar"): diferente do
  // comando "sair", aqui a conversa e fechada de fato, com a mensagem de
  // despedida que o proprio fluxo definiu.
  /**
   * @param {object} [opcoes]
   * @param {boolean} [opcoes.pesquisa=true] oferecer a pesquisa de satisfacao?
   *   `false` para o fechamento por ABANDONO -- ver abaixo.
   * @param {string} [opcoes.motivo="fluxo"]
   */
  async encerrarAtendimento(ctx, mensagem, { pesquisa = true, motivo = "fluxo" } = {}) {
    const { conversa, telefone, instanceName } = ctx;

    if (mensagem) {
      await this.enviarBot(conversa.id, telefone, mensagem, instanceName);
    }

    // Antes de fechar de fato, oferece a pesquisa de satisfacao automatica. Se
    // ela iniciar, a conversa ja fica marcada como fechada e a sessao segue viva
    // apenas para capturar a nota/comentario (ver continuarPesquisaSatisfacao).
    // Nao dispara se um no de avaliacao ja tiver perguntado (checa avaliacao).
    //
    // QUEM ABANDONOU A CONVERSA NAO RECEBE PESQUISA.
    //
    // O cliente que sumiu no meio do menu nao foi atendido -- nao ha atendimento
    // para avaliar. Perguntar "de 1 a 5, que nota voce da?" a quem parou de
    // responder ha cinco minutos e mandar mensagem para um chat abandonado, e
    // ainda contamina o CSAT com notas de quem nunca foi atendido (ou, mais
    // provavel, com mais um silencio).
    if (pesquisa) {
      const iniciada = await this.iniciarPesquisaSatisfacao(ctx);
      if (iniciada) return iniciada;
    }

    return this.fecharConversa(ctx, { motivo });
  }

  // Fechamento efetivo: marca a conversa como fechada e desliga a sessao.
  async fecharConversa(ctx, { motivo = "fluxo" } = {}) {
    const { conversa, telefone, instanciaId } = ctx;

    const fechadoEm = new Date();
    await this.deps.conversaRepository.update(conversa.id, {
      statusAtendimento: "fechada",
      fechadoEm,
      lido: true,
      naoLidas: 0,
    });
    // A OS em curso encerra junto. E o fechamento dela que faz a proxima
    // mensagem do cliente abrir uma OS NOVA no mesmo fio, em vez de continuar
    // um atendimento que ja acabou.
    await this.deps.conversaRepository.atualizarAtendimentoAtual(conversa.id, {
      status: "fechada",
      fechadoEm,
    });

    await this.deps.sessaoRepository.upsert(instanciaId, conversa.id, telefone, {
      fluxoAtualId: null,
      passoAtualId: null,
      aguardando: null,
      ativo: false,
      contexto: {},
    });

    await this._emitirConversa(conversa.id);
    logger.info("Atendimento encerrado", { conversaId: conversa.id, motivo });

    return { processado: true, conversaId: conversa.id, encerrado: true, fechada: true };
  }

  // ------------------------------------------------ pesquisa de satisfacao ---

  // Extrai a nota de 1 a 5 do texto do cliente. Usa o ULTIMO numero valido: o
  // cliente costuma responder "4" ou "nota 4", e se ele ecoar o enunciado
  // ("de 1 a 5, dou 4") o "1" e o "5" vem antes da nota que interessa.
  interpretarNota(texto) {
    const nums = String(texto || "").match(/\d+/g) || [];
    let nota = null;
    for (const n of nums) {
      const v = Number(n);
      if (v >= 1 && v <= 5) nota = v;
    }
    return nota;
  }

  // Config da pesquisa a partir do PASSO do fluxo. Nao ha mais mistura com a
  // configuracao global: o parametro que vale e o que esta no fluxo (ou o padrao
  // documentado em fluxo.automacao, que a tela mostra como placeholder).
  _configPesquisaPasso(passo) {
    return { ativo: true, ...paramsAvaliacao(passo) };
  }

  /**
   * A pesquisa de satisfacao e uma ETAPA DO FLUXO -- e so isso.
   *
   * Antes, nao havendo no de avaliacao em fluxo nenhum, isto caia na
   * configuracao GLOBAL e a pesquisa era enviada assim mesmo. O efeito pratico
   * era o bug relatado: com TODOS os fluxos pausados, o cliente continuava
   * recebendo "de 1 a 5, que nota voce da?" de um bot que a tela mostrava
   * desligado -- e nao havia onde clicar para parar aquilo.
   *
   * Agora, sem fluxo ATIVO com passo "avaliacao", nao ha pesquisa. Pausar o
   * fluxo passa a ser o botao de desligar, como se espera.
   *
   * Devolve { cfg, fluxoId } ou null.
   */
  async _configPesquisaAtiva() {
    const fluxos = await this.deps.fluxoRepository.findAtivos();
    for (const f of fluxos || []) {
      if (!f.ativo) continue;
      const no = (f.passos || []).find((p) => p.tipo === "avaliacao");
      if (no) return { cfg: this._configPesquisaPasso(no), fluxoId: f.id, passoId: no.id };
    }
    return null;
  }

  // Dispara a pesquisa (CSAT) AUTOMATICAMENTE ao encerrar. Retorna o resultado
  // quando iniciada, ou null quando nao se aplica (modo != local, desligada ou ja
  // avaliada) - nesse caso o chamador segue com o fechamento normal. Usa os
  // textos padrao da configuracao (chatbot.pesquisaSatisfacao / defaults).
  async iniciarPesquisaSatisfacao(ctx) {
    const { conversa, telefone, instanciaId, instanceName } = ctx;

    // Fora do modo "local" o bot NUNCA envia nada por conta propria.
    const modo = await this.deps.configuracaoService.modoAtendimento();
    if (modo !== "local") return null;

    // FLUXO PAUSADO = SEM AUTOMACAO. Sem fluxo ativo com passo de avaliacao,
    // nenhuma pesquisa e enviada (ver _configPesquisaAtiva).
    const ativa = await this._configPesquisaAtiva();
    if (!ativa) {
      logger.info("Pesquisa de satisfacao nao enviada: nenhum fluxo ativo com passo de avaliacao", {
        conversaId: conversa.id,
      });
      return null;
    }
    const { cfg, fluxoId } = ativa;

    // Nao pergunta duas vezes: se ja existe nota (ex.: um no de avaliacao no
    // fluxo ja perguntou), apenas segue para o fechamento.
    const atual = await this.deps.conversaRepository.findById(conversa.id);
    if (atual && atual.avaliacao != null) return null;

    // O CICLO JA VIROU?
    //
    // A pesquisa automatica e disparada em segundo plano depois do fechamento
    // (conversa.service). Se nesse intervalo o cliente escreveu de novo, um
    // atendimento NOVO ja comecou -- e mandar a pesquisa agora fecharia esse
    // chamado recem-aberto antes de qualquer atendente ver. Nesse caso a
    // pesquisa simplesmente nao acontece.
    if (
      conversa.atendimentoAtualId &&
      atual?.atendimentoAtualId &&
      atual.atendimentoAtualId !== conversa.atendimentoAtualId
    ) {
      logger.info("Pesquisa de satisfacao ignorada: novo atendimento ja aberto", {
        conversaId: conversa.id,
      });
      return null;
    }

    await this.enviarBot(conversa.id, telefone, cfg.mensagemNota, instanceName);

    // `osAvaliada` prende a pesquisa ao CICLO que acabou de fechar. Sem isso, se
    // o cliente abrir um chamado novo antes de responder a nota, a nota (e o
    // fechamento) cairiam na OS nova -- fechando por tras um atendimento que
    // acabou de comecar.
    const osAvaliada = atual?.atendimentoAtualId || conversa.atendimentoAtualId || null;
    // `fluxoAtualId` guardado de proposito: e por ele que a varredura do
    // servidor confere, 5 minutos depois, se o fluxo AINDA esta ativo antes de
    // executar a proxima acao. Sem isso, pausar o fluxo no meio da espera nao
    // teria efeito nenhum.
    await this.deps.sessaoRepository.upsert(instanciaId, conversa.id, telefone, {
      fluxoAtualId: fluxoId,
      passoAtualId: null,
      aguardando: AGUARDANDO.AVALIACAO_NOTA,
      ativo: true,
      contexto: { pesquisa: true, pesquisaCfg: cfg, tentativasAval: 0, osAvaliada },
    });
    // A OS passa a constar como "aguardando" a nota -- diferente de "sem nota".
    if (osAvaliada) {
      await this.deps.conversaRepository.atualizarAtendimento(osAvaliada, {
        avaliacaoStatus: "aguardando",
      });
    }

    // Fecha desde ja: a conversa sai da fila, mas a sessao da pesquisa continua
    // viva para capturar a resposta. Sem resposta, a sessao expira pelo TTL.
    const fechadoEm = new Date();
    await this.deps.conversaRepository.update(conversa.id, {
      statusAtendimento: "fechada",
      fechadoEm,
      lido: true,
      naoLidas: 0,
      avaliacaoStatus: "aguardando",
    });
    if (osAvaliada) {
      await this.deps.conversaRepository.atualizarAtendimento(osAvaliada, {
        status: "fechada",
        fechadoEm,
      });
    }
    await this._emitirConversa(conversa.id);

    logger.info("Pesquisa de satisfacao iniciada", { conversaId: conversa.id });
    return {
      processado: true,
      conversaId: conversa.id,
      pesquisaSatisfacao: true,
      aguardando: AGUARDANDO.AVALIACAO_NOTA,
    };
  }

  // Trata a resposta do cliente durante a pesquisa: primeiro a nota, depois o
  // comentario. Ao final agradece e encerra a sessao da pesquisa.
  async continuarPesquisaSatisfacao(sessao, ctx, textoEntrada) {
    const { conversa, telefone, instanceName } = ctx;

    // FLUXO PAUSADO NO MEIO DA PESQUISA.
    //
    // Pausar o fluxo cala o bot: ele nao manda mais nada (nem o agradecimento,
    // nem a proxima pergunta). Mas a nota que o cliente ACABOU de enviar e dado
    // que ele nos deu -- jogar fora seria pior do que guardar. Entao gravamos a
    // resposta em silencio e encerramos a sessao.
    if (sessao.fluxoAtualId) {
      const fluxo = await this.deps.fluxoRepository.findById(sessao.fluxoAtualId);
      if (!fluxo || !fluxo.ativo) {
        const alvo = sessao.conversaId || conversa.id;
        const os = sessao.contexto?.osAvaliada || null;
        const nota = this.interpretarNota(textoEntrada);
        if (nota != null && sessao.aguardando === AGUARDANDO.AVALIACAO_NOTA) {
          await this.deps.conversaRepository.update(alvo, {
            avaliacao: nota,
            avaliacaoStatus: "respondida",
          });
          if (os) {
            await this.deps.conversaRepository.atualizarAtendimento(os, {
              avaliacao: nota,
              avaliacaoStatus: "respondida",
            });
          }
        }
        await this.deps.sessaoRepository.update(sessao.id, {
          fluxoAtualId: null,
          passoAtualId: null,
          aguardando: null,
          ativo: false,
          contexto: {},
        });
        await this._emitirConversa(alvo);
        logger.info("Pesquisa encerrada sem resposta do bot: fluxo pausado", { conversaId: alvo });
        return { processado: true, conversaId: alvo, fluxoPausado: true };
      }
    }
    // A nota pertence a conversa que FOI AVALIADA (a da sessao), nao a que
    // trouxe a mensagem. Normalmente sao a mesma agora, mas manter o alvo
    // explicito e o que garante que a nota nunca mais caia numa conversa que
    // ninguem atendeu, mesmo se o desvio do webhook falhar.
    const alvoId = sessao.conversaId || conversa.id;
    // A config foi congelada no contexto da sessao quando a pesquisa comecou --
    // e a do FLUXO daquele momento. Congelar evita que editar o fluxo no meio
    // de uma pesquisa em curso troque as regras debaixo do cliente.
    const cfg = sessao.contexto?.pesquisaCfg || this._configPesquisaPasso(null);
    const osAvaliada = sessao.contexto?.osAvaliada || null;

    if (sessao.aguardando === AGUARDANDO.AVALIACAO_NOTA) {
      const nota = this.interpretarNota(textoEntrada);

      // O cliente DISSE que nao quer avaliar. Isso nao e "nao respondeu" nem
      // nota zero: e uma escolha, e o relatorio precisa mostra-la como tal.
      if (this.recusouAvaliar(textoEntrada)) {
        await this.registrarStatusAvaliacao(alvoId, osAvaliada, "sem_nota");
        await this.enviarBot(conversa.id, telefone, cfg.mensagemAgradecimento, instanceName);
        return this.finalizarPesquisa(ctx, sessao);
      }

      if (nota == null) {
        const tentativas = (sessao.contexto?.tentativasAval || 0) + 1;
        // Cliente nao colabora: encerra sem insistir, para nao virar spam. O
        // limite vem do FLUXO (antes era o `maxTentativasOpcao` global do .env).
        if (tentativas >= (cfg.maxTentativas || 2)) {
          await this.registrarStatusAvaliacao(alvoId, osAvaliada, "sem_nota");
          return this.finalizarPesquisa(ctx, sessao);
        }
        await this.enviarBot(conversa.id, telefone, cfg.mensagemNotaInvalida, instanceName);
        await this.deps.sessaoRepository.update(sessao.id, {
          contexto: { ...(sessao.contexto || {}), tentativasAval: tentativas },
        });
        return { processado: true, conversaId: conversa.id, aguardando: AGUARDANDO.AVALIACAO_NOTA };
      }

      await this.deps.conversaRepository.update(alvoId, {
        avaliacao: nota,
        avaliacaoStatus: "respondida",
      });
      // A nota pertence ao CICLO (a OS) que foi avaliado -- `osAvaliada`, e nao
      // "a OS atual": o cliente pode ter aberto um chamado novo entre o
      // fechamento e a resposta da pesquisa.
      if (osAvaliada) {
        await this.deps.conversaRepository.atualizarAtendimento(osAvaliada, {
          avaliacao: nota,
          avaliacaoStatus: "respondida",
        });
      }
      await this._emitirConversa(alvoId);

      // Pediu comentario? avanca; senao agradece e encerra.
      if (cfg.pedirComentario) {
        await this.enviarBot(conversa.id, telefone, cfg.mensagemComentario, instanceName);
        await this.deps.sessaoRepository.update(sessao.id, {
          aguardando: AGUARDANDO.AVALIACAO_COMENTARIO,
          ativo: true,
          contexto: { ...(sessao.contexto || {}), avaliacao: nota, tentativasAval: 0 },
        });
        return {
          processado: true,
          conversaId: conversa.id,
          aguardando: AGUARDANDO.AVALIACAO_COMENTARIO,
        };
      }

      await this.enviarBot(conversa.id, telefone, cfg.mensagemAgradecimento, instanceName);
      return this.finalizarPesquisa(ctx, sessao);
    }

    // AVALIACAO_COMENTARIO: o texto e o feedback livre. "pular"/vazio ignora.
    const comentario = String(textoEntrada || "").trim();
    const pular = ["pular", "nao", "nao quero", "-", "n"];
    const ehPular = !comentario || pular.includes(this.normalizarTexto(comentario));
    if (!ehPular) {
      await this.deps.conversaRepository.update(alvoId, {
        feedback: comentario.slice(0, 1000),
      });
      if (osAvaliada) {
        await this.deps.conversaRepository.atualizarAtendimento(osAvaliada, {
          feedback: comentario.slice(0, 1000),
        });
      }
      await this._emitirConversa(alvoId);
    }
    await this.enviarBot(conversa.id, telefone, cfg.mensagemAgradecimento, instanceName);
    return this.finalizarPesquisa(ctx, sessao);
  }

  /**
   * ESPERA NA FILA DE PENDENTES -- o outro relogio, e nao o mesmo.
   *
   * Aqui NAO ha pergunta pendente: a conversa foi para a fila e nenhum atendente
   * assumiu. Quem espera atendimento nao "deixou de responder", entao receber
   * "nao entendemos a sua demanda" seria errado -- por isso os dois tempos vivem
   * em blocos separados do fluxo e em caminhos separados aqui.
   *
   * Chamado pela varredura do servidor. Devolve true quando avisou.
   */
  async aplicarEsperaFila(conversa, fluxo, { instanceName } = {}) {
    if (!fluxo?.ativo) return false; // fluxo pausado = sem automacao
    const cfg = paramsTempos(fluxo).filaPendentes;
    if (!cfg.ativo) return false;

    // So faz sentido para quem esta MESMO esperando um humano.
    if (conversa.statusAtendimento !== "pendente" || conversa.atendenteId) return false;

    const os = (conversa.atendimentos || []).find((a) => a.id === conversa.atendimentoAtualId);
    if (!os) return false;
    // IDEMPOTENCIA: a marca vive no banco, entao nem a varredura de um minuto
    // depois nem um restart do servidor mandam a mensagem de novo.
    if (os.avisoEsperaEm && !cfg.repetir) return false;

    // O relogio conta desde que a conversa ENTROU na fila (a abertura da OS),
    // nao desde a ultima mensagem: o cliente pode ter mandado varias e continuar
    // esperando o mesmo tanto.
    const desde = new Date(os.abertoEm || conversa.criadoEm).getTime();
    const ultimoAviso = os.avisoEsperaEm ? new Date(os.avisoEsperaEm).getTime() : null;
    const base = cfg.repetir && ultimoAviso ? ultimoAviso : desde;
    if (Date.now() - base < cfg.minutos * 60 * 1000) return false;

    const texto = this.interpolar(cfg.mensagem, { conversa });
    await this.enviarBot(conversa.id, conversa.telefone, texto, instanceName);
    await this.deps.conversaRepository.atualizarAtendimento(os.id, { avisoEsperaEm: new Date() });

    logger.info("Aviso de espera na fila enviado", {
      conversaId: conversa.id,
      minutos: cfg.minutos,
    });
    await this._emitirConversa(conversa.id);
    return true;
  }

  /** A sessao esta parada esperando a nota (ou o comentario) do cliente? */
  aguardandoAvaliacao(sessao) {
    return (
      !!sessao?.ativo &&
      (sessao.aguardando === AGUARDANDO.AVALIACAO_NOTA ||
        sessao.aguardando === AGUARDANDO.AVALIACAO_COMENTARIO)
    );
  }

  /**
   * PRAZO DA AVALIACAO ESGOTADO (os "5 minutos").
   *
   * Chamado pela varredura do servidor (chatbot.inatividade), nunca pelo
   * navegador. Se o cliente nao respondeu dentro do prazo que o FLUXO define:
   *
   *   - envia a mensagem de encerramento configurada no fluxo;
   *   - registra `sem_resposta` -- e nao uma nota falsa nem "pendente eterno";
   *   - encerra a sessao e o atendimento.
   *
   * Quem garante que o fluxo esta ATIVO e a varredura, no instante da execucao.
   * Devolve true quando fez alguma coisa.
   */
  async aplicarTimeoutAvaliacao(sessao, { conversa, instanciaId, instanceName }) {
    if (!this.aguardandoAvaliacao(sessao)) return false;

    const cfg = sessao.contexto?.pesquisaCfg || this._configPesquisaPasso(null);
    const prazoMs = (cfg.timeoutMin || 5) * 60 * 1000;
    const desde = new Date(sessao.atualizadoEm || sessao.criadoEm).getTime();
    if (Date.now() - desde < prazoMs) return false;

    const alvoId = sessao.conversaId || conversa.id;
    const osAvaliada = sessao.contexto?.osAvaliada || null;

    // Comentario pendente nao invalida a nota que ja veio: quem respondeu a
    // nota e sumiu no comentario continua "respondida".
    const jaTemNota = conversa?.avaliacao != null;
    await this.registrarStatusAvaliacao(
      alvoId,
      osAvaliada,
      jaTemNota ? "respondida" : "sem_resposta"
    );

    if (cfg.mensagemTimeout) {
      await this.enviarBot(alvoId, sessao.telefone, cfg.mensagemTimeout, instanceName);
    }

    await this.deps.sessaoRepository.update(sessao.id, {
      fluxoAtualId: null,
      passoAtualId: null,
      aguardando: null,
      ativo: false,
      contexto: {},
    });

    logger.info("Avaliacao encerrada por falta de resposta", {
      conversaId: alvoId,
      prazoMin: cfg.timeoutMin,
      status: jaTemNota ? "respondida" : "sem_resposta",
    });
    await this._emitirConversa(alvoId);
    return true;
  }

  // "Nao quero avaliar" dito com todas as letras. Separado de `interpretarNota`
  // porque a intencao e outra: aqui o cliente RESPONDEU -- ele so nao quis dar
  // nota. Gravar isso como "sem resposta" (ou como nota 0) seria mentir no
  // relatorio.
  recusouAvaliar(texto) {
    const t = this.normalizarTexto(texto);
    if (!t) return false;
    const recusas = [
      "pular", "nao quero", "nao quero avaliar", "nao vou avaliar", "prefiro nao",
      "prefiro nao responder", "sem nota", "nao avaliar", "dispensar", "deixa",
      "deixa pra la", "nao obrigado", "nao, obrigado",
    ];
    return recusas.includes(t);
  }

  // Grava COMO a avaliacao terminou, na conversa e na OS avaliada. Silencioso:
  // e registro, e nao pode derrubar o encerramento do atendimento.
  async registrarStatusAvaliacao(conversaId, atendimentoId, status) {
    try {
      await this.deps.conversaRepository.update(conversaId, { avaliacaoStatus: status });
      if (atendimentoId) {
        await this.deps.conversaRepository.atualizarAtendimento(atendimentoId, {
          avaliacaoStatus: status,
        });
      }
      await this._emitirConversa(conversaId);
    } catch (e) {
      logger.warn("Nao foi possivel registrar o status da avaliacao", {
        conversaId,
        status,
        message: e.message,
      });
    }
  }

  // Encerra a sessao da pesquisa e garante que a conversa fique fechada.
  async finalizarPesquisa(ctx, sessao) {
    const { conversa } = ctx;
    await this.deps.sessaoRepository.update(sessao.id, {
      fluxoAtualId: null,
      passoAtualId: null,
      aguardando: null,
      ativo: false,
      contexto: {},
    });
    const atual = await this.deps.conversaRepository.findById(conversa.id);
    // So fecha se o fio ainda estiver no MESMO ciclo que foi avaliado. Se o
    // cliente abriu um chamado novo enquanto a pesquisa corria, fechar aqui
    // mataria esse chamado antes de qualquer atendente ver.
    const osAvaliada = sessao?.contexto?.osAvaliada || null;
    const mesmoCiclo = !osAvaliada || atual?.atendimentoAtualId === osAvaliada;
    if (atual && mesmoCiclo && atual.statusAtendimento !== "fechada") {
      const fechadoEm = new Date();
      await this.deps.conversaRepository.update(conversa.id, {
        statusAtendimento: "fechada",
        fechadoEm,
        lido: true,
        naoLidas: 0,
      });
      await this.deps.conversaRepository.atualizarAtendimentoAtual(conversa.id, {
        status: "fechada",
        fechadoEm,
      });
    }
    await this._emitirConversa(conversa.id);
    logger.info("Pesquisa de satisfacao concluida", {
      conversaId: conversa.id,
      nota: atual?.avaliacao ?? null,
    });
    return { processado: true, conversaId: conversa.id, encerrado: true, avaliado: true };
  }

  async encerrarSessao(ctx) {
    const { conversa, telefone, instanciaId, instanceName } = ctx;
    await this.deps.sessaoRepository.upsert(instanciaId, conversa.id, telefone, {
      fluxoAtualId: null,
      passoAtualId: null,
      aguardando: null,
      ativo: false,
      contexto: {},
    });

    return { processado: true, conversaId: conversa.id, encerrado: true };
  }

  // ------------------------------------------------------------- passos ---

  async executarPasso(passo, contexto) {
    const inicio = Date.now();
    const { conversa, telefone, instanciaId, fluxo, instanceName } = contexto;
    let resposta = null;
    let aguardando = null;
    let proximo = null;
    // Contexto de sessao que este passo precisa persistir (ex.: a pesquisa de
    // satisfacao guarda aqui a sua config). Quando null, o chamador usa o reset
    // padrao (tentativas zeradas).
    let contextoSessao = null;

    switch (passo.tipo) {
      case "gatilho":
      // Defesa em profundidade: `proximoPasso` ja pula os dois, mas um fluxo
      // com targetId apontando direto para ca (JSON editado a mao) nao pode
      // deixar o cliente sem resposta -- segue para o proximo passo de verdade.
      case "comentario":
      case "espera":
        proximo = this.proximoPasso(fluxo.passos, passo);
        break;

      case "avaliacao": {
        // Pesquisa de satisfacao como PASSO do fluxo: pergunta a nota e para
        // aqui. A resposta e capturada por continuarPesquisaSatisfacao, que le a
        // config guardada no contexto da sessao (contextoSessao abaixo).
        const cfg = this._configPesquisaPasso(passo);
        resposta = cfg.mensagemNota;
        aguardando = AGUARDANDO.AVALIACAO_NOTA;
        contextoSessao = {
          pesquisa: true,
          pesquisaCfg: cfg,
          tentativasAval: 0,
          osAvaliada: conversa.atendimentoAtualId || null,
        };
        // Tira a conversa da fila desde ja (como a pesquisa automatica ao
        // encerrar); a sessao segue viva para capturar a nota/comentario.
        await this.deps.conversaRepository.update(conversa.id, {
          statusAtendimento: "fechada",
          fechadoEm: new Date(),
          lido: true,
          naoLidas: 0,
          avaliacaoStatus: "aguardando",
        });
        await this.deps.conversaRepository.atualizarAtendimentoAtual(conversa.id, {
          status: "fechada",
          fechadoEm: new Date(),
          avaliacaoStatus: "aguardando",
        });
        await this._emitirConversa(conversa.id);
        break;
      }

      case "mensagem": {
        resposta = this.textoDoPasso(passo, contexto);
        // Passo com menu (fluxo importado): envia o texto e PARA aqui. Sem isso
        // o motor seguiria o targetId na hora e o cliente receberia o fluxo
        // inteiro de uma vez, sem chance de escolher nada.
        if (this.opcoesDoPasso(passo).length) {
          aguardando = AGUARDANDO.OPCAO;
        } else if (this.passoAguardaCnpj(passo) && !contexto.cnpjValidacao?.valido) {
          // Contato recorrente: oferece o CNPJ ja usado antes (ver memoria).
          const pedido = await this._pedirOuConfirmarCnpj(conversa, resposta, passo);
          aguardando = pedido.aguardando;
          resposta = pedido.resposta;
          if (pedido.cnpjSugerido) contextoSessao = { cnpjSugerido: pedido.cnpjSugerido };
        } else {
          proximo = this.proximoPasso(fluxo.passos, passo);
        }
        break;
      }

      case "condicao": {
        const cnpjCtx = contexto.cnpjValidacao;
        if (cnpjCtx?.valido) {
          // Passo de roteamento: a confirmacao ja foi enviada no momento da
          // validacao. Repetir aqui mandava a mesma mensagem duas vezes.
          proximo = this.proximoPasso(fluxo.passos, passo);
        } else {
          // O texto tem que vir do passo. So caimos no padrao do motor quando
          // as respostas automaticas estao ligadas.
          const textoPasso = this.textoDoPasso(passo, contexto) || "";
          // Contato recorrente: oferece o CNPJ ja usado antes (ver memoria).
          const pedido = await this._pedirOuConfirmarCnpj(conversa, textoPasso, passo);
          aguardando = pedido.aguardando;
          resposta = pedido.resposta;
          if (pedido.cnpjSugerido) contextoSessao = { cnpjSugerido: pedido.cnpjSugerido };
        }
        break;
      }

      case "delay": {
        const ms = Math.min(Number(passo.config?.ms) || 1000, limites.maxDelayMs);
        await sleep(ms);
        proximo = this.proximoPasso(fluxo.passos, passo);
        break;
      }

      case "acao": {
        const acao = passo.config?.acao;
        const cnpj = conversa.cnpj || contexto.cnpjValidacao?.cnpj;
        const parceiro = cnpj ? await this.deps.parceiroRepository.findAtivoByCnpj(cnpj) : null;

        if (acao === "desconto_parceiro") {
          const percentual = passo.config?.percentual || 15;
          if (parceiro) {
            const result = await this.deps.mockErp.aplicarDescontoParceiro({
              cnpj,
              razaoSocial: parceiro.razaoSocial,
              percentual,
            });
            resposta = result.mensagem;
          } else {
            resposta =
              "Desconto de parceiro nao aplicavel: o CNPJ informado nao possui contrato ativo.";
          }
        } else if (acao === "gerar_boleto") {
          const result = await this.deps.mockErp.gerarBoleto({
            cnpj,
            razaoSocial: parceiro?.razaoSocial,
          });
          resposta = `${result.mensagem}\nLinha digitavel: ${result.linhaDigitavel}\nPIX: ${result.pixCopiaCola}\nVencimento: ${result.vencimento}`;
        } else {
          resposta = this.textoDoPasso(passo, contexto);
        }
        if (this.opcoesDoPasso(passo).length) aguardando = AGUARDANDO.OPCAO;
        else proximo = this.proximoPasso(fluxo.passos, passo);
        break;
      }

      default:
        proximo = this.proximoPasso(fluxo.passos, passo);
    }

    if (resposta) {
      const opcoesMenu = this.opcoesDoPasso(passo);
      // Menu (esperando escolha) -> tenta botoes/lista interativos, com o texto
      // do passo como corpo (fallback visivel). Demais mensagens -> texto normal.
      if (opcoesMenu.length && aguardando === AGUARDANDO.OPCAO) {
        await this.enviarBotComOpcoes(conversa.id, telefone, resposta, opcoesMenu, instanceName);
      } else {
        await this.enviarBot(conversa.id, telefone, resposta, instanceName);
      }
    }

    await this.registrarLog(instanciaId, fluxo.id, passo, conversa.id, resposta, true, inicio);

    return { proximo, aguardando, contextoSessao };
  }

  // Percorre os passos com dois freios: um teto de passos e um conjunto de
  // visitados. Sem eles, um fluxo com targetId ciclico (facil de montar no
  // editor visual) prendia o event loop do servidor para sempre.
  async percorrer(passoInicial, contexto) {
    let passoAtual = passoInicial;
    let aguardando = null;
    const visitados = new Set();
    let executados = 0;

    while (passoAtual) {
      if (visitados.has(passoAtual.id) || executados >= limites.maxPassosPorExecucao) {
        logger.warn("Execucao de fluxo interrompida: ciclo ou limite de passos", {
          fluxoId: contexto.fluxo.id,
          conversaId: contexto.conversa.id,
          passoId: passoAtual.id,
          executados,
        });
        await this.registrarLog(
          contexto.instanciaId,
          contexto.fluxo.id,
          passoAtual,
          contexto.conversa.id,
          "Fluxo interrompido: ciclo detectado ou limite de passos atingido.",
          false,
          Date.now()
        );
        passoAtual = null;
        break;
      }

      visitados.add(passoAtual.id);
      executados += 1;

      const resultado = await this.executarPasso(passoAtual, contexto);
      aguardando = resultado.aguardando;

      if (aguardando) {
        // Fica parado no passo que pediu a informacao; a resposta do cliente
        // e que faz avancar. `contextoSessao` carrega o que esse passo precisa
        // guardar (ex.: a config da pesquisa de satisfacao).
        return { passoAtual, aguardando, contextoSessao: resultado.contextoSessao || null };
      }

      passoAtual = resultado.proximo;
    }

    return { passoAtual: null, aguardando: null, contextoSessao: null };
  }

  async executarFluxo(fluxo, conversa, telefone, instanciaId, instanceName, contextoExtra = {}) {
    const passos = this.ordenarPassos(fluxo.passos);
    const contexto = {
      conversa,
      telefone,
      instanciaId,
      instanceName,
      fluxo: { ...fluxo, passos },
      ...contextoExtra,
    };

    const { passoAtual, aguardando, contextoSessao } = await this.percorrer(passos[0] || null, contexto);

    await this.deps.sessaoRepository.upsert(instanciaId, conversa.id, telefone, {
      fluxoAtualId: fluxo.id,
      passoAtualId: passoAtual?.id || null,
      aguardando,
      ativo: !!aguardando,
      contexto: contextoSessao || { tentativasCnpj: 0, tentativasOpcao: 0 },
    });

    return { fluxoId: fluxo.id, aguardando, concluido: !aguardando };
  }

  // ------------------------------------------------------ continuar sessao --

  // Executa a opcao escolhida pelo cliente: seguir para outro bloco, entregar
  // para um atendente ou encerrar a conversa.
  async aplicarOpcao(opcao, contexto, sessao) {
    const { conversa, telefone, instanceName, fluxo } = contexto;
    const globais = this.configuracoesGlobais(fluxo);

    // ---------------------------------------------------------------------
    // AQUI, E SO AQUI, O CLIENTE DEFINE O SETOR.
    //
    // `opcao.setor` vem do JSON do fluxo ("1 - Setor Tecnico" -> "Tecnico").
    // Antes disto, nenhuma opcao carregava setor: a escolha do menu nao gravava
    // nada e o setor so aparecia no handoff, deduzido do texto. Agora a escolha
    // e persistida no instante em que acontece -- e como Conversa, OS e
    // Feedback leem esse mesmo campo, as tres telas concordam sem F5.
    // ---------------------------------------------------------------------
    // `opcao.setor` (JSON do fluxo) e o caminho oficial. Quando ele nao existe
    // -- fluxo montado antes do campo, ou importado do editor de origem, que
    // nao o conhece -- o setor sai do ROTULO DA OPCAO QUE O CLIENTE ESCOLHEU
    // ("1 - Setor Tecnico"). Continua sendo escolha do cliente, nao palpite
    // sobre o texto dele; ver setor.helper.setorDaOpcaoEscolhida.
    const setorDaEscolha = opcao.setor || setorDaOpcaoEscolhida(opcao);
    if (setorDaEscolha) {
      const setorEscolhido = resolverSetorDeclarado({ setorExplicito: setorDaEscolha });
      if (conversa.setor !== setorEscolhido) {
        await this.deps.conversaRepository.update(conversa.id, { setor: setorEscolhido });
        await this.deps.conversaRepository.atualizarAtendimentoAtual(conversa.id, {
          setor: setorEscolhido,
        });
        conversa.setor = setorEscolhido;
        await this._emitirConversa(conversa.id);
        logger.info("Setor definido pela escolha do cliente", {
          conversaId: conversa.id,
          opcao: opcao.id,
          setor: setorEscolhido,
        });
      }
    }

    // "INFORMAR OUTRO CNPJ": o cliente esta dizendo que o CNPJ vinculado nao
    // serve. Mesma acao do "NAO" na confirmacao -- desassocia a conversa, sem
    // tocar no cadastro da empresa -- e por isso reusa o mesmo metodo. Sem
    // isto, a etapa de CNPJ ofereceria de volta exatamente o CNPJ recusado.
    if (opcao.limparCnpj) await this._desassociarCnpj(conversa);

    if (opcao.acao === "encerrar") {
      const despedida = opcao.mensagemEncerramento || globais?.farewellMessage?.message || null;
      return this.encerrarAtendimento(
        contexto,
        despedida ? this.interpolar(despedida, contexto) : null
      );
    }

    if (opcao.acao === "transferir") {
      // O editor de origem manda a `welcomeMessage` ("sua solicitacao esta
      // completa, aguarde um colaborador") justamente ao entregar para a fila.
      const aviso = globais?.welcomeMessage?.message;
      if (aviso) {
        await this.enviarBot(conversa.id, telefone, this.interpolar(aviso, contexto), instanceName);
      }
      // A fila do editor de origem (queueId) vira setor pelo mapa de
      // Configuracoes; sem mapa, a conversa cai na fila geral como antes.
      const filaId = opcao.filaId ?? null;
      let setor = opcao.setor || null;
      if (!setor && filaId != null) {
        const mapa = await this.deps.configuracaoService.filasParaSetor();
        setor = mapa[String(filaId)] || null;
      }
      return this.transferirParaHumano(contexto, {
        motivo: "fluxo_transferiu",
        setor,
        filaId,
      });
    }

    const destino = fluxo.passos.find((p) => p.id === opcao.targetId) || null;
    if (!destino) {
      // Ramificacao apontando para o vazio: um atendente e melhor que silencio.
      return this.transferirParaHumano(contexto, { motivo: "ramificacao_sem_destino" });
    }

    const resultado = await this.percorrer(destino, contexto);

    await this.deps.sessaoRepository.update(sessao.id, {
      passoAtualId: resultado.passoAtual?.id || null,
      aguardando: resultado.aguardando,
      ativo: !!resultado.aguardando,
      contexto: resultado.contextoSessao || { ...(sessao.contexto || {}), tentativasOpcao: 0, tentativasCnpj: 0 },
    });

    return {
      fluxoId: fluxo.id,
      aguardando: resultado.aguardando,
      concluido: !resultado.aguardando,
    };
  }

  async continuarSessao(sessao, ctx, textoEntrada) {
    const { conversa, telefone, instanciaId, instanceName } = ctx;
    const fluxo = await this.deps.fluxoRepository.findById(sessao.fluxoAtualId);

    if (!fluxo || !fluxo.ativo) {
      // Fluxo apagado ou PAUSADO no meio do atendimento: o bot para de conduzir
      // e a conversa vai para a fila, para uma pessoa assumir.
      return this.enviarMenu(ctx);
    }

    const passos = this.ordenarPassos(fluxo.passos);
    const contexto = {
      ...ctx,
      fluxo: { ...fluxo, passos },
    };

    let passoAtual = sessao.passoAtualId
      ? passos.find((p) => p.id === sessao.passoAtualId)
      : passos[0];

    // Cliente parado num menu do fluxo: a mensagem dele e a escolha da opcao.
    if (sessao.aguardando === AGUARDANDO.OPCAO) {
      const opcoes = this.opcoesDoPasso(passoAtual);
      const escolha = opcoes.length ? this.casarOpcao(textoEntrada, opcoes) : null;

      if (!escolha) {
        // Passo perdeu as opcoes (fluxo editado no meio do atendimento): nao ha
        // como continuar de onde parou.
        if (!opcoes.length) return this.transferirParaHumano(ctx, { motivo: "passo_sem_opcoes" });

        const tentativas = (sessao.contexto?.tentativasOpcao || 0) + 1;
        if (tentativas >= limites.maxTentativasOpcao) {
          return this.transferirParaHumano(ctx, { motivo: "opcao_invalida" });
        }

        // Texto do proprio fluxo importado, nao do motor.
        const naoEntendi = this.configuracoesGlobais(fluxo)?.notOptionsSelectMessage?.message;
        if (naoEntendi) {
          await this.enviarBot(
            conversa.id,
            telefone,
            this.interpolar(naoEntendi, contexto),
            instanceName
          );
        }

        await this.deps.sessaoRepository.update(sessao.id, {
          contexto: { ...(sessao.contexto || {}), tentativasOpcao: tentativas },
        });

        return { fluxoId: fluxo.id, conversaId: conversa.id, aguardando: AGUARDANDO.OPCAO };
      }

      return this.aplicarOpcao(escolha, contexto, sessao);
    }

    // Cliente recorrente confirmando o CNPJ que ja usou antes.
    if (sessao.aguardando === AGUARDANDO.CNPJ_CONFIRMA) {
      const resp = this.normalizarTexto(textoEntrada);
      const sim = ["sim", "s", "isso", "confirmo", "correto", "positivo", "ok", "sim!", "1"];
      const nao = ["nao", "n", "outro", "errado", "negativo", "2"];

      if (sim.includes(resp)) {
        // Reaproveita o caminho normal de validacao: consulta parceiro, grava na
        // conversa e devolve a mensagem de confirmacao.
        const cnpjValidacao = await this.validarCnpjRecebido(
          conversa,
          sessao.contexto?.cnpjSugerido || "",
          paramsCnpj(passoAtual)
        );
        if (cnpjValidacao.valido) {
          await this.enviarBot(conversa.id, telefone, cnpjValidacao.mensagem, instanceName);
          contexto.cnpjValidacao = cnpjValidacao;
          contexto.conversa = await this.deps.conversaRepository.findById(conversa.id);
          // O passo que pediu o CNPJ cumpriu seu papel; segue para o proximo.
          const seguinte = passoAtual ? this.proximoPasso(passos, passoAtual) : null;
          const resultado = await this.percorrer(seguinte, contexto);
          await this.deps.sessaoRepository.update(sessao.id, {
            passoAtualId: resultado.passoAtual?.id || null,
            aguardando: resultado.aguardando,
            ativo: !!resultado.aguardando,
            contexto: resultado.contextoSessao || { tentativasCnpj: 0, tentativasOpcao: 0 },
          });
          return {
            fluxoId: fluxo.id,
            aguardando: resultado.aguardando,
            concluido: !resultado.aguardando,
          };
        }
        // CNPJ guardado nao vale mais (ex.: base mudou): pede digitado.
      } else if (!nao.includes(resp)) {
        // Nem sim nem nao: e o caso "cliente nao respondeu o que foi pedido".
        // O texto vem do fluxo, igual a todos os outros.
        await this.enviarBot(
          conversa.id,
          telefone,
          paramsCnpj(passoAtual).mensagemRespostaInvalida,
          instanceName
        );
        return { conversaId: conversa.id, aguardando: AGUARDANDO.CNPJ_CONFIRMA };
      }

      // "nao" (ou sugestao invalida): o CNPJ oferecido nao serve.
      // Desvincula o que estiver na conversa -- ela volta para "CNPJ pendente"
      // na Central -- e pede o correto. O cadastro da empresa NAO e tocado.
      await this._desassociarCnpj(conversa);
      await this.enviarBot(
        conversa.id,
        telefone,
        paramsCnpj(passoAtual).mensagemPedirOutro,
        instanceName
      );
      await this.deps.sessaoRepository.update(sessao.id, {
        aguardando: AGUARDANDO.CNPJ,
        ativo: true,
        contexto: { ...(sessao.contexto || {}), cnpjSugerido: null, tentativasCnpj: 0 },
      });
      return { conversaId: conversa.id, aguardando: AGUARDANDO.CNPJ };
    }

    if (sessao.aguardando === AGUARDANDO.CNPJ) {
      // Parametros do PASSO que pediu o CNPJ (tentativas e textos). Sem passo
      // identificado, valem os padroes documentados em fluxo.automacao.
      const cfgCnpj = paramsCnpj(passoAtual);
      const cnpjValidacao = await this.validarCnpjRecebido(conversa, textoEntrada, cfgCnpj);

      if (!cnpjValidacao.valido) {
        // "Nao entendi o que voce falou" NAO gasta tentativa: o cliente que
        // pergunta outra coisa no meio do caminho nao errou o CNPJ. Gastar
        // tentativa aqui fazia uma duvida legitima empurrar o cliente para fora
        // do fluxo.
        if (cnpjValidacao.estado === "resposta_invalida") {
          await this.enviarBot(conversa.id, telefone, cnpjValidacao.mensagem, instanceName);
          return { conversaId: conversa.id, aguardando: AGUARDANDO.CNPJ };
        }

        const tentativas = (sessao.contexto?.tentativasCnpj || 0) + 1;
        const restantes = cfgCnpj.maxTentativas - tentativas;

        if (restantes <= 0) {
          // Acabaram as tentativas: o FLUXO decide o desfecho.
          if (cfgCnpj.aoEsgotarTentativas === "avulso") {
            await this.enviarBot(conversa.id, telefone, cfgCnpj.mensagemNaoCadastrado, instanceName);
            await this.deps.sessaoRepository.update(sessao.id, {
              contexto: { ...(sessao.contexto || {}), tentativasCnpj: 0 },
            });
            logger.info("CNPJ nao confirmado: seguindo como cliente avulso", {
              conversaId: conversa.id,
            });
            return this.transferirParaHumano(ctx, { avisar: false, motivo: "cliente_avulso" });
          }
          return this.transferirParaHumano(ctx, { motivo: "cnpj_invalido" });
        }

        // Ainda ha tentativa: avisa QUE errou (antes o bot ficava mudo e o
        // cliente reenviava o mesmo numero sem saber o motivo) e, quando so
        // resta uma, usa o texto que diz isso explicitamente.
        await this.enviarBot(
          conversa.id,
          telefone,
          restantes === 1 ? cfgCnpj.mensagemUltimaTentativa : cnpjValidacao.mensagem,
          instanceName
        );

        await this.deps.sessaoRepository.update(sessao.id, {
          contexto: { ...(sessao.contexto || {}), tentativasCnpj: tentativas },
        });

        return { conversaId: conversa.id, aguardando: AGUARDANDO.CNPJ };
      }

      await this.enviarBot(conversa.id, telefone, cnpjValidacao.mensagem, instanceName);

      contexto.cnpjValidacao = cnpjValidacao;
      contexto.conversa = await this.deps.conversaRepository.findById(conversa.id);

      // O passo que pediu o CNPJ ja cumpriu seu papel; segue para o proximo.
      if (passoAtual) {
        passoAtual = this.proximoPasso(passos, passoAtual);
      }
    }

    const resultado = await this.percorrer(passoAtual, contexto);

    await this.deps.sessaoRepository.update(sessao.id, {
      passoAtualId: resultado.passoAtual?.id || null,
      aguardando: resultado.aguardando,
      ativo: !!resultado.aguardando,
      contexto: resultado.contextoSessao || { ...(sessao.contexto || {}), tentativasCnpj: 0, tentativasOpcao: 0 },
    });

    return {
      fluxoId: fluxo.id,
      aguardando: resultado.aguardando,
      concluido: !resultado.aguardando,
    };
  }

  // ------------------------------------------------------------- entrada ---

  async processarMensagemEntrada(params) {
    const chave = `${params.instanciaId}:${params.telefone}`;
    // Serializa mensagens do mesmo cliente: webhooks chegam em paralelo.
    return comLock(chave, () => this._processarMensagemEntrada(params));
  }

  async _processarMensagemEntrada({
    instanciaId,
    instanceName,
    telefone,
    texto,
    nomeCliente = "Cliente",
    waMessageId = null,
    midia = null,
    encaminhada = null,
  }) {
    const textoLimpo = this.extrairTextoMensagem(texto);
    const ehMidia = !!midia && midia.tipo && midia.tipo !== "texto";
    // Sem texto e sem midia: nada a processar.
    if (!textoLimpo && !ehMidia) return { processado: false, motivo: "mensagem_vazia" };

    // A Evolution API reentrega webhooks; sem isso a mesma mensagem rodava o
    // fluxo duas vezes e o cliente recebia tudo duplicado.
    if (waMessageId && (await this.deps.conversaRepository.existeMensagemWa(waMessageId))) {
      return { processado: false, motivo: "mensagem_duplicada" };
    }

    // Texto exibido na bolha/preview + metadata da midia (quando houver).
    const rotulos = { imagem: "[Imagem]", figurinha: "[Figurinha]", video: "[Vídeo]", documento: "[Documento]", audio: "[Áudio]", localizacao: "[Localização]", contato: "[Contato]" };
    const textoMsg = ehMidia ? (textoLimpo || rotulos[midia.tipo] || "[Mídia]") : textoLimpo;
    // A marca de encaminhamento entra no metadata (campo Json que ja existe --
    // sem migracao) e vale tambem para texto puro, que nao tem midia nenhuma.
    const metadata =
      ehMidia || encaminhada ? { ...(ehMidia ? midia : {}), ...(encaminhada || {}) } : null;

    // RESPOSTA DA PESQUISA DE SATISFACAO: a conversa avaliada JA ESTA FECHADA, e
    // findByTelefone (de proposito) so olha pendente/aberta. Sem este desvio, a
    // nota do cliente criava uma conversa NOVA e era gravada nela -- uma conversa
    // que ninguem atendeu e sem nome de cliente. Era isso que fazia a coluna
    // "Atendente" das avaliacoes dizer "Bot" mesmo em atendimento humano, e ainda
    // deixava uma conversa-fantasma na lista de Fechadas a cada avaliacao.
    let conversa = null;
    const sessaoAberta = await this.deps.sessaoRepository.findByTelefone(instanciaId, telefone);
    const respondendoPesquisa =
      sessaoAberta?.ativo &&
      sessaoAberta.conversaId &&
      !this.sessaoExpirada(sessaoAberta) &&
      (sessaoAberta.aguardando === AGUARDANDO.AVALIACAO_NOTA ||
        sessaoAberta.aguardando === AGUARDANDO.AVALIACAO_COMENTARIO);
    if (respondendoPesquisa) {
      // Tambem sem o historico: quem responde a nota da pesquisa nao precisa
      // que o fio inteiro seja carregado para o "5" ser gravado.
      const repo = this.deps.conversaRepository;
      conversa = repo.findByIdParaEvento
        ? await repo.findByIdParaEvento(sessaoAberta.conversaId)
        : await repo.findById(sessaoAberta.conversaId);
    }
    // Leitura SEM o historico: e a primeira consulta de toda mensagem que
    // chega, e carregar o fio inteiro aqui era o que fazia o RECEBIMENTO custar
    // proporcionalmente ao tamanho da conversa (1,85s medido em producao).
    // O motor nao le `conversa.mensagens` -- ver findByTelefoneParaMotor.
    if (!conversa) {
      const repo = this.deps.conversaRepository;
      conversa = repo.findByTelefoneParaMotor
        ? await repo.findByTelefoneParaMotor(instanciaId, telefone)
        : await repo.findByTelefone(instanciaId, telefone); // simulador/stubs
    }
    if (!conversa) {
      conversa = await this.deps.conversaRepository.create({
        instanciaId,
        cliente: nomeCliente,
        telefone,
        statusAtendimento: "pendente",
        lido: false,
        naoLidas: 1,
        mensagens: {
          create: { origem: "cliente", texto: textoMsg, waMessageId, metadata },
        },
      });
      // Foto de perfil (best-effort) so na criacao, para nao pesar a cada msg.
      const fotoUrl = await this.deps.evolutionApi.fetchProfilePictureUrl(telefone, instanceName);
      if (fotoUrl) await this.deps.conversaRepository.update(conversa.id, { fotoUrl });
      conversa = await this.deps.conversaRepository.findById(conversa.id);
    } else {
      // NOVO CICLO NO MESMO FIO.
      //
      // Aqui ficava a duplicacao: `findByTelefone` ignorava conversa fechada,
      // entao o cliente que voltava a escrever ganhava uma conversa NOVA, com
      // outro numero, e o historico anterior sumia numa linha separada. Agora o
      // fio e sempre o mesmo e o que nasce e uma OS nova -- o historico inteiro
      // continua junto e so o numero da OS muda.
      //
      // A resposta da PESQUISA DE SATISFACAO e a excecao: ela pertence ao ciclo
      // que acabou de fechar, entao nao abre atendimento nenhum.
      if (!respondendoPesquisa && conversa.statusAtendimento === "fechada") {
        // CHAMADO NOVO COMECA SEM SETOR -- a triagem e do CICLO, nao do fio.
        //
        // O fio e permanente e o setor mora nele, entao o ciclo novo herdava o
        // setor do anterior: quem foi ao Técnico em agosto voltava em setembro
        // ja carimbado como Técnico, sem ter escolhido nada -- e a badge dizia
        // "SETOR TÉCNICO" antes de o menu sequer ser respondido. Era o mesmo
        // sintoma da deducao por palavra-chave, por outro caminho.
        //
        // O cliente responde o menu de novo a cada chamado; e essa resposta que
        // define o setor deste ciclo (ver aplicarOpcao). Ate la, "Geral".
        const r = await this.deps.conversaRepository.garantirAtendimentoAberto(conversa.id, {
          setor: SETOR_PADRAO,
        });
        await this.deps.conversaRepository.update(conversa.id, {
          statusAtendimento: "pendente",
          fechadoEm: null,
          atendidoEm: null,
          // Ciclo novo comeca sem responsavel: quem assumir o anterior nao herda
          // este de graca (`ultimoAtendenteNome` guarda o historico).
          atendenteId: null,
          // Sem triagem ate o cliente escolher no menu deste chamado.
          setor: SETOR_PADRAO,
          avaliacao: null,
          feedback: null,
          lido: false,
        });
        // O objeto em memoria segue o resto do processamento desta mensagem: sem
        // isto, um handoff no mesmo turno leria o setor antigo e o regravaria.
        conversa.setor = SETOR_PADRAO;
        logger.info("Novo atendimento aberto no fio existente (sem setor)", {
          conversaId: conversa.id,
          numeroOS: r?.atendimento?.numeroOS ?? null,
        });
      }

      // A NOTA DA PESQUISA NAO E "MENSAGEM NOVA" -- e por isso vai marcada.
      //
      // O "5" que o cliente responde a "de 1 a 5, que nota voce da?" e, no
      // banco, uma mensagem do cliente como outra qualquer -- e a Central tocava
      // o som e mostrava notificacao para ela, chamando o atendente para uma
      // conversa que ACABOU de fechar e nao precisa de ninguem.
      //
      // A distincao nao da para fazer na tela (o texto e so um numero): quem
      // sabe que aquilo e resposta de pesquisa e o servidor, que conhece o
      // estado da sessao. Entao a marca e gravada aqui, junto da mensagem.
      //
      // Se o cliente escrever DEPOIS da avaliacao, essa proxima mensagem nao
      // tem a marca, abre atendimento novo e avisa normalmente -- que e
      // exatamente quando o atendente precisa saber.
      await this.deps.conversaRepository.addMensagem(
        conversa.id,
        "cliente",
        textoMsg,
        respondendoPesquisa ? { ...(metadata || {}), respostaPesquisa: true } : metadata,
        waMessageId
      );
      // Se a conversa ficou so com o numero (ex.: iniciada pelo atendente) ou com
      // o placeholder "Cliente", adota o nome do perfil do WhatsApp quando o
      // cliente responde. Nao sobrescreve um nome ja definido manualmente.
      const nomeAtual = String(conversa.cliente || "").trim();
      const ehPlaceholder = !nomeAtual || nomeAtual === telefone || nomeAtual === "Cliente";
      const nomeReal = String(nomeCliente || "").trim();
      if (ehPlaceholder && nomeReal && nomeReal !== "Cliente" && nomeReal !== telefone) {
        await this.deps.conversaRepository.update(conversa.id, { cliente: nomeReal });
      }
      // Leitura LEVE: o motor nunca le `conversa.mensagens` (nenhum passo do
      // fluxo depende do historico), e o que sobra alimenta tanto o resto do
      // processamento quanto o evento logo abaixo -- uma consulta em vez de duas.
      conversa = await this.deps.conversaRepository.findByIdParaEvento(conversa.id);
    }

    // Guarda defensiva: se a releitura falhar (corrida com exclusao da conversa,
    // por exemplo), respondemos o webhook em vez de estourar TypeError.
    if (!conversa) {
      logger.warn("Conversa nao encontrada apos gravar a mensagem", { telefone, waMessageId });
      return { processado: false, motivo: "conversa_indisponivel" };
    }

    // Empurra a conversa ao front imediatamente, reaproveitando o que ja foi
    // lido acima. Isto acontece ANTES do fluxo do bot rodar: a mensagem do
    // cliente aparece na Central sem esperar CNPJ, menu ou envio de resposta.
    await this._emitirConversa(conversa.id, conversa);

    // Quem responde o cliente e definido em Configuracoes. Fora do modo "local",
    // o motor NAO envia nada por conta propria: a mensagem fica registrada na
    // Central e o n8n (ou o atendente) decide o que fazer.
    const modo = await this.deps.configuracaoService.modoAtendimento();
    if (modo !== "local") {
      let encaminhamento = { encaminhado: false, motivo: "modo_humano" };
      if (modo === "n8n") {
        encaminhamento = await this.deps.n8nClient.encaminharMensagem({
          evento: "mensagem_recebida",
          conversaId: conversa.id,
          instancia: instanceName,
          telefone,
          nomeCliente: conversa.cliente,
          texto: textoMsg,
          midia: metadata,
          waMessageId,
          statusAtendimento: conversa.statusAtendimento,
          cnpj: conversa.cnpj || null,
          recebidoEm: new Date().toISOString(),
        });
      }
      return {
        processado: true,
        motivo: `controlado_por_${modo}`,
        conversaId: conversa.id,
        ...encaminhamento,
      };
    }

    // Midia nao dispara o fluxo do bot: registramos e notificamos o atendente.
    if (ehMidia) {
      return { processado: true, motivo: "midia_recebida", conversaId: conversa.id };
    }

    // Fora do horario de atendimento: o bot nao inicia fluxo nenhum. Vale so
    // para conversa nova/parada - quem ja esta no meio de um menu continua, para
    // nao abandonar o cliente no meio do caminho quando o expediente vira.
    const horario = await this.deps.configuracaoService.horarioAtendimento();
    if (this.foraDoHorario(horario)) {
      const sessaoEmCurso = await this.deps.sessaoRepository.findByTelefone(instanciaId, telefone);
      // Nao interrompe quem ja esta no meio de um menu OU respondendo a pesquisa
      // de satisfacao: joga-los na fila por causa do expediente abandona o fluxo.
      const emCurso =
        sessaoEmCurso?.ativo &&
        [
          AGUARDANDO.OPCAO,
          AGUARDANDO.CNPJ,
          AGUARDANDO.CNPJ_CONFIRMA,
          AGUARDANDO.AVALIACAO_NOTA,
          AGUARDANDO.AVALIACAO_COMENTARIO,
        ].includes(sessaoEmCurso.aguardando);
      if (!emCurso) {
        if (horario.mensagem) {
          await this.enviarBot(
            conversa.id,
            telefone,
            this.interpolar(horario.mensagem, { conversa }),
            instanceName
          );
        }
        logger.info("Mensagem recebida fora do horario de atendimento", {
          conversaId: conversa.id,
        });
        return this.transferirParaHumano(
          { conversa, telefone, instanciaId, instanceName },
          { avisar: false, motivo: "fora_do_horario" }
        );
      }
    }

    // Atendente humano assumiu: o bot nao interfere.
    if (conversa.statusAtendimento === "aberta") {
      return { processado: false, motivo: "atendimento_humano", conversaId: conversa.id };
    }

    let sessao = await this.deps.sessaoRepository.findByTelefone(instanciaId, telefone);
    if (sessao && this.sessaoExpirada(sessao)) {
      await this.deps.sessaoRepository.update(sessao.id, {
        ativo: false,
        aguardando: null,
        passoAtualId: null,
        contexto: {},
      });
      logger.info("Sessao do chatbot expirada", { conversaId: conversa.id, telefone });
      sessao = null;
    }

    const ctx = {
      conversa,
      telefone,
      instanciaId,
      instanceName,
      contexto: sessao?.contexto || {},
    };

    try {
      // Pesquisa de satisfacao em andamento: a resposta do cliente e a nota ou o
      // comentario. Tratado antes de tudo para que as palavras de controle
      // (sair, menu, atendente...) nao sequestrem a resposta da pesquisa.
      if (
        sessao?.ativo &&
        (sessao.aguardando === AGUARDANDO.AVALIACAO_NOTA ||
          sessao.aguardando === AGUARDANDO.AVALIACAO_COMENTARIO)
      ) {
        return await this.continuarPesquisaSatisfacao(sessao, ctx, textoLimpo);
      }

      const comandoBruto = this.detectarComando(textoLimpo);

      // Com o cliente parado num menu do fluxo, as palavras-chave globais do
      // motor colidem de frente com os rotulos do menu: `palavrasChave.menu` tem
      // "voltar" e "inicio", `palavrasChave.sair` tem "encerrar" e "sair", e um
      // menu tipico traz "3,voltar,menu inicial,inicio" e "encerrar,sair,4".
      // Nesse estado a opcao do fluxo ganha - senao o cliente que digita
      // "voltar" cai na fila em vez de voltar ao inicio do bot, e quem digita
      // "encerrar" nao recebe a mensagem de despedida que o fluxo definiu.
      // O pedido explicito de atendente continua atropelando o fluxo.
      const noMenuDoFluxo = sessao?.ativo && sessao.aguardando === AGUARDANDO.OPCAO;

      // ETAPA OBRIGATORIA NAO SE PULA POR ACIDENTE.
      //
      // "atendente", "sair" e "menu" sao atalhos do motor que atropelam o
      // fluxo. Isso e util (quem pede uma pessoa deve conseguir uma pessoa),
      // mas e uma forma de sair de uma etapa obrigatoria -- entao QUEM DECIDE e
      // o fluxo, nao o codigo: configuracoesGlobais.permitirComandosGlobais.
      // Desligado, o cliente que escreve "quero falar com alguem" enquanto o bot
      // espera o CNPJ recebe o fallback e continua na etapa.
      const emEtapaObrigatoria =
        sessao?.ativo &&
        [AGUARDANDO.CNPJ, AGUARDANDO.CNPJ_CONFIRMA, AGUARDANDO.OPCAO].includes(sessao.aguardando);
      let permiteAtalhos = true;
      if (emEtapaObrigatoria && sessao.fluxoAtualId) {
        const fluxoAtual = await this.deps.fluxoRepository.findById(sessao.fluxoAtualId);
        permiteAtalhos = paramsTempos(fluxoAtual).permitirComandosGlobais;
      }

      const comando = !permiteAtalhos
        ? null
        : noMenuDoFluxo && comandoBruto !== "atendente"
          ? null
          : comandoBruto;

      if (comando === "atendente") {
        return await this.transferirParaHumano(ctx, { motivo: "pedido_do_cliente" });
      }

      if (comando === "sair") {
        return await this.encerrarSessao(ctx);
      }

      if (comando === "menu") {
        const fluxos = await this.deps.fluxoRepository.findAtivos();
        ctx.contexto = { ...ctx.contexto, tentativasMenu: 0 };
        return await this.enviarMenu(ctx);
      }

      // Transferida para humano e ainda ninguem assumiu: o bot so registra.
      if (sessao?.ativo && sessao.aguardando === AGUARDANDO.HUMANO) {
        return {
          processado: false,
          motivo: "aguardando_atendente",
          conversaId: conversa.id,
        };
      }

      // Sessao esperando escolha do menu.
      if (sessao?.ativo && sessao.aguardando === AGUARDANDO.MENU) {
        const opcoes = sessao.contexto?.menuOpcoes || [];
        const fluxoId = this.interpretarEscolhaMenu(textoLimpo, opcoes);

        if (fluxoId) {
          const fluxo = await this.deps.fluxoRepository.findById(fluxoId);
          if (fluxo?.ativo) {
            const result = await this.executarFluxo(
              fluxo,
              conversa,
              telefone,
              instanciaId,
              instanceName
            );
            return { processado: true, conversaId: conversa.id, fluxoId: fluxo.id, ...result };
          }
        }
        // Nao escolheu numero: cai no fluxo normal de gatilho/fallback abaixo.
      }

      // Sessao em andamento dentro de um fluxo.
      if (sessao?.ativo && sessao.fluxoAtualId) {
        const result = await this.continuarSessao(sessao, ctx, textoLimpo);
        return { processado: true, conversaId: conversa.id, ...result };
      }

      const fluxos = await this.deps.fluxoRepository.findAtivos();
      // Palavra-chave primeiro; o fluxo de boas-vindas (gatilho "*") e o fallback,
      // senao ele engoliria todos os fluxos especificos.
      const fluxo = this.detectarGatilho(textoLimpo, fluxos) || this.fluxoPadrao(fluxos);

      if (!fluxo) {
        // Antes o bot simplesmente nao respondia nada aqui.
        const tentativas = ctx.contexto?.tentativasMenu || 0;
        if (tentativas >= limites.maxTentativasMenu) {
          return await this.transferirParaHumano(ctx, { motivo: "sem_gatilho" });
        }

        const result = await this.enviarMenu(ctx);
        return { ...result, motivo: "sem_gatilho" };
      }

      // Cliente ja mandou o CNPJ junto com a primeira mensagem.
      const cnpjNumeros = limparCnpj(textoLimpo);
      let cnpjValidacao = null;
      if (cnpjNumeros.length === 14 && cnpjValido(cnpjNumeros) && !conversa.cnpjVerificado) {
        // Fora de fluxo nao ha passo: valem os padroes de fluxo.automacao.
        cnpjValidacao = await this.validarCnpjRecebido(conversa, textoLimpo);
        await this.enviarBot(conversa.id, telefone, cnpjValidacao.mensagem, instanceName);
        conversa = await this.deps.conversaRepository.findById(conversa.id);
      }

      const result = await this.executarFluxo(
        fluxo,
        conversa,
        telefone,
        instanciaId,
        instanceName,
        { cnpjValidacao }
      );

      return { processado: true, conversaId: conversa.id, fluxoId: fluxo.id, ...result };
    } catch (error) {
      // Qualquer falha inesperada vira handoff em vez de deixar o cliente sem resposta.
      logger.error("Erro ao processar mensagem do chatbot", {
        conversaId: conversa.id,
        telefone,
        message: error.message,
        stack: error.stack,
      });
      await this.transferirParaHumano(ctx, { avisar: false, motivo: "erro_interno" }).catch(
        () => {}
      );

      return { processado: false, motivo: "erro_interno", conversaId: conversa.id };
    }
  }
}

const engine = new ChatbotEngine();

module.exports = engine;
// A classe e as constantes ficam expostas para o simulador montar uma instancia
// com dependencias falsas (mesma logica, sem banco e sem WhatsApp).
module.exports.ChatbotEngine = ChatbotEngine;
module.exports.AGUARDANDO = AGUARDANDO;
module.exports.GATILHO_CURINGA = GATILHO_CURINGA;
