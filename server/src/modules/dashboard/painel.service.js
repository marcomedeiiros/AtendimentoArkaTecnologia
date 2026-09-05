/**
 * PAINEL DE PAREDE -- os numeros que a equipe ve o dia inteiro.
 *
 * ── POR QUE ESTE ARQUIVO NAO CHAMA O HELP DESK ──────────────────────────────
 *
 * O `helpdesk.service` ja calcula SLA, CSAT e backlog. Reaproveita-lo seria o
 * primeiro instinto -- e seria caro: ele carrega TODAS as conversas com TODAS
 * as mensagens para medir o tempo ate a primeira resposta pelo carimbo de cada
 * mensagem. Medido em producao em 01/09/2026: 2,6 s e 87 MB por chamada.
 *
 * Uma TV recarrega sozinha a cada 30 segundos, para sempre. Pagar 87 MB a cada
 * meio minuto numa VM de 1,6 GB de RAM nao e uma opcao.
 *
 * Entao este servico mede pela tabela `atendimentos`, que e pequena e indexada,
 * e NAO abre mensagem nenhuma. A consequencia e honesta e esta nos rotulos:
 *
 *     helpdesk  "1a resposta"     = ate a primeira MENSAGEM da equipe
 *     painel    "tempo ate assumir" = ate alguem CLICAR em atender (atendidoEm)
 *
 * Sao duas perguntas diferentes, e por isso tem dois nomes diferentes. Chamar
 * as duas de "primeira resposta" criaria duas telas com o mesmo rotulo e
 * numeros que nunca batem -- o jeito mais rapido de a equipe parar de confiar
 * nas duas.
 */
const prisma = require("../../infrastructure/database/prisma.client");
const equipeService = require("../equipe/equipe.service");
const configuracaoService = require("../configuracoes/configuracao.service");
const { podeAcessarSetor } = require("../../shared/helpers/setor.helper");
const { ehAtendenteReal } = require("../../shared/helpers/atendimentoSintetico.helper");
const logger = require("../../config/logger");

// Quantos tecnicos entram no ranking. Tres cabe na tela e ainda e disputavel:
// com dez, quem esta em setimo nao olha mais.
const TOP = 3;

// Minimo de notas para entrar no ranking por avaliacao. Sem isto, quem recebeu
// UMA nota 5 lidera para sempre e o ranking vira sorteio -- desmotiva mais do
// que motiva, que e o oposto do que esta tela existe para fazer.
const MINIMO_AVALIACOES = 3;

// ── A PONTUACAO DO DESTAQUE DO MES ─────────────────────────────────────────
//
// Este arquivo passou a vida RECUSANDO uma pontuacao unica, e o motivo estava
// escrito aqui: juntar volume e nota obriga a inventar um peso ("cada estrela
// vale quantos atendimentos?"), e o peso escolhido decide o vencedor. Ninguem
// explica o proprio lugar num ranking assim, e ranking que nao se explica gera
// desconfianca em vez de disputa.
//
// A objecao continua valida -- o que mudou foi a resposta a ela. O peso nao e
// mais escondido dentro de um numero: as TRES PARCELAS saem daqui separadas, e
// a parede mostra "38 + 39 + 15 = 92". Quem discorda do peso discorda de uma
// conta visivel, e nao de um oraculo. Foi essa visibilidade que tornou o card
// unico defensavel; sem ela, a recusa antiga continuaria certa.
//
// Cada atendimento fechado vale 1 ponto, entao a nota precisa de um peso para
// nao virar ruido ao lado de dezenas de atendimentos: com 8, um mes impecavel
// (5,0) vale 40 pontos -- o equivalente a 40 atendimentos. E deliberado que
// atender bem pese tanto quanto atender muito.
const PESO_NOTA = 8;

// Agilidade em FAIXAS, e nao proporcional ao tempo.
//
// Proporcional premiaria cada segundo economizado, e numa parede isso vira
// pressa: vale a pena assumir a conversa so para parar o relogio, mesmo sem
// poder atender. Faixa larga premia o habito ("assumo rapido") e para de
// premiar depois -- entre 30 s e 90 s nao ha vantagem a perseguir.
const FAIXAS_AGILIDADE = [
  { ateSeg: 120, pontos: 20 },
  { ateSeg: 300, pontos: 15 },
  { ateSeg: 600, pontos: 10 },
  { ateSeg: 1200, pontos: 5 },
];

