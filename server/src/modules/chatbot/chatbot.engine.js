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
const { mapConversa } = require("../../shared/helpers/mapper.helper");
const configuracaoService = require("../configuracoes/configuracao.service");
const n8nClient = require("../../infrastructure/external/n8n.client");
const bus = require("../../shared/events/event-bus");
const logger = require("../../config/logger");
const env = require("../../config/env");
const { sessao: cfgSessao, limites, palavrasChave } = require("./chatbot.config");

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
    return idx >= 0 ? passos[idx + 1] || null : null;
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
    const cfg = fluxo && this.configuracaoInatividade(fluxo);
    if (!cfg) return null;

    const parado = Date.now() - new Date(sessao.atualizadoEm || sessao.criadoEm).getTime();
    if (parado < cfg.minutos * 60 * 1000) return null;

    const ctx = { conversa, telefone: sessao.telefone, instanciaId, instanceName };
    const texto = cfg.mensagem ? this.interpolar(cfg.mensagem, ctx) : null;

    logger.info("Sessao encerrada por inatividade", {
      conversaId: conversa.id,
      minutos: cfg.minutos,
      encerrar: cfg.encerrar,
    });

    if (cfg.encerrar) return this.encerrarAtendimento(ctx, texto);

    if (texto) await this.enviarBot(conversa.id, sessao.telefone, texto, instanceName);
    return this.transferirParaHumano(ctx, { motivo: "inatividade" });
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

  async enviarBot(conversaId, telefone, texto, instanceName) {
    const msg = await this.deps.conversaRepository.addMensagem(conversaId, "bot", texto, null, null, {
      status: "enviando",
    });
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
  async _emitirConversa(conversaId) {
    try {
      const conversa = await this.deps.conversaRepository.findById(conversaId);
      if (conversa) this.deps.bus.emitConversa(mapConversa(conversa));
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
    const cfg = passo?.config || {};
    if (cfg.memoriaCnpj === false) return pedirNormal;
    try {
      const anterior = await this.deps.conversaRepository.ultimoCnpjDoTelefone(
        conversa.telefone,
        conversa.id
      );
      if (!anterior?.cnpj) return pedirNormal;

      const parceiro = await this.deps.parceiroRepository.findAtivoByCnpj(anterior.cnpj);
      const cnpjFmt = mascararCnpj(anterior.cnpj);
      const empresaNome = parceiro?.razaoSocial || "";

      const padrao =
        `Vi que você já foi atendido por aqui. O CNPJ continua sendo este?\n\n` +
        `📄 {{cnpj}}{{empresa}}\n\n` +
        `Responda *SIM* para confirmar ou *NÃO* para informar outro.`;
      const modelo =
        typeof cfg.mensagemConfirmarCnpj === "string" && cfg.mensagemConfirmarCnpj.trim()
          ? cfg.mensagemConfirmarCnpj
          : padrao;

      return {
        aguardando: AGUARDANDO.CNPJ_CONFIRMA,
        resposta: modelo
          .replace(/\{\{\s*cnpj\s*\}\}/g, cnpjFmt)
          .replace(/\{\{\s*empresa\s*\}\}/g, empresaNome ? `\n🏢 ${empresaNome}` : ""),
        cnpjSugerido: anterior.cnpj,
      };
    } catch (e) {
      // Memoria e conveniencia: se a consulta falhar, o atendimento nao para.
      logger.warn("Falha ao consultar CNPJ anterior do contato", { message: e.message });
      return pedirNormal;
    }
  }

  async validarCnpjRecebido(conversa, texto) {
    const cnpjLimpo = limparCnpj(texto);
    if (cnpjLimpo.length !== 14 || !cnpjValido(cnpjLimpo)) {
      return { valido: false, cnpj: cnpjLimpo };
    }

    const parceiro = await this.deps.parceiroRepository.findAtivoByCnpj(cnpjLimpo);
    await this.deps.conversaRepository.update(conversa.id, {
      cnpj: cnpjLimpo,
      cnpjVerificado: true,
    });

    const msg = parceiro
      ? `CNPJ ${mascararCnpj(cnpjLimpo)} validado! Razao Social: ${parceiro.razaoSocial} - parceiro com contrato ativo.`
      : `CNPJ ${mascararCnpj(cnpjLimpo)} consultado. Nao consta contrato de parceiro ativo.`;

    return { valido: true, cnpj: cnpjLimpo, parceiro, mensagem: msg };
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
    ctx,
    { avisar = true, motivo = "solicitado", setor = null, filaId = null } = {}
  ) {
    const { conversa, telefone, instanciaId, instanceName } = ctx;

    if (avisar) {
    }

    const dados = { statusAtendimento: "pendente", lido: false };
    // `filaId` vem do editor de origem (queueId) e nao tem equivalente aqui:
    // fica no log para rastreio. Se a opcao trouxer um setor, ele entra na
    // conversa e o HelpDesk ja consegue filtrar por ele.
    if (setor) dados.setor = setor;
    await this.deps.conversaRepository.update(conversa.id, dados);

    await this.deps.sessaoRepository.upsert(instanciaId, conversa.id, telefone, {
      fluxoAtualId: null,
      passoAtualId: null,
      aguardando: AGUARDANDO.HUMANO,
      ativo: true,
      contexto: {},
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
  async encerrarAtendimento(ctx, mensagem) {
    const { conversa, telefone, instanceName } = ctx;

    if (mensagem) {
      await this.enviarBot(conversa.id, telefone, mensagem, instanceName);
    }

    // Antes de fechar de fato, oferece a pesquisa de satisfacao automatica. Se
    // ela iniciar, a conversa ja fica marcada como fechada e a sessao segue viva
    // apenas para capturar a nota/comentario (ver continuarPesquisaSatisfacao).
    // Nao dispara se um no de avaliacao ja tiver perguntado (checa avaliacao).
    const pesquisa = await this.iniciarPesquisaSatisfacao(ctx);
    if (pesquisa) return pesquisa;

    return this.fecharConversa(ctx, { motivo: "fluxo" });
  }

  // Fechamento efetivo: marca a conversa como fechada e desliga a sessao.
  async fecharConversa(ctx, { motivo = "fluxo" } = {}) {
    const { conversa, telefone, instanciaId } = ctx;

    await this.deps.conversaRepository.update(conversa.id, {
      statusAtendimento: "fechada",
      fechadoEm: new Date(),
      lido: true,
      naoLidas: 0,
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

  // Config efetiva da pesquisa para um PASSO de fluxo do tipo "avaliacao": parte
  // dos padroes globais (Configuracoes) e deixa o passo sobrescrever cada texto e
  // o "pedir comentario". Assim cada fluxo pode ter a sua pesquisa sem depender
  // da config global.
  async _configPesquisaPasso(passo) {
    const global = await this.deps.configuracaoService.pesquisaSatisfacao();
    const c = (passo && passo.config) || {};
    const txt = (v, padrao) => (typeof v === "string" && v.trim() ? v : padrao);
    return {
      ativo: true,
      pedirComentario:
        typeof c.pedirComentario === "boolean" ? c.pedirComentario : global.pedirComentario,
      mensagemNota: txt(c.mensagemNota, global.mensagemNota),
      mensagemComentario: txt(c.mensagemComentario, global.mensagemComentario),
      mensagemAgradecimento: txt(c.mensagemAgradecimento, global.mensagemAgradecimento),
      mensagemNotaInvalida: txt(c.mensagemNotaInvalida, global.mensagemNotaInvalida),
    };
  }

  // Config da pesquisa usada pela pesquisa AUTOMATICA (ao fechar): se algum fluxo
  // ativo tiver um no "avaliacao", usa os textos DELE (editaveis no editor de
  // fluxos, sem passar por Configuracoes). Sem no, cai nos padroes globais.
  async _configPesquisaAtiva() {
    const fluxos = await this.deps.fluxoRepository.findAtivos();
    for (const f of fluxos || []) {
      const no = (f.passos || []).find((p) => p.tipo === "avaliacao");
      if (no) return this._configPesquisaPasso(no);
    }
    return this.deps.configuracaoService.pesquisaSatisfacao();
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

    const cfg = await this._configPesquisaAtiva();
    if (!cfg.ativo) return null;

    // Nao pergunta duas vezes: se ja existe nota (ex.: um no de avaliacao no
    // fluxo ja perguntou), apenas segue para o fechamento.
    const atual = await this.deps.conversaRepository.findById(conversa.id);
    if (atual && atual.avaliacao != null) return null;

    await this.enviarBot(conversa.id, telefone, cfg.mensagemNota, instanceName);

    await this.deps.sessaoRepository.upsert(instanciaId, conversa.id, telefone, {
      fluxoAtualId: null,
      passoAtualId: null,
      aguardando: AGUARDANDO.AVALIACAO_NOTA,
      ativo: true,
      contexto: { pesquisa: true, pesquisaCfg: cfg, tentativasAval: 0 },
    });

    // Fecha desde ja: a conversa sai da fila, mas a sessao da pesquisa continua
    // viva para capturar a resposta. Sem resposta, a sessao expira pelo TTL.
    await this.deps.conversaRepository.update(conversa.id, {
      statusAtendimento: "fechada",
      fechadoEm: new Date(),
      lido: true,
      naoLidas: 0,
    });
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
    // A nota pertence a conversa que FOI AVALIADA (a da sessao), nao a que
    // trouxe a mensagem. Normalmente sao a mesma agora, mas manter o alvo
    // explicito e o que garante que a nota nunca mais caia numa conversa que
    // ninguem atendeu, mesmo se o desvio do webhook falhar.
    const alvoId = sessao.conversaId || conversa.id;
    // Passo "avaliacao" do fluxo guarda a config dele no contexto da sessao;
    // fora isso, cai na config global (pesquisa automatica ao encerrar).
    const cfg = sessao.contexto?.pesquisaCfg || (await this.deps.configuracaoService.pesquisaSatisfacao());

    if (sessao.aguardando === AGUARDANDO.AVALIACAO_NOTA) {
      const nota = this.interpretarNota(textoEntrada);

      if (nota == null) {
        const tentativas = (sessao.contexto?.tentativasAval || 0) + 1;
        // Cliente nao colabora: encerra sem insistir, para nao virar spam.
        if (tentativas >= limites.maxTentativasOpcao) {
          return this.finalizarPesquisa(ctx, sessao);
        }
        await this.enviarBot(conversa.id, telefone, cfg.mensagemNotaInvalida, instanceName);
        await this.deps.sessaoRepository.update(sessao.id, {
          contexto: { ...(sessao.contexto || {}), tentativasAval: tentativas },
        });
        return { processado: true, conversaId: conversa.id, aguardando: AGUARDANDO.AVALIACAO_NOTA };
      }

      await this.deps.conversaRepository.update(alvoId, { avaliacao: nota });
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
      await this._emitirConversa(alvoId);
    }
    await this.enviarBot(conversa.id, telefone, cfg.mensagemAgradecimento, instanceName);
    return this.finalizarPesquisa(ctx, sessao);
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
    if (atual && atual.statusAtendimento !== "fechada") {
      await this.deps.conversaRepository.update(conversa.id, {
        statusAtendimento: "fechada",
        fechadoEm: new Date(),
        lido: true,
        naoLidas: 0,
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
      case "comentario":
        proximo = this.proximoPasso(fluxo.passos, passo);
        break;

      case "avaliacao": {
        // Pesquisa de satisfacao como PASSO do fluxo: pergunta a nota e para
        // aqui. A resposta e capturada por continuarPesquisaSatisfacao, que le a
        // config guardada no contexto da sessao (contextoSessao abaixo).
        const cfg = await this._configPesquisaPasso(passo);
        resposta = cfg.mensagemNota;
        aguardando = AGUARDANDO.AVALIACAO_NOTA;
        contextoSessao = { pesquisa: true, pesquisaCfg: cfg, tentativasAval: 0 };
        // Tira a conversa da fila desde ja (como a pesquisa automatica ao
        // encerrar); a sessao segue viva para capturar a nota/comentario.
        await this.deps.conversaRepository.update(conversa.id, {
          statusAtendimento: "fechada",
          fechadoEm: new Date(),
          lido: true,
          naoLidas: 0,
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
      return this.transferirParaHumano(contexto, { motivo: "fluxo_transferiu", setor, filaId });
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
      // Fluxo apagado ou desativado no meio do atendimento.
      const fluxos = await this.deps.fluxoRepository.findAtivos();
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
          sessao.contexto?.cnpjSugerido || ""
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
        // Resposta que nao e sim nem nao: reforca a pergunta uma vez.
        await this.enviarBot(
          conversa.id,
          telefone,
          "Por favor, responda *SIM* para usar o mesmo CNPJ ou *NÃO* para informar outro.",
          instanceName
        );
        return { conversaId: conversa.id, aguardando: AGUARDANDO.CNPJ_CONFIRMA };
      }

      // "nao" (ou sugestao invalida): o CNPJ oferecido nao serve.
      // Desvincula o que estiver na conversa -- ela volta para "CNPJ pendente"
      // na Central -- e pede o correto.
      if (conversa.cnpj || conversa.cnpjVerificado) {
        await this.deps.conversaRepository.update(conversa.id, {
          cnpj: null,
          cnpjVerificado: false,
        });
        await this._emitirConversa(conversa.id);
      }
      await this.enviarBot(
        conversa.id,
        telefone,
        "Sem problema. Por favor, informe o *CNPJ* (pode enviar com ou sem pontuação).",
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
      const cnpjValidacao = await this.validarCnpjRecebido(conversa, textoEntrada);

      if (!cnpjValidacao.valido) {
        const tentativas = (sessao.contexto?.tentativasCnpj || 0) + 1;

        if (tentativas >= limites.maxTentativasCnpj) {
          return this.transferirParaHumano(ctx, { motivo: "cnpj_invalido" });
        }

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
    const rotulos = { imagem: "[Imagem]", video: "[Vídeo]", documento: "[Documento]", audio: "[Áudio]", localizacao: "[Localização]", contato: "[Contato]" };
    const textoMsg = ehMidia ? (textoLimpo || rotulos[midia.tipo] || "[Mídia]") : textoLimpo;
    const metadata = ehMidia ? midia : null;

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
      conversa = await this.deps.conversaRepository.findById(sessaoAberta.conversaId);
    }
    if (!conversa) conversa = await this.deps.conversaRepository.findByTelefone(instanciaId, telefone);
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
      await this.deps.conversaRepository.addMensagem(
        conversa.id,
        "cliente",
        textoMsg,
        metadata,
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
      conversa = await this.deps.conversaRepository.findById(conversa.id);
    }

    // Guarda defensiva: se a releitura falhar (corrida com exclusao da conversa,
    // por exemplo), respondemos o webhook em vez de estourar TypeError.
    if (!conversa) {
      logger.warn("Conversa nao encontrada apos gravar a mensagem", { telefone, waMessageId });
      return { processado: false, motivo: "conversa_indisponivel" };
    }

    // Empurra a conversa (nova ou atualizada) ao front imediatamente.
    await this._emitirConversa(conversa.id);

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
      const comando = noMenuDoFluxo && comandoBruto !== "atendente" ? null : comandoBruto;

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
