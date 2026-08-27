/**
 * PARÂMETROS DE AUTOMAÇÃO DO BOT resolvidos a partir do FLUXO.
 *
 * Este módulo é a fonte única de "o que o bot faz". Antes, o comportamento
 * estava espalhado em três lugares que discordavam entre si:
 *
 *   - `chatbot.config.js` (variáveis de ambiente): quantidade de tentativas de
 *     CNPJ. Mudar isso exigia deploy, e não aparecia em lugar nenhum da tela.
 *   - `configuracao.service` (chave global `chatbot.pesquisaSatisfacao`): a
 *     pesquisa de satisfação. Por ser GLOBAL, ela rodava mesmo com todos os
 *     fluxos pausados -- o cliente recebia "de 1 a 5, que nota você dá?" de um
 *     bot que, segundo a tela, estava desligado.
 *   - textos embutidos no motor (`chatbot.engine`): "responda SIM ou NÃO",
 *     confirmação de CNPJ, etc.
 *
 * Agora tudo sai do FLUXO: cada parâmetro mora no `config` de um passo, e o
 * fluxo precisa estar ATIVO para qualquer automação acontecer. Olhar o fluxo na
 * tela passa a ser suficiente para saber o que o bot vai fazer.
 *
 * Os PADRÕES abaixo existem para um fluxo recém-criado já se comportar de forma
 * razoável -- eles não são "regra escondida": a tela do editor mostra cada um
 * deles como placeholder do campo correspondente, e qualquer texto digitado ali
 * vence o padrão.
 */

// Padrões de cada parâmetro. Alterar aqui muda o comportamento de um fluxo que
// NÃO preencheu o campo; um fluxo que preencheu continua mandando.
const PADROES = {
  cnpj: {
    // Quantas vezes o cliente pode errar o CNPJ antes de o fluxo desistir.
    maxTentativas: 2,
    // O que fazer quando as tentativas acabam: transferir para um atendente ou
    // seguir o atendimento como cliente avulso.
    aoEsgotarTentativas: "transferir", // "transferir" | "avulso"
    mensagemInvalido:
      "Hmm, o número informado parece estar incorreto. Poderia conferir o CNPJ e tentar novamente?",
    mensagemUltimaTentativa:
      "O número informado parece estar incorreto. Você tem mais uma tentativa: confira o CNPJ e envie novamente.",
    mensagemNaoCadastrado:
      "Não encontramos esse CNPJ em nossa lista de Clientes. Você será atendido como cliente avulso.",
    mensagemRespostaInvalida:
      "Hmm, não entendi o que você falou. Poderia repetir?",
    mensagemConfirmar:
      "Vi que você já foi atendido por aqui. O atendimento continua sendo para esta empresa?\n\n🏢 {{empresa}}\n\nResponda *SIM* para confirmar ou *NÃO* para informar outro CNPJ.",
    mensagemConfirmarSemEmpresa:
      "Vi que você já foi atendido por aqui. O CNPJ continua sendo este?\n\n📄 {{cnpj}}\n\nResponda *SIM* para confirmar ou *NÃO* para informar outro.",
    mensagemPedirOutro:
      "Sem problema. Por favor, informe o *CNPJ* (pode enviar com ou sem pontuação).",
    // Memória do contato recorrente: oferecer o CNPJ já usado antes.
    memoria: true,
  },

  /**
   * TEMPO A -- O CLIENTE NAO RESPONDE AO BOT.
   *
   * O bot fez uma pergunta obrigatoria (CNPJ, opcao do menu) e o cliente sumiu.
   * Isto NAO e sobre a fila: e sobre uma etapa parada esperando resposta.
   */
  semResposta: {
    minutos: 5,
    mensagem: "Não entendemos a sua demanda. Por favor, abra um chamado novamente.",
    // "encerrar" fecha a OS (a proxima mensagem do cliente abre um chamado
    // novo, que e o que a mensagem promete); "fila" devolve para um atendente.
    acao: "encerrar", // "encerrar" | "fila"
  },

  /**
   * TEMPO B -- O CLIENTE ESPERA UM ATENDENTE HA TEMPO DEMAIS.
   *
   * Aqui nao ha pergunta nenhuma pendente: a conversa esta na fila de Pendentes
   * e ninguem assumiu. Sao coisas diferentes e nao podem compartilhar relogio --
   * quem espera atendimento nao "deixou de responder".
   */
  filaPendentes: {
    minutos: 10,
    mensagem:
      "Ei {{cliente}}! Estamos com uma demanda alta no momento, mas fique tranquilo! Em breve, um dos nossos atendentes estará disponível para atendê-lo.",
    // Uma vez por atendimento. Repetir a cada 10 min viraria spam de quem ja
    // esta esperando -- e a garantia de "so uma vez" e a coluna
    // atendimentos.aviso_espera_em, nao um contador em memoria.
    repetir: false,
  },

  avaliacao: {
    pedirComentario: true,
    mensagemNota:
      "Antes de encerrar: de 1 a 5, que nota você dá para este atendimento? (1 = péssimo, 5 = ótimo)",
    mensagemComentario:
      'Obrigado! Em poucas palavras, o que foi bom ou o que podemos melhorar? (ou responda "pular")',
    mensagemAgradecimento: "Sua avaliação foi registrada. Obrigado pelo seu feedback!",
    mensagemNotaInvalida: "Por favor, responda apenas com um número de 1 a 5.",
    // Quantas respostas fora de 1..5 antes de encerrar a pesquisa sem nota.
    maxTentativas: 2,
    // ESPERA PELA AVALIAÇÃO. Contada pelo SERVIDOR (varredura periódica), nunca
    // pelo navegador: fechar a aba, cair a rede ou reiniciar o painel não muda
    // nada. Ver chatbot.inatividade.js.
    timeoutMin: 5,
    mensagemTimeout:
      "Agradecemos o seu contato! Caso precise de mais alguma coisa, estaremos à disposição.",
  },
};

