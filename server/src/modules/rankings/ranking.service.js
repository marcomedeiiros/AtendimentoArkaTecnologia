/**
 * OS DOIS RANKINGS DE DESEMPENHO -- e a regra que os mantem separados.
 *
 * ── A PONTUACAO DA SEDE NAO E CALCULADA AQUI ───────────────────────────────
 *
 * Vale repetir porque e a decisao mais importante deste arquivo: o ranking da
 * sede NAO tem formula propria. Ele pede `painelService.rankingDoMes(...)`, que
 * chama a MESMA `_ranking` do painel de parede e da Visao Geral, e apenas
 * FILTRA o resultado por quem esta na equipe da sede. Nao ha uma segunda conta
 * para manter em sincronia com a primeira -- e por isso nao ha o dia em que as
 * duas discordam.
 *
 * O ranking externo tem formula propria (pontuacao.externa.js) porque mede
 * outra coisa: relatorio de visita, e nao conversa avaliada pelo cliente.
 *
 * ── POR QUE OS DOIS NUNCA SE MISTURAM ──────────────────────────────────────
 *
 * Os dois vao de 0 a 100 -- e a coincidencia de escala e justamente a armadilha
 * a evitar. Numeros do mesmo tamanho parecem comparaveis, e nao sao: 80 na sede
 * quer dizer "fechou bastante, com nota alta e assumindo rapido"; 80 no externo
 * quer dizer "entregou relatorio completo, no prazo, com foto e sem voltar para
 * correcao". Sao trabalhos diferentes medidos por criterios diferentes; somar,
 * ordenar junto ou dizer que um esta "a frente" do outro nao significa nada.
 *
 * (Ate a mudanca de peso a sede nao tinha teto -- cada atendimento valia 1
 * ponto, sem limite -- e o argumento contra misturar era a escala. O argumento
 * agora e mais forte, e nao mais fraco: era possivel achar que os dois eram
 * comparaveis se so a regua fosse ajustada, e nao sao.)
 *
 * Por isso nao existe endpoint que devolva os dois juntos numa lista so.
 *
 * ── NADA DE RANKING E GUARDADO ─────────────────────────────────────────────
 *
 * O historico e RECALCULADO a cada consulta, a partir de atendimentos e
 * mapeamentos -- que nao mudam depois de fechados. Um retrato salvo por mes
 * seria uma segunda fonte da verdade, e a primeira vez que alguem corrigisse um
 * atendimento antigo as duas passariam a discordar em silencio.
 *
 * A UNICA coisa guardada e a PREMIACAO (quem ganhou, o que ganhou, quando), que
 * e justamente o que o calculo nao tem como saber.
 */
const prisma = require("../../infrastructure/database/prisma.client");
const painelService = require("../dashboard/painel.service");
const { pontuarExterno, reguaEmVigor } = require("./pontuacao.externa");
const regrasRelatorio = require("./relatorio.regras");
const ciclo = require("./ciclo");
const premiados = require("./premiados");
const AppError = require("../../shared/errors/AppError");
const logger = require("../../config/logger");

const EQUIPES = ["sede", "externo"];
const ROTULOS = { sede: "Atendimento na Sede", externo: "Atendimento Fora da Sede" };

/**
 * "sede,externo" -> ["sede", "externo"].
 *
 * Uma pessoa pode concorrer nos dois -- ha quem atenda no chat e tambem visite
 * cliente. Os rankings continuam separados; o que muda e o mesmo nome poder
 * aparecer nas duas listas, com pontuacoes de reguas diferentes que nunca se
 * somam.
 *
 * Filtra pelo que EXISTE: um valor antigo ou digitado errado no banco nao pode
 * criar uma terceira equipe fantasma na tela.
 */
function equipesDe(valor) {
  return String(valor || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => EQUIPES.includes(s));
}

// "2026-09" -> { ano: 2026, mes: 9 }. Recusa o que nao for mes de verdade em vez
// de cair no mes atual: um filtro digitado errado que devolve dados do mes
// corrente e pior do que um erro, porque parece resposta.
function interpretarCompetencia(texto) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(texto || "").trim());
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12 || ano < 2000 || ano > 2100) return null;
  return { ano, mes };
}

const competenciaDe = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