function pontosDeAgilidade(medioSeg) {
  if (medioSeg == null) return 0;
  return FAIXAS_AGILIDADE.find((f) => medioSeg <= f.ateSeg)?.pontos || 0;
}

const inicioDoDia = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const inicioDoMes = () => {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
};

const media = (lista) => (lista.length ? lista.reduce((a, b) => a + b, 0) / lista.length : 0);

/**
 * O MARCO DE ZERAMENTO DO PAINEL -- "Limpar dados do painel da equipe".
 *
 * ── O QUE ELE FAZ, E O QUE ELE DELIBERADAMENTE NAO FAZ ─────────────────────
 *
 * Ele NAO apaga atendimento nenhum. Guarda um INSTANTE, e o painel passa a
 * contar dali para a frente -- na tela o efeito e o pedido: classificacao,
 * destaque, CSAT, tempos e "fechados hoje" voltam a zero.
 *
 * Apagar as linhas de verdade era a leitura literal do pedido, e o preco seria
 * pago em telas que ninguem mencionou:
 *
 *   Relatorios Clientes (CNPJ)  le as MESMAS OS. O relatorio de agosto de um
 *                               cliente voltaria vazio -- e ele ja recebeu o
 *                               documento com os numeros antigos.
 *   Avaliacoes / Registro /     mesma origem. O historico de CSAT do ano
 *   Help Desk                   sumiria junto com o ranking do mes.
 *   O fio da conversa           a mensagem sobrevive (`onDelete: SetNull`),
 *                               mas perde o carimbo da OS: o historico deixa
 *                               de se separar por atendimento na Central.
 *   O numero da OS              #OS00062 ja foi dito ao cliente e nao teria
 *                               mais registro do outro lado.
 *
 * Nada disso e recuperavel depois. O marco entrega o resultado visivel que foi
 * pedido e pode ser desfeito com um clique -- que e o que um botao vermelho
 * numa tela de gestao precisa ter.
 *
 * Guardado na tabela de configuracao por acesso direto, e nao pelo
 * `configuracaoService`: aquele so grava chaves da tela de Configuracoes
 * (allowlist em DEFINICOES) e mantem cache -- isto aqui nao e um ajuste que
 * alguem edita num formulario.
 */
// UM MARCO POR RANKING. Limpar a sede nao pode zerar as visitas, e vice-versa:
// sao equipes diferentes, medidas por criterios diferentes.
const CHAVE_ZERAGEM = { sede: "painel.zeradoEm.sede", externo: "painel.zeradoEm.externo" };
// A chave da PRIMEIRA versao, quando havia um marco so. Quem ja tinha clicado
// em limpar antes desta mudanca continua com o painel zerado -- em vez de o
// valor virar orfao e a limpeza se desfazer sozinha num deploy.
const CHAVE_ZERAGEM_ANTIGA = "painel.zeradoEm";

async function marcoDeZeragem(qual = "sede") {
  const chaves = qual === "sede" ? [CHAVE_ZERAGEM.sede, CHAVE_ZERAGEM_ANTIGA] : [CHAVE_ZERAGEM[qual]];
  const linhas = await prisma.configuracao.findMany({ where: { chave: { in: chaves.filter(Boolean) } } });
  // Havendo os dois, vale o mais RECENTE: a chave nova e a decisao mais atual.
  let marco = null;
  for (const l of linhas) {
    if (!l?.valor) continue;
    const d = new Date(l.valor);
    // Data invalida guardada nao pode esconder o painel inteiro: sem isto, um
    // valor corrompido viraria `Invalid Date` e toda comparacao daria falso de
    // um jeito dificil de diagnosticar.
    if (Number.isNaN(d.getTime())) continue;
    if (!marco || d > marco) marco = d;
  }
  return marco;
}

// O comeco da janela: o mais RECENTE entre o periodo natural e o zeramento.
const maisRecente = (a, b) => (b && b > a ? b : a);