// Só chaves conhecidas, e cada uma com o tipo certo. Um `config` vindo de um
// JSON importado à mão não pode injetar comportamento nem derrubar o motor.
function texto(valor, padrao) {
  return typeof valor === "string" && valor.trim() ? valor : padrao;
}
function inteiro(valor, padrao, min, max) {
  const n = Number(valor);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : padrao;
}
function booleano(valor, padrao) {
  return typeof valor === "boolean" ? valor : padrao;
}

/**
 * Parâmetros de CNPJ de um passo (tipo "condicao" / "Validar CNPJ").
 * `passo` pode ser null: devolve os padrões.
 */
function paramsCnpj(passo) {
  const c = (passo && passo.config) || {};
  const p = PADROES.cnpj;
  return {
    maxTentativas: inteiro(c.maxTentativasCnpj, p.maxTentativas, 1, 10),
    aoEsgotarTentativas:
      c.aoEsgotarTentativasCnpj === "avulso" ? "avulso" : p.aoEsgotarTentativas,
    mensagemInvalido: texto(c.mensagemCnpjInvalido, p.mensagemInvalido),
    mensagemUltimaTentativa: texto(c.mensagemCnpjUltimaTentativa, p.mensagemUltimaTentativa),
    mensagemNaoCadastrado: texto(c.mensagemCnpjNaoCadastrado, p.mensagemNaoCadastrado),
    mensagemRespostaInvalida: texto(c.mensagemRespostaInvalida, p.mensagemRespostaInvalida),
    mensagemConfirmar: texto(c.mensagemConfirmarCnpj, p.mensagemConfirmar),
    mensagemConfirmarSemEmpresa: texto(
      c.mensagemConfirmarCnpjSemEmpresa,
      p.mensagemConfirmarSemEmpresa
    ),
    mensagemPedirOutro: texto(c.mensagemPedirOutroCnpj, p.mensagemPedirOutro),
    memoria: booleano(c.memoriaCnpj, p.memoria),
  };
}