function competenciaAnterior(comp) {
  const { ano, mes } = interpretarCompetencia(comp);
  const d = new Date(ano, mes - 2, 1);
  return competenciaDe(d);
}

/**
 * Ordena e numera as posicoes.
 *
 * Desempate: pontos, depois o criterio de VOLUME de cada ranking (atendimentos
 * numa ponta, relatorios entregues na outra) e por fim o nome, que garante
 * ordem estavel -- sem ele, dois empates trocariam de lugar a cada F5 e a
 * equipe veria o podio "mudando sozinho".
 */
/**
 * ── POR QUE NAO EXISTE MAIS UMA "NOTA GERAL" ─────────────────────────────
 *
 * Havia aqui uma `notaGeral`: a media das duas notas, ponderada pelo volume de
 * cada lado, para responder "quem se saiu melhor no mes, considerando tudo?".
 * Ela nasceu certa e MORREU no dia em que a pontuacao da sede perdeu o teto.
 *
 * O cabecalho dela afirmava, textualmente, "continua de 0 a 100, na mesma
 * escala das duas -- e media, nao soma". Com a sede acumulando sem teto, a
 * afirmacao virou falsa e a conta virou sem sentido:
 *
 *   sede 250 (10 avaliados) + externo 80 (10 relatorios)  ->  165
 *
 * E o numero nao era so estranho na tela: ele era o PRIMEIRO DESEMPATE dos dois
 * rankings. No externo, onde ninguem passa de 100, quem tambem atende na sede
 * chegava ao desempate com um numero em outra escala -- empate em 62 pontos
 * entre um tecnico e alguem que acumula as duas funcoes, e o segundo subia com
 * 165 contra 62. Por trabalho feito na OUTRA competicao. Era exatamente a
 * mistura que o cabecalho deste arquivo proibe, entrando pela porta do
 * desempate. (auditoria-tela-rankings-10-09.md, achado 1)
 *
 * ── E POR QUE NAO FOI SO NORMALIZAR ──────────────────────────────────────
 *
 * Porque nao ha por onde. A sede nao tem teto, entao converter em "porcentagem
 * de quanto?" exige escolher um denominador -- e o unico disponivel e o
 * primeiro colocado do mes. A nota de cada um passaria a depender de quanto os
 * OUTROS trabalharam, mudaria sozinha quando alguem fechasse mais um
 * atendimento, e reescreveria o passado a cada consulta (nada de ranking e
 * guardado). Trocar um numero sem sentido por um numero instavel nao e conserto.
 *
 * Media de escala aberta com escala fechada obriga a inventar um fator de
 * conversao, e o fator escolhido decide o vencedor -- e a mesma objecao que
 * `painel.service` levanta desde o primeiro dia contra juntar volume e nota.
 *
 * ── O QUE FICOU NO LUGAR ─────────────────────────────────────────────────
 *
 * Os DOIS NUMEROS, lado a lado, sem media nenhuma: quem esta nas duas equipes
 * leva junto o `outroLado` (pontos e volume daquele mes) so para a tela poder
 * mostrar. Ninguem perde informacao -- "essa pessoa tambem trabalha do outro
 * lado?" continua respondida --, e nada do outro ranking toca a ORDEM deste.
 */

/**
 * Ordena e numera as posicoes.
 *
 * O DESEMPATE E O DE CADA COMPETICAO: pontos, depois o VOLUME proprio
 * (atendimentos avaliados numa ponta, relatorios entregues na outra) e por fim
 * o nome, que garante ordem estavel -- sem ele, dois empatados trocariam de
 * lugar a cada F5 e a equipe veria o podio "mudando sozinho".
 *
 * A nota geral esteve aqui, como primeiro desempate, e saiu com a mistura de
 * escalas que ela passou a fazer (ver o bloco acima). Os empates de plato que
 * a motivaram eram efeito do TETO da sede, que nao existe mais: ali cada
 * atendimento avaliado move o placar. No externo o teto continua, e o empate
 * volta a cair no volume -- que e propriedade daquele trabalho, e nao do outro.
 *
 * `posicao` vai por ULTIMO no objeto de proposito: com ela antes do espalhar,
 * reclassificar uma lista ja classificada mantinha a posicao velha.
 */
