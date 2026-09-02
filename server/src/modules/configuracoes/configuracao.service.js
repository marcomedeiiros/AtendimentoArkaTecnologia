const prisma = require("../../infrastructure/database/prisma.client");
const env = require("../../config/env");
const logger = require("../../config/logger");
// Quem INTERPRETA o expediente e o modulo do chatbot; aqui so se le a chave.
// Ver `horarioAtendimento` mais abaixo.
const horarioChatbot = require("../chatbot/chatbot.horario");

/**
 * Taxonomia inicial de motivos de encerramento (chave `atendimento.motivos`).
 *
 * Doze itens, pensados para uma operacao de suporte de TI. Nao e uma lista
 * definitiva -- e o ponto de partida que a operacao revisa depois de ver os
 * primeiros meses de dado real.
 *
 * Os dois ultimos existem para PROTEGER os dez primeiros: sem uma saida honesta
 * para "o cliente sumiu" e para "ligaram errado", esses casos sao marcados como
 * um motivo tecnico qualquer, e o relatorio passa a contar chamado que nunca
 * houve exatamente na linha que alguem usaria para decidir onde investir.
 */
const MOTIVOS_PADRAO = [
  "Dúvida de uso",
  "Erro ou indisponibilidade",
  "Lentidão",
  "Instalação ou configuração",
  "Acesso e senha",
  "Backup e restauração",
  "Financeiro e boleto",
  "Contrato e renovação",
  "Orçamento",
  "Pedido de melhoria",
  "Cliente não respondeu",
  "Engano ou spam",
];

/**
 * Motivos gravados pelo SISTEMA, fora da lista editavel.
 *
 * Ficam separados porque nao sao escolha de ninguem: sao o desfecho que o proprio
 * bot deu ao ciclo. Se morassem na lista editavel, alguem os apagaria numa
 * revisao de taxonomia e as OS fechadas por automacao voltariam a ser um buraco
 * no relatorio -- que e exatamente o problema que este campo veio resolver.
 */
const MOTIVOS_AUTOMATICOS = {
  INATIVIDADE: "Encerrado por inatividade",
  FLUXO: "Encerrado pelo fluxo",
  // Linha propria, e nao "Encerrado pelo fluxo", porque responde uma pergunta de
  // NEGOCIO que nenhuma outra responde: quanto do volume chega quando nao ha
  // ninguem para atender. Se esse numero for grande, a decisao nao e melhorar o
  // bot -- e esticar o expediente ou colocar plantao.
  FORA_HORARIO: "Encerrado fora do horário",
};