/** Parâmetros da pesquisa de satisfação de um passo (tipo "avaliacao"). */
function paramsAvaliacao(passo) {
  const c = (passo && passo.config) || {};
  const p = PADROES.avaliacao;
  return {
    pedirComentario: booleano(c.pedirComentario, p.pedirComentario),
    mensagemNota: texto(c.mensagemNota, p.mensagemNota),
    mensagemComentario: texto(c.mensagemComentario, p.mensagemComentario),
    mensagemAgradecimento: texto(c.mensagemAgradecimento, p.mensagemAgradecimento),
    mensagemNotaInvalida: texto(c.mensagemNotaInvalida, p.mensagemNotaInvalida),
    maxTentativas: inteiro(c.maxTentativasAvaliacao, p.maxTentativas, 1, 10),
    timeoutMin: inteiro(c.timeoutAvaliacaoMin, p.timeoutMin, 1, 24 * 60),
    mensagemTimeout: texto(c.mensagemTimeoutAvaliacao, p.mensagemTimeout),
  };
}

/**
 * Bloco de configuração de escopo do FLUXO (e não de um passo).
 *
 * Ele mora no `config.configuracoesGlobais` do passo "Configurações do bot" --
 * o mesmo bloco que o editor de origem já usa para `welcomeMessage`,
 * `notResponseMessage` e companhia. Reaproveitar esse lugar mantém tudo que é
 * do fluxo inteiro num ponto só, em vez de espalhar por passos.
 */
function globaisDoFluxo(fluxo) {
  for (const passo of fluxo?.passos || []) {
    const cfg = passo.config?.configuracoesGlobais;
    if (cfg && typeof cfg === "object") return cfg;
  }
  return {};
}

/**
 * OS DOIS RELÓGIOS DO FLUXO -- deliberadamente separados.
 *
 * `semResposta`   : o bot perguntou e o cliente sumiu (5 min).
 * `filaPendentes` : ninguém assumiu a conversa na fila (10 min).
 *
 * Confundir os dois daria o comportamento errado nos dois casos: quem espera
 * atendimento receberia "não entendemos sua demanda", e quem abandonou uma
 * pergunta receberia "estamos com demanda alta".
 *
 * COMPATIBILIDADE: fluxos exportados do editor de origem trazem
 * `notResponseMessage {time, message, type}`, que é o mesmo conceito de
 * `semResposta`. Ele continua sendo lido, mas o bloco novo VENCE quando existe
 * -- assim quem já tinha o antigo não perde nada e quem configurar o novo manda.
 */
function paramsTempos(fluxo) {
  const g = globaisDoFluxo(fluxo);
  const p = PADROES;

  // Legado: {time: minutos, message, type} -- type 3 = encerrar.
  const legado = g.notResponseMessage || {};
  const legadoMin = Number(legado.time);
  const temLegado = Number.isFinite(legadoMin) && legadoMin > 0;

  const sr = g.semResposta || {};
  const fp = g.filaPendentes || {};

  return {
    semResposta: {
      minutos: inteiro(
        sr.minutos,
        temLegado ? Math.round(legadoMin) : p.semResposta.minutos,
        1,
        24 * 60
      ),
      mensagem: texto(
        sr.mensagem,
        temLegado && typeof legado.message === "string" && legado.message.trim()
          ? legado.message.trim()
          : p.semResposta.mensagem
      ),
      acao:
        sr.acao === "fila" || sr.acao === "encerrar"
          ? sr.acao
          : temLegado && Number(legado.type) !== 3
            ? "fila"
            : p.semResposta.acao,
    },
    filaPendentes: {
      // `ativo: false` desliga o aviso sem apagar o texto configurado.
      ativo: fp.ativo !== false,
      minutos: inteiro(fp.minutos, p.filaPendentes.minutos, 1, 24 * 60),
      mensagem: texto(fp.mensagem, p.filaPendentes.mensagem),
      repetir: booleano(fp.repetir, p.filaPendentes.repetir),
    },
    // Comandos globais ("atendente", "menu", "sair") podem furar uma etapa
    // obrigatória? Sai do fluxo, não do código -- ver o guard no motor.
    permitirComandosGlobais: booleano(g.permitirComandosGlobais, true),
  };
}

/**
 * Retrato legível de TODAS as automações que um fluxo executa.
 *
 * É o que alimenta o painel "Automações do BOT" no editor: em vez de descobrir
 * as regras lendo código, o operador abre o fluxo e vê a lista completa do que
 * o bot fará -- com o valor efetivo de cada parâmetro (o que ele digitou, ou o
 * padrão que está valendo).
 */
