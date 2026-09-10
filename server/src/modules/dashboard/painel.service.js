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
const { nomesDaEquipe } = require("../../shared/helpers/equipeRanking.helper");
const sedeRegras = require("./sede.regras");
const ciclo = require("../rankings/ciclo");
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
// ── OS PESOS, E POR QUE ELES MUDARAM ───────────────────────────────────────
//
// Ate aqui era: 1 ponto por atendimento, nota x 8 (ate 40) e agilidade em
// faixas (ate 20). A justificativa escrita era que "40 pontos equivalem a 40
// atendimentos", e ela dependia de uma premissa que a operacao nao confirmou:
// que as pessoas fechassem dezenas de atendimentos por mes. Fecham de 2 a 8.
//
// Com esse volume real, o peso virava outra coisa: qualidade valia ~87% da
// nota final e volume ~13%. Um mes de 8 atendimentos com nota 5,0 perdia para
// um de 3 atendimentos com nota 5,0 -- porque os 5 atendimentos a mais valiam 5
// pontos, e um degrau de agilidade valia 20. O ranking premiava atender POUCO e
// bem, que nao e o que a equipe faz nem o que a empresa quer.
//
// Daquele ajuste saiu um indice de 0 a 100 com as tres parcelas comparaveis
// entre si -- atendimentos ate 35, nota media ate 35, agilidade ate 30. ESSE
// DESENHO NAO VALE MAIS: ver o bloco seguinte. O historico fica porque explica
// por que as tres parcelas existem, e por que elas continuam separadas na tela.
//
// A conta continua VISIVEL parcela a parcela -- que sempre foi a condicao para
// um numero unico ser defensavel. Quem discorda do peso discorda de uma conta a
// vista, e nao de um oraculo.

// ── A PONTUACAO DEIXOU DE TER TETO ─────────────────────────────────────────
//
// Era um INDICE de 0 a 100: volume em faixas (ate 35), nota media x 7 (ate 35) e
// agilidade em faixas (ate 30). Ele respondia "quao bem voce trabalhou neste
// ciclo", e as tres parcelas eram comparaveis entre si porque somavam 100.
//
// O QUE ISSO CUSTAVA NA PRATICA, e foi o pedido: o numero PARAVA de se mexer. A
// escada de volume dava 24 pontos para 6 atendimentos E para 7 -- fechar o
// setimo nao movia nada, e o proximo salto era no oitavo. Com nota 5,0 (parcela
// cheia) e a equipe fazendo de 2 a 8 atendimentos por ciclo, tres pessoas
// ficaram em 84 pontos ao mesmo tempo e o placar congelou. Relatado em
// 10/09/2026 como "o ranking travado nos 84".
//
// AGORA CADA ATENDIMENTO SOMA, e a soma nao tem topo:
//
//   por atendimento avaliado      PONTOS_POR_ATENDIMENTO
//   por estrela recebida          PONTOS_POR_ESTRELA        (nota 5 -> +10)
//   por rapidez em assumir        BONUS_AGILIDADE (por atendimento)
//
// Um atendimento perfeito (nota 5, assumido em 2 minutos) vale 25. Seis deles,
// 150. O setimo passa a valer, e o vigesimo tambem.
//
// ── O QUE SE PERDE, DITO POR EXTENSO ───────────────────────────────────────
//
// A escada de faixas existia por uma razao boa, que continua valida: "ponto por
// unidade transforma o ultimo dia do ciclo em corrida -- fechar mais uma OS vale
// exatamente X, sempre, e ha como perseguir isso fechando conversa que ainda nao
// acabou". Essa porta REABRE aqui, e foi uma decisao consciente de quem manda na
// regra, nao um descuido.
//
// Duas coisas seguram o pior caso, e por isso nao foram tocadas:
//
//   1. so pontua atendimento FECHADO E AVALIADO pelo cliente. Fechar as pressas
//      sem o cliente avaliar nao rende ponto nenhum -- e correr atropelando o
//      cliente tende a nao render nota 5;
//   2. o MINIMO DE AVALIACOES continua valendo para a parcela da nota: com uma
//      ou duas notas ela fica zerada, e a tela diz "1 de 3" em vez de fingir.
//
// ── E O QUE ISSO FAZ COM O HISTORICO ───────────────────────────────────────
//
// Nada de ranking e guardado: o historico e recalculado a cada consulta. Trocar
// a formula REESCREVE todos os ciclos passados -- inclusive os ja premiados --, e
// a premiacao registrada pode passar a apontar para quem nao e mais o primeiro.
// Nao ha como evitar isso sem guardar o ranking fechado de cada ciclo, o que
// nunca existiu aqui. Fica registrado porque e consequencia, nao surpresa.
const PONTOS_POR_ATENDIMENTO = 10;
const PONTOS_POR_ESTRELA = 2;