/**
 * O piso de um MES especifico, dado o marco de zeramento.
 *
 * ── O DEFEITO QUE ISTO IMPEDE ──────────────────────────────────────────────
 *
 * "Limpar" significa RECOMECAR A CONTAR, e nao apagar o passado. Aplicando o
 * marco cru a qualquer mes, um mes inteiramente ANTERIOR a limpeza passaria a
 * ter piso no futuro dele proprio -- e apareceria zerado. Julho sumiria porque
 * alguem limpou em setembro, e a premiacao de julho ficaria apontando para um
 * ranking que a tela nao consegue mais mostrar.
 *
 * Entao o marco so vale para o mes que o CONTEM e para os seguintes. Meses
 * fechados antes dele ficam como estavam.
 */
function pisoDoMes(inicio, fim, marco) {
  if (!marco || marco >= fim) return inicio;
  return maisRecente(inicio, marco);
}

class PainelService {
  /**
   * @param {string|null} acesso cargo de quem pediu. A FILA e recortada por
   *   ele; os agregados (ranking, CSAT, tempos, meta) sao da equipe inteira,
   *   que e o proposito da tela.
   */
  async obter(acesso = null) {
    const zerado = await marcoDeZeragem();
    // O zeramento recorta as DUAS janelas. Recortar so a do mes deixaria
    // "fechados hoje" contando atendimentos anteriores a limpeza -- um numero
    // sobrevivente no meio de um painel zerado, que parece defeito.
    const desdeMes = maisRecente(inicioDoMes(), zerado);
    const desdeHoje = maisRecente(inicioDoDia(), zerado);

    const [doMes, fechadosHoje, fila, equipe, meta, carga] = await Promise.all([
      // So o que o ranking e os tempos precisam. Sem `include`: mensagem
      // nenhuma entra nesta consulta.
      prisma.atendimento.findMany({
        where: { abertoEm: { gte: desdeMes } },
        select: {
          atendenteId: true,
          atendenteNome: true,
          status: true,
          avaliacao: true,
          abertoEm: true,
          atendidoEm: true,
          fechadoEm: true,
        },
      }),
      prisma.atendimento.count({ where: { status: "fechada", fechadoEm: { gte: desdeHoje } } }),
      prisma.conversa.findMany({
        where: { statusAtendimento: "pendente", arquivada: false, oculta: false },
        select: {
          id: true,
          cliente: true,
          empresa: true,
          // `telefone` saiu do select junto com o campo do payload: o banco nao
          // precisa ler o que ninguem vai mandar nem desenhar.
          setor: true,
          numeroTicket: true,
          criadoEm: true,
          atualizadoEm: true,
        },
        orderBy: { atualizadoEm: "asc" },
      }),
      equipeService.listar(),
      configuracaoService.metaDiariaPainel(),
      // Carga de cada atendente: conversas ABERTAS por responsavel. Um
      // `groupBy` resolve; carregar as conversas para contar em memoria seria o
      // mesmo erro que custou 87 MB na listagem da Central.
      prisma.conversa.groupBy({
        by: ["atendenteId"],
        where: { statusAtendimento: "aberta", atendenteId: { not: null } },
        _count: { _all: true },
      }),
    ]);

    return {
      geradoEm: new Date().toISOString(),
      // O ROTULO MUDA quando o painel foi zerado. Continuar dizendo "mes
      // corrente" com os numeros comecando no meio do mes faria a tela mentir
      // -- e quem olha a parede nao tem como saber que houve uma limpeza.
      periodo: {
        desde: desdeMes.toISOString(),
        rotulo: zerado ? "desde a limpeza" : "mês corrente",
        zeradoEm: zerado ? zerado.toISOString() : null,
      },
      ranking: this._ranking(doMes),
      csat: this._csat(doMes),
      tempos: this._tempos(doMes),
      hoje: { fechados: fechadosHoje, meta },
      equipe: this._equipe(equipe, carga),
      fila: this._fila(fila, acesso),
    };
  }

