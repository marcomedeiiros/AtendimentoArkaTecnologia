/**
 * QUANDO O MÊS DO RANKING COMEÇA E TERMINA.
 *
 * ── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
 *
 * O ciclo era o mês do calendário, cravado em quatro lugares diferentes
 * (`painel.service`, `ranking.service` duas vezes, `mapeamento.service`). Cada
 * um escrevia `new Date(ano, mes - 1, 1)` por conta própria -- quatro cópias da
 * mesma regra, que é o começo de quatro respostas diferentes para "que mês é
 * este?".
 *
 * Agora a regra mora aqui, e o administrador pode mover o dia e a hora em que
 * o ciclo vira: quem fecha folha no dia 25 precisa que o ranking feche junto.
 *
 * ── A CONVENÇÃO: O CICLO COMEÇA NO DIA ESCOLHIDO ───────────────────────────
 *
 * A competência `2026-09` com dia 25 vai de **25/09 às 25/10**. Não de 25/08 a
 * 25/09.
 *
 * As duas leituras são defensáveis, e a escolha não é estética: só esta reduz
 * exatamente ao comportamento de hoje quando o dia é 1 (01/09 a 01/10). A outra
 * faria a competência de setembro passar a significar agosto no dia em que
 * alguém salvasse a configuração pela primeira vez -- e o histórico inteiro,
 * que é recalculado a cada consulta, mudaria de conteúdo em silêncio.
 *
 * Como a leitura errada é fácil de ter, a tela escreve o intervalo por extenso
 * em vez de só mostrar o número do dia.
 *
 * ── SÓ VALE DAQUI PARA FRENTE ──────────────────────────────────────────────
 *
 * Nada de ranking é guardado: o histórico é recalculado a cada consulta. Sem
 * cuidado, mudar o dia de fechamento em março reescreveria janeiro e fevereiro
 * -- eles passariam a conter outros dias, as posições mudariam sozinhas, e a
 * premiação já registrada apontaria para quem não é mais o primeiro.
 *
 * Por isso `vigenteDesde` é gravado junto com a regra, e competência anterior a
 * ele continua sendo mês de calendário. O passado fica como foi vivido.
 */
const prisma = require("../../infrastructure/database/prisma.client");
const logger = require("../../config/logger");

const CHAVE = "ranking.ciclo";

// O padrão é o mês do calendário: dia 1, meia-noite. `vigenteDesde: null`
// significa "nunca foi configurado", e aí não há passado a preservar.
const PADRAO = { dia: 1, hora: 0, minuto: 0, vigenteDesde: null };

const inteiro = (v, min, max, atual) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return atual;
  return Math.min(max, Math.max(min, Math.round(n)));
};

/**
 * QUAL DIA DE FECHAMENTO EXISTE NAQUELE MÊS.
 *
 * ── POR QUE ISTO PRECISOU EXISTIR ──────────────────────────────────────────
 *
 * O dia era limitado a 28, e a justificativa estava escrita aqui: fevereiro não
 * tem 30, e `new Date(2026, 1, 30)` não estoura -- ele **transborda** para 02
 * de março. Um ciclo marcado para o dia 31 mudaria de janela sozinho, mês a
 * mês, sem ninguém ter mexido em nada.
 *
 * O limite resolvia o problema errado. Quem fecha folha no dia 30 precisa que o
 * ranking feche no dia 30, e "escolha 28" não é uma resposta -- são dois dias de
 * trabalho caindo no ciclo seguinte, todo mês.
 *
 * ── A REGRA: O DIA ESCOLHIDO, OU O ÚLTIMO QUE O MÊS TIVER ──────────────────
 *
 * Dia 30 fecha em 30/01, 28/02 (ou 29, em ano bissexto), 30/03... e dia **31**
 * passa a significar, na prática, "sempre no último dia do mês". Nada
 * transborda, porque a data nunca é inventada: ela é aparada para um dia que
 * existe naquele mês.
 *
 * ── E POR QUE NÃO UMA DATA DE CALENDÁRIO ───────────────────────────────────
 *
 * Porque o ciclo é uma regra que REPETE. Uma data escolhida no calendário
 * ("30/09/2026") responde por um mês só, e alguém teria de voltar aqui todo mês
 * -- e no mês em que esquecesse, o ranking não fecharia. O dia do mês é a regra;
 * a hora, que já existia, é o refinamento dela.
 *
 * A aparagem em si mora em `shared/helpers/calendario`, porque o vencimento
 * mensal do relatório de visita faz a mesma pergunta ao calendário.
 *
 * A janela e a competência corrente usam a MESMA aparagem, e isso não é
 * detalhe: quando as duas discordam sobre onde o mês vira, nasce um dia que não
 * pertence a competência nenhuma -- foi exatamente o defeito de 10/09
 * (auditoria-ranking-zerado-10-09.md). `verificar-ciclo-ranking` varre 18 meses
 * dia a dia justamente para provar que elas concordam.
 */