/**
 * Bonus de rapidez POR ATENDIMENTO, e nao pela mediana do ciclo.
 *
 * A mediana nao acumula -- ela e propriedade do conjunto, e um numero que nao
 * cresce com o trabalho nao cabe numa pontuacao sem teto. Medindo atendimento
 * por atendimento, quem assume rapido dez vezes ganha dez vezes.
 *
 * Os limiares sao os mesmos de `FAIXAS_AGILIDADE` (a leitura de "rapido" nao
 * mudou); o que mudou e a escala, porque agora o valor e cobrado por unidade.
 */
const BONUS_AGILIDADE = [
  { ateSeg: 120, pontos: 5 },
  { ateSeg: 300, pontos: 4 },
  { ateSeg: 600, pontos: 3 },
  { ateSeg: 1200, pontos: 2 },
  { ateSeg: 2700, pontos: 1 },
];

function bonusDeAgilidade(segundos) {
  if (segundos == null) return 0;
  return BONUS_AGILIDADE.find((f) => segundos <= f.ateSeg)?.pontos || 0;
}

// A ESCADA DE VOLUME E `pontosDeVolume` FORAM REMOVIDAS.
//
// Elas existiam para dar pontos por FAIXA de volume, com teto -- e a faixa e
// exatamente o que fazia o placar parar de se mexer entre 6 e 8 atendimentos.
// Com a pontuacao sem teto, volume e `fechados x PONTOS_POR_ATENDIMENTO`, e
// nao ha degrau nem alvo a configurar.
//
// Removidas em vez de deixadas sem uso: funcao de pontuacao parada no arquivo
// e convite para alguem religar a regra antiga por engano -- foi o que
// aconteceu com `inicioDoMes` nesta mesma classe (ver `cicloCorrente`).
//
// A escada de faixas do ranking EXTERNO (`rankings/pontuacao.externa`) segue
// intacta: aquele ranking tem teto 100 de propósito, e nunca se soma a este.

// `FAIXAS_AGILIDADE` e `pontosDeAgilidade` FORAM REMOVIDAS junto com o teto.
//
// Elas davam pontos pela MEDIANA do ciclo, e mediana nao acumula -- ela e
// propriedade do conjunto e nao cresce com o trabalho. Quem substituiu foi
// `BONUS_AGILIDADE`, cobrado por atendimento.
//
// A razao de serem FAIXAS, e nao proporcional ao tempo, continua valendo e vale
// repetir aqui: proporcional premiaria cada segundo economizado, e numa parede
// isso vira pressa -- vale a pena assumir a conversa so para parar o relogio,
// mesmo sem poder atender. Faixa larga premia o habito ("assumo rapido") e para
// de premiar depois. `BONUS_AGILIDADE` manteve os mesmos limiares por isso.
//
// A mediana continua sendo CALCULADA (`assumirTipico`) e exibida como
// indicador: ela responde "quanto tempo tipicamente levo para assumir?", que e
// uma pergunta legitima. So nao pontua mais.

const inicioDoDia = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