  /**
   * O DESTAQUE DO MES -- uma classificacao, com a conta a vista.
   *
   * Aqui havia DOIS podios (mais atendimentos / melhores notas) justamente para
   * nao arbitrar um peso entre eles. Viraram um so a pedido de quem usa a
   * parede, e a troca so e honesta por causa de uma condicao: as parcelas saem
   * daqui SEPARADAS, e a tela mostra a soma. Ver o bloco de constantes acima.
   *
   * O que cada pessoa junta no mes:
   *
   *   atendimentos fechados      1 ponto cada
   *   nota media x PESO_NOTA     so a partir de MINIMO_AVALIACOES notas
   *   agilidade (ate assumir)    faixa fixa, ver FAIXAS_AGILIDADE
   *
   * O MINIMO DE AVALIACOES SOBREVIVEU A UNIFICACAO, e isso importa: sem ele,
   * uma unica nota 5 valeria 40 pontos -- mais do que um mes inteiro de
   * atendimento de muita gente -- e o ranking voltaria a ser sorteio. Quem
   * ainda nao tem tres notas pontua ZERO nessa parcela, e a tela diz que esta
   * faltando (ver `aCaminho`), em vez de fingir que a pessoa e ruim de nota.
   */
  _ranking(atendimentos, { limite = TOP, incluirZerados = false } = {}) {
    const porPessoa = new Map();
    for (const a of atendimentos) {
      // SO GENTE ENTRA NO RANKING DE GENTE.
      //
      // Duas coisas ocupam este campo sem serem uma pessoa:
      //   vazio                     -> o bot resolveu sozinho;
      //   "Histórico do WhatsApp"   -> a OS sintetica que recebe o historico
      //                                importado do celular (ver o helper).
      //
      // O segundo caso passou meses despercebido porque so aparece quando
      // alguem importa historico: o rotulo virava um "atendente" com um
      // atendimento fechado e um ponto, e subia na lista junto com a equipe.
      const nome = a.atendenteNome || null;
      if (!ehAtendenteReal(nome)) continue;
      if (!porPessoa.has(nome)) porPessoa.set(nome, { nome, fechados: 0, notas: [], assumir: [] });
      const p = porPessoa.get(nome);
      if (a.status === "fechada") p.fechados += 1;
      if (typeof a.avaliacao === "number") p.notas.push(a.avaliacao);
      // O MESMO "tempo ate assumir" do indicador da faixa de baixo, so que por
      // pessoa. E ate o CLIQUE em atender (`atendidoEm`), e nao ate a primeira
      // mensagem: medir a primeira mensagem exige abrir todas as mensagens de
      // todas as conversas -- 2,6 s e 87 MB por chamada, numa tela que recarrega
      // a cada 30 segundos. Ver o cabecalho deste arquivo.
      if (a.atendidoEm) p.assumir.push((new Date(a.atendidoEm) - new Date(a.abertoEm)) / 1000);
    }

    const pessoas = [...porPessoa.values()];

    const pontuadas = pessoas.map((p) => {
      const notaMedia = p.notas.length ? media(p.notas) : null;
      const notaConta = p.notas.length >= MINIMO_AVALIACOES;
      const assumirMedio = p.assumir.length ? Math.round(media(p.assumir)) : null;

      const ptsAtendimentos = p.fechados;
      const ptsNota = notaConta ? Math.round(notaMedia * PESO_NOTA) : 0;
      const ptsAgilidade = pontosDeAgilidade(assumirMedio);

      return {
        nome: p.nome,
        pontos: ptsAtendimentos + ptsNota + ptsAgilidade,
        atendimentos: { valor: p.fechados, pontos: ptsAtendimentos },
        // `conta` e o que a tela usa para escrever "1 de 3" em vez de "0,0".
        nota: { valor: notaMedia, amostra: p.notas.length, conta: notaConta, pontos: ptsNota },
        agilidade: { medioSeg: assumirMedio, amostra: p.assumir.length, pontos: ptsAgilidade },
      };
    });

    // Zero ponto nao entra: e quem so tem conversa em aberto, e uma linha
    // "0 pts" na parede parece cobranca publica. Ha podio, e nao lanterna.
    const classificacao = pontuadas
      // Na PAREDE, zero ponto nao entra: e quem so tem conversa em aberto, e uma
      // linha "0 pts" exposta na sala parece cobranca publica. Na Visao Geral
      // (`incluirZerados`) entra, porque ali a pergunta e outra -- "como esta o
      // time inteiro" -- e uma lista que esconde parte do time nao responde.
      .filter((p) => incluirZerados || p.pontos > 0)
      .sort(
        (a, b) =>
          b.pontos - a.pontos ||
          b.atendimentos.valor - a.atendimentos.valor ||
          a.nome.localeCompare(b.nome)
      )
      .slice(0, limite)
      .map((p, i) => ({ posicao: i + 1, ...p }));

    // QUEM ESTA A CAMINHO -- so os nomes, nunca a nota.
    //
    // O minimo de avaliacoes protege o ranking, mas cobra um preco no comeco:
    // ate alguem juntar tres notas essa parcela fica zerada para todo mundo, e
    // a tela nao explicaria por que. Uma operacao recem-comecada fica dias
    // assim -- justo os dias em que a equipe esta olhando mais.
    //
    // A NOTA DE QUEM AINDA NAO ENTROU NAO SAI DAQUI. Mandar a media de quem tem
    // uma avaliacao so seria o mesmo que abolir o minimo: a parede mostraria o
    // numero, e o numero e o que a equipe compara. Vai a CONTAGEM, e mais nada.
    const aCaminho = pessoas
      .filter((p) => p.notas.length > 0 && p.notas.length < MINIMO_AVALIACOES)
      .map((p) => ({ nome: p.nome, amostra: p.notas.length }))
      .sort((a, b) => b.amostra - a.amostra || a.nome.localeCompare(b.nome))
      .slice(0, TOP);

    return {
      classificacao,
      aCaminho,
      minimoAvaliacoes: MINIMO_AVALIACOES,
      pesos: { nota: PESO_NOTA, agilidade: FAIXAS_AGILIDADE },
    };
  }