// A aparagem mora no helper: o vencimento mensal do relatorio faz a MESMA
// pergunta ao calendario, e duas copias dela seriam dois calendarios.
const { diaQueExiste } = require("../../shared/helpers/calendario.helper");

/**
 * Dia de 1 a 31 -- o maior que existe em algum mês.
 *
 * Escolher 31 não cria um "31 de fevereiro": `diaQueExiste` apara para o
 * último dia daquele mês. É por isso que o teto pôde subir de 28 para 31.
 */
function validar(entrada, base = PADRAO) {
  const out = { ...base };
  if (entrada?.dia !== undefined) out.dia = inteiro(entrada.dia, 1, 31, base.dia);
  if (entrada?.hora !== undefined) out.hora = inteiro(entrada.hora, 0, 23, base.hora);
  if (entrada?.minuto !== undefined) out.minuto = inteiro(entrada.minuto, 0, 59, base.minuto);
  if (entrada?.vigenteDesde !== undefined) {
    out.vigenteDesde = /^\d{4}-\d{2}$/.test(String(entrada.vigenteDesde || ""))
      ? String(entrada.vigenteDesde)
      : null;
  }
  return out;
}

async function obter() {
  try {
    const linha = await prisma.configuracao.findUnique({ where: { chave: CHAVE } });
    if (!linha?.valor) return PADRAO;
    return validar(JSON.parse(linha.valor), PADRAO);
  } catch (e) {
    logger.warn("Ciclo do ranking invalido no banco; usando o mes de calendario", {
      message: e.message,
    });
    return PADRAO;
  }
}

const compDe = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/**
 * A janela `[inicio, fim)` de uma competência.
 *
 * `fim` é EXCLUSIVO -- é o instante em que o ciclo seguinte começa. Um
 * atendimento fechado exatamente na virada pertence ao ciclo novo, e não aos
 * dois.
 */
function janela(ano, mes, cfg = PADRAO) {
  const comp = `${ano}-${String(mes).padStart(2, "0")}`;
  // Competência anterior à vigência continua sendo mês de calendário: o passado
  // não muda de conteúdo por causa de uma regra criada depois dele.
  const valeAqui = cfg.vigenteDesde && comp >= cfg.vigenteDesde;
  const { dia, hora, minuto } = valeAqui ? cfg : PADRAO;

  // ── A COMPETÊNCIA DE TRANSIÇÃO COMEÇA ONDE O CALENDÁRIO PAROU ─────────────
  //
  // O DEFEITO QUE ISTO FECHA (auditoria-ranking-zerado-10-09.md):
  //
  // Preservar o passado e mover o dia do ciclo abrem um VÃO entre os dois. Com
  // fechamento no dia 28 e vigência em 2026-09:
  //
  //   competência 2026-08 -> 01/08 a 01/09   (calendário: é anterior à vigência)
  //   competência 2026-09 -> 28/09 a 28/10   (regra nova)
  //
  // Os dias 01/09 a 28/09 não pertenciam a competência NENHUMA. Em produção,
  // no dia 10/09/2026, a tela do Ranking do Time mostrou a equipe inteira com
  // 0 pontos e 0 avaliados enquanto o painel de parede mostrava 84 -- e a
  // leitura imediata foi "o ranking zerou os pontos", quando nada havia sido
  // apagado: os atendimentos caíram no vão.
  //
  // Pior, era um vão INALCANÇÁVEL: `competenciaDe` respondia 2026-08 (correto
  // pela regra nova, cuja virada ainda não tinha chegado), mas a janela de
  // 2026-08 terminava em 01/09. Nem escolhendo a competência "certa" a tela
  // alcançava o dia de hoje.
  //
  // A CORREÇÃO: a primeira competência sob a regra nova absorve esses dias --
  // ela começa no dia 1, e não no dia do ciclo. O primeiro ciclo fica mais
  // longo UMA vez (01/09 a 28/10 no exemplo) e, do seguinte em diante, é
  // 28 a 28 para sempre.
  //
  // A alternativa era esticar o FIM da última competência de calendário
  // (2026-08 iria até 28/09). Recusada: aquele mês pode já ter sido premiado, e
  // mudar o conteúdo dele é exatamente o que `vigenteDesde` existe para
  // impedir. Entre alongar um ciclo que está começando e reescrever um que já
  // fechou, só a primeira é reversível.
  const ehTransicao = !!valeAqui && comp === cfg.vigenteDesde;

  return {
    inicio: ehTransicao
      ? new Date(ano, mes - 1, PADRAO.dia, PADRAO.hora, PADRAO.minuto, 0, 0)
      : new Date(ano, mes - 1, diaQueExiste(ano, mes - 1, dia), hora, minuto, 0, 0),
    // A APARAGEM VALE NAS DUAS PONTAS, e o mês de referência de cada uma é
    // diferente: o fim é o dia do ciclo no mês SEGUINTE. Com dia 31, a
    // competência de janeiro vai de 31/01 a 28/02 -- e a de fevereiro começa
    // exatamente onde ela termina. Aparar só o início abriria um vão de dias
    // sem competência entre um mês curto e o seguinte.
    fim: new Date(ano, mes, diaQueExiste(ano, mes, dia), hora, minuto, 0, 0),
    // Para a tela dizer o intervalo por extenso, em vez de deixar quem lê
    // adivinhar se o dia 25 é o começo ou o fim.
    personalizada: !!valeAqui,
    // A tela precisa poder explicar por que ESTE ciclo é mais longo que os
    // outros -- sem isso, "01/09 a 28/10" parece defeito de cálculo.
    transicao: ehTransicao,
  };
}