/**
 * O CICLO CORRENTE -- e por que `inicioDoMes()` deixou de existir.
 *
 * ── O DEFEITO QUE ISTO FECHA (auditoria-ranking-zerado-10-09.md) ────────────
 *
 * Havia um `inicioDoMes()` aqui que fixava o dia 1 do mes de calendario, usado
 * pela parede e pelo `/ranking-equipe`. O cabecalho de `rankings/ciclo` diz que
 * a regra de "que mes e este?" estava cravada em quatro lugares e foi
 * centralizada -- mas ESTAS DUAS COPIAS nunca foram migradas. O arquivo que
 * unificou a regra ficou com um consumidor so.
 *
 * Enquanto o ciclo era o padrao (dia 1), as duas formas davam o MESMO
 * resultado, e a divergencia ficou invisivel. Ela apareceu no dia em que o
 * administrador moveu o dia do ciclo para 28 -- ou seja, no dia em que o
 * recurso passou a ser usado: a parede mostrou 84 pontos (mes de calendario) e
 * a tela do Ranking do Time mostrou 0 (ciclo), na mesma sala, no mesmo minuto.
 * Foi lido como "o ranking zerou os pontos".
 *
 * A licao que vale mais que a correcao: centralizar uma regra sem REMOVER as
 * copias antigas nao centraliza nada -- cria uma versao a mais dela. E a
 * divergencia fica latente ate alguem mudar a configuracao, o que faz o defeito
 * aparecer longe, no tempo e no codigo, da mudanca que o causou. Por isso
 * `inicioDoMes` foi deletado em vez de deixado sem uso.
 */
const cicloCorrente = async () => {
  const cfg = await ciclo.obter();
  const comp = ciclo.competenciaDe(new Date(), cfg);
  const [ano, mes] = comp.split("-").map(Number);
  return ciclo.janela(ano, mes, cfg);
};

const media = (lista) => (lista.length ? lista.reduce((a, b) => a + b, 0) / lista.length : 0);

/**
 * ESTE ATENDIMENTO FOI RESOLVIDO POR UMA PESSOA?
 *
 * ── COMO DA PARA SABER ─────────────────────────────────────────────────────
 *
 * Pelo MOTIVO. Quando quem fecha e uma pessoa, o motivo e obrigatorio e sai da
 * lista configurada da empresa (ver conversa.service.alterarStatus). Quando quem
 * fecha e o bot, ele grava um dos rotulos de `MOTIVOS_AUTOMATICOS`: encerrado
 * por inatividade, pelo fluxo, ou fora do horario.
 *
 * Exige TAMBEM um atendente de verdade: um fechamento sem motivo gravado (ciclo
 * antigo, ou caminho interno) nao pode passar por resolucao humana so porque o
 * campo esta vazio.
 *
 * ── ONDE ISSO MUDA O NUMERO ────────────────────────────────────────────────
 *
 * "Fechados hoje" e "tempo ate resolver". Os dois contavam todo fechamento, e os
 * do bot distorcem cada um de um jeito: o volume inflava com conversa que
 * ninguem atendeu, e a media de tempo misturava o fluxo que encerra em segundos
 * com a inatividade que fecha horas depois.
 */
const MOTIVOS_DO_BOT = new Set(Object.values(configuracaoService.MOTIVOS_AUTOMATICOS || {}));
function resolvidoPorAtendente(a) {
  if (!ehAtendenteReal(a?.atendenteNome)) return false;
  return !MOTIVOS_DO_BOT.has(String(a?.motivo || "").trim());
}

/**
 * A MEDIANA -- usada no tempo ate assumir, e nao a media.
 *
 * Aqui a amostra e pequena de proposito: um mes tem 2 a 8 atendimentos por
 * pessoa. Nessa escala UMA conversa esquecida uma tarde inteira arrasta a media
 * do mes inteiro -- sete atendimentos de 5 minutos e um de seis horas dao media
 * de 50 minutos, e a pessoa perde a parcela como se demorasse sempre.
 *
 * A mediana responde a pergunta que o ranking quer fazer ("essa pessoa costuma
 * assumir rapido?") e nao a que a media responde ("quanto tempo somado o
 * cliente esperou?"). A segunda tem valor, e por isso continua sendo a media no
 * indicador de operacao la embaixo do painel -- ali a conversa esquecida DEVE
 * aparecer.
 */
