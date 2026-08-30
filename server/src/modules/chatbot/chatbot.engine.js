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
  tipoClienteDaOpcaoEscolhida,
} = require("../../shared/helpers/cnpj.helper");
const { comLock } = require("../../shared/helpers/lock.helper");
// PARAMETROS DA AUTOMACAO: quem manda e o FLUXO, nao o codigo. Ver
// fluxos/fluxo.automacao.js -- todo texto, tentativa e prazo do bot sai de la.
const {
  paramsCnpj,
  paramsAvaliacao,
  paramsTempos,
  paramsHandoff,
} = require("../fluxos/fluxo.automacao");
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

// ── OS ESTADOS QUE ADMITEM "ENCERRADO POR INATIVIDADE" ────────────────────────
//
// Allowlist POSITIVA, e nao uma lista de excecoes. `aplicarInatividade` pedia
// apenas `aguardando !== "humano"`: qualquer outro valor servia, `null`
// inclusive. Ou seja, o encerramento era decidido por EXCLUSAO -- e sobrava para
// estados que nao tem pergunta nenhuma em aberto.
//
// Aqui estao so os estados em que o bot FEZ UMA PERGUNTA e a proxima mensagem do
// cliente e a resposta dela. Fora da lista, de proposito:
//
//   humano               -> nao e pergunta; a conversa esta na fila do atendente;
//   avaliacao_nota/coment -> tem prazo, texto e desfecho proprios
//                            (`aplicarTimeoutAvaliacao`);
//   null                 -> nao ha pergunta; nao ha o que cobrar.
const AGUARDA_RESPOSTA_DO_CLIENTE = [
  AGUARDANDO.CNPJ,
  AGUARDANDO.CNPJ_CONFIRMA,
  AGUARDANDO.MENU,
  AGUARDANDO.OPCAO,
];