/**
 * Em qual competência cai um instante.
 *
 * Com dia 25, o dia 7 de setembro pertence ao ciclo que começou em 25 de
 * AGOSTO. Sem isto a tela abriria em setembro e mostraria um ciclo que ainda
 * não começou -- vazio, parecendo que o ranking quebrou.
 */
function competenciaDe(agora = new Date(), cfg = PADRAO) {
  const comp = compDe(agora);
  const valeAqui = cfg.vigenteDesde && comp >= cfg.vigenteDesde;
  if (!valeAqui) return comp;

  // NA COMPETÊNCIA DE TRANSIÇÃO O CICLO COMEÇOU NO DIA 1 (ver `janela`), então
  // qualquer instante dela já pertence a ela. Sem esta linha, o dia 10/09
  // respondia "2026-08" -- uma competência cuja janela terminava em 01/09, e
  // que portanto não continha o próprio instante que a escolheu.
  //
  // Esta era a metade do defeito que nenhum teste pegava: os dois lados podiam
  // discordar sem que nada reclamasse, porque `competenciaDe` era conferida
  // pelo RÓTULO que devolvia, nunca contra a janela correspondente.
  if (comp === cfg.vigenteDesde) return comp;

  // A MESMA aparagem da `janela` -- ver `diaQueExiste`. Sem ela, com dia 30 em
  // fevereiro a virada seria 02/03: os dias 28/02 e 01/03 responderiam a
  // competência anterior, cuja janela já teria terminado em 28/02. É a forma
  // exata do defeito que fez a tela mostrar a equipe zerada em 10/09.
  const viradaDesteMes = new Date(
    agora.getFullYear(),
    agora.getMonth(),
    diaQueExiste(agora.getFullYear(), agora.getMonth(), cfg.dia),
    cfg.hora,
    cfg.minuto,
    0,
    0
  );
  if (agora >= viradaDesteMes) return comp;
  return compDe(new Date(agora.getFullYear(), agora.getMonth() - 1, 1));
}

async function salvar(entrada, autor = null) {
  const atual = await obter();
  const novo = validar(entrada || {}, atual);

  // A VIGÊNCIA É CARIMBADA AQUI, e não recebida de fora.
  //
  // Se ela viesse no corpo do pedido, dava para pedir vigência retroativa e
  // reescrever meses já premiados. O ponto de partida é sempre a competência em
  // que a regra está sendo criada, medida pelo relógio do servidor.
  //
  // Só é (re)carimbada quando o ciclo de fato muda: salvar a mesma regra de
  // novo não pode empurrar a vigência para frente e devolver meses recentes ao
  // calendário.
  const mudou = novo.dia !== atual.dia || novo.hora !== atual.hora || novo.minuto !== atual.minuto;
  const ehPadrao = novo.dia === PADRAO.dia && novo.hora === PADRAO.hora && novo.minuto === PADRAO.minuto;
  if (ehPadrao) {
    // Voltou ao mês de calendário: sem vigência, porque não há mais regra
    // especial que precise de uma data de corte.
    novo.vigenteDesde = null;
  } else if (mudou || !atual.vigenteDesde) {
    novo.vigenteDesde = compDe(new Date());
  }

  await prisma.configuracao.upsert({
    where: { chave: CHAVE },
    update: { valor: JSON.stringify(novo) },
    create: { chave: CHAVE, valor: JSON.stringify(novo) },
  });
  logger.warn("Ciclo do ranking alterado", {
    por: autor?.nome || autor?.email || autor?.sub || "desconhecido",
    ciclo: novo,
  });
  return novo;
}

module.exports = { CHAVE, PADRAO, obter, salvar, validar, janela, competenciaDe, diaQueExiste };