  /**
   * RANKING DO TIME para a Visao Geral -- a lista inteira, com o ultimo
   * atendimento de cada um.
   *
   * ── POR QUE A MESMA PONTUACAO DA PAREDE ────────────────────────────────────
   *
   * Este ranking e o da TV usam `_ranking`, a MESMA funcao. Nao e economia de
   * codigo: e a unica forma de as duas telas nao discordarem sobre quem esta em
   * primeiro. Duas contas parecidas, escritas em lugares diferentes, divergem
   * no dia em que alguem ajusta uma delas -- e ai a equipe ve medalha de ouro
   * para uma pessoa na parede e para outra no painel, no mesmo minuto.
   *
   * Duas coisas mudam, e so essas: entra TODO MUNDO (a parede corta no top 3,
   * que e o que cabe de longe) e vem junto o ULTIMO ATENDIMENTO de cada um.
   *
   * ── O ULTIMO ATENDIMENTO NAO E DO MES ──────────────────────────────────────
   *
   * A pontuacao e do mes corrente; o "ultimo atendimento" e o mais recente que
   * existir, de qualquer data. Sao perguntas diferentes: a primeira e "como foi
   * este mes", a segunda e "quando esta pessoa atendeu pela ultima vez" -- e a
   * segunda so e util justamente quando a resposta e antiga.
   *
   * Uma consulta por pessoa (o time tem dezenas, nao milhares), em vez de
   * arrastar o historico inteiro para achar um maximo por nome.
   */
  async rankingEquipe() {
    // O MESMO recorte da parede: as duas telas mostram a mesma classificacao, e
    // uma limpeza que valesse so numa delas seria pior do que nao existir.
    const zerado = await marcoDeZeragem();
    const desdeMes = maisRecente(inicioDoMes(), zerado);

    const doMes = await prisma.atendimento.findMany({
      where: { abertoEm: { gte: desdeMes } },
      select: {
        atendenteNome: true,
        status: true,
        avaliacao: true,
        abertoEm: true,
        atendidoEm: true,
        fechadoEm: true,
      },
    });

    const { classificacao, minimoAvaliacoes, pesos } = this._ranking(doMes, {
      limite: Number.MAX_SAFE_INTEGER,
      incluirZerados: true,
    });

    const comUltimo = await Promise.all(
      classificacao.map(async (p) => ({ ...p, ultimo: await this._ultimoAtendimento(p.nome) }))
    );

    return {
      geradoEm: new Date().toISOString(),
      // O ROTULO MUDA quando o painel foi zerado. Continuar dizendo "mes
      // corrente" com os numeros comecando no meio do mes faria a tela mentir
      // -- e quem olha a parede nao tem como saber que houve uma limpeza.
      periodo: {
        desde: desdeMes.toISOString(),
        rotulo: zerado ? "desde a limpeza" : "mês corrente",
        zeradoEm: zerado ? zerado.toISOString() : null,
      },
      classificacao: comUltimo,
      minimoAvaliacoes,
      pesos,
    };
  }