function classificar(pessoas, volumeDe) {
  return pessoas
    .slice()
    .sort(
      (a, b) =>
        b.pontos - a.pontos ||
        volumeDe(b) - volumeDe(a) ||
        a.nome.localeCompare(b.nome)
    )
    .map((p, i) => ({ ...p, posicao: i + 1 }));
}

class RankingService {
  /**
   * Quem concorre em cada ranking, mais quem valida.
   *
   * O filtro e "tem alguma coisa gravada", e o recorte por equipe acontece em
   * memoria: com a lista em texto ("sede,externo"), um `where` por valor exato
   * deixaria de fora justamente quem esta nos dois. A tabela de usuarios tem
   * dezenas de linhas -- ler todas as marcadas custa menos que a consulta.
   */
  async equipes() {
    const usuarios = await prisma.usuario.findMany({
      where: { NOT: [{ equipeRanking: null }, { equipeRanking: "" }] },
      select: { id: true, nome: true, email: true, cargo: true, equipeRanking: true },
      orderBy: { nome: "asc" },
    });
    // Quem valida mapeamento e registra premio e o ADMINISTRADOR -- nao ha mais
    // marca separada. Ele NAO e excluido do ranking: se estiver numa equipe,
    // concorre nela, porque administrar o sistema nao impede atender cliente.
    const validadores = await prisma.usuario.findMany({
      where: { cargo: "Administrador", ativo: true },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    });
    return {
      sede: usuarios.filter((u) => equipesDe(u.equipeRanking).includes("sede")),
      externo: usuarios.filter((u) => equipesDe(u.equipeRanking).includes("externo")),
      supervisores: validadores,
    };
  }

  /**
   * RANKING DA SEDE -- a pontuacao do painel, recortada pela equipe.
   *
   * O supervisor e excluido mesmo que esteja marcado numa equipe: quem valida
   * nao concorre. E a regra fica AQUI, no servidor, e nao no filtro da tela --
   * senao bastaria abrir o endpoint direto para ver o supervisor no podio.
   */
  async _rankingSede(ano, mes, equipe) {
    const doMes = await painelService.rankingDoMes(ano, mes);
    const porNome = new Map(doMes.classificacao.map((p) => [p.nome, p]));

    // O ULTIMO ATENDIMENTO de cada um, de qualquer data.
    //
    // Veio junto quando o ranking virou aba da Visao Geral: a aba anterior
    // mostrava essa coluna, e some-la sem aviso seria tirar da tela uma
    // informacao que ninguem pediu para tirar. Uma consulta por pessoa, e o
    // time tem unidades -- nao milhares.
    const ultimos = await Promise.all(equipe.map((u) => painelService._ultimoAtendimento(u.nome)));
    const ultimoPorId = new Map(equipe.map((u, i) => [u.id, ultimos[i]]));

    const pessoas = equipe.map((u) => {
      // Sem linha no mes = nao atendeu. Zera, e continua na tabela: uma equipe
      // de tres em que um sumiu precisa mostrar os tres, senao ninguem percebe
      // que alguem parou.
      const p = porNome.get(u.nome);
      return {
        usuarioId: u.id,
        nome: u.nome,
        pontos: p?.pontos ?? 0,
        // As MESMAS parcelas que o painel ja devolve. Renomear aqui criaria um
        // vocabulario paralelo para a mesma conta.
        criterios: [
          // "avaliados" no rotulo porque o numero mudou de significado: so
          // entra atendimento fechado que o cliente avaliou. Um rotulo que
          // continuasse dizendo "Atendimentos" faria a pessoa procurar defeito
          // ao ver 3 onde ela fechou 8.
          { chave: "atendimentos", rotulo: "Atendimentos avaliados", valor: p?.atendimentos.valor ?? 0, pontos: p?.atendimentos.pontos ?? 0 },
          {
            chave: "nota",
            rotulo: "Avaliação média",
            valor: p?.nota.conta ? p.nota.valor : null,
            amostra: p?.nota.amostra ?? 0,
            conta: !!p?.nota.conta,
            minimo: doMes.minimoAvaliacoes,
            pontos: p?.nota.pontos ?? 0,
          },
          {
            chave: "agilidade",
            rotulo: "Tempo até assumir",
            valor: p?.agilidade.medioSeg ?? null,
            amostra: p?.agilidade.amostra ?? 0,
            pontos: p?.agilidade.pontos ?? 0,
          },
        ],
        registros: p?.atendimentos.valor ?? 0,
        ultimo: ultimoPorId.get(u.id) || null,
      };
    });

    return {
      pesos: doMes.pesos,
      // O MINIMO DE AMOSTRA, com o nome da PERGUNTA e nao da unidade: "quantos
      // registros ja permitem julgar as parcelas de qualidade". Na sede sao
      // avaliacoes, fora da sede sao relatorios entregues -- e a tela escreve
      // "1 de 3" nos dois casos, a partir deste campo. Dois nomes para o mesmo
      // campo obrigariam a tela a escolher qual ler por aba.
      minimoAmostra: doMes.minimoAvaliacoes,
      classificacao: classificar(pessoas, (p) => p.registros),
    };
  }