// ── BOTAO ONDE A RESPOSTA E FIXA (nao vem de opcao de menu) ──────────────────
//
// Nem toda pergunta do bot e menu. "O CNPJ continua sendo este?" e "de 1 a 5,
// que nota voce da?" tem resposta fechada, mas nasceram como TEXTO: o cliente
// tinha de digitar "SIM" ou "3" no meio de uma conversa cheia de botoes. Era a
// unica coisa que ainda pedia digitacao sem precisar.
//
// A SACADA que faz isto caber sem tocar no recebimento: o `id` do botao E O
// TEXTO QUE O MOTOR JA ESPERA. O WhatsApp devolve o id do botao tocado
// (`selectedButtonId`, ver extrairTexto), entao tocar em "✅ Sim" chega aqui
// exatamente como se o cliente tivesse digitado "SIM". Nenhum parser muda,
// nenhum estado novo, e digitar continua funcionando igual.
const BOTOES_FIXOS = {
  [AGUARDANDO.CNPJ_CONFIRMA]: [
    { id: "SIM", rotulo: "✅ Sim, é esse" },
    { id: "NÃO", rotulo: "🔁 Não, outro CNPJ" },
  ],
  // Cinco notas em duas bolhas (3 + 2), porque o WhatsApp so aceita 3 botoes
  // por mensagem. A carinha ajuda a ler a escala sem o cliente voltar na legenda.
  [AGUARDANDO.AVALIACAO_NOTA]: [
    { id: "1", rotulo: "1 😠" },
    { id: "2", rotulo: "2 🙁" },
    { id: "3", rotulo: "3 😐" },
    { id: "4", rotulo: "4 🙂" },
    { id: "5", rotulo: "5 😍" },
  ],
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

    // ── RESPOSTA DE BOTAO: casa pelo ID DA OPCAO, e antes de tudo ────────────
    //
    // Quando o cliente TOCA num botao (ou numa linha de lista), o WhatsApp
    // devolve o id que foi enviado -- nao o texto que ele leu. `extrairTexto`
    // (whatsapp.service) entrega esse id aqui como se fosse a mensagem.
    //
    // Casar por id e EXATO e nao depende da numeracao do menu: reordenar as
    // opcoes no editor deixaria "2" apontando para outra coisa, e um botao
    // enviado minutos antes chegaria com o significado trocado. O id do no
    // (`sup_1`, `res_3`) e estavel.
    //
    // Vem antes das palavras-chave de proposito: um id nunca deve ser
    // interpretado como texto digitado.
    const porId = opcoes.find((o) => o?.id && this.normalizarTexto(o.id) === alvo);
    if (porId) return porId;

    // ── VOTO DE ENQUETE: casa pelo ROTULO ────────────────────────────────────
    //
    // A enquete nao carrega id: o que volta e o NOME da opcao, exatamente o
    // texto que foi enviado. E o mesmo texto que `_rotuloOpcao` monta, entao
    // comparamos com ele -- incluindo o `opcao.botao` escrito no fluxo, que e o
    // que de fato aparece na enquete.
    //
    // Casamento exato e normalizado (minusculo, sem acento), nao "contem": um
    // rotulo nunca deve casar por pedaco, senao "Voltar ao Menu" casaria dentro
    // de outra opcao que mencione menu.
    const porRotulo = opcoes.find((o) => {
      const rot = o?.botao || this._rotuloOpcao(o, "");
      return rot && this.normalizarTexto(rot) === alvo;
    });
    if (porRotulo) return porRotulo;

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

  /**
   * ALGUMA OPCAO DESTE PASSO LEVA A ALGUM LUGAR?
   *
   * Um passo com `config.opcoes` estaciona o fluxo esperando a escolha do
   * cliente. Isso e certo quando ha escolha a fazer -- e errado quando nao ha:
   *
   *   passo final: texto "✅ Chamado aberto com sucesso ..."
   *               opcoes: [{ esperaEscolha: false, acao: "ir", targetId: null }]
   *
   * Esse desenho (comum quando a confirmacao e escrita num no PROPRIO em vez de
   * no `mensagemHandoff` da opcao que transfere) fazia o motor parar ali em
   * `aguardando: "opcao"` -- ou seja, "esperando resposta do cliente" -- depois
   * de ter anunciado que o chamado ja estava aberto. Ninguem ia responder: o
   * proximo a agir e o tecnico. Minutos depois, a inatividade encerrava o
   * chamado. Era o defeito relatado.
   *
   * `aplicarOpcao` JA trata a opcao sem destino assim ("ramificacao apontando
   * para o vazio: um atendente e melhor que silencio"), mas so DEPOIS que o
   * cliente responde -- uma resposta que este passo nao tem por que esperar. A
   * mesma regra passa a valer no instante em que o passo e alcancado.
   *
   * O criterio nao olha o TEXTO do passo (isso seria fragil e quebraria com
   * qualquer reescrita): olha se existe saida. Uma pergunta aberta legitima
   * ("AGORA DESCREVA SUA SOLICITACAO", cuja unica opcao tem `acao: "transferir"`)
   * tem saida e continua estacionando -- e continua podendo expirar.
   */
  temSaidaAcionavel(passo, passos = []) {
    return this.opcoesDoPasso(passo).some((opcao) => {
      // Acoes terminais resolvem por si; nao dependem de destino.
      if (opcao.acao === "transferir" || opcao.acao === "encerrar") return true;
      return !!(opcao.targetId && passos.some((p) => p.id === opcao.targetId));
    });
  }

  /**
   * A opcao e uma ESCOLHA que o cliente pode fazer?
   *
   * Menu de verdade: tem palavras-chave que o cliente digita ("1", "tecnico").
   * Curinga: `palavrasChave` vazio -- casa com qualquer coisa (o "resposta livre"
   * dos fluxos importados). `esperaEscolha` entra como segunda pista porque
   * fluxos montados a mao podem trazer o flag sem as palavras.
   */
  _opcaoEhEscolha(opcao) {
    if (opcao?.esperaEscolha === true) return true;
    return (opcao?.palavrasChave || []).some((k) => String(k || "").trim());
  }

  /**
   * ESTE PASSO PRECISA MESMO DA RESPOSTA DO CLIENTE?
   *
   * Um passo com `config.opcoes` estacionava o fluxo SEMPRE. Isso vale quando a
   * resposta muda algo -- e nao vale no desenho que causou o defeito relatado:
   *
   *   [13] mensagem "CHAMADO ABERTO"   opcoes: [transferir, sem destino, curinga]
   *        texto: "✅ Chamado aberto com sucesso ... um tecnico dara continuidade"
   *
   * A unica opcao e um CURINGA cuja acao e `transferir`: qualquer coisa que o
   * cliente responda -- ou nao responda -- termina no mesmo lugar, a fila do
   * atendente. Esperar por essa resposta nao tem funcao nenhuma, e era isso que
   * mantinha a sessao em "aguardando: opcao" depois de o bot anunciar que o
   * chamado estava aberto. Dois minutos depois, a inatividade fechava a OS.
   *
   * O criterio e a TOPOLOGIA, nunca o texto do passo (que pode ser reescrito a
   * qualquer momento no editor):
   *
   *   - alguma opcao e uma ESCOLHA (tem palavra-chave) -> estaciona COBRANDO a
   *     resposta. E um menu: sem escolha o fluxo nao anda.
   *   - alguma opcao ROTEIA (`acao: "ir"` para um passo que existe) -> estaciona
   *     COBRANDO. A resposta decide o caminho.
   *   - nenhuma opcao tem saida -> nao estaciona: fim do fluxo (entrega a fila).
   *   - todas as opcoes sao curinga e TODAS transferem -> estaciona SEM COBRAR.
   *
   * O ultimo caso e o do relato, e merece explicacao. Por que estacionar e nao
   * transferir na hora? Porque a topologia NAO distingue um no que confirma de
   * um no que pergunta:
   *
   *   [13] "✅ Chamado aberto com sucesso..."     curinga -> transferir  (confirma)
   *   [ 7] "AGORA DESCREVA SUA SOLICITACAO"       curinga -> transferir  (pergunta)
   *
   * Transferir na hora quebraria o segundo: o bot pediria a descricao e entregaria
   * a conversa antes de o cliente escrever, e o tecnico receberia um chamado sem
   * problema nenhum descrito. Foi o que o `verificar-tudo.js` pegou.
   *
   * Entao o passo continua estacionado -- se o cliente escrever, a transferencia
   * acontece com a mensagem dele, exatamente como antes. O que muda e que essa
   * espera NAO E COBRADA: qualquer coisa que o cliente responda (ou nao responda)
   * termina no mesmo lugar, a fila do atendente. Cobrar uma resposta que nao muda
   * o desfecho -- e ENCERRAR o chamado por falta dela -- e o defeito.
   *
   * Consequencia assumida: um no que seja pergunta E curinga-que-transfere deixa
   * de expirar por inatividade. Na duvida entre fechar um chamado indevidamente e
   * deixar uma conversa esperando um atendente, a segunda e a opcao certa. Menus
   * e perguntas que roteiam (a maioria) continuam expirando normalmente.
   *
   * @returns {{estaciona: boolean, cobraResposta: boolean, opcao: object|null}}
   */
  decidirEsperaDoPasso(passo, passos = []) {
    const opcoes = this.opcoesDoPasso(passo);
    if (!opcoes.length) return { estaciona: false, cobraResposta: false, opcao: null };

    // Menu: ha o que escolher.
    if (opcoes.some((o) => this._opcaoEhEscolha(o))) {
      return { estaciona: true, cobraResposta: true, opcao: null };
    }

    // A resposta roteia o fluxo para outro passo.
    const roteia = opcoes.some(
      (o) => o.acao !== "transferir" && o.acao !== "encerrar" && o.targetId && passos.some((p) => p.id === o.targetId)
    );
    if (roteia) return { estaciona: true, cobraResposta: true, opcao: null };

    // Sem saida nenhuma: fim do fluxo.
    if (!this.temSaidaAcionavel(passo, passos)) {
      return { estaciona: false, cobraResposta: false, opcao: null };
    }

    // Todas curinga e todas transferem: o desfecho ja esta decidido, a resposta
    // nao muda nada. Espera sem cobranca.
    if (opcoes.every((o) => o.acao === "transferir")) {
      return { estaciona: true, cobraResposta: false, opcao: null };
    }

    return { estaciona: true, cobraResposta: true, opcao: null };
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

  // AQUI EXISTIA `configuracaoInatividade(fluxo)`.
  //
  // Ela lia `configuracoesGlobais.notResponseMessage` DIRETO e devolvia os
  // minutos daquele campo legado. So que quem manda no relogio e `paramsTempos`,
  // cuja precedencia e outra: bloco de espera no canvas > configuracoes globais
  // > legado > padrao. No fluxo da ARKA os dois discordavam -- o legado dizia 10
  // minutos, o bloco dizia 5, e o bot esperava 5.
  //
  // Nenhum caminho de producao a chamava: so o script de verificacao, que por
  // isso validava um numero que o bot nao usa. Duas fontes para o mesmo
  // parametro, e a que ninguem usava era a que o teste conferia.
  //
  // Quem precisa do valor efetivo chama `paramsTempos(fluxo).semResposta`.

  /**
   * AS MARCAS DE ESPERA -- gravadas em todo write que mexe em `aguardando`.
   *
   * `aguardando` diz QUE o bot espera algo. Nao dizia QUANDO ele perguntou, e o
   * prazo de inatividade corria sobre `atualizadoEm` -- um `@updatedAt` da linha,
   * que qualquer escrita reinicia e que nenhum caminho de resposta era obrigado
   * a tocar. Duas consequencias reais:
   *
   *   - o cliente respondia, o bot repetia a pergunta e o relogio NAO voltava ao
   *     zero (os caminhos de "resposta invalida" nao gravavam nada na sessao);
   *   - concluir a automacao era representado por AUSENCIA (`ativo: false`,
   *     `fluxoAtualId: null`), e ausencia nao sobrevive a um reset de TTL.
   *
   * Regra: `aguardandoDesde` e o instante em que o bot **(re)perguntou**. Toda vez
   * que ele pergunta de novo, o prazo comeca de novo. `concluidoEm` marca o
   * desfecho -- dali em diante nao existe inatividade a cobrar. E qualquer
   * transicao limpa `inatividadeEm`, para a espera NOVA poder ser encerrada uma
   * vez (a reivindicacao antiga nao vale para a pergunta seguinte).
   *
   * @param {string|null} aguardando  estado resultante da transicao
   * @param {object} [opcoes]
   * @param {boolean} [opcoes.concluido=false] a automacao chegou a um desfecho?
   */
  _marcasDeEspera(aguardando, { concluido = false, cobraResposta = true } = {}) {
    const agora = new Date();
    // `aguardandoDesde` e o RELOGIO DA COBRANCA, nao "quando a sessao mudou".
    // Fica null quando a espera nao cobra resposta -- e sem relogio nao existe
    // inatividade a aplicar (ver aplicarInatividade). E assim que um passo de
    // confirmacao ("Chamado aberto com sucesso") pode ficar estacionado sem
    // nunca ser encerrado por falta de resposta.
    const cobra = cobraResposta && AGUARDA_RESPOSTA_DO_CLIENTE.includes(aguardando);
    return {
      aguardandoDesde: cobra ? agora : null,
      concluidoEm: concluido ? agora : null,
      inatividadeEm: null,
    };
  }

  // O bot acabou de REPETIR a pergunta (opcao invalida, CNPJ que nao casou,
  // "nem sim nem nao"). O cliente respondeu -- so nao respondeu o que foi pedido
  // -- e portanto o prazo recomeca daqui. Sem isto, quem erra a resposta uma vez
  // continua correndo contra o relogio da PERGUNTA ANTERIOR.
  _marcasDeReperguntar() {
    return { aguardandoDesde: new Date(), inatividadeEm: null };
  }

  /**
   * ENCERRAR POR INATIVIDADE -- so com prova de que existe pergunta em aberto.
   *
   * O criterio antigo era por EXCLUSAO: sessao ativa + fluxo + `aguardando !==
   * "humano"` + conversa pendente + `atualizadoEm` velho. Nada ali afirmava que o
   * bot tinha perguntado algo, e por isso o encerramento pegava conversas em que
   * a automacao JA HAVIA TERMINADO -- o cliente recebia "Chamado aberto com
   * sucesso" e, depois, "Atendimento encerrado por inatividade".
   *
   * Agora sao sete condicoes, todas afirmativas (ver
   * .planning/phases/08-inatividade/PLAN.md):
   *
   *   1. conversa elegivel (fluxo ativo, pendente, sem atendente);
   *   2. a automacao esta esperando resposta (`ativo` + `aguardando`);
   *   3. o estado e um dos que PEDEM resposta (allowlist positiva);
   *   4. o cliente NAO respondeu aquela pergunta (consulta fresca no historico);
   *   5. o prazo do fluxo estourou, contado desde a PERGUNTA;
   *   6. a automacao nao foi concluida (`concluidoEm`);
   *   7. nada mudou desde a leitura -- releitura + UPDATE condicional.
   *
   * Devolve null quando nao se aplica.
   */
  async aplicarInatividade(sessao, { conversa, instanciaId, instanceName }) {
    // (2) A automacao esta parada esperando alguma coisa?
    if (!sessao?.ativo || !sessao.fluxoAtualId) return null;

    // (3) ...e essa coisa e uma RESPOSTA DO CLIENTE?
    //
    // Aqui havia `if (sessao.aguardando === AGUARDANDO.HUMANO) return null` -- a
    // unica excecao. Trocada por allowlist: fora dela nao ha pergunta em aberto,
    // e "encerrado por inatividade" nao tem sentido.
    if (!AGUARDA_RESPOSTA_DO_CLIENTE.includes(sessao.aguardando)) return null;

    // (6) A AUTOMACAO JA TERMINOU?
    //
    // O caso do relato: o cliente respondeu tudo, o bot abriu o chamado e
    // entregou para a equipe. `concluidoEm` preenchido significa "o cliente
    // cumpriu a sua parte" -- nao ha inatividade a cobrar, por mais tempo que
    // passe e por mais que a conversa siga em Pendentes.
    if (sessao.concluidoEm) return null;

    // (7a) IDEMPOTENCIA: esta espera ja foi encerrada uma vez.
    if (sessao.inatividadeEm) return null;

    const fluxo = await this.deps.fluxoRepository.findById(sessao.fluxoAtualId);
    // (1) FLUXO PAUSADO = SEM AUTOMACAO (defesa em profundidade: o varredor ja
    // confere, mas este metodo e publico e nao pode depender de quem chama).
    if (!fluxo || !fluxo.ativo) return null;

    // Parametros do FLUXO. `semResposta` e o bloco novo; sem ele, cai no
    // `notResponseMessage` que os fluxos exportados ja trazem (ver paramsTempos).
    const cfg = paramsTempos(fluxo).semResposta;

    // (3b) EXISTE PERGUNTA COBRAVEL?
    //
    // `aguardandoDesde` e gravado so quando o bot pede algo cuja resposta MUDA o
    // rumo (menu, roteamento, CNPJ). Sem ele, a sessao esta estacionada mas nao
    // ha resposta a cobrar -- e o caso do passo de confirmacao cuja unica opcao
    // e um curinga que transfere: qualquer coisa que o cliente diga termina na
    // mesma fila (ver decidirEsperaDoPasso).
    //
    // Aqui existia um fallback para `atualizadoEm`, pensado para as sessoes
    // anteriores a esta coluna. Ele tinha de sair: `atualizadoEm` volta a cada
    // escrita na linha e nao distingue pergunta de confirmacao -- era por ele que
    // o encerramento indevido continuava passando. Sessoes antigas simplesmente
    // nao expiram por inatividade; elas saem pelo TTL da sessao (30 min).
    if (!sessao.aguardandoDesde) return null;

    // (5) O prazo conta desde a PERGUNTA, nao desde o ultimo toque na linha.
    const desde = new Date(sessao.aguardandoDesde);
    if (Date.now() - desde.getTime() < cfg.minutos * 60 * 1000) return null;

    // (4) O CLIENTE RESPONDEU ESTA PERGUNTA?
    //
    // A pergunta e "chegou mensagem do cliente DEPOIS do pedido do bot?" -- e nao
    // "o cliente ja mandou alguma mensagem alguma vez". Consulta fresca no
    // historico, feita no instante de agir: e o que fecha a corrida do §13 sem
    // depender de nenhum caminho de escrita ter lembrado de tocar a sessao.
    if (this.deps.conversaRepository.respondeuDepoisDe) {
      const respondeu = await this.deps.conversaRepository.respondeuDepoisDe(conversa.id, desde);
      if (respondeu) {
        logger.debug("Inatividade ignorada: o cliente respondeu a pergunta", {
          conversaId: conversa.id,
          desde: desde.toISOString(),
        });
        return null;
      }
    }

    // (7b) O ESTADO MUDOU ENQUANTO O RELOGIO CORRIA?
    //
    // A varredura le a sessao e so entao age. Entre uma coisa e outra o cliente
    // pode ter respondido, o atendente pode ter assumido, ou a conversa pode ter
    // sido fechada. Reconferimos AGORA -- disparar o timeout em cima de uma
    // conversa que ja andou seria mandar "nao entendemos sua demanda" para
    // alguem que acabou de ser atendido.
    const agora = await this.deps.sessaoRepository.findByConversa(conversa.id);
    if (!agora?.ativo || agora.aguardando !== sessao.aguardando) return null;
    if (agora.concluidoEm || agora.inatividadeEm) return null;
    if (new Date(agora.atualizadoEm).getTime() !== new Date(sessao.atualizadoEm).getTime()) return null;
    const convAgora = await this.deps.conversaRepository.findById(conversa.id);
    if (!convAgora || convAgora.statusAtendimento !== "pendente") return null;
    if (convAgora.atendenteId) return null;

    // (7c) REIVINDICA A ESPERA -- UPDATE condicional, uma vez so.
    //
    // As checagens acima sao leituras: entre a ultima delas e o envio ainda cabe
    // uma segunda varredura (restart, replica, varredura anterior demorada). Este
    // UPDATE e o unico ponto em que a decisao se torna exclusiva: quem conseguir
    // marcar `inatividadeEm` age; quem receber `count: 0` sai calado.
    if (this.deps.sessaoRepository.reivindicarInatividade) {
      const claim = await this.deps.sessaoRepository.reivindicarInatividade(
        agora.id,
        agora.aguardandoDesde ?? null
      );
      if (!claim?.count) {
        logger.debug("Inatividade ignorada: outra varredura ja tratou esta espera", {
          conversaId: conversa.id,
          sessaoId: agora.id,
        });
        return null;
      }
    }

    // `fluxo` viaja junto: e dele que sai o texto da confirmacao de
    // encaminhamento quando `acao` e "fila" (ver paramsHandoff).
    const ctx = { conversa: convAgora, telefone: sessao.telefone, instanciaId, instanceName, fluxo };
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

    // `acao: "fila"` -- devolve para um atendente em vez de fechar. A mensagem
    // do bloco de espera JA explica o que aconteceu, entao a confirmacao de
    // encaminhamento so entra quando o bloco nao tem texto: duas mensagens
    // seguidas dizendo coisas diferentes ("nao entendemos a sua demanda" +
    // "solicitacao registrada") confundem mais do que uma.
    if (texto) await this.enviarBot(conversa.id, sessao.telefone, texto, instanceName);
    return this.transferirParaHumano(ctx, { avisar: !texto, motivo: "sem_resposta" });
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
  async enviarBot(conversaId, telefone, texto, instanceName, { reaproveitarFalha = false } = {}) {
    // RETENTATIVA REAPROVEITA A BOLHA QUE FALHOU.
    //
    // Quem se importa com o desfecho do envio (o aviso de espera na fila) tenta
    // de novo na varredura seguinte. Sem reaproveitar a linha, cada tentativa
    // criaria uma bolha nova: numa queda de meia hora, 30 mensagens identicas
    // com `status: "erro"` na conversa do cliente.
    let msg = null;
    if (reaproveitarFalha && this.deps.conversaRepository.ultimaMensagemBotComErro) {
      msg = await this.deps.conversaRepository.ultimaMensagemBotComErro(conversaId, texto);
    }
    if (!msg) {
      msg = await this.deps.conversaRepository.addMensagem(
        conversaId,
        "bot",
        texto,
        { automacao: true },
        null,
        { status: "enviando" }
      );
    }

    let enviada = false;
    try {
      const r = await this.deps.evolutionApi.sendText(
        telefone,
        texto,
        instanceName || env.evolutionApi.instance
      );
      // Guardar o id da Evolution e o que permite os ACKs de entrega/leitura
      // (messages.update) encontrarem esta mensagem depois.
      await this.deps.conversaRepository.vincularWaMessageId(msg.id, r?.key?.id || null, "enviada");
      enviada = true;
    } catch (error) {
      logger.warn("Falha ao enviar WhatsApp", { telefone, message: error.message });
      await this.deps.conversaRepository.vincularWaMessageId(msg.id, null, "erro");
    }
    await this._emitirConversa(conversaId);
    // O retorno passou a dizer SE FOI. Antes era so o texto, e quem chamava nao
    // tinha como saber que o envio falhou -- foi o que fez o aviso de espera na
    // fila ser marcado como "ja enviado" depois de uma falha.
    return { texto, enviada, mensagemId: msg.id };
  }

  // Valor que o clique de um botao/linha "digita" para o motor: o numero da
  // opcao (casa com palavrasChave em casarOpcao). Fallback: 1a palavra-chave.
  _valorOpcao(op) {
    // O ID DO NO E O VALOR DO BOTAO -- estavel, e nao a posicao no menu.
    //
    // Aqui vinha a palavra-chave numerica, entao o id do botao era "1", "2",
    // "3". Funcionava enquanto ninguem mexesse no menu: reordenar as opcoes no
    // editor fazia "2" passar a significar outra coisa, e um botao que o cliente
    // recebeu antes da edicao voltava com o significado trocado -- ele toca em
    // "Atendimento avulso" e cai no Financeiro.
    //
    // `casarOpcao` reconhece o id na volta (ver o casamento por id la).
    // O fallback continua sendo a palavra-chave, para fluxo cujas opcoes nao
    // tenham id.
    if (op?.id) return String(op.id);
    const num = (op.palavrasChave || []).find((k) => /^\d+$/.test(k));
    return num || (op.palavrasChave || [])[0] || String(op.rotulo || "").split(",")[0] || "";
  }

  // Rotulo amigavel do botao: tenta extrair da linha do menu (ex.: "1️⃣- Setor
  // Técnico" -> "Setor Técnico"); senao usa uma palavra-chave legivel/numero.
  /**
   * @param {number} [indice] posicao da opcao no menu (0-based). Usada para
   *   achar a linha quando a opcao nao tem palavra-chave numerica.
   */
  _rotuloOpcao(op, texto, indice) {
    // TEXTO DO BOTAO ESCRITO NO FLUXO, quando houver.
    //
    // `opcao.botao` e o campo para quem monta o fluxo dizer exatamente o que vai
    // dentro do botao -- com emoji, curto, sem depender de a extracao abaixo
    // adivinhar a partir da linha do menu ("1️⃣- Setor Técnico" -> "Setor
    // Técnico"). E o que permite "✋ Tenho contrato" em vez de "TENHO CONTRATO
    // COM A ARKA" cortado em 20 caracteres pelo limite do WhatsApp.
    if (op?.botao && String(op.botao).trim()) return String(op.botao).trim();

    // POR QUAL NUMERO PROCURAR a linha do menu, em ordem de confianca:
    // a palavra-chave numerica, e senao a POSICAO da opcao no menu. Sem o
    // segundo, um menu cujas opcoes nao tenham a palavra-chave "1" nao tem
    // como achar a propria linha, e todo rotulo cai na palavra-chave.
    const kwNum = (op.palavrasChave || []).find((k) => /^\d+$/.test(k));
    const candidatos = [];
    if (kwNum) candidatos.push(kwNum);
    if (Number.isInteger(indice)) candidatos.push(String(indice + 1));
    if (Number.isInteger(op?.ordem)) candidatos.push(String(op.ordem + 1));

    for (const num of candidatos) {
      if (!texto) break;
      // O SEPARADOR E OPCIONAL, e O NEGRITO PODE VIR ANTES DO NUMERO.
      //
      // Duas versoes quebraram aqui, pelo mesmo motivo -- supor como o menu
      // esta escrito:
      //
      //   1. a primeira exigia traco depois do numero (`[^-\n]*[-–]`), e o menu
      //      escreve "1️⃣ Técnico", sem traco;
      //   2. a segunda passou a aceitar sem traco, mas exigia o digito no
      //      COMECO da linha -- e o menu de producao escreve "*1️⃣ Técnico*",
      //      com o asterisco do negrito ANTES do numero.
      //
      // Nos dois casos a extracao falhava, caia na palavra-chave, e o botao
      // virava "tecnico": minusculo e sem acento, porque palavra-chave e texto
      // de casamento, nao rotulo de tela. Foi o que o cliente viu.
      //
      // Agora: marcadores de formatacao opcionais, o numero, os invisiveis do
      // emoji de teclado (U+FE0F variation selector e U+20E3 combining keycap,
      // que sao o que faz "1" virar "1️⃣"), um separador opcional, e o resto.
      const re = new RegExp(
        `(?:^|\\n)[ \\t]*[*_~]*[ \\t]*${num}[\\uFE0F\\u20E3]*[ \\t]*[-–—.):]*[ \\t]*(.+)`,
        "u"
      );
      const m = texto.match(re);
      // Marcadores de formatacao do WhatsApp (*negrito*, _italico_) fazem parte
      // do texto, e nao do rotulo: dentro do botao eles apareceriam crus.
      const limpo = m && m[1].trim().replace(/^[*_~]+|[*_~]+$/g, "").trim();
      if (limpo) return limpo;
    }
    const kw = (op.palavrasChave || []).find((k) => !/^\d+$/.test(k));
    return kw || kwNum || String(op.rotulo || "").split(",")[0] || "Opção";
  }

  /**
   * Encurta o rotulo SEM comer palavra no meio.
   *
   * O WhatsApp corta em 20 caracteres no botao e 24 na linha de lista, e
   * cortar por contagem produzia botao que nao diz o que faz -- visto na tela
   * do cliente: "Tenho contrato com a", "Administrativo / Fin", "Voltar ao
   * menu inici". Pior que curto e ambiguo.
   *
   * Tres passos: corta na ultima fronteira de palavra que cabe; joga fora
   * palavra de ligacao pendurada no fim ("...com a" nao acrescenta nada); e
   * limpa pontuacao solta ("Administrativo /" -> "Administrativo").
   *
   * A conta e em UTF-16, como o limite do protocolo -- e o corte cru de reserva
   * cuida de nao partir par surrogado no meio, que viraria caractere invalido.
   */
  _cortarRotulo(texto, limite) {
    const s = String(texto || "").trim();
    if (s.length <= limite) return s;

    const semSurrogadoPartido = (v) =>
      /[\uD800-\uDBFF]$/.test(v) ? v.slice(0, -1) : v;

    const espaco = s.slice(0, limite + 1).lastIndexOf(" ");
    let partes = (espaco > 0 ? s.slice(0, espaco) : s.slice(0, limite)).split(/\s+/);

    // Palavras que so ligam outras: sozinhas no fim do rotulo, nao informam
    // nada e ainda sugerem que o texto foi cortado (e foi).
    const LIGACAO = new Set([
      "com", "a", "o", "as", "os", "de", "da", "do", "das", "dos", "e", "em",
      "no", "na", "nos", "nas", "para", "por", "ao", "aos", "à", "às", "um",
      "uma", "que", "ou", "como", "sem", "sob", "sobre", "meu", "minha",
    ]);
    while (partes.length > 1 && LIGACAO.has(partes[partes.length - 1].toLowerCase())) partes.pop();

    const saida = partes.join(" ").replace(/[\s/\\|\-–—,:;.]+$/u, "");
    return semSurrogadoPartido(saida || s.slice(0, limite));
  }

  /**
   * Manda uma pergunta de RESPOSTA FIXA com botao (SIM/NÃO, nota 1..5).
   *
   * Reaproveita `enviarBotComOpcoes` de proposito: e la que vivem o corte de
   * rotulo, a divisao em bolhas de 3 e o fallback para texto quando a Evolution
   * recusa. Duplicar isso aqui seria criar um segundo caminho para o mesmo
   * problema -- e um deles envelheceria.
   *
   * Com os botoes desligados, ou sem botao definido para o estado, cai no texto
   * de sempre. Digitar a resposta continua funcionando nos dois casos: o id do
   * botao E o texto esperado.
   */
  async _enviarComBotoesFixos(conversaId, telefone, texto, aguardando, instanceName, { exibicao = "auto" } = {}) {
    const fixos = BOTOES_FIXOS[aguardando];
    if (
      !fixos?.length ||
      exibicao === "text" ||
      exibicao === "texto" ||
      (process.env.WHATSAPP_BOTOES_INTERATIVOS !== "true" && exibicao !== "buttons")
    ) {
      return this.enviarBot(conversaId, telefone, texto, instanceName);
    }
    const opcoes = fixos.map((b) => ({ id: b.id, botao: b.rotulo }));
    return this.enviarBotComOpcoes(conversaId, telefone, texto, opcoes, instanceName, {
      exibicao: exibicao === "auto" ? "buttons" : exibicao,
    });
  }

  // Remove do corpo as linhas de opcao numeradas (ex.: "1️⃣- Setor Técnico"),
  // deixando so o cabecalho -- as opcoes viram BOTOES. Se sobrar vazio, usa um
  // cabecalho padrao. (No fallback de texto puro, mandamos o texto ORIGINAL com
  // os numeros, para o cliente nunca ficar sem opcao.)
  _corpoInterativo(texto) {
    const linhas = String(texto || "").split("\n");
    // A LINHA NUMERADA SAI DO CORPO -- com ou sem traco, com ou sem negrito.
    //
    // Duas suposicoes sobre "como o menu esta escrito" quebraram isto:
    //
    //   1. exigir `[-–]` depois do numero limpava "1️⃣- Setor Tecnico" e
    //      deixava passar "1️⃣ Tecnico";
    //   2. exigir o digito no COMECO da linha deixava passar
    //      "*1️⃣ Tecnico*" -- que e como o menu de PRODUCAO esta escrito, com
    //      o asterisco do negrito antes do numero.
    //
    // Nos dois casos o cliente recebia os botoes E a lista numerada logo
    // abaixo: a mesma escolha oferecida duas vezes. Mesmo defeito de
    // `_rotuloOpcao` (a0d41ac), pela mesma raiz.
    //
    // Depois do numero exige-se keycap OU separador, nunca apenas espaco, para
    // nao comer linha de conteudo legitima como "2 vias do documento".
    const semOpcoes = linhas.filter(
      // ️⃣ = os dois invisiveis do keycap ("1" + seletor + caixinha).
      (l) => !/^[ \t]*[*_~]*[ \t]*\d+(?:[️⃣]+[ \t]*[-–—.):]?|[ \t]*[-–—.):])[ \t]*\S/u.test(l)
    );
    // E A INSTRUCAO DE DIGITAR TAMBEM SAI.
    //
    // "Responda *SIM* para continuar ou *NÃO* para informar outro CNPJ" e
    // "Digite apenas uma nota" mandam o cliente fazer o que o botao acabou de
    // dispensar. Este metodo SO roda no caminho interativo -- no fallback de
    // texto o original vai inteiro --, entao remover aqui nao deixa ninguem
    // sem saber o que fazer.
    const semInstrucao = semOpcoes.filter(
      (l) => !/^[ \t]*[*_~]*(responda|digite|envie o n[úu]mero|escolha uma das op)\b/iu.test(l)
    );
    const corpo = semInstrucao.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    return corpo || "Escolha uma opção:";
  }

  // Envia um menu como mensagem INTERATIVA (botoes se ate 3 opcoes, senao lista).
  // Corpo = texto SEM as linhas numeradas (buttons-only). Se a instancia Baileys
  // recusar/nao renderizar, cai para texto puro COM os numeros -- fallback que
  // nunca deixa o cliente sem menu.
  /**
   * MENU COMO ENQUETE -- clicavel, e com o texto numerado preservado.
   *
   * A pergunta vai no `name` da enquete (o WhatsApp mostra esse texto acima das
   * opcoes), e cada opcao usa o rotulo do fluxo (`opcao.botao` quando existir).
   *
   * O texto completo do passo continua sendo enviado ANTES, como mensagem
   * normal. Nao e redundancia: se o voto nao voltar legivel -- o risco conhecido
   * do Baileys --, o cliente ainda tem o menu numerado para digitar, e o
   * atendimento nao para. E o mesmo motivo pelo qual `casarOpcao` aceita numero,
   * palavra-chave, id e rotulo.
   *
   * Limites do WhatsApp: 2 a 12 opcoes, e cada opcao com no maximo 100
   * caracteres. Com menos de 2 opcoes nao ha enquete possivel -- cai para texto.
   */
  /**
   * Envia um menu com 2 a 12 opções juntas em um ÚNICO card interativo clicável (Enquete/Poll).
   * Elimina qualquer divisão de "Mais opções:" e permite clicar diretamente na opção desejada.
   */
  async _enviarMenuEnquete(conversaId, telefone, texto, opcoes, instanceName) {
    const inst = instanceName || env.evolutionApi.instance;
    const itens = opcoes
      .slice(0, 12)
      .map((op, i) => this._rotuloOpcao(op, texto, i).slice(0, 100))
      // Enquete nao aceita opcao repetida; duas com o mesmo rotulo viram uma.
      .filter((v, i, a) => v && a.indexOf(v) === i);

    if (itens.length < 2) return this.enviarBot(conversaId, telefone, texto, instanceName);

    const corpo = this._corpoInterativo(texto);
    const msg = await this.deps.conversaRepository.addMensagem(conversaId, "bot", texto, null, null, {
      status: "enviando",
    });

    try {
      const r = await this.deps.evolutionApi.sendPoll(
        telefone,
        {
          name: corpo.slice(0, 255) || "Como podemos ajudar você hoje?",
          values: itens,
          selectableCount: 1,
        },
        inst
      );
      await this.deps.conversaRepository.vincularWaMessageId(msg.id, r?.key?.id || null, "enviada");
      logger.info("Menu enviado como enquete clicável", { conversaId, opcoes: itens.length });
    } catch (error) {
      logger.warn("Falha ao enviar enquete; caindo para texto numerado", {
        conversaId,
        message: error.message,
      });
      await this.enviarBot(conversaId, telefone, texto, instanceName);
    }
    return texto;
  }

  /**
   * @param {object} [opcoes2]
   * @param {"buttons"|"list"|"text"|"enquete"|"auto"} [opcoes2.exibicao] forma pedida pelo NO do
   *   fluxo (`config.exibicao`).
   */
  async enviarBotComOpcoes(conversaId, telefone, texto, opcoes, instanceName, { exibicao = "auto" } = {}) {
    // 1. Se o passo pede "text" / "texto" no bloco do fluxo, envia mensagem de texto com números (1️⃣, 2️⃣...) para o cliente falar ou digitar.
    if (exibicao === "text" || exibicao === "texto") {
      return this.enviarBot(conversaId, telefone, texto, instanceName);
    }

    // 2. Se o passo pede enquete explicitamente, ou se a flag global estiver ativa,
    // ou se tem mais de 3 opções (pois o WhatsApp limita quick reply a 3 por mensagem, enquanto enquete aceita até 12 juntos):
    if (
      exibicao === "enquete" ||
      exibicao === "poll" ||
      process.env.WHATSAPP_MENU_ENQUETE === "true" ||
      (exibicao === "buttons" && opcoes.length > 3) ||
      (exibicao === "auto" && opcoes.length > 3 && opcoes.length <= 12)
    ) {
      return this._enviarMenuEnquete(conversaId, telefone, texto, opcoes, instanceName);
    }

    // 3. Se os botões interativos estiverem desligados no ambiente e o bloco não pedir buttons/list explicitamente:
    if (process.env.WHATSAPP_BOTOES_INTERATIVOS !== "true" && exibicao !== "buttons" && exibicao !== "list") {
      return this.enviarBot(conversaId, telefone, texto, instanceName);
    }

    const inst = instanceName || env.evolutionApi.instance;
    const corpo = this._corpoInterativo(texto);
    const msg = await this.deps.conversaRepository.addMensagem(conversaId, "bot", texto, null, null, {
      status: "enviando",
    });
    const itens = opcoes.slice(0, 10).map((op, i) => ({
      id: this._valorOpcao(op),
      titulo: this._rotuloOpcao(op, texto, i),
    }));

    const marcar = (r, status) =>
      this.deps.conversaRepository.vincularWaMessageId(msg.id, r?.key?.id || null, status);

    // BOTAO ou LISTA -- e, pedindo botao com mais de 3 opcoes, botao MESMO ASSIM.
    //
    // A Evolution recusa 4 botoes numa mensagem: `400 Maximum of 3 reply buttons
    // allowed` (medido em 29/08/2026 na 2.4.0-rc2, chamando o endpoint direto).
    // O limite e do protocolo do WhatsApp, nao da Evolution -- vale igual na
    // Cloud API oficial da Meta. A lista cabe 10, mas esconde tudo atras de um
    // "Ver opcoes", que e precisamente o toque a mais que o menu de botoes
    // existe para eliminar.
    //
    // Entao as opcoes vao em MENSAGENS DE 3: 4 opcoes = 3 + 1. Duas bolhas,
    // quatro botoes, nenhum "Ver opcoes".
    //
    // O PADRAO E BOTAO, e a lista virou opt-in (`exibicao: "list"`). Era o
    // contrario -- `auto` mandava lista acima de 3 --, e o efeito pratico era
    // que os menus de producao, que nao tem `exibicao` gravado no banco,
    // caiam todos no "Ver opcoes" mesmo com os botoes ligados. Decisao do
    // Marco (29/08): o cliente deve ver as opcoes ao entrar na conversa.
    //
    // Acima de 6, `auto` volta para lista: tres ou mais bolhas seguidas de
    // botao viram spam, e ai a lista realmente le melhor. Um NO que pedir
    // `buttons` explicitamente continua mandando botao -- quem escreveu o fluxo
    // sabe o que quer --, e o log registra o tamanho.
    const MAX_OPCOES_EM_BOTAO = 6;
    let comoBotoes = itens.length <= MAX_OPCOES_EM_BOTAO;
    if (exibicao === "buttons") {
      comoBotoes = true;
      if (itens.length > MAX_OPCOES_EM_BOTAO) {
        logger.info("Passo pediu botoes com muitas opcoes: vai em varias bolhas", {
          conversaId,
          opcoes: itens.length,
          bolhas: Math.ceil(itens.length / 3),
        });
      }
    } else if (exibicao === "list") {
      comoBotoes = false;
    }

    try {
      let r;
      if (comoBotoes) {
        // Envia todos os botões juntos na mesma mensagem para não dividir em "Mais opções"
        const payload = {
          title: "Atendimento",
          description: corpo,
          footer: "Selecione uma opção",
          buttons: itens.map((i) => ({
            type: "reply",
            displayText: this._cortarRotulo(i.titulo, 20),
            id: i.id,
          })),
        };
        r = await this.deps.evolutionApi.sendButtons(telefone, payload, inst);
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
                  title: this._cortarRotulo(i.titulo, 24),
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
      // O TIPO DO CLIENTE, gravado -- e nao so devolvido.
      //
      // A classificacao logo abaixo (`estado: parceiro ? "cadastrado" :
      // "avulso"`) sempre existiu, mas morria no retorno desta funcao e numa
      // linha de log. O que ia para o banco era `cnpjVerificado: true` nos dois
      // casos, entao a Central nao tinha como distinguir um do outro e chamava
      // o avulso de "CLIENTE IDENTIFICADO".
      clienteTipo: parceiro ? "cadastrado" : "avulso",
    });

    // O RESULTADO DA CONSULTA E INTERNO. NAO VAI PARA O WHATSAPP.
    //
    // Aqui era montada "Cliente identificado: {razao social} - parceiro com
    // contrato ativo." e os quatro chamadores a enviavam com `enviarBot`. Era um
    // log de processamento na conversa do cliente: ele nao pediu o retorno da
    // consulta a base de parceiros, pediu atendimento.
    //
    // E a informacao nunca dependeu daquela bolha: a identificacao acabou de ser
    // GRAVADA na conversa logo acima, e e de la que a Central le a empresa para
    // mostrar no cabecalho do atendimento. O log abaixo cobre a auditoria.
    //
    // O caso "CNPJ valido, empresa fora da lista" continua falando, porque ali o
    // cliente PRECISA saber que sera atendido como avulso -- isso muda o preco.
    logger.info("CNPJ identificado", {
      conversaId: conversa.id,
      empresa: parceiro?.razaoSocial || null,
      cadastrado: !!parceiro,
    });

    const mensagem = parceiro ? cfg.mensagemCadastrado || null : cfg.mensagemNaoCadastrado;

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
    ctx,
    { avisar = true, motivo = "solicitado", setor = null, filaId = null, opcao = null } = {}
  ) {
    const { conversa, telefone, instanciaId, instanceName } = ctx;

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

    // ── A CONFIRMACAO DE ENCAMINHAMENTO ────────────────────────────────────
    //
    // Aqui existia `if (avisar) { }` -- um bloco VAZIO. O parametro continuava
    // sendo passado por seis chamadores, documentando uma intencao que o codigo
    // nao cumpria: quem caia em `avisar: true` nao recebia nada.
    //
    // Nao era teoria. O fluxo da ARKA usa `aoEsgotarTentativasCnpj: transferir`
    // com duas tentativas: quem errava o CNPJ duas vezes ia para a fila em
    // SILENCIO ABSOLUTO -- sem saber que desistimos do CNPJ, sem saber que havia
    // fila. Do lado do cliente, o bot simplesmente parava de responder. O mesmo
    // valia para `ramificacao_sem_destino`.
    //
    // Quem passa `avisar: false` ja falou com o cliente na linha anterior (a
    // mensagem de fora de horario, a de cliente avulso, a de "nao entendemos a
    // sua demanda") e nao quer duas mensagens seguidas dizendo coisas
    // diferentes.
    if (avisar) {
      const aviso = paramsHandoff(ctx.fluxo, opcao);
      if (aviso) await this.enviarBot(conversa.id, telefone, this.interpolar(aviso, ctx), instanceName);
    }

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
      // ENTREGAR PARA A EQUIPE E UM DESFECHO -- e e por isso que `concluidoEm`
      // e gravado aqui. Este e o ponto exato do relato: o cliente respondeu tudo,
      // o bot mandou "Chamado aberto com sucesso" e a conversa ficou em
      // Pendentes esperando o tecnico. Antes, a unica marca disso era
      // `aguardando: "humano"` -- que o TTL da sessao apagava algumas horas
      // depois, e dali em diante a conversa era indistinguivel de uma nova.
      ...this._marcasDeEspera(AGUARDANDO.HUMANO, { concluido: true }),
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
      ...this._marcasDeEspera(null, { concluido: true }),
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

    await this._enviarComBotoesFixos(
      conversa.id,
      telefone,
      cfg.mensagemNota,
      AGUARDANDO.AVALIACAO_NOTA,
      instanceName,
      { exibicao: cfg.exibicao || "auto" }
    );

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
      // A pesquisa NAO entra na allowlist de inatividade: ela tem prazo, texto e
      // desfecho proprios (`aplicarTimeoutAvaliacao`). `aguardandoDesde` fica
      // null de proposito -- quem cobra esta espera e o outro caminho.
      ...this._marcasDeEspera(AGUARDANDO.AVALIACAO_NOTA),
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
          ...this._marcasDeEspera(null, { concluido: true }),
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
      const nota = this.interpretarNota(ctx.botaoId || textoEntrada);

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
        // Repergunta COM os botoes: se a primeira nota nao veio no formato, o
        // que o cliente menos precisa e da mesma pergunta pedindo digitacao.
        await this._enviarComBotoesFixos(
          conversa.id,
          telefone,
          cfg.mensagemNotaInvalida,
          AGUARDANDO.AVALIACAO_NOTA,
          instanceName,
          { exibicao: cfg.exibicao || "auto" }
        );
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

    // O RELOGIO CONTA DESDE QUE A CONVERSA ENTROU NA FILA -- e nao desde que o
    // cliente comecou a falar com o bot.
    //
    // Aqui era `os.abertoEm`, a abertura da OS. Mas a OS abre quando o CICLO
    // comeca, isto e, na primeira mensagem do cliente -- entao os 10 minutos
    // incluiam toda a triagem do bot. Quem levava 8 minutos respondendo CNPJ,
    // menu e descricao recebia "seu atendimento esta na fila" 2 minutos depois de
    // ja ter sido avisado de que o chamado foi aberto. O aviso e sobre a DEMORA
    // do atendente; enquanto o cliente respondia ao bot, ninguem estava devendo
    // resposta a ele.
    //
    // `sessao.concluidoEm` e o instante exato do handoff (ver _marcasDeEspera).
    // Sem ele -- conversa que chegou a fila sem passar por fluxo, ou reaberta
    // pelo atendente -- vale a abertura da OS, como antes.
    const entrouNaFila = conversa.sessao?.concluidoEm || null;
    const desde = new Date(entrouNaFila || os.abertoEm || conversa.criadoEm).getTime();
    const ultimoAviso = os.avisoEsperaEm ? new Date(os.avisoEsperaEm).getTime() : null;
    const base = cfg.repetir && ultimoAviso ? ultimoAviso : desde;
    if (Date.now() - base < cfg.minutos * 60 * 1000) return false;

    const texto = this.interpolar(cfg.mensagem, { conversa });
    const envio = await this.enviarBot(conversa.id, conversa.telefone, texto, instanceName, {
      reaproveitarFalha: true,
    });

    // ENVIO QUE FALHOU NAO CONTA COMO ENVIADO.
    //
    // Aqui o `avisoEsperaEm` era estampado logo depois do `enviarBot`, sem olhar
    // o resultado -- e `enviarBot` nunca lanca, ele engole a falha e marca a
    // mensagem como "erro". Com `repetir: false`, o guard la em cima
    // (`if (os.avisoEsperaEm && !cfg.repetir) return false`) passava a bloquear
    // para sempre: uma falha de um segundo (a Evolution fora do ar, o container
    // reiniciando no meio de um deploy) matava o aviso daquele atendimento
    // definitivamente. Foi exatamente o que aconteceu em 2026-08-28 19:19.
    //
    // Sem a marca, a proxima varredura (60s) tenta de novo, reaproveitando a
    // mesma bolha em vez de empilhar uma nova.
    if (!envio.enviada) {
      logger.warn("Aviso de espera na fila NAO enviado; sera tentado de novo", {
        conversaId: conversa.id,
        atendimentoId: os.id,
      });
      return false;
    }

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
      ...this._marcasDeEspera(null, { concluido: true }),
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
      ...this._marcasDeEspera(null, { concluido: true }),
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
      ...this._marcasDeEspera(null, { concluido: true }),
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
    // O passo tem opcoes, mas nenhuma leva a lugar nenhum: o fluxo TERMINA aqui,
    // e nao fica esperando uma resposta que ninguem tem por que dar.
    let fimDoFluxo = false;
    // Quando o fluxo termina EXECUTANDO uma opcao (curinga que so transfere), e
    // ela que carrega setor, fila e o texto do handoff.
    let opcaoFinal = null;
    // A espera deste passo COBRA resposta do cliente? Ver decidirEsperaDoPasso.
    let cobraResposta = true;

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
          // Estaciona -- mas so COBRA a resposta quando ela muda algo. Ver
          // decidirEsperaDoPasso.
          const espera = this.decidirEsperaDoPasso(passo, fluxo.passos);
          if (espera.estaciona) {
            aguardando = AGUARDANDO.OPCAO;
            cobraResposta = espera.cobraResposta;
          } else {
            fimDoFluxo = true;
            opcaoFinal = espera.opcao;
          }
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
        if (this.opcoesDoPasso(passo).length) {
          const espera = this.decidirEsperaDoPasso(passo, fluxo.passos);
          if (espera.estaciona) {
            aguardando = AGUARDANDO.OPCAO;
            cobraResposta = espera.cobraResposta;
          } else {
            fimDoFluxo = true;
            opcaoFinal = espera.opcao;
          }
        } else proximo = this.proximoPasso(fluxo.passos, passo);
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
        // `config.exibicao` do PASSO ("buttons" | "list"); sem ele, a contagem
        // decide (ate 3 botoes, acima lista).
        await this.enviarBotComOpcoes(conversa.id, telefone, resposta, opcoesMenu, instanceName, {
          exibicao: passo.config?.exibicao || "auto",
        });
      } else {
        // Pergunta de resposta FIXA (o CNPJ continua este? / nota 1..5) vai com
        // botao; qualquer outra mensagem e texto. Sem botao definido para o
        // estado, `_enviarComBotoesFixos` cai no texto sozinho.
        await this._enviarComBotoesFixos(conversa.id, telefone, resposta, aguardando, instanceName, {
          exibicao: passo.config?.exibicao || "auto",
        });
      }
    }

    await this.registrarLog(instanciaId, fluxo.id, passo, conversa.id, resposta, true, inicio);

    return { proximo, aguardando, contextoSessao, fimDoFluxo, opcaoFinal, cobraResposta };
  }

  /**
   * O FLUXO ACABOU NUM PASSO SEM SAIDA -- entrega para a equipe.
   *
   * O passo ja falou com o cliente (tipicamente a confirmacao de que o chamado
   * foi aberto), e nao ha para onde ir. Duas alternativas seriam erradas:
   *
   *   - ESTACIONAR em `aguardando: "opcao"` (o que o motor fazia): a sessao
   *     passava a dizer "esperando resposta do cliente" depois de anunciar que o
   *     chamado estava aberto, e a inatividade fechava o atendimento minutos
   *     depois. Era o defeito relatado.
   *   - Apenas DESLIGAR a sessao: a conversa ficaria em Pendentes sem OS
   *     garantida, sem setor gravado e sem evento para a Central.
   *
   * `transferirParaHumano` e o caminho que ja faz a coisa certa: garante a OS
   * aberta, marca a conversa como pendente para a equipe, grava `concluidoEm`
   * (portanto mata a inatividade) e emite o evento. `avisar: false` porque o
   * passo acabou de falar -- mandar a confirmacao de encaminhamento em seguida
   * seriam duas mensagens dizendo a mesma coisa.
   *
   * Idempotente: e um upsert de sessao + `garantirAtendimentoAberto`. Reprocessar
   * o passo final nao cria OS nem timer duplicado.
   */
  async _entregarNoFimDoFluxo(contexto, opcao = null) {
    // A opcao curinga que transfere pode trazer setor e fila do proprio no; sem
    // isso a conversa cairia na fila geral, perdendo a triagem que o desenho do
    // fluxo ja fazia. Mesmo tratamento que `aplicarOpcao` da a `acao:
    // "transferir"` -- incluindo o mapa queueId -> setor de Configuracoes.
    let setor = opcao?.setor || null;
    const filaId = opcao?.filaId ?? null;
    if (!setor && filaId != null) {
      const mapa = await this.deps.configuracaoService.filasParaSetor();
      setor = mapa[String(filaId)] || null;
    }
    // `avisar: false`: o passo acabou de falar (tipicamente a confirmacao de que
    // o chamado foi aberto). Duas mensagens seguidas dizendo a mesma coisa
    // confundem mais do que uma.
    return this.transferirParaHumano(contexto, {
      avisar: false,
      motivo: "fim_do_fluxo",
      setor,
      filaId,
      opcao,
    });
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
        // ESPERA SEM COBRANCA -- registrada em `info`, nao em `debug`.
        //
        // Este e o unico sinal observavel de que o passo de confirmacao ("Chamado
        // aberto com sucesso") parou SEM abrir prazo de inatividade. Sem esta
        // linha, a prova de que a correcao funciona seria a AUSENCIA de
        // "Etapa encerrada" no log -- indistinguivel de "ninguem testou ainda".
        // Em producao o nivel e `info`, entao `debug` nao serviria.
        if (resultado.cobraResposta === false) {
          logger.info("Espera sem cobranca: a resposta do cliente nao muda o desfecho", {
            fluxoId: contexto.fluxo.id,
            conversaId: contexto.conversa.id,
            passoId: passoAtual.id,
            passoTitulo: passoAtual.titulo,
          });
        }

        return {
          passoAtual,
          aguardando,
          contextoSessao: resultado.contextoSessao || null,
          cobraResposta: resultado.cobraResposta !== false,
        };
      }

      // O passo falou e nao tem saida: fim do fluxo. Sai avisando o chamador,
      // que entrega a conversa ao atendente em vez de estacionar a sessao.
      if (resultado.fimDoFluxo) {
        logger.info("Fluxo terminou num passo sem saida", {
          fluxoId: contexto.fluxo.id,
          conversaId: contexto.conversa.id,
          passoId: passoAtual.id,
          passoTitulo: passoAtual.titulo,
        });
        return { passoAtual: null, aguardando: null, contextoSessao: null, fimDoFluxo: true, opcaoFinal: resultado.opcaoFinal || null };
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

    const { passoAtual, aguardando, contextoSessao, fimDoFluxo, opcaoFinal, cobraResposta } =
      await this.percorrer(passos[0] || null, contexto);
    if (fimDoFluxo) {
      return { fluxoId: fluxo.id, ...(await this._entregarNoFimDoFluxo(contexto, opcaoFinal)) };
    }

    await this.deps.sessaoRepository.upsert(instanciaId, conversa.id, telefone, {
      fluxoAtualId: fluxo.id,
      passoAtualId: passoAtual?.id || null,
      aguardando,
      ativo: !!aguardando,
      // Sem `aguardando`, o fluxo andou ate o fim sem pedir nada: e desfecho.
      // Com `aguardando`, o bot acabou de perguntar -- o prazo comeca agora.
      ...this._marcasDeEspera(aguardando, { concluido: !aguardando, cobraResposta }),
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

    // ---------------------------------------------------------------------
    // "ATENDIMENTO AVULSO" TAMBEM E ESCOLHA DO CLIENTE, e vale como o setor.
    //
    // O cliente escolhia "2 - Atendimento avulso" e nada era gravado: a Central
    // seguia mostrando a badge da empresa (verde, "parceiro com contrato
    // ativo"), porque o unico caminho que classificava o tipo era a validacao
    // de CNPJ. Quem atende precisava adivinhar que aquele atendimento e cobrado
    // a parte.
    //
    // E DESVINCULA O CNPJ: quem pede atendimento avulso deixa de ser atendido
    // como a empresa daquele contrato, e a Central mostra "CLIENTE AVULSO" em vez
    // do nome dela. O cadastro da empresa NAO e tocado -- e o mesmo
    // `_desassociarCnpj` do "informar outro CNPJ", que solta a conversa e deixa
    // o parceiro em paz.
    // ---------------------------------------------------------------------
    // Grava em `atendimentoAvulso`, e NAO em `clienteTipo`: aquele campo e o
    // retrato do cadastro no instante da validacao do CNPJ, e ele precisa poder
    // envelhecer (empresa cadastrada como parceira depois volta a ser
    // "cadastrado"). Escrever a escolha ali marcava o cliente como avulso para
    // sempre -- o verificar-cliente-avulso reprovou a primeira versao por isso.
    //
    // A marca continua existindo mesmo com o CNPJ desvinculado, e isso importa:
    // sem ela, uma conversa sem CNPJ cairia em "CLIENTE NAO IDENTIFICADO", que e
    // outra coisa. "Nao sei quem e" e "sei que e avulso" sao estados diferentes.
    const tipoDaEscolha = tipoClienteDaOpcaoEscolhida(opcao);
    if (tipoDaEscolha === "avulso" && !conversa.atendimentoAvulso) {
      await this.deps.conversaRepository.update(conversa.id, { atendimentoAvulso: true });
      conversa.atendimentoAvulso = true;
      await this._desassociarCnpj(conversa);
      await this._emitirConversa(conversa.id);
      logger.info("Atendimento avulso escolhido pelo cliente", {
        conversaId: conversa.id,
        opcao: opcao.id,
      });
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
      // A CONFIRMACAO NAO E MAIS MONTADA AQUI.
      //
      // Este trecho lia `configuracoesGlobais.welcomeMessage` -- a mensagem de
      // BOAS-VINDAS -- e a enviava como aviso de transferencia, porque o editor
      // de origem usava o mesmo campo para as duas coisas. No fluxo da ARKA isso
      // fazia o cliente do Financeiro terminar o atendimento ouvindo "Agora
      // sim!! Sua solicitacao esta completa", e deixava sem confirmacao nenhuma
      // todo caminho de transferencia que nao passasse por aqui.
      //
      // Agora quem envia e `transferirParaHumano`, com o texto de `paramsHandoff`
      // -- um caminho so, para todos os motivos de handoff. A opcao viaja junto
      // porque ela pode trazer o texto do proprio no (`mensagemHandoff`).
      //
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
        opcao,
      });
    }

    const destino = fluxo.passos.find((p) => p.id === opcao.targetId) || null;
    if (!destino) {
      // Ramificacao apontando para o vazio: um atendente e melhor que silencio.
      return this.transferirParaHumano(contexto, { motivo: "ramificacao_sem_destino" });
    }

    const resultado = await this.percorrer(destino, contexto);
    if (resultado.fimDoFluxo) {
      return { fluxoId: fluxo.id, ...(await this._entregarNoFimDoFluxo(contexto, resultado.opcaoFinal)) };
    }

    await this.deps.sessaoRepository.update(sessao.id, {
      passoAtualId: resultado.passoAtual?.id || null,
      aguardando: resultado.aguardando,
      ativo: !!resultado.aguardando,
      ...this._marcasDeEspera(resultado.aguardando, { concluido: !resultado.aguardando, cobraResposta: resultado.cobraResposta !== false }),
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
      const escolha = opcoes.length
        ? (ctx.botaoId ? this.casarOpcao(ctx.botaoId, opcoes) : null) || this.casarOpcao(textoEntrada, opcoes)
        : null;

      if (!escolha) {
        // Passo perdeu as opcoes (fluxo editado no meio do atendimento): nao ha
        // como continuar de onde parou.
        if (!opcoes.length) return this.transferirParaHumano(contexto, { motivo: "passo_sem_opcoes" });

        const tentativas = (sessao.contexto?.tentativasOpcao || 0) + 1;
        if (tentativas >= limites.maxTentativasOpcao) {
          return this.transferirParaHumano(contexto, { motivo: "opcao_invalida" });
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
          // O bot acabou de repetir o menu: o prazo recomeca daqui, e nao da
          // pergunta anterior. O cliente respondeu -- so nao acertou a opcao.
          ...this._marcasDeReperguntar(),
        });

        return { fluxoId: fluxo.id, conversaId: conversa.id, aguardando: AGUARDANDO.OPCAO };
      }

      return this.aplicarOpcao(escolha, contexto, sessao);
    }

    // Cliente recorrente confirmando o CNPJ que ja usou antes.
    if (sessao.aguardando === AGUARDANDO.CNPJ_CONFIRMA) {
      const resp = this.normalizarTexto(ctx.botaoId || textoEntrada);
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
          // Pode nao haver nada a dizer: parceiro reconhecido segue direto para
          // o proximo passo, que ja fala com o cliente. Ver validarCnpjRecebido.
          if (cnpjValidacao.mensagem) {
            await this.enviarBot(conversa.id, telefone, cnpjValidacao.mensagem, instanceName);
          }
          contexto.cnpjValidacao = cnpjValidacao;
          contexto.conversa = await this.deps.conversaRepository.findById(conversa.id);
          // O passo que pediu o CNPJ cumpriu seu papel; segue para o proximo.
          const seguinte = passoAtual ? this.proximoPasso(passos, passoAtual) : null;
          const resultado = await this.percorrer(seguinte, contexto);
          if (resultado.fimDoFluxo) {
            return { fluxoId: fluxo.id, ...(await this._entregarNoFimDoFluxo(contexto, resultado.opcaoFinal)) };
          }
          await this.deps.sessaoRepository.update(sessao.id, {
            passoAtualId: resultado.passoAtual?.id || null,
            aguardando: resultado.aguardando,
            ativo: !!resultado.aguardando,
            ...this._marcasDeEspera(resultado.aguardando, { concluido: !resultado.aguardando, cobraResposta: resultado.cobraResposta !== false }),
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
        await this._enviarComBotoesFixos(
          conversa.id,
          telefone,
          paramsCnpj(passoAtual).mensagemRespostaInvalida,
          AGUARDANDO.CNPJ_CONFIRMA,
          instanceName
        );
        // Este caminho tambem nao escrevia nada na sessao (ver o de CNPJ, mais
        // abaixo): o bot repetiu a pergunta, entao o prazo recomeca daqui.
        await this.deps.sessaoRepository.update(sessao.id, this._marcasDeReperguntar());
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
        // Pergunta NOVA (o CNPJ digitado, em vez do confirmado): prazo do zero.
        ...this._marcasDeEspera(AGUARDANDO.CNPJ),
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
          // ESTE CAMINHO NAO ESCREVIA NADA NA SESSAO.
          //
          // O cliente respondeu, o bot repetiu a pergunta -- e o relogio da
          // inatividade continuava correndo desde o pedido ANTERIOR. Quem
          // perguntasse outra coisa no meio do caminho podia ser encerrado por
          // "falta de resposta" segundos depois de ter escrito.
          await this.deps.sessaoRepository.update(sessao.id, this._marcasDeReperguntar());
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
            // ESTE CAMINHO NAO GRAVAVA NADA. O fluxo decidia atender como
            // avulso, escrevia no log e transferia -- e a conversa seguia com
            // `cnpjVerificado: false`, entao a Central mostrava "CLIENTE NAO
            // IDENTIFICADO". O sistema tinha tomado a decisao e a tela nao
            // ficava sabendo.
            //
            // `cnpjVerificado` continua false de proposito: nenhum CNPJ foi
            // confirmado aqui. O que se sabe e o TIPO, e e so isso que se grava.
            await this.deps.conversaRepository.update(conversa.id, { clienteTipo: "avulso" });
            logger.info("CNPJ nao confirmado: seguindo como cliente avulso", {
              conversaId: conversa.id,
            });
            return this.transferirParaHumano(contexto, {
              avisar: false,
              motivo: "cliente_avulso",
            });
          }
          // `contexto`, e nao `ctx`: e ele que carrega o fluxo, e sem o fluxo a
          // confirmacao de encaminhamento cai no padrao do sistema em vez do
          // texto que a instalacao configurou em `handoffMessage`.
          return this.transferirParaHumano(contexto, { motivo: "cnpj_invalido" });
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
          // O bot acabou de pedir o CNPJ de novo: prazo do zero.
          ...this._marcasDeReperguntar(),
        });

        return { conversaId: conversa.id, aguardando: AGUARDANDO.CNPJ };
      }

      // Silencio aqui e o caminho normal do parceiro reconhecido: quem fala com
      // o cliente e o proximo passo do fluxo. Ver validarCnpjRecebido.
      if (cnpjValidacao.mensagem) {
        await this.enviarBot(conversa.id, telefone, cnpjValidacao.mensagem, instanceName);
      }

      contexto.cnpjValidacao = cnpjValidacao;
      contexto.conversa = await this.deps.conversaRepository.findById(conversa.id);

      // O passo que pediu o CNPJ ja cumpriu seu papel; segue para o proximo.
      if (passoAtual) {
        passoAtual = this.proximoPasso(passos, passoAtual);
      }
    }

    const resultado = await this.percorrer(passoAtual, contexto);
    if (resultado.fimDoFluxo) {
      return { fluxoId: fluxo.id, ...(await this._entregarNoFimDoFluxo(contexto, resultado.opcaoFinal)) };
    }

    await this.deps.sessaoRepository.update(sessao.id, {
      passoAtualId: resultado.passoAtual?.id || null,
      aguardando: resultado.aguardando,
      ativo: !!resultado.aguardando,
      ...this._marcasDeEspera(resultado.aguardando, { concluido: !resultado.aguardando, cobraResposta: resultado.cobraResposta !== false }),
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
    botaoId = null,
    nomeCliente = "Cliente",
    waMessageId = null,
    midia = null,
    encaminhada = null,
  }) {
    const textoLimpo = this.extrairTextoMensagem(texto);
    const ehMidia = !!midia && midia.tipo && midia.tipo !== "texto";
    // Sem texto, sem botaoId e sem midia: nada a processar.
    if (!textoLimpo && !botaoId && !ehMidia) return { processado: false, motivo: "mensagem_vazia" };

    // A Evolution API reentrega webhooks; sem isso a mesma mensagem rodava o
    // fluxo duas vezes e o cliente recebia tudo duplicado.
    if (waMessageId && (await this.deps.conversaRepository.existeMensagemWa(waMessageId))) {
      return { processado: false, motivo: "mensagem_duplicada" };
    }

    // Texto exibido na bolha/preview + metadata da midia (quando houver).
    const rotulos = { imagem: "[Imagem]", figurinha: "[Figurinha]", video: "[Vídeo]", documento: "[Documento]", audio: "[Áudio]", localizacao: "[Localização]", contato: "[Contato]" };
    let textoMsg = ehMidia ? (textoLimpo || rotulos[midia.tipo] || "[Mídia]") : (textoLimpo || botaoId);

    // RESPOSTA DA PESQUISA DE SATISFACAO: a conversa avaliada JA ESTA FECHADA, e
    // findByTelefone (de proposito) so olha pendente/aberta. Sem este desvio, a
    // nota do cliente criava uma conversa NOVA e era gravada nela -- uma conversa
    // que ninguem atendeu e sem nome de cliente. Era isso que fazia a coluna
    // "Atendente" das avaliacoes dizer "Bot" mesmo em atendimento humano, e ainda
    // deixava uma conversa-fantasma na lista de Fechadas a cada avaliacao.
    let conversa = null;
    // Esta mensagem abriu um CICLO NOVO no fio (a conversa estava fechada)?
    let cicloReaberto = false;
    const sessaoAberta = await this.deps.sessaoRepository.findByTelefone(instanciaId, telefone);

    // Se o texto recebido for apenas um ID técnico de botão (ex: "mp_2", "com_1" ou botaoId),
    // tenta resolver para o rótulo legível da opção (ex: "Comercial", "Produtos")
    // para que no chat de atendimento apareça o nome da opção e não o código técnico.
    const idBusca = botaoId || (textoLimpo && !ehMidia ? textoLimpo : null);
    if (sessaoAberta?.ativo && idBusca) {
      if (sessaoAberta.aguardando === AGUARDANDO.OPCAO && sessaoAberta.fluxoAtualId) {
        try {
          const flx = await this.deps.fluxoRepository.findById(sessaoAberta.fluxoAtualId);
          if (flx) {
            const passos = this.ordenarPassos(flx.passos);
            const passoAtual = sessaoAberta.passoAtualId ? passos.find((p) => p.id === sessaoAberta.passoAtualId) : passos[0];
            const opcoes = this.opcoesDoPasso(passoAtual);
            const op = opcoes.find((o) => o?.id && (o.id === idBusca || this.normalizarTexto(o.id) === this.normalizarTexto(idBusca)));
            if (op) {
              const rot = op.botao || this._rotuloOpcao(op, this.textoDoPasso(passoAtual, { conversa: { cliente: nomeCliente, telefone } }));
              if (rot && (textoMsg === op.id || !textoMsg || textoMsg === botaoId)) {
                textoMsg = rot;
              }
            }
          }
        } catch { /* ignora falha de resolucao de rotulo */ }
      } else if (sessaoAberta.aguardando === AGUARDANDO.CNPJ_CONFIRMA) {
        const btn = (BOTOES_FIXOS[AGUARDANDO.CNPJ_CONFIRMA] || []).find(
          (b) => b.id === idBusca || this.normalizarTexto(b.id) === this.normalizarTexto(idBusca)
        );
        if (btn && (textoMsg === btn.id || !textoMsg || textoMsg === botaoId)) {
          textoMsg = btn.rotulo;
        }
      } else if (sessaoAberta.aguardando === AGUARDANDO.AVALIACAO_NOTA) {
        const btn = (BOTOES_FIXOS[AGUARDANDO.AVALIACAO_NOTA] || []).find((b) => b.id === idBusca);
        if (btn && (textoMsg === btn.id || !textoMsg || textoMsg === botaoId)) {
          textoMsg = btn.rotulo;
        }
      }
    }

    // A marca de encaminhamento e botaoId entram no metadata.
    const metadata =
      ehMidia || encaminhada || botaoId
        ? { ...(ehMidia ? midia : {}), ...(encaminhada || {}), ...(botaoId ? { botaoId } : {}) }
        : null;
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
        // Marca o CICLO NOVO. E o que distingue "o cliente voltou com um chamado
        // novo" (aqui o fluxo deve rodar de novo) de "o cliente ainda espera o
        // tecnico do chamado anterior" (aqui o fluxo NAO deve rodar). Usado mais
        // abaixo, na expiracao da sessao.
        cicloReaberto = true;
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
          // A escolha de "atendimento avulso" e DO CHAMADO, pela mesma razao que
          // o setor: quem pediu avulso em agosto nao esta pedindo avulso de novo
          // em setembro. Sem este reset, a badge "AVULSO" ficaria colada no fio
          // para sempre -- o mesmo sintoma que o setor herdado tinha.
          atendimentoAvulso: false,
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
      // ── QUEM ESTA NA FILA DO TECNICO NAO VOLTA PARA O INICIO DO BOT ────────
      //
      // Era daqui que saia o "Atendimento encerrado por inatividade" depois de
      // "Chamado aberto com sucesso" -- a causa-raiz do relato:
      //
      //   1. o cliente respondeu tudo, o bot abriu o chamado e entregou para a
      //      equipe (`aguardando: "humano"`), conversa em Pendentes;
      //   2. o tecnico demorou mais que o TTL humano (240 min -- uma fila que
      //      atravessa a noite passa disso sozinha);
      //   3. o cliente perguntou "alguma novidade?";
      //   4. a sessao expirava, `aguardando: "humano"` era APAGADO, e como a
      //      conversa segue `pendente` (nao `aberta`), o motor caia no gatilho
      //      curinga e REEXECUTAVA o fluxo do zero -- reenviando o menu de boas
      //      vindas para quem so queria um status;
      //   5. cinco minutos de silencio depois, a inatividade encerrava a OS que
      //      o tecnico ainda nao tinha visto.
      //
      // O TTL existe para nao deixar ninguem preso no meio de um fluxo antigo.
      // Uma conversa na FILA nao esta no meio de fluxo nenhum: ela esta esperando
      // uma pessoa, e esse estado nao expira -- ele termina quando alguem assume
      // (`statusAtendimento: "aberta"`) ou quando o ciclo fecha.
      //
      // `cicloReaberto` preserva o caminho oposto: cliente que volta com um
      // chamado NOVO (conversa estava fechada) continua sendo atendido pelo bot.
      const naFilaDoAtendente =
        sessao.aguardando === AGUARDANDO.HUMANO &&
        !cicloReaberto &&
        conversa.statusAtendimento === "pendente" &&
        !conversa.atendenteId;

      if (naFilaDoAtendente) {
        logger.info("Sessao expirada, mas a conversa segue na fila: bot nao reinicia o fluxo", {
          conversaId: conversa.id,
          telefone,
        });
        // Mesmo desfecho do branch `aguardando_atendente` mais abaixo: a mensagem
        // ja esta registrada e na tela do atendente; o bot nao responde.
        return { processado: false, motivo: "aguardando_atendente", conversaId: conversa.id };
      }

      await this.deps.sessaoRepository.update(sessao.id, {
        ativo: false,
        aguardando: null,
        passoAtualId: null,
        // Nao ha mais pergunta em aberto nem reivindicacao de inatividade
        // valida: a espera morreu com a sessao.
        aguardandoDesde: null,
        inatividadeEm: null,
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
      botaoId,
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
        if (cnpjValidacao.mensagem) {
          await this.enviarBot(conversa.id, telefone, cnpjValidacao.mensagem, instanceName);
        }
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