const mediana = (lista) => {
  if (!lista.length) return 0;
  const ordenada = [...lista].sort((a, b) => a - b);
  const meio = Math.floor(ordenada.length / 2);
  // Par: a media dos dois centrais, senao a mediana pularia entre dois valores
  // conforme entra ou sai um atendimento.
  return ordenada.length % 2 ? ordenada[meio] : (ordenada[meio - 1] + ordenada[meio]) / 2;
};

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
    // A JANELA DO CICLO, e nao o mes do calendario -- ver `cicloCorrente`. O
    // `fim` entra na consulta porque a competencia de transicao pode terminar
    // no mes seguinte: sem ele, a parede somaria dias de um ciclo que ainda nao
    // fechou junto com os do proximo assim que a virada passasse.
    const { inicio: inicioCiclo, fim: fimCiclo } = await cicloCorrente();
    const desdeMes = maisRecente(inicioCiclo, zerado);
    const desdeHoje = maisRecente(inicioDoDia(), zerado);

    const [regras, daSede, doMes, fechadosDeHoje, fila, equipe, meta, carga] = await Promise.all([
      // Os pesos que o administrador definiu. Lidos UMA vez por chamada: sao os
      // mesmos para todo mundo, e ler por pessoa faria a conta depender de
      // quando cada linha foi calculada.
      this.regras(),
      // QUEM CONCORRE NA SEDE. A parede mostra o ranking de atendimento da
      // sede: sem este recorte ela coroava como lider do mes quem nao esta
      // inscrito na competicao -- e discordava, na mesma sala, da tabela que a
      // Visao Geral mostrava.
      nomesDaEquipe(prisma, "sede"),
      // So o que o ranking e os tempos precisam. Sem `include`: mensagem
      // nenhuma entra nesta consulta.
      prisma.atendimento.findMany({
        where: { abertoEm: { gte: desdeMes, lt: fimCiclo } },
        select: {
          atendenteId: true,
          atendenteNome: true,
          status: true,
          avaliacao: true,
          abertoEm: true,
          atendidoEm: true,
          fechadoEm: true,
          // `motivo` E OBRIGATORIO NESTE SELECT: e por ele que se sabe se quem
          // fechou foi uma pessoa ou o bot (ver `resolvidoPorAtendente`). Sem a
          // coluna o campo chega `undefined`, TODO fechamento passa por humano,
          // e o "tempo ate resolver" volta a misturar o bot -- sem nada acusar.
          motivo: true,
        },
      }),
      // "FECHADOS HOJE" conta so o que uma PESSOA resolveu.
      //
      // Era um `count`, e virou leitura: a regra ("nao foi o bot") depende do
      // motivo e do atendente, e nao ha `where` que a expresse sem repetir os
      // rotulos automaticos dentro da consulta -- uma segunda copia da regra,
      // que passaria a discordar da primeira no dia em que alguem acrescentar um
      // motivo automatico novo. Sao os fechamentos de UM DIA: a lista e curta.
      prisma.atendimento.findMany({
        where: { status: "fechada", fechadoEm: { gte: desdeHoje } },
        select: { atendenteNome: true, motivo: true },
      }),
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
      // A PAREDE MOSTRA QUEM ESTA ZERADO TAMBEM -- a pedido de quem usa a tela.
      //
      // Ela escondia zero ponto ("ha podio, e nao lanterna"), e o efeito no
      // comeco do mes era um painel com tres caixas "em aberto" e "Ninguem
      // pontuou ainda": a TV ficava dias sem dizer nada, justamente quando a
      // equipe olha mais. Com os nomes na tela, o zero e ponto de partida
      // visivel em vez de ausencia.
      ranking: this._ranking(doMes, { equipe: daSede, incluirZerados: true, regras }),
      // O RANKING DE FORA DA SEDE, para a parede mostrar as duas competições.
      //
      // A TV só conhecia a sede, e quem trabalha na rua não se via na parede --
      // exatamente o time que passa o dia fora e para na empresa de vez em
      // quando. Se a equipe externa não existe, vem `null` e a tela não desenha
      // o painel: uma coluna vazia é pior que uma coluna a menos.
      rankingExterno: await this._paredeExterna(desdeMes),
      csat: this._csat(doMes),
      tempos: this._tempos(doMes),
      hoje: { fechados: fechadosDeHoje.filter(resolvidoPorAtendente).length, meta },
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
   *   atendimentos AVALIADOS     x `unidades.atendimento`, sem teto
   *   soma das NOTAS             x `unidades.estrela`, a partir de MINIMO_AVALIACOES
   *   rapidez em ASSUMIR         BONUS_AGILIDADE por atendimento, somado
   *
   * ── SO PONTUA ATENDIMENTO QUE O CLIENTE AVALIOU ────────────────────────────
   *
   * As tres parcelas saem do MESMO conjunto: os atendimentos fechados que
   * receberam nota. Fechar sem avaliacao nao vale ponto nenhum -- nem de
   * volume, nem de agilidade.
   *
   * E uma decisao com consequencia, e ela e o ponto: antes o volume contava
   * atendimento que ninguem confirmou que deu certo, e a nota so podia falar do
   * pedaco avaliado. Eram duas bases diferentes na mesma soma. Agora o ranking
   * mede uma coisa so -- atendimento com desfecho conhecido -- e "pedir a
   * avaliacao" passa a fazer parte de fechar bem.
   *
   * O preco esta assumido: um mes cheio de atendimentos sem nota pontua pouco.
   * A tela mostra a parcela separada, entao da para ver que o que faltou foi
   * avaliacao, e nao trabalho.
   *
   * O MINIMO DE AVALIACOES continua valendo para a parcela da NOTA: sem ele,
   * uma unica nota 5 valeria 35 pontos e o ranking viraria sorteio. Quem ainda
   * nao tem tres notas pontua ZERO ali, e a tela diz que esta faltando (ver
   * `aCaminho`), em vez de fingir que a pessoa e ruim de nota.
   */
  /**
   * As unidades padrao das tres parcelas -- a FONTE do que a tela de
   * configuracao oferece como "restaurar", sem repetir os numeros num segundo
   * lugar.
   */
  regrasPadrao() {
    return sedeRegras.padraoDe({
      PONTOS_POR_ATENDIMENTO,
      PONTOS_POR_ESTRELA,
      MINIMO_AVALIACOES,
      BONUS_AGILIDADE,
    });
  }

  regras() {
    return sedeRegras.obter(this.regrasPadrao());
  }

  salvarRegras(entrada, autor) {
    return sedeRegras.salvar(entrada, this.regrasPadrao(), autor);
  }

  _ranking(atendimentos, { limite = TOP, incluirZerados = false, semearVistos = false, equipe = null, regras = null } = {}) {
    /**
     * AS UNIDADES QUE O ADMINISTRADOR DECIDE.
     *
     * Sao VALORES POR UNIDADE, e nao tetos: `atendimento` e quanto vale cada
     * atendimento avaliado, `estrela` e quanto vale cada estrela recebida.
     * Dobrar qualquer um dobra aquela parcela para todo mundo -- nao ha teto
     * para reescalar, e por isso o `escalar` que existia aqui saiu junto com a
     * escada de faixas.
     */
    const padrao = this.regrasPadrao();
    const unidades = { ...padrao.unidades, ...(regras?.unidades || {}) };
    const minimoNotas = regras?.minimoAvaliacoes ?? MINIMO_AVALIACOES;
    const porPessoa = new Map();
    // Todo atendente REAL que aparece no periodo, pontuando ou nao.
    const vistosNoMes = new Set();
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
      // SO CONCORRE QUEM FOI INSCRITO NA COMPETICAO.
      //
      // O corte e AQUI, na entrada, e nao depois de classificar: assim ele vale
      // tambem para o "a caminho da nota" e para o destaque do mes, que saem do
      // mesmo agrupamento. Cortando so a lista final, a parede continuaria
      // anunciando gente de fora do ranking no rodape e no podio.
      //
      // Conjunto VAZIO nao filtra nada -- e antes de alguem marcar a equipe em
      // Gestao da Equipe, um filtro vazio apagaria a parede inteira.
      if (equipe && equipe.size && !equipe.has(nome)) continue;
      // QUEM APARECEU NO MES, apareceu -- mesmo que nada dele pontue.
      //
      // Registrado AQUI, antes do corte de "fechada + avaliada" logo abaixo:
      // depois daquele corte, quem so tem OS aberta some sem deixar rastro, e a
      // Visao Geral perde a pessoa em vez de mostra-la com zero. Ver a semeadura
      // de zerados mais abaixo, e o porque de nao bastar a equipe configurada.
      vistosNoMes.add(nome);
      // SO PONTUA O QUE O CLIENTE AVALIOU (ver o cabecalho deste metodo).
      //
      // O corte tambem e na ENTRADA, e nao em cada parcela, para que as tres
      // saiam da MESMA base. Contar volume de um conjunto e nota de outro faria
      // a soma juntar duas medidas de coisas diferentes -- que era exatamente o
      // que acontecia antes.
      if (a.status !== "fechada" || typeof a.avaliacao !== "number") continue;
      if (!porPessoa.has(nome)) porPessoa.set(nome, { nome, fechados: 0, notas: [], assumir: [] });
      const p = porPessoa.get(nome);
      p.fechados += 1;
      p.notas.push(a.avaliacao);
      // O MESMO "tempo ate assumir" do indicador da faixa de baixo, so que por
      // pessoa. E ate o CLIQUE em atender (`atendidoEm`), e nao ate a primeira
      // mensagem: medir a primeira mensagem exige abrir todas as mensagens de
      // todas as conversas -- 2,6 s e 87 MB por chamada, numa tela que recarrega
      // a cada 30 segundos. Ver o cabecalho deste arquivo.
      if (a.atendidoEm) p.assumir.push((new Date(a.atendidoEm) - new Date(a.abertoEm)) / 1000);
    }

    /**
     * QUEM ESTA NA EQUIPE E NAO TEM LINHA NENHUMA ENTRA ZERADO.
     *
     * O agrupamento acima so conhece quem aparece em algum atendimento. No
     * comeco do mes -- ou logo depois de uma limpeza -- isso e ninguem, e a
     * parede ficava com tres caixas "em aberto" e "Ninguem pontuou ainda".
     *
     * Semeando a equipe, o zero passa a ser um ponto de partida com nome. So faz
     * sentido com `incluirZerados`: no modo de podio, uma linha "0 pts" e
     * exatamente o que nao se quer expor.
     *
     * ── E QUEM TRABALHOU NO MES SEM PONTUAR TAMBEM ENTRA ─────────────────────
     *
     * A semeadura olhava so a equipe CONFIGURADA, e isso deixava um buraco: quem
     * tem atendimento no mes mas nada fechado-e-avaliado nao vinha de lugar
     * nenhum. Some quem acabou de entrar, quem so tem OS em curso, e quem fechou
     * sem o cliente avaliar -- gente que a Visao Geral deveria mostrar com ZERO,
     * e nao esconder.
     *
     * Pior: sem `equipe` configurada (o estado de antes de alguem marcar a
     * equipe em Gestao da Equipe) a semeadura nao acontecia de jeito nenhum, e a
     * lista virava "so quem pontuou".
     *
     * `vistosNoMes` ja respeita o filtro de equipe -- ele e preenchido depois do
     * corte la em cima --, entao unir os dois nao traz ninguem de fora da
     * competicao.
     *
     * NAO vale para a PAREDE, e por isso e uma opcao propria (`semearVistos`) em
     * vez de vir junto com `incluirZerados`. Ali o zero da equipe configurada e
     * bem-vindo -- ele evita a caixa "em aberto" no comeco do mes --, mas somar
     * quem so passou pelo mes encheria o podio de gente com 0 pt, que e
     * exatamente a exposicao publica que a parede evita.
     */
    if (incluirZerados) {
      const semear = semearVistos ? [...(equipe || []), ...vistosNoMes] : [...(equipe || [])];
      for (const nome of semear) {
        if (!porPessoa.has(nome)) porPessoa.set(nome, { nome, fechados: 0, notas: [], assumir: [] });
      }
    }

    const pessoas = [...porPessoa.values()];

    const pontuadas = pessoas.map((p) => {
      const notaMedia = p.notas.length ? media(p.notas) : null;
      const notaConta = p.notas.length >= minimoNotas;
      // MEDIANA, e nao media -- ver a nota em `mediana`. O campo continua se
      // chamando `medioSeg` porque e o nome que a parede e a Visao Geral leem;
      // trocar o nome do campo por causa da mudanca de calculo quebraria as
      // duas telas sem nenhum ganho para quem olha.
      const assumirTipico = p.assumir.length ? Math.round(mediana(p.assumir)) : null;

      // ── AS TRES PARCELAS ACUMULAM, CADA UMA POR UNIDADE ────────────────
      //
      // Nenhuma tem teto: quem fecha o dobro de atendimentos avaliados soma o
      // dobro. Era isto o pedido -- ver o bloco "A PONTUACAO DEIXOU DE TER
      // TETO" no topo do arquivo.
      const ptsAtendimentos = p.fechados * unidades.atendimento;
      // A SOMA das notas, e nao a media: media nao acumula. Assim a parcela
      // cresce com o volume E com a qualidade -- dez notas 5 valem o dobro de
      // cinco notas 5, e dez notas 3 valem menos que dez notas 5.
      //
      // O MINIMO continua valendo, e por isso a soma e zerada abaixo dele: com
      // uma nota so, a tela escreve "1 de 3" em vez de mostrar pontuacao de
      // qualidade a partir de amostra de um.
      const ptsNota = notaConta
        ? Math.round(p.notas.reduce((a, b) => a + b, 0) * unidades.estrela)
        : 0;
      // Bonus POR ATENDIMENTO, somado. A mediana continua sendo calculada acima
      // (`assumirTipico`) porque as telas a mostram como indicador -- mas ela
      // nao pontua mais: mediana e propriedade do conjunto e nao cresce com o
      // trabalho, entao nao cabe numa pontuacao sem teto.
      const ptsAgilidade = p.assumir.reduce((soma, seg) => soma + bonusDeAgilidade(seg), 0);

      return {
        nome: p.nome,
        pontos: ptsAtendimentos + ptsNota + ptsAgilidade,
        atendimentos: { valor: p.fechados, pontos: ptsAtendimentos },
        // `conta` e o que a tela usa para escrever "1 de 3" em vez de "0,0".
        nota: { valor: notaMedia, amostra: p.notas.length, conta: notaConta, pontos: ptsNota },
        agilidade: { medioSeg: assumirTipico, amostra: p.assumir.length, pontos: ptsAgilidade },
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
      minimoAvaliacoes: minimoNotas,
      // A REGUA EM VIGOR, para a tela escrever a regra sem repetir os numeros
      // do servidor num texto que envelhece sozinho.
      //
      // `pesos` continua sendo o nome do campo porque e por ele que a Visao
      // Geral e a parede leem a regra -- renomear o campo obrigaria as duas a
      // mudarem juntas por nada. O que mudou e o CONTEUDO: nao ha mais teto
      // nenhum aqui, sao valores por unidade.
      pesos: {
        // Os valores EM VIGOR (o padrao, com o que o administrador configurou
        // por cima) -- e nao as constantes. A tela escreve "10 por atendimento"
        // a partir daqui; com o valor cravado, ela continuaria dizendo 10
        // depois de alguem trocar para 15.
        unidades: { ...unidades },
        // As faixas do bonus de rapidez, para a tela poder listar os degraus.
        bonusAgilidade: BONUS_AGILIDADE,
        // NAO HA TETO -- e a tela precisa saber disso para nao escrever
        // "pontuacao de 0 a 100", que era o texto antigo e virou mentira.
        semTeto: true,
      },
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
    // O MESMO ciclo da parede -- ver `cicloCorrente`. Aqui tambem era
    // `inicioDoMes()`, e as duas telas divergiam do Ranking do Time no dia em
    // que o ciclo saiu do dia 1.
    const { inicio: inicioCiclo, fim: fimCiclo } = await cicloCorrente();
    const desdeMes = maisRecente(inicioCiclo, zerado);

    const doMes = await prisma.atendimento.findMany({
      where: { abertoEm: { gte: desdeMes, lt: fimCiclo } },
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
      // AQUI ENTRA TODO MUNDO QUE TRABALHOU NO MES, pontuando ou nao. Esta e a
      // lista de gestao, nao o podio: quem so tem OS em curso, quem acabou de
      // entrar e quem fechou sem o cliente avaliar precisam aparecer -- com
      // zero. Sumir e pior do que aparecer com 0, porque some tambem a pergunta
      // "por que essa pessoa esta zerada?". A parede nao recebe isto de
      // proposito; ver a semeadura em `_ranking`.
      semearVistos: true,
      // O mesmo recorte da parede, pelo mesmo motivo: e o ranking de
      // atendimento da SEDE, e nao "todo mundo que ja fechou uma OS".
      equipe: await nomesDaEquipe(prisma, "sede"),
      regras: await this.regras(),
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
    // A janela vem do ciclo configurado -- ver `rankings/ciclo`. Com o padrao
    // (dia 1, meia-noite) ela e exatamente o mes do calendario de antes.
    const { inicio, fim } = ciclo.janela(ano, mes, await ciclo.obter());
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
      ...this._ranking(doMes, { limite: Number.MAX_SAFE_INTEGER, incluirZerados: true, regras: await this.regras() }),
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

  /**
   * O ranking EXTERNO para a parede.
   *
   * ── O `require` FICA AQUI DENTRO, E ISSO É DE PROPÓSITO ───────────────────
   *
   * `ranking.service` já requer ESTE arquivo no topo. Requerê-lo de volta no
   * topo daqui fecha um ciclo, e em ciclo o Node entrega o módulo pela metade
   * para quem chegar primeiro -- uma falha que aparece como "não é uma função"
   * na subida, longe da causa. Adiando para a hora da chamada, os dois já estão
   * carregados.
   *
   * ── POR QUE NÃO REPETIR A CONTA AQUI ──────────────────────────────────────
   *
   * A fórmula do externo é outra (relatório de visita, não conversa avaliada), e
   * ela vive em `pontuacao.externa`. Uma segunda implementação para a parede
   * seria a garantia de a TV e a tela de Rankings discordarem -- e a TV é
   * justamente a que ninguém confere.
   */
  async _paredeExterna(desdeMes) {
    try {
      const rankingService = require("../rankings/ranking.service");
      const equipes = await rankingService.equipes();
      if (!equipes.externo.length) return null;
      const r = await rankingService._rankingExterno(
        desdeMes.getFullYear(),
        desdeMes.getMonth() + 1,
        equipes.externo
      );
      return { classificacao: r.classificacao };
    } catch (e) {
      // A parede NÃO pode cair por causa de um painel a mais. Sem o externo ela
      // continua mostrando a sede, a fila e os indicadores -- que é o que
      // estava lá antes desta adição.
      logger.warn("Nao consegui montar o ranking externo para a parede", { message: e.message });
      return null;
    }
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
      // "TEMPO ATE RESOLVER" so conta o que ALGUEM resolveu.
      //
      // Contava todo fechamento, inclusive os do bot -- e os do bot sao os mais
      // rapidos que existem (o fluxo encerra em segundos) e os mais lentos que
      // existem (inatividade fecha horas depois). Os dois puxavam a media para
      // lados opostos, e o numero na parede deixava de responder a pergunta que
      // ele faz: quanto tempo a equipe leva para resolver um caso.
      if (a.fechadoEm && resolvidoPorAtendente(a)) {
        ateResolver.push((new Date(a.fechadoEm) - new Date(a.abertoEm)) / 1000);
      }
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