  /** RANKING EXTERNO -- formula propria, ver pontuacao.externa.js. */
  async _rankingExterno(ano, mes, equipe) {
    // O MESMO ciclo da sede. Os dois rankings nunca se misturam na conta, mas
    // o mes tem de ser o mesmo mes -- dois calendarios diferentes na mesma
    // tela seria o pior dos dois mundos.
    const { inicio, fim } = ciclo.janela(ano, mes, await ciclo.obter());
    // "Limpar dados de atendimento fora da sede" recomeca a contagem daqui. O
    // piso e por MES (ver painelService.pisoDoMes): a limpeza nao apaga meses
    // ja fechados, senao uma premiacao antiga apontaria para um ranking vazio.
    const desde = painelService.pisoDoMes(inicio, fim, await painelService.marcoDe("externo"));

    // Recortado pela DATA DA VISITA, e nao pela entrega: o mes em que o
    // trabalho foi feito e o mes que ele conta. Ancorar na entrega deixaria uma
    // visita do dia 30 cair no mes seguinte por causa do prazo do relatorio.
    const mapeamentos = await prisma.mapeamentoTecnico.findMany({
      where: { dataVisita: { gte: desde, lt: fim }, tecnicoId: { in: equipe.map((u) => u.id) } },
      select: {
        tecnicoId: true, status: true, resumo: true, itens: true,
        evidencias: true, devolucoes: true, prazoEm: true, entregueEm: true,
        // `fotosRelatorio` E OBRIGATORIO NESTE SELECT: a parcela de evidencias
        // conta o maior valor entre as fotos anexadas e as que estao dentro do
        // PDF. Sem a coluna aqui o campo chega `undefined`, as fotos do
        // relatorio valem zero, e a nota cai sem nada acusando -- o mesmo
        // defeito silencioso que o `equipeRanking` ja causou em outro select.
        fotosRelatorio: true,
      },
    });

    const porTecnico = new Map(equipe.map((u) => [u.id, []]));
    for (const m of mapeamentos) porTecnico.get(m.tecnicoId)?.push(m);

    // Os pesos e limites que o administrador definiu. Lidos AQUI, uma vez por
    // ranking, e nao dentro do laco: sao os mesmos para todo mundo do mes, e ler
    // por pessoa faria a conta depender de quando cada linha foi calculada.
    const regras = await regrasRelatorio.obter();
    // A REGUA QUE ESTA VALENDO, para a tela poder explicar a conta sem repetir
    // numero nenhum. Vem da MESMA funcao que pontua (`reguaEmVigor`) -- e nao
    // relida daqui --, senao a tela explicaria uma regua e o placar sairia de
    // outra. A aba da sede ja fazia assim; a do externo escrevia "25, 25, 20,
    // 15, 15" e "3 relatorios" cravados no cliente, e mentia desde o dia em que
    // alguem mexeu na configuracao. (auditoria-tela-rankings-10-09.md, 3 e 4)
    const regua = reguaEmVigor(regras);

    const pessoas = equipe.map((u) => {
      const p = pontuarExterno(porTecnico.get(u.id) || [], regras);
      return {
        usuarioId: u.id,
        nome: u.nome,
        pontos: p.pontos,
        criterios: [
          { chave: "volume", rotulo: "Relatórios entregues", valor: p.volume.valor, pontos: p.volume.pontos },
          // `minimo` VAI JUNTO nas tres parcelas de qualidade: e o numero que a
          // tela escreve no "1 de 3". Sem ele, o cliente usava um 3 cravado --
          // e com o minimo configurado em 5 escrevia "4 de 3", que se le como
          // "bati o minimo e o sistema nao esta contando".
          { chave: "completude", rotulo: "Relatório completo", valor: p.completude.valor, conta: p.completude.conta, amostra: p.completude.amostra, minimo: p.completude.minimo, sufixo: "%", pontos: p.completude.pontos },
          { chave: "prazo", rotulo: "Entregue no prazo", valor: p.prazo.valor, conta: p.prazo.conta, amostra: p.prazo.amostra, minimo: p.prazo.minimo, sufixo: "%", pontos: p.prazo.pontos },
          { chave: "evidencias", rotulo: "Evidências por visita", valor: p.evidencias.valor, conta: p.evidencias.conta, amostra: p.evidencias.amostra, minimo: p.evidencias.minimo, pontos: p.evidencias.pontos },
          { chave: "retrabalho", rotulo: "Sem retorno para correção", valor: p.retrabalho.devolucoes, pontos: p.retrabalho.pontos },
        ],
        registros: p.volume.entregues,
      };
    });

    return {
      // A regua na MESMA forma que a sede usa (`pesos`), com o conteudo que
      // este ranking tem: parcelas com teto, e o teto e a SOMA delas. `semTeto`
      // e o campo que a tela le para decidir entre "de 0 a 100" e "sem teto" --
      // as duas competicoes respondem a mesma pergunta, com respostas
      // diferentes, e nenhuma das duas fica escrita no cliente.
      pesos: {
        parcelas: regua.parcelas,
        custoPorDevolucao: regua.custoPorDevolucao,
        teto: regua.teto,
        semTeto: false,
      },
      minimoAmostra: regua.minimo,
      classificacao: classificar(pessoas, (p) => p.registros),
    };
  }