  /**
   * O atendimento mais recente de uma pessoa, com a empresa atendida.
   *
   * Ordena por `atualizadoEm`, e nao por `fechadoEm`: quem esta com uma OS
   * ABERTA agora nao tem data de fechamento, e ordenar por um campo nulo joga
   * essas linhas para uma ponta qualquer da lista conforme o banco -- o
   * "ultimo atendimento" apareceria como um de semanas atras justamente para
   * quem esta atendendo neste instante.
   *
   * A empresa vem da CONVERSA porque e la que o CNPJ mora. Consequencia
   * assumida (a mesma dos relatorios por cliente): se o vinculo mudar depois, o
   * que esta linha mostra muda junto.
   */
  /**
   * A MESMA PONTUACAO, PARA UM MES QUALQUER.
   *
   * Existe para o Ranking de Atendimento na Sede (modulo `rankings`) poder
   * fechar setembro em outubro sem reimplementar conta nenhuma: a lista vai
   * inteira para `_ranking`, que e a MESMA funcao do painel de parede e da
   * Visao Geral. Se a formula mudar um dia, muda para as tres telas juntas --
   * que e o unico jeito de elas nunca discordarem sobre quem esta em primeiro.
   *
   * ── O ZERAMENTO DO PAINEL NAO ENTRA AQUI, E ISSO E DELIBERADO ──────────────
   *
   * "Limpar dados do painel da equipe" existe para dar um recomeco visivel na
   * parede. Aplicar esse corte tambem aqui apagaria meses fechados do historico
   * -- inclusive os que ja renderam premio -- e o registro de premiacao ficaria
   * apontando para um ranking que a tela nao consegue mais mostrar.
   *
   * @param {number} ano
   * @param {number} mes 1-12
   */
  async rankingDoMes(ano, mes) {
    const inicio = new Date(ano, mes - 1, 1, 0, 0, 0, 0);
    const fim = new Date(ano, mes, 1, 0, 0, 0, 0);
    // A limpeza da SEDE vale aqui tambem -- era o pedido: "limpar dados de
    // atendimento na sede". O `pisoDoMes` garante que ela recomeca a contagem
    // sem apagar meses ja fechados (ver a nota la).
    const desde = pisoDoMes(inicio, fim, await marcoDeZeragem("sede"));

    const doMes = await prisma.atendimento.findMany({
      where: { abertoEm: { gte: desde, lt: fim } },
      select: {
        atendenteNome: true,
        status: true,
        avaliacao: true,
        abertoEm: true,
        atendidoEm: true,
        fechadoEm: true,
      },
    });

    // Todo mundo, sem corte: quem filtra por equipe e o modulo de rankings, e
    // cortar no top 3 aqui esconderia justamente o terceiro colocado de uma
    // equipe de tres pessoas.
    return {
      periodo: { inicio: inicio.toISOString(), fim: fim.toISOString() },
      ...this._ranking(doMes, { limite: Number.MAX_SAFE_INTEGER, incluirZerados: true }),
    };
  }

  // Publicados para o modulo de rankings usar EXATAMENTE a mesma regra de piso
  // que a parede usa -- reimplementar "so vale do mes do marco em diante" do
  // outro lado seria a segunda copia de uma regra sutil.
  pisoDoMes(inicio, fim, marco) {
    return pisoDoMes(inicio, fim, marco);
  }

  marcoDe(qual) {
    return marcoDeZeragem(qual);
  }

  /** Os marcos ativos, para a tela dizer o que esta zerado e desde quando. */
  async marcosDeZeragem() {
    const [sede, externo] = await Promise.all([marcoDeZeragem("sede"), marcoDeZeragem("externo")]);
    return {
      sede: sede ? sede.toISOString() : null,
      externo: externo ? externo.toISOString() : null,
    };
  }