// Chaves suportadas e de onde vem o valor padrao (.env) quando o banco esta vazio.
const DEFINICOES = {
  "evolution.url":      { padrao: () => env.evolutionApi.url,      segredo: false },
  "evolution.apiKey":   { padrao: () => env.evolutionApi.key,      segredo: true  },
  "evolution.instance": { padrao: () => env.evolutionApi.instance, segredo: false },
  "n8n.url":            { padrao: () => process.env.N8N_URL || "http://localhost:5678", segredo: false },
  "n8n.apiKey":         { padrao: () => process.env.N8N_API_KEY || "", segredo: true },
  // URL do webhook do n8n que recebe cada mensagem entrante.
  "n8n.webhookFluxo":   { padrao: () => process.env.N8N_WEBHOOK_FLUXO || "", segredo: false },
  // Quem responde o cliente:
  //   local -> motor de fluxos do proprio Arka responde por gatilho (padrao)
  //   n8n   -> encaminha ao n8n; o bot local NUNCA envia nada por conta propria
  //   humano-> so registra a conversa; ninguem responde automaticamente
  //
  // O padrao e "local" de proposito: numa instalacao nova o n8n ainda nao tem
  // webhook configurado, e com "n8n" os fluxos do Arka ficariam mudos sem que o
  // motivo fosse obvio. Troque em Configuracoes quando o workflow estiver pronto.
  "atendimento.modo":   { padrao: () => process.env.ATENDIMENTO_MODO || "local", segredo: false },
  // Transcricao de audio (fala->texto). Provedor padrao: Groq (Whisper), que tem
  // camada gratuita. A chave e OpenAI-compativel, entao trocar para a OpenAI e so
  // mudar a chave/URL. Vem do .env (GROQ_API_KEY) quando o banco esta vazio.
  "transcricao.apiKey": { padrao: () => process.env.GROQ_API_KEY || process.env.TRANSCRICAO_API_KEY || "", segredo: true },
  // ── HORARIO DE ATENDIMENTO ────────────────────────────────────────────────
  //
  // Uma configuracao, INDEPENDENTE DO FLUXO: o expediente nao e um passo do bot,
  // e escrever os horarios dentro de um bloco de mensagem criaria duas fontes
  // que discordam (troca-se o expediente na tela e o cliente continua ouvindo o
  // texto antigo). Quem interpreta este JSON e `chatbot/chatbot.horario.js`.
  //
  // FORMA ATUAL -- um objeto por dia, com quantos periodos precisar:
  //   {
  //     "ativo": true,
  //     "timezone": "America/Sao_Paulo",
  //     "dias": {
  //       "1": { "ativo": true, "periodos": [{ "inicio": "08:00", "fim": "18:00" }] },
  //       "6": { "ativo": false, "periodos": [] }
  //     },
  //     "excecoes": [{ "data": "2026-12-25", "fechado": true, "descricao": "Natal" }],
  //     "mensagem": "... {{horarios}} ...",
  //     "reavisarAposMin": 120
  //   }
  //
  // FORMA ANTIGA, ainda aceita (e o que esta gravado em producao hoje):
  //   { "ativo": bool, "inicio": "08:00", "fim": "18:00", "dias": [1..5], "mensagem": "..." }
  //
  // `dias` segue Date#getDay (0=domingo) nas duas formas. Vazio/desligado =
  // atende sempre, que e o padrao para nao mudar o comportamento de quem ja usa
  // o sistema.
  "chatbot.horario":    { padrao: () => process.env.CHATBOT_HORARIO || "", segredo: false },
  // Mapa fila -> setor. O `queueId` dos fluxos importados nao existe aqui; este
  // mapa e o que permite a transferencia cair no setor certo do HelpDesk.
  // JSON: { "33": "Técnico", "35": "Comercial" }
  //
  // OS NOMES SAO A LISTA CANONICA de setor.helper.SETORES, e nao rotulo livre.
  // Este exemplo dizia "Suporte" -- que nao esta na lista. Quem o copiava fazia
  // toda conversa daquela fila cair em "Geral", porque e nisso que
  // normalizarSetor converte o que nao reconhece.
  "chatbot.filas":      { padrao: () => process.env.CHATBOT_FILAS || "", segredo: false },
  // Meta diaria de atendimentos FECHADOS, exibida no painel de parede.
  //
  // Numero puro, gravado como texto (e o formato de todas as chaves aqui).
  // Zero ou vazio = SEM meta: o painel mostra so a contagem do dia, sem barra
  // de progresso. E o padrao de proposito -- uma meta inventada por nos
  // apareceria numa TV para a equipe inteira como se a empresa a tivesse
  // definido, e ninguem saberia de onde veio.
  "painel.metaDiaria":  { padrao: () => process.env.PAINEL_META_DIARIA || "", segredo: false },
  // Pesquisa de satisfacao (CSAT) que o bot dispara ao encerrar o atendimento:
  // pergunta a nota de 1 a 5 e, em seguida, um comentario livre. As respostas
  // vao para os campos `avaliacao`/`feedback` da conversa e alimentam a aba
  // Avaliacoes da Visao Geral.
  // JSON: { "ativo": bool, "pedirComentario": bool, "mensagemNota": "...",
  //         "mensagemComentario": "...", "mensagemAgradecimento": "...",
  //         "mensagemNotaInvalida": "..." }
  // Ligada por padrao; desligue com {"ativo": false}. So atua no modo "local".
  "chatbot.pesquisaSatisfacao": { padrao: () => process.env.CHATBOT_PESQUISA || "", segredo: false },
  // Metas de SLA do Help Desk (painel de indicadores). JSON:
  // { "respostaMin": 15, "resolucaoHoras": 24 }
  // Antes eram constantes no codigo: mudar a meta exigia deploy.
  "helpdesk.sla": { padrao: () => process.env.HELPDESK_SLA || "", segredo: false },
  // Taxonomia de motivos de encerramento (JSON: array de strings).
  //
  // PRECISA estar declarada aqui, e nao so ser lida da tabela: `_carregar` monta
  // o cache percorrendo ESTE objeto, entao chave nao declarada tem o valor do
  // banco descartado em silencio -- e `salvar` ignora o que nao esta aqui
  // (`if (!(chave in DEFINICOES)) continue`). Sem esta linha a lista seria
  // impossivel de ler E de gravar, sempre caindo no padrao, o que anularia
  // justamente o motivo de ela morar em Configuracao: poder ser revista sem
  // deploy. Padrao vazio -> `motivosEncerramento` devolve MOTIVOS_PADRAO.
  "atendimento.motivos": { padrao: () => "", segredo: false },
};