  /**
   * Um ranking fechado de um mes, com a evolucao em relacao ao mes anterior.
   *
   * A evolucao compara POSICAO, e nao pontos: "subiu de 3o para 2o" e o que a
   * pessoa quer saber. Comparar pontos diria "caiu 4 pontos" num mes em que
   * todo mundo caiu -- informacao que existe, mas nao responde a pergunta.
   */
  async obter(equipeChave, competencia) {
    if (!EQUIPES.includes(equipeChave)) {
      throw new AppError("Ranking desconhecido", 400, "RANKING_INVALIDO");
    }
    // QUE MES ESTA CORRENTE depende do ciclo: com fechamento no dia 25, o dia 7
    // ainda pertence ao ciclo que comecou no mes passado. Usar o mes do
    // calendario aqui abriria a tela num ciclo que ainda nao comecou -- vazio,
    // parecendo defeito.
    const comp = interpretarCompetencia(competencia)
      ? competencia
      : ciclo.competenciaDe(new Date(), await ciclo.obter());
    const { ano, mes } = interpretarCompetencia(comp);

    const equipes = await this.equipes();
    const equipe = equipes[equipeChave];

    // ── O OUTRO LADO VIAJA JUNTO, SO PARA EXIBICAO ────────────────────────
    //
    // As mesmas pessoas atendem na sede E visitam cliente, e a tela mostra numa
    // coluna como foi o mes da pessoa do OUTRO lado -- porque a pergunta "essa
    // pessoa tambem trabalha na rua?" e legitima e a resposta esta a uma
    // consulta de distancia.
    //
    // O QUE ELE NAO FAZ MAIS: entrar na conta e na ORDEM. Havia aqui uma media
    // ponderada das duas notas (`notaGeral`) que era o primeiro desempate --
    // e, com a sede sem teto, ela misturava escalas e deixava pontuacao da sede
    // decidir posicao no ranking externo. Ver o bloco "POR QUE NAO EXISTE MAIS
    // UMA NOTA GERAL" no topo do arquivo.
    //
    // Custa uma rodada de consultas, e so para quem esta nas DUAS equipes:
    // onde as equipes nao se cruzam, isto nao custa nada.
    //
    // E SO PARA O MES QUE ESTA NA TELA. O mes anterior recebia o mesmo
    // tratamento quando a geral ordenava -- era obrigatorio, senao o desempate
    // valeria num mes e nao no outro e a tela anunciaria um "subiu" que nao
    // aconteceu. Sem a geral, a ordem dos dois meses sai do mesmo criterio, e
    // do mes anterior a tela usa somente a POSICAO: buscar o outro lado dele
    // seria pagar por um dado que ninguem le.
    const outraChave = equipeChave === "sede" ? "externo" : "sede";
    const nosDois = new Set(
      equipe.filter((u) => equipes[outraChave].some((o) => o.id === u.id)).map((u) => u.id)
    );

    const rankingDe = (chave, aa, mm) =>
      chave === "sede"
        ? this._rankingSede(aa, mm, equipes.sede)
        : this._rankingExterno(aa, mm, equipes.externo);

    // Anexa o outro lado SEM reordenar: a classificacao que chega aqui ja esta
    // decidida pelo criterio desta competicao, e mexer nela seria trazer o
    // outro ranking de volta para dentro da ordem.
    const comOutroLado = async (r, aa, mm) => {
      if (nosDois.size === 0) return r;
      const outra = await rankingDe(outraChave, aa, mm);
      const doOutroLado = new Map(outra.classificacao.map((x) => [x.usuarioId, x]));
      const lista = r.classificacao.map((p) => {
        if (!nosDois.has(p.usuarioId)) return { ...p, nosDoisRankings: false, outroLado: null };
        const o = doOutroLado.get(p.usuarioId);
        return {
          ...p,
          nosDoisRankings: true,
          // Os numeros do outro lado, como eles sao -- e nao uma media deles
          // com os de ca. A tela escreve os dois, cada um na sua escala.
          outroLado: o ? { ranking: outraChave, pontos: o.pontos, registros: o.registros } : null,
        };
      });
      return { ...r, classificacao: lista };
    };

    const atual = await comOutroLado(await rankingDe(equipeChave, ano, mes), ano, mes);

    // Mes anterior so para saber a posicao de cada um. Uma consulta a mais, e
    // ela vale: sem ela a tela mostraria "1o lugar" sem dizer se isso e novo.
    const antes = interpretarCompetencia(competenciaAnterior(comp));
    const anterior = await rankingDe(equipeChave, antes.ano, antes.mes);
    const posicaoAntes = new Map(anterior.classificacao.map((p) => [p.usuarioId, p.posicao]));
    const pontosAntes = new Map(anterior.classificacao.map((p) => [p.usuarioId, p.pontos]));
    const classificacao = atual.classificacao.map((p) => {
      const antesPos = posicaoAntes.get(p.usuarioId) ?? null;
      // Sem mes anterior nao ha movimento a declarar. "manteve" seria uma
      // afirmacao sobre uma comparacao que nao existe.
      const evolucao =
        antesPos == null ? "novo" : antesPos > p.posicao ? "subiu" : antesPos < p.posicao ? "caiu" : "manteve";
      return { ...p, anterior: { posicao: antesPos, pontos: pontosAntes.get(p.usuarioId) ?? null }, evolucao };
    });

    const marco = await painelService.marcoDe(equipeChave);
    const janelaMes = ciclo.janela(ano, mes, await ciclo.obter());
    const { inicio: inicioMes, fim: fimMes } = janelaMes;

    const premiacoes = await prisma.premiacaoRanking.findMany({
      where: { ranking: equipeChave, competencia: comp },
      orderBy: { posicao: "asc" },
    });

    return {
      ranking: equipeChave,
      rotulo: ROTULOS[equipeChave],
      competencia: comp,
      competenciaAnterior: competenciaAnterior(comp),
      // ── O INTERVALO POR EXTENSO, PORQUE O RÓTULO NÃO BASTA ─────────────────
      //
      // "setembro/2026" não diz de quando a quando se está contando, e com o
      // ciclo fora do dia 1 os dois deixam de coincidir: com fechamento no dia
      // 28, "setembro/2026" vai de 28/09 a 28/10.
      //
      // `transicao` é o caso que MAIS precisa ser dito: a primeira competência
      // sob um ciclo novo absorve os dias entre onde o calendário parou e a
      // virada nova (ver `ciclo.janela`), então ela é mais longa que as outras
      // -- uma vez só. Sem esta informação, a tela mostra um mês com 57 dias e
      // nada explica por quê, e a próxima pergunta é se o ranking quebrou de
      // novo. A tela de configuração já escreve o intervalo por extenso pelo
      // mesmo motivo; faltava aqui.
      janela: {
        inicio: janelaMes.inicio.toISOString(),
        fim: janelaMes.fim.toISOString(),
        personalizada: !!janelaMes.personalizada,
        transicao: !!janelaMes.transicao,
      },
      pesos: atual.pesos || null,
      minimoAmostra: atual.minimoAmostra ?? null,
      participantes: equipe.length,
      // Quantos sobem ao pódio. Decidido no SERVIDOR (ver `premiados`): a tela
      // desenhava três lugares fixos, o que numa equipe de três premiava até o
      // último colocado.
      premiados: premiados.quantos(classificacao.length, (await premiados.obter())[equipeChave]),
      // Desde quando este ranking esta contando. `zeradoEm` e o marco (existe ou
      // nao, e o que decide se a tela mostra "Limpar" ou "Restaurar");
      // `zeradoNoMes` diz se ele realmente corta o mes que esta na tela.
      //
      // Sao coisas diferentes: em setembro, com uma limpeza feita em setembro,
      // julho aparece INTEIRO -- e um aviso "contando a partir de 3/set" em
      // cima da tabela de julho seria mentira. Quem sabe a regra e o servidor
      // (`pisoDoMes`); a tela so exibe a resposta, em vez de reimplementa-la.
      zeradoEm: marco ? marco.toISOString() : null,
      zeradoNoMes: !!marco && painelService.pisoDoMes(inicioMes, fimMes, marco) > inicioMes,
      supervisores: equipes.supervisores.map((u) => ({ id: u.id, nome: u.nome })),
      classificacao,
      premiacoes,
    };
  }