  /**
   * "Limpar dados de atendimento na sede" / "... fora da sede".
   *
   * Zera a contagem DAQUELE ranking a partir de agora -- e, no caso da sede, o
   * painel de parede junto, porque e a mesma equipe e os mesmos numeros.
   * Nenhum atendimento nem mapeamento e apagado: ver a nota em `marcoDeZeragem`
   * e em `pisoDoMes`, que e quem impede a limpeza de comer meses ja fechados.
   */
  async limparPainel(qual = "sede", autor = null) {
    const chave = CHAVE_ZERAGEM[qual];
    if (!chave) throw new Error(`Ranking desconhecido para limpeza: ${qual}`);
    const valor = new Date().toISOString();
    await prisma.configuracao.upsert({
      where: { chave },
      update: { valor },
      create: { chave, valor },
    });
    // Fica no log com AUTORIA: e uma acao que muda o que a equipe inteira ve, e
    // "os numeros sumiram" sem rastro de quem e quando e uma manha perdida
    // procurando defeito onde houve decisao.
    logger.warn("Ranking zerado", {
      ranking: qual,
      zeradoEm: valor,
      por: autor?.nome || autor?.email || autor?.sub || "desconhecido",
    });
    return { ranking: qual, zeradoEm: valor };
  }

  /**
   * Desfaz a limpeza. So e possivel porque nada foi apagado -- e a razao de o
   * marco existir em vez de um DELETE.
   *
   * Na sede apaga TAMBEM a chave antiga (`painel.zeradoEm`, de quando havia um
   * marco unico). Sem isso, quem limpou antes desta mudanca clicaria em
   * restaurar e continuaria com o painel vazio, sem nada na tela explicando por
   * que -- o valor velho seguiria mandando.
   */
  async restaurarPainel(qual = "sede", autor = null) {
    const chaves = qual === "sede" ? [CHAVE_ZERAGEM.sede, CHAVE_ZERAGEM_ANTIGA] : [CHAVE_ZERAGEM[qual]];
    await prisma.configuracao.deleteMany({ where: { chave: { in: chaves.filter(Boolean) } } });
    logger.warn("Ranking restaurado", {
      ranking: qual,
      por: autor?.nome || autor?.email || autor?.sub || "desconhecido",
    });
    return { ranking: qual, zeradoEm: null };
  }

  async _ultimoAtendimento(nome) {
    const a = await prisma.atendimento.findFirst({
      where: { atendenteNome: nome },
      orderBy: { atualizadoEm: "desc" },
      select: {
        numeroOS: true,
        status: true,
        setor: true,
        abertoEm: true,
        atendidoEm: true,
        fechadoEm: true,
        conversa: { select: { cliente: true, empresa: true } },
      },
    });
    if (!a) return null;

    const encerrado = a.status === "fechada" && !!a.fechadoEm;
    return {
      os: a.numeroOS != null ? `OS${String(a.numeroOS).padStart(5, "0")}` : null,
      status: a.status,
      setor: a.setor || null,
      encerrado,
      // A data que a tela mostra: quando fechou, se fechou; senao quando
      // assumiu; e, sem nem isso, quando o chamado abriu. Vai junto o
      // `encerrado` para a tela poder escrever "fechado em" ou "aberto desde"
      // em vez de uma data solta que nao diz o que aconteceu.
      quando: (a.fechadoEm || a.atendidoEm || a.abertoEm)?.toISOString() || null,
      cliente: a.conversa?.cliente || null,
      empresa: a.conversa?.empresa || null,
    };
  }

  _csat(atendimentos) {
    const notas = atendimentos.filter((a) => typeof a.avaliacao === "number").map((a) => a.avaliacao);
    // O TOTAL vai junto da media, sempre. "4,8" com tres respostas e uma
    // afirmacao muito mais fraca do que "4,8" com duzentas, e quem le a tela
    // precisa conseguir distinguir as duas sem perguntar a ninguem.
    return { media: notas.length ? media(notas) : null, total: notas.length };
  }