// Mascara em ASCII puro: caracteres como "•" se corrompem dependendo da
// codificacao do cliente e deixavam de casar com a regra de "nao sobrescrever",
// apagando o segredo real ao salvar a tela sem redigitar.
const MASCARA = "********";
const PARECE_MASCARA = /^[*•·�\s]+$/;

// Cache em memoria: estas chaves sao lidas a cada chamada a Evolution/n8n.
let cache = null;

class ConfiguracaoService {
  async _carregar() {
    if (cache) return cache;
    const linhas = await prisma.configuracao.findMany();
    const doBanco = Object.fromEntries(linhas.map((l) => [l.chave, l.valor]));
    cache = {};
    for (const [chave, def] of Object.entries(DEFINICOES)) {
      const valor = doBanco[chave];
      cache[chave] = valor !== undefined && valor !== "" ? valor : def.padrao();
    }
    return cache;
  }

  invalidarCache() {
    cache = null;
  }

  async obter(chave) {
    const cfg = await this._carregar();
    return cfg[chave];
  }

  // Config da Evolution efetiva (banco > env).
  async evolution() {
    const c = await this._carregar();
    return {
      url: String(c["evolution.url"] || "").replace(/\/$/, ""),
      apiKey: c["evolution.apiKey"],
      instance: c["evolution.instance"],
    };
  }

  async n8n() {
    const c = await this._carregar();
    return {
      url: String(c["n8n.url"] || "").replace(/\/$/, ""),
      apiKey: c["n8n.apiKey"],
      webhookFluxo: String(c["n8n.webhookFluxo"] || "").trim(),
    };
  }

  // Chave do servico de transcricao (Groq/OpenAI). Vazia = recurso desligado.
  async transcricaoApiKey() {
    const c = await this._carregar();
    return String(c["transcricao.apiKey"] || "").trim();
  }

  /**
   * A MESMA chave, para os recursos de IA em geral (hoje: transcricao de audio e
   * corretor de texto).
   *
   * UMA chave, e nao uma por recurso, porque e uma conta so na Groq e a API e a
   * mesma (formato OpenAI: /audio/transcriptions e /chat/completions). Uma chave
   * por recurso obrigaria a colar o mesmo valor duas vezes em Configuracoes e
   * criaria o estado "transcricao funciona, corretor nao" sem nenhuma razao
   * tecnica -- confusao pura para quem administra.
   *
   * Existe como nome proprio (e nao um `transcricaoApiKey()` chamado de dentro
   * do corretor) para o codigo do corretor nao mentir sobre o que le.
   */
  async iaApiKey() {
    return this.transcricaoApiKey();
  }

  // "n8n" | "local" | "humano" -- ver DEFINICOES.
  async modoAtendimento() {
    const c = await this._carregar();
    const modo = String(c["atendimento.modo"] || "n8n").toLowerCase();
    return ["n8n", "local", "humano"].includes(modo) ? modo : "n8n";
  }