  /**
   * A EVOLUCAO de cada pessoa nos ultimos meses.
   *
   * Recalcula mes a mes -- sao poucas consultas pequenas, e o resultado nunca
   * envelhece. A alternativa (gravar um retrato por mes) so pareceria mais
   * barata ate a primeira divergencia entre o retrato e a verdade.
   */
  async historico(equipeChave, competencia, meses = 6) {
    if (!EQUIPES.includes(equipeChave)) {
      throw new AppError("Ranking desconhecido", 400, "RANKING_INVALIDO");
    }
    // QUE MES ESTA CORRENTE depende do ciclo: com fechamento no dia 25, o dia 7
    // ainda pertence ao ciclo que comecou no mes passado. Usar o mes do
    // calendario aqui abriria a tela num ciclo que ainda nao comecou -- vazio,
    // parecendo defeito.
    const comp = interpretarCompetencia(competencia)
      ? competencia
      : ciclo.competenciaDe(new Date(), await ciclo.obter());
    const limite = Math.min(Math.max(Number(meses) || 6, 2), 12);

    const equipes = await this.equipes();
    const equipe = equipes[equipeChave];

    const competencias = [];
    let cursor = comp;
    for (let i = 0; i < limite; i += 1) {
      competencias.unshift(cursor);
      cursor = competenciaAnterior(cursor);
    }

    const porPessoa = new Map(equipe.map((u) => [u.id, { usuarioId: u.id, nome: u.nome, meses: [] }]));
    for (const c of competencias) {
      const { ano, mes } = interpretarCompetencia(c);
      const r =
        equipeChave === "sede"
          ? await this._rankingSede(ano, mes, equipe)
          : await this._rankingExterno(ano, mes, equipe);
      for (const p of r.classificacao) {
        porPessoa.get(p.usuarioId)?.meses.push({
          competencia: c,
          pontos: p.pontos,
          posicao: p.posicao,
          registros: p.registros,
        });
      }
    }

    return { ranking: equipeChave, competencias, pessoas: [...porPessoa.values()] };
  }