  _tempos(atendimentos) {
    const ateAssumir = [];
    const ateResolver = [];
    for (const a of atendimentos) {
      if (a.atendidoEm) ateAssumir.push((new Date(a.atendidoEm) - new Date(a.abertoEm)) / 1000);
      if (a.fechadoEm) ateResolver.push((new Date(a.fechadoEm) - new Date(a.abertoEm)) / 1000);
    }
    return {
      assumirMedioSeg: Math.round(media(ateAssumir)),
      assumirAmostra: ateAssumir.length,
      resolverMedioSeg: Math.round(media(ateResolver)),
      resolverAmostra: ateResolver.length,
    };
  }

  /**
   * Quem esta online agora e quantas conversas cada um carrega.
   *
   * A carga sao as conversas ABERTAS (alguem assumiu), e nao a fila: fila e de
   * ninguem, e somar a fila na carga de todo mundo faria a tela sugerir que a
   * equipe esta afogada quando o que falta e alguem clicar em atender.
   *
   * Quem esta offline nao aparece. Este painel fica numa TV o dia inteiro, e
   * uma lista com quem nao esta trabalhando vira placar de ausencia -- o
   * contrario do que a tela se propoe a fazer.
   */
  _equipe(equipe, carga) {
    const porId = new Map(carga.map((c) => [c.atendenteId, c._count._all]));
    return equipe
      .filter((m) => m.status === "online")
      .map((m) => ({ id: m.id, nome: m.nome, cargo: m.cargo, abertas: porId.get(m.id) || 0 }))
      .sort((a, b) => b.abertas - a.abertas || a.nome.localeCompare(b.nome));
  }

  /**
   * A FILA RESPEITA O SETOR DE QUEM ESTA VENDO.
   *
   * Escrito sem isto, este metodo devolvia a fila inteira -- e o
   * `verificar-escopo-dados` reprovou na hora, dizendo exatamente o que tinha
   * acontecido: "GET /api/dashboard/painel -> VAZOU Tecnico/pendente,
   * Financeiro/pendente, Geral/pendente". Um atendente do Financeiro passaria a
   * ler, numa TV, o nome e a empresa dos clientes do Tecnico.
   *
   * Os NUMEROS agregados continuam da equipe toda: media da casa, ranking da
   * casa, meta da casa. Nenhum deles identifica um cliente, e recortar o
   * ranking por setor destruiria a tela -- ela existe justamente para a equipe
   * se ver como equipe.
   */
  _fila(conversas, acesso) {
    const agora = Date.now();
    const visiveis =
      !acesso || acesso.cargo === "Administrador"
        ? conversas
        : conversas.filter((c) => podeAcessarSetor(acesso, c.setor || "Geral"));
    return visiveis.map((c) => ({
      id: c.id,
      cliente: c.empresa || c.cliente,
      // O TELEFONE NAO VIAJA MAIS PARA A PAREDE.
      //
      // A TV nao o exibe desde que o cartao da fila passou a mostrar so o nome,
      // e este payload alimenta EXCLUSIVAMENTE o Modo TV. Dado que a tela nao
      // desenha nao precisa sair do servidor -- e este em particular e o
      // telefone de um cliente, numa tela que fica ligada num painel do
      // escritorio, a vista de qualquer pessoa que passe (visitante incluido).
      setor: c.setor || "Geral",
      ticket: c.numeroTicket,
      // Espera contada a partir da ULTIMA movimentacao, nao da criacao: a
      // conversa e um fio permanente por cliente, e `criadoEm` e de meses atras.
      esperaMin: Math.max(0, Math.round((agora - new Date(c.atualizadoEm)) / 60000)),
      // O INSTANTE, e nao so o numero de minutos.
      //
      // A TV recarrega a cada 30 s, mas o relogio dela bate a cada 20 s. Com
      // apenas `esperaMin`, uma fila parada mostraria "3 min" congelado ate a
      // proxima carga -- numa tela que existe para dar sensacao de tempo real,
      // um numero que nao anda parece tela travada. Com o instante, o navegador
      // recalcula sozinho entre uma atualizacao e outra.
      esperaDesde: new Date(c.atualizadoEm).toISOString(),
    }));
  }
}

module.exports = new PainelService();