  // JSON invalido nao pode derrubar o atendimento: cai no padrao "atende sempre".
  _json(valor, padrao) {
    const bruto = String(valor || "").trim();
    if (!bruto) return padrao;
    try {
      const dados = JSON.parse(bruto);
      return dados && typeof dados === "object" ? dados : padrao;
    } catch {
      logger.warn("Configuracao com JSON invalido, usando o padrao", { valor: bruto.slice(0, 60) });
      return padrao;
    }
  }

  /**
   * O EXPEDIENTE EFETIVO, sempre na forma nova.
   *
   * A normalizacao (e a conversao da forma antiga) mora em `chatbot.horario.js`,
   * que e o modulo que decide o que ela SIGNIFICA. Aqui so se le a chave e se
   * entrega o objeto pronto -- assim o motor, a tela e os testes recebem
   * exatamente a mesma estrutura, independentemente de qual forma esta gravada.
   */
  async horarioAtendimento() {
    const c = await this._carregar();
    return horarioChatbot.normalizarHorario(this._json(c["chatbot.horario"], {}));
  }

  /**
   * O expediente para a TELA: o mesmo objeto, mais o retrato legivel.
   *
   * A tela precisa de duas coisas que o motor nao usa: os dias FECHADOS (para
   * desenhar a linha "Sábado — fechado") e a previa da mensagem que o cliente
   * receberia. Calcular isso no front duplicaria a regra em JavaScript de
   * navegador -- e uma copia que envelhece sozinha.
   */
  async horarioAtendimentoParaUi() {
    const horario = await this.horarioAtendimento();
    return {
      horario,
      resumo: horarioChatbot.resumoHorario(horario, { incluirFechados: true }),
      mensagemPrevia: horarioChatbot.mensagemFora(horario),
      // Regra ATIVA sem periodo legivel nenhum e configuracao pela metade, nao
      // "nunca atender": a tela avisa em vez de o bot calar em silencio.
      semPeriodos: horario.ativo && !horarioChatbot.temAlgumPeriodo(horario),
      mensagemPadrao: horarioChatbot.MENSAGEM_PADRAO,
    };
  }

  // Pesquisa de satisfacao disparada pelo bot ao encerrar. Ligada por padrao;
  // textos customizaveis pela tela de Configuracoes (chave chatbot.pesquisaSatisfacao).
  async pesquisaSatisfacao() {
    const c = await this._carregar();
    const p = this._json(c["chatbot.pesquisaSatisfacao"], {});
    const txt = (valor, padrao) =>
      typeof valor === "string" && valor.trim() ? valor : padrao;
    return {
      ativo: p.ativo !== false,
      pedirComentario: p.pedirComentario !== false,
      mensagemNota: txt(
        p.mensagemNota,
        "Antes de encerrar: de 1 a 5, que nota você dá para este atendimento? (1 = péssimo, 5 = ótimo)"
      ),
      mensagemComentario: txt(
        p.mensagemComentario,
        'Obrigado! Em poucas palavras, o que foi bom ou o que podemos melhorar? (ou responda "pular")'
      ),
      mensagemAgradecimento: txt(
        p.mensagemAgradecimento,
        "Sua avaliação foi registrada. Obrigado pelo seu feedback!"
      ),
      mensagemNotaInvalida: txt(
        p.mensagemNotaInvalida,
        "Por favor, responda apenas com um número de 1 a 5."
      ),
    };
  }

  // Metas de SLA do Help Desk. Valores fora de faixa caem no padrao -- um SLA
  // zerado ou absurdo faria o indicador mentir.
  async slaHelpDesk() {
    const c = await this._carregar();
    const s = this._json(c["helpdesk.sla"], {});
    const num = (valor, padrao, min, max) => {
      const n = Number(valor);
      return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : padrao;
    };
    return {
      respostaMin: num(s.respostaMin, 15, 1, 24 * 60), // 1 min .. 24 h
      resolucaoHoras: num(s.resolucaoHoras, 24, 1, 24 * 30), // 1 h .. 30 dias
    };
  }