  // ── PREMIACAO ────────────────────────────────────────────────────────────

  async listarPremiacoes(competencia = null) {
    const where = interpretarCompetencia(competencia) ? { competencia } : {};
    return prisma.premiacaoRanking.findMany({
      where,
      orderBy: [{ competencia: "desc" }, { ranking: "asc" }, { posicao: "asc" }],
    });
  }

  /**
   * Registra (ou atualiza) o premio de uma posicao.
   *
   * `pontos` e `usuarioNome` sao gravados como RETRATO do fechamento, e nao
   * relidos depois: e o numero que justificou o premio, e ele precisa continuar
   * legivel mesmo que a formula mude no ano seguinte ou a pessoa saia da
   * empresa. O resto do sistema recalcula; este registro nao.
   */
  async registrarPremiacao(dados, autor = null) {
    const { ranking, competencia, posicao } = dados;
    if (!EQUIPES.includes(ranking)) throw new AppError("Ranking desconhecido", 400, "RANKING_INVALIDO");
    if (!interpretarCompetencia(competencia)) throw new AppError("Competência inválida (use AAAA-MM)", 400, "COMPETENCIA_INVALIDA");
    // O TETO vem de `premiados`, e nao repetido aqui -- ver o bloco MAXIMO la.
    const pos = Number(posicao);
    if (!Number.isInteger(pos) || pos < 1 || pos > premiados.MAXIMO) {
      throw new AppError(
        `Posição deve ser de 1 a ${premiados.MAXIMO}`,
        400,
        "POSICAO_INVALIDA"
      );
    }

    // O vencedor NAO vem do corpo da requisicao: e lido do ranking calculado.
    // Aceitar um id do cliente deixaria premiar quem nao ganhou.
    const r = await this.obter(ranking, competencia);

    // ── O PODIO CONFIGURADO TAMBEM E LIMITE, E ELE E CHECADO AQUI ──────────
    //
    // O teto acima diz o maximo que o sistema suporta; `r.premiados` diz
    // quantos lugares ESTE ranking tem agora (`premiados.quantos`). Com um
    // campeao so configurado, registrar premio do 2o lugar e premiar quem a
    // regra nao premia -- e vira linha no banco, que ninguem desfaz.
    //
    // A tela ja oferece somente as vagas que existem, mas esconder botao nunca
    // foi protecao: sem este guarda, a mesma chamada sai no curl.
    if (pos > r.premiados) {
      throw new AppError(
        r.premiados === 1
          ? `O pódio de "${r.rotulo}" tem um campeão só. Não há prêmio para o ${pos}º -- aumente "Premiados no pódio" na configuração se quiser premiar mais gente.`
          : `O pódio de "${r.rotulo}" tem ${r.premiados} lugares. Não há prêmio para o ${pos}º.`,
        400,
        "FORA_DO_PODIO"
      );
    }

    const vencedor = r.classificacao.find((p) => p.posicao === pos);
    if (!vencedor) throw new AppError("Não há ninguém nessa posição neste mês", 400, "SEM_VENCEDOR");
    // ZERO PONTO NAO E PODIO.
    //
    // A classificacao lista a equipe INTEIRA, inclusive quem nao produziu no
    // mes -- e isso e proposital, porque uma equipe de tres em que um sumiu
    // precisa mostrar os tres. O efeito colateral, se ninguem barrar aqui, e
    // que um mes vazio ainda tem "1o lugar": daria para registrar premio de um
    // mes em que nao houve trabalho nenhum, com o nome de quem por acaso ficou
    // primeiro no criterio de desempate alfabetico.
    if (!vencedor.pontos) {
      throw new AppError(
        `${vencedor.nome} não pontuou em ${competencia}. Não há prêmio a registrar nessa posição.`,
        400,
        "SEM_PONTUACAO"
      );
    }

    const registro = {
      ranking,
      competencia,
      posicao: pos,
      usuarioId: vencedor.usuarioId,
      usuarioNome: vencedor.nome,
      pontos: vencedor.pontos,
      premio: dados.premio ? String(dados.premio).trim() : null,
      valor: dados.valor ? String(dados.valor).trim() : null,
      entregueEm: dados.entregueEm ? new Date(dados.entregueEm) : null,
      observacao: dados.observacao ? String(dados.observacao).trim() : null,
    };

    const salvo = await prisma.premiacaoRanking.upsert({
      where: { ranking_competencia_posicao: { ranking, competencia, posicao: pos } },
      update: registro,
      create: registro,
    });
    logger.info("Premiacao registrada", {
      ranking, competencia, posicao, vencedor: vencedor.nome,
      por: autor?.nome || autor?.sub || "desconhecido",
    });
    return salvo;
  }

  async removerPremiacao(id) {
    await prisma.premiacaoRanking.deleteMany({ where: { id } });
    return { removido: true };
  }
}

module.exports = new RankingService();
module.exports.EQUIPES = EQUIPES;
module.exports.interpretarCompetencia = interpretarCompetencia;
module.exports.competenciaDe = competenciaDe;
module.exports.competenciaAnterior = competenciaAnterior;