function resumoAutomacoes(fluxo) {
  if (!fluxo) return { ativo: false, itens: [] };
  const passos = fluxo.passos || [];
  const itens = [];

  const passoCnpj = passos.find((p) => p.tipo === "condicao");
  if (passoCnpj) {
    const cfg = paramsCnpj(passoCnpj);
    itens.push({
      grupo: "Identificação por CNPJ",
      passoId: passoCnpj.id,
      passoTitulo: passoCnpj.titulo,
      regras: [
        { rotulo: "Tentativas permitidas", valor: String(cfg.maxTentativas) },
        {
          rotulo: "Ao esgotar as tentativas",
          valor: cfg.aoEsgotarTentativas === "avulso" ? "Seguir como cliente avulso" : "Transferir para atendente",
        },
        { rotulo: "CNPJ inválido", valor: cfg.mensagemInvalido },
        { rotulo: "Última tentativa", valor: cfg.mensagemUltimaTentativa },
        { rotulo: "CNPJ válido, não cadastrado", valor: cfg.mensagemNaoCadastrado },
        { rotulo: "Resposta fora do esperado", valor: cfg.mensagemRespostaInvalida },
        { rotulo: "Confirmar CNPJ anterior", valor: cfg.memoria ? "Ligado" : "Desligado" },
      ],
    });
  }

  const passoAval = passos.find((p) => p.tipo === "avaliacao");
  if (passoAval) {
    const cfg = paramsAvaliacao(passoAval);
    itens.push({
      grupo: "Pesquisa de satisfação",
      passoId: passoAval.id,
      passoTitulo: passoAval.titulo,
      regras: [
        { rotulo: "Pergunta da nota", valor: cfg.mensagemNota },
        { rotulo: "Pede comentário", valor: cfg.pedirComentario ? "Sim" : "Não" },
        { rotulo: "Nota fora de 1 a 5", valor: cfg.mensagemNotaInvalida },
        { rotulo: "Tentativas de nota", valor: String(cfg.maxTentativas) },
        { rotulo: "Espera pela resposta", valor: `${cfg.timeoutMin} min` },
        { rotulo: "Sem resposta no prazo", valor: cfg.mensagemTimeout },
        { rotulo: "Agradecimento", valor: cfg.mensagemAgradecimento },
      ],
    });
  }

  // Os dois relógios do fluxo, cada um no seu grupo -- é a leitura que evita
  // confundi-los ao configurar.
  const passoGlobais = passos.find((p) => p.config?.configuracoesGlobais);
  if (passoGlobais) {
    const t = paramsTempos(fluxo);
    itens.push({
      grupo: "Cliente não responde ao bot",
      passoId: passoGlobais.id,
      passoTitulo: passoGlobais.titulo,
      regras: [
        { rotulo: "Esperar a resposta por", valor: `${t.semResposta.minutos} min` },
        { rotulo: "Mensagem", valor: t.semResposta.mensagem },
        {
          rotulo: "Depois disso",
          valor: t.semResposta.acao === "fila" ? "Devolver para a fila" : "Encerrar o atendimento",
        },
        {
          rotulo: "Comandos globais podem pular etapa",
          valor: t.permitirComandosGlobais ? "Sim" : "Não",
        },
      ],
    });
    itens.push({
      grupo: "Espera na fila de Pendentes",
      passoId: passoGlobais.id + ":fila",
      passoTitulo: passoGlobais.titulo,
      regras: t.filaPendentes.ativo
        ? [
            { rotulo: "Avisar após", valor: `${t.filaPendentes.minutos} min na fila` },
            { rotulo: "Mensagem", valor: t.filaPendentes.mensagem },
            { rotulo: "Repetir o aviso", valor: t.filaPendentes.repetir ? "Sim" : "Não (uma vez por atendimento)" },
          ]
        : [{ rotulo: "Aviso de espera", valor: "Desligado" }],
    });
  }

  return { ativo: !!fluxo.ativo, nome: fluxo.nome, gatilho: fluxo.gatilho, itens };
}

module.exports = { PADROES, paramsCnpj, paramsAvaliacao, paramsTempos, resumoAutomacoes };