  /**
   * MOTIVOS DE ENCERRAMENTO -- a taxonomia de "por que este cliente procurou".
   *
   * Vive na Configuracao, e nao numa lista em codigo, porque ela PRECISA mudar:
   * a leitura correta e revisar por trimestre, dividindo o motivo que ficou
   * grande demais e juntando o que ninguem usa. Uma lista congelada em deploy
   * nao sobrevive a esse ciclo.
   *
   * CURTA DE PROPOSITO. Taxonomia grande e preenchida no automatico pelo
   * primeiro item que serve, e o relatorio que sai dela mente com confianca. Doze
   * cabe numa tela sem rolagem e ainda obriga a pensar dois segundos.
   *
   * "Cliente nao respondeu" e "Engano ou spam" nao sao enchimento: sem eles, o
   * atendente que nao tem o que marcar marca um motivo tecnico qualquer, e a
   * contaminacao entra justamente nas linhas que se usaria para decidir.
   */
  async motivosEncerramento() {
    const c = await this._carregar();
    const lista = this._json(c["atendimento.motivos"], null);
    // Lista invalida (JSON quebrado, vazia, so lixo) cai no padrao: fechar
    // atendimento e obrigatorio na operacao, e uma configuracao ruim nao pode
    // deixar a equipe sem nenhuma opcao para escolher.
    if (!Array.isArray(lista)) return [...MOTIVOS_PADRAO];
    const limpos = lista
      .map((m) => String(m || "").trim())
      .filter((m) => m.length > 0 && m.length <= 60)
      // Sem duplicata: dois itens iguais viram duas fatias do mesmo assunto no
      // relatorio, e ninguem consegue somar as duas de volta.
      .filter((m, i, arr) => arr.indexOf(m) === i)
      .slice(0, 30);
    return limpos.length ? limpos : [...MOTIVOS_PADRAO];
  }

  /**
   * Meta diaria do painel de parede. `null` = sem meta definida.
   *
   * Devolver `null` (e nao um numero de conforto) e o que permite ao painel
   * distinguir "a meta e 30" de "ninguem definiu meta" e desenhar coisas
   * diferentes nos dois casos.
   */
  async metaDiariaPainel() {
    const c = await this._carregar();
    const n = Number(String(c["painel.metaDiaria"] ?? "").trim());
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  }

  // { "33": "Técnico" } -> setor para onde a fila do fluxo importado aponta.
  // Valor fora de setor.helper.SETORES nao vira setor nenhum: ver acharSetor.
  async filasParaSetor() {
    const c = await this._carregar();
    const mapa = this._json(c["chatbot.filas"], {});
    const out = {};
    for (const [fila, setor] of Object.entries(mapa)) {
      if (typeof setor === "string" && setor.trim()) out[String(fila)] = setor.trim();
    }
    return out;
  }

  // Listagem para a tela: mascara segredos, mas informa se ja existe valor.
  async listarParaUi() {
    const cfg = await this._carregar();
    const out = {};
    for (const [chave, def] of Object.entries(DEFINICOES)) {
      const valor = cfg[chave];
      out[chave] = def.segredo
        ? { definido: !!valor, valor: valor ? MASCARA : "" }
        : { definido: !!valor, valor: valor || "" };
    }
    return out;
  }

  async salvar(valores = {}) {
    const gravadas = [];
    for (const [chave, valor] of Object.entries(valores)) {
      if (!(chave in DEFINICOES)) continue;
      // Segredo reenviado mascarado (ou vazio): mantem o valor ja gravado.
      if (DEFINICOES[chave].segredo) {
        const v = String(valor ?? "");
        if (v === "" || PARECE_MASCARA.test(v)) continue;
      }
      await prisma.configuracao.upsert({
        where: { chave },
        update: { valor: String(valor) },
        create: { chave, valor: String(valor) },
      });
      gravadas.push(chave);
    }
    this.invalidarCache();
    logger.info("Configuracoes atualizadas", { chaves: gravadas });
    return this.listarParaUi();
  }
}

module.exports = new ConfiguracaoService();
// Constantes exportadas a parte: o engine grava os motivos automaticos e a tela
// de configuracao precisa do padrao para oferecer "restaurar a lista original".
module.exports.MOTIVOS_PADRAO = MOTIVOS_PADRAO;
module.exports.MOTIVOS_AUTOMATICOS = MOTIVOS_AUTOMATICOS;
