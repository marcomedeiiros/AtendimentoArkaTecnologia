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
 * ── SÓ VALE DAQUI PARA FRENTE, E ISSO VALE PARA CADA MUDANÇA ───────────────
 *
 * Nada de ranking é guardado: o histórico é recalculado a cada consulta. Sem
 * cuidado, mudar o dia de fechamento em março reescreveria janeiro e fevereiro
 * -- eles passariam a conter outros dias, as posições mudariam sozinhas, e a
 * premiação já registrada apontaria para quem não é mais o primeiro.
 *
 * Por isso a regra não é gravada sozinha: é gravada com a COMPETÊNCIA A PARTIR
 * DA QUAL ela passa a valer, e as anteriores continuam sob a regra que valia
 * quando foram vividas.
 *
 * ── AS VIGÊNCIAS SÃO UMA LISTA, E ISSO FOI UM DEFEITO ──────────────────────
 *
 * Havia UM `vigenteDesde`, recarimbado a cada mudança. Ele protegia o passado
 * anterior à PRIMEIRA configuração, e só. Na segunda mudança, as competências
 * vividas sob a primeira regra deixavam de ser "posteriores à vigência" e
 * voltavam a ser mês de calendário -- exatamente o que o campo existia para
 * impedir.
 *
 * Provado, com dia 28 vigente em 2026-09 e depois dia 15 em 2026-11:
 *
 *   competência   sob a regra de setembro   depois da 2ª mudança (antes daqui)
 *   2026-09       01/09 -> 28/10            01/09 -> 01/10
 *   2026-10       28/10 -> 28/11            01/10 -> 01/11
 *
 * O ciclo de outubro mudava de conteúdo INTEIRO, e era o que estava valendo
 * quando o mês foi vivido e possivelmente premiado.
 * (auditoria-tela-rankings-10-09.md, achado 6)
 *
 * Agora o que se guarda é `vigencias`: uma linha por decisão, com a competência
 * em que ela começou a valer. Cada competência é lida sob a regra que estava em
 * vigor NELA, e uma mudança nova não alcança nenhuma competência anterior.
 *
 * ── A REGRA QUE MANTÉM AS JANELAS COLADAS ──────────────────────────────────
 *
 * Uma competência COMEÇA onde o regime anterior parou e TERMINA na virada da
 * própria regra, no mês seguinte:
 *
 *   inicio(comp) = virada no mês de `comp`,   pela regra da competência ANTERIOR
 *   fim(comp)    = virada no mês SEGUINTE,    pela regra de `comp`
 *
 * Fora de mudança as duas regras são a mesma, e isso reduz ao ciclo de sempre.
 * Na mudança, quem absorve o descasamento é a competência que está EM CURSO --
 * ela fica mais longa (dia adiado) ou mais curta (dia antecipado), uma vez só.
 *
 * A alternativa era esticar o FIM da competência anterior. Recusada: aquele mês
 * pode já ter sido premiado, e mudar o conteúdo dele é o que este arquivo
 * existe para impedir. Entre alongar um ciclo que está começando e reescrever
 * um que já fechou, só a primeira é reversível.
 *
 * E é essa fórmula que garante o principal: como `fim(comp)` e
 * `inicio(comp + 1)` são a MESMA expressão, não existe instante fora de
 * competência. O vão de 27 dias que zerou a tela em 10/09 era exatamente isso.
 */
const prisma = require("../../infrastructure/database/prisma.client");
const logger = require("../../config/logger");
// A aparagem mora no helper: o vencimento mensal do relatorio faz a MESMA
// pergunta ao calendario, e duas copias dela seriam dois calendarios.
const { diaQueExiste } = require("../../shared/helpers/calendario.helper");

const CHAVE = "ranking.ciclo";

// O padrão é o mês do calendário: dia 1, meia-noite. `vigencias` vazio
// significa "nunca foi configurado", e aí não há passado a preservar.
const PADRAO = { dia: 1, hora: 0, minuto: 0, vigenteDesde: null, vigencias: [] };

const inteiro = (v, min, max, atual) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return atual;
  return Math.min(max, Math.max(min, Math.round(n)));
};

const ehCompetencia = (v) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v || ""));

/**
 * A lista de vigências, saneada -- e ela roda também na LEITURA.
 *
 * Vigência com competência inválida é DESCARTADA, e não corrigida: um "desde"
 * que não é mês não tem palpite honesto, e mantê-lo faria a comparação de
 * competência (que é textual) tratá-lo como sempre verdadeiro -- uma regra que
 * passaria a valer para o passado inteiro.
 *
 * Ordenada por competência e sem repetição: duas regras para o mesmo mês
 * deixariam a janela dele dependendo da ordem de gravação. Quando há repetição,
 * vale a ÚLTIMA -- é a decisão mais recente sobre aquele mês.
 *
 * O teto de 240 linhas (vinte anos de mudanças mensais) existe só para um JSON
 * corrompido não virar um laço caro em toda consulta de ranking. Não é para
 * aparar histórico de verdade: cada linha aqui protege um mês já vivido.
 */
function saneiaVigencias(lista) {
  if (!Array.isArray(lista)) return [];
  const porCompetencia = new Map();
  for (const v of lista) {
    if (!ehCompetencia(v?.desde)) continue;
    porCompetencia.set(String(v.desde), {
      desde: String(v.desde),
      dia: inteiro(v.dia, 1, 31, PADRAO.dia),
      hora: inteiro(v.hora, 0, 23, PADRAO.hora),
      minuto: inteiro(v.minuto, 0, 59, PADRAO.minuto),
    });
  }
  return [...porCompetencia.values()].sort((a, b) => a.desde.localeCompare(b.desde)).slice(-240);
}

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
    out.vigenteDesde = ehCompetencia(entrada.vigenteDesde) ? String(entrada.vigenteDesde) : null;
  }
  if (entrada?.vigencias !== undefined) out.vigencias = saneiaVigencias(entrada.vigencias);
  return out;
}

/**
 * As vigências de uma configuração, aceitando as DUAS formas.
 *
 * A forma antiga (`{ dia, hora, minuto, vigenteDesde }`) continua entrando: é
 * o que está gravado no banco de quem já configurou, e é o que a verificação
 * monta à mão para exercitar um cenário. Ela vale como uma vigência só -- que é
 * exatamente o que ela sempre significou.
 *
 * Sem vigência nenhuma, a lista é vazia e todo mês é mês de calendário.
 */
function vigenciasDe(cfg) {
  const lista = saneiaVigencias(cfg?.vigencias);
  if (lista.length) return lista;
  if (ehCompetencia(cfg?.vigenteDesde)) {
    return saneiaVigencias([
      { desde: cfg.vigenteDesde, dia: cfg.dia, hora: cfg.hora, minuto: cfg.minuto },
    ]);
  }
  return [];
}

/**
 * A regra que valia NAQUELA competência -- a última que começou até ela.
 *
 * Antes de qualquer vigência, o regime é o mês do calendário. Devolver o mesmo
 * objeto `PADRAO` nesses casos não é economia: é o que deixa `janela` detectar
 * uma troca de regra comparando identidade, sem inventar um segundo critério de
 * igualdade entre regras.
 */
function regraDe(vigencias, comp) {
  let regra = PADRAO;
  for (const v of vigencias) {
    if (v.desde <= comp) regra = v;
    else break;
  }
  return regra;
}

const compDe = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const compEm = (ano, mes) => `${ano}-${String(mes).padStart(2, "0")}`;

/** A virada de um mês, pela regra dada. `mesIdx` é o índice do `Date`. */
const viradaEm = (ano, mesIdx, regra) =>
  new Date(ano, mesIdx, diaQueExiste(ano, mesIdx, regra.dia), regra.hora, regra.minuto, 0, 0);

// Mês de calendário exato: começa e termina no dia 1, à meia-noite.
const ehViradaDeCalendario = (d) =>
  d.getDate() === PADRAO.dia && d.getHours() === PADRAO.hora && d.getMinutes() === PADRAO.minuto;

async function obter() {
  try {
    const linha = await prisma.configuracao.findUnique({ where: { chave: CHAVE } });
    if (!linha?.valor) return PADRAO;
    const vigencias = vigenciasDe(validar(JSON.parse(linha.valor), PADRAO));
    // A REGRA CORRENTE VAI PLANA na resposta, e é derivada da última vigência.
    //
    // O formulário edita "o ciclo", e não a lista: ele lê `dia`/`hora`/`minuto`
    // e manda os três de volta. Derivar aqui, em vez de gravar os dois
    // formatos, é o que impede a lista e os campos planos de discordarem --
    // que seria a versão nova do mesmo defeito.
    const corrente = vigencias[vigencias.length - 1];
    return {
      dia: corrente?.dia ?? PADRAO.dia,
      hora: corrente?.hora ?? PADRAO.hora,
      minuto: corrente?.minuto ?? PADRAO.minuto,
      vigenteDesde: corrente?.desde ?? null,
      vigencias,
    };
  } catch (e) {
    logger.warn("Ciclo do ranking invalido no banco; usando o mes de calendario", {
      message: e.message,
    });
    return PADRAO;
  }
}

/**
 * A janela `[inicio, fim)` de uma competência.
 *
 * `fim` é EXCLUSIVO -- é o instante em que o ciclo seguinte começa. Um
 * atendimento fechado exatamente na virada pertence ao ciclo novo, e não aos
 * dois.
 *
 * A fórmula (início pela regra da competência ANTERIOR, fim pela regra desta)
 * está explicada no cabeçalho do arquivo. Ela é o que mantém as janelas
 * coladas: `fim(comp)` e `inicio(comp + 1)` são a mesma expressão.
 */
function janela(ano, mes, cfg = PADRAO) {
  const vigencias = vigenciasDe(cfg);
  const regraAgora = regraDe(vigencias, compEm(ano, mes));
  // A competência anterior, para saber onde o regime dela parou. O ano vira
  // sozinho: janeiro pergunta a dezembro do ano passado.
  const antesAno = mes === 1 ? ano - 1 : ano;
  const antesMes = mes === 1 ? 12 : mes - 1;
  const regraAntes = regraDe(vigencias, compEm(antesAno, antesMes));

  // A APARAGEM VALE NAS DUAS PONTAS, e o mês de referência de cada uma é
  // diferente: o fim é o dia do ciclo no mês SEGUINTE. Com dia 31, a
  // competência de janeiro vai de 31/01 a 28/02 -- e a de fevereiro começa
  // exatamente onde ela termina. Aparar só o início abriria um vão de dias
  // sem competência entre um mês curto e o seguinte.
  const inicio = viradaEm(ano, mes - 1, regraAntes);
  const fim = viradaEm(ano, mes, regraAgora);

  return {
    inicio,
    fim,
    // Para a tela dizer o intervalo por extenso, em vez de deixar quem lê
    // adivinhar se o dia 25 é o começo ou o fim.
    //
    // A pergunta é sobre a JANELA, e não sobre haver regra configurada: uma
    // competência de transição pode não ser mês de calendário mesmo quando a
    // regra nova é o dia 1 (ela começa no dia velho e termina no dia 1). Medir
    // a janela responde certo nos dois casos; medir a regra, não.
    personalizada: !(ehViradaDeCalendario(inicio) && ehViradaDeCalendario(fim)),
    // A tela precisa poder explicar por que ESTE ciclo é mais longo (ou mais
    // curto) que os outros -- sem isso, "01/09 a 28/10" parece defeito de
    // cálculo. É a competência em que a regra trocou.
    transicao: regraAntes !== regraAgora,
  };
}

/**
 * Em qual competência cai um instante.
 *
 * Com dia 25, o dia 7 de setembro pertence ao ciclo que começou em 25 de
 * AGOSTO. Sem isto a tela abriria em setembro e mostraria um ciclo que ainda
 * não começou -- vazio, parecendo que o ranking quebrou.
 *
 * ── ELA DERIVA DE `janela`, E ISSO É O CONSERTO ────────────────────────────
 *
 * Esta função tinha a própria conta da virada, escrita à mão. Duas contas para
 * a mesma pergunta podiam discordar -- e discordaram: em 10/09/2026 o rótulo
 * apontava para uma competência cuja janela não continha o instante que a
 * escolheu, e a tela mostrou a equipe zerada.
 *
 * Perguntando a `janela` não existe como discordar, e a regra fica em uma
 * linha: o instante é da competência do calendário quando já passou do início
 * dela, e da anterior caso contrário -- as duas janelas se encostam por
 * construção. É essa invariante que `verificar-ciclo-ranking` varre dia a dia.
 */
function competenciaDe(agora = new Date(), cfg = PADRAO) {
  const ano = agora.getFullYear();
  const mes = agora.getMonth() + 1;
  if (agora >= janela(ano, mes, cfg).inicio) return compEm(ano, mes);
  return compDe(new Date(ano, agora.getMonth() - 1, 1));
}

async function salvar(entrada, autor = null) {
  const atual = await obter();
  const novo = validar(entrada || {}, atual);

  // A VIGÊNCIA É CARIMBADA AQUI, e não recebida de fora.
  //
  // Se ela viesse no corpo do pedido, dava para pedir vigência retroativa e
  // reescrever meses já premiados. O ponto de partida é sempre a competência em
  // que a regra está sendo criada, medida pelo relógio do servidor.
  const mudou = novo.dia !== atual.dia || novo.hora !== atual.hora || novo.minuto !== atual.minuto;
  if (!mudou) {
    // Salvar a mesma regra de novo não pode criar vigência: ela empurraria o
    // corte para frente e devolveria meses recentes ao regime anterior.
    return atual;
  }

  // ── A MUDANÇA É ACRESCENTADA, E NUNCA SUBSTITUI AS ANTERIORES ────────────
  //
  // Era aqui que o passado se perdia: o `vigenteDesde` único era recarimbado, e
  // as competências vividas sob a regra anterior voltavam a ser mês de
  // calendário.
  //
  // VOLTAR AO DIA 1 TAMBÉM É UMA VIGÊNCIA, e não apagar a lista. "Do mês que
  // vem em diante é mês de calendário" é uma decisão sobre o futuro; apagar a
  // lista seria dizer que os ciclos passados nunca existiram -- e eles podem
  // estar premiados.
  const desde = compDe(new Date());
  // Duas mudanças no MESMO mês: vale a última. Não é perder decisão -- é que
  // duas regras para a mesma competência deixariam a janela dela dependendo da
  // ordem de gravação, e essa competência ainda está em curso.
  const vigencias = saneiaVigencias([
    ...atual.vigencias,
    { desde, dia: novo.dia, hora: novo.hora, minuto: novo.minuto },
  ]);

  await prisma.configuracao.upsert({
    where: { chave: CHAVE },
    update: { valor: JSON.stringify({ vigencias }) },
    create: { chave: CHAVE, valor: JSON.stringify({ vigencias }) },
  });
  logger.warn("Ciclo do ranking alterado", {
    por: autor?.nome || autor?.email || autor?.sub || "desconhecido",
    ciclo: { dia: novo.dia, hora: novo.hora, minuto: novo.minuto },
    desde,
    // Quantas vigências existem: se este número não cresce a cada mudança, o
    // passado voltou a ser reescrito.
    vigencias: vigencias.length,
  });
  return {
    dia: novo.dia,
    hora: novo.hora,
    minuto: novo.minuto,
    vigenteDesde: desde,
    vigencias,
  };
}

module.exports = {
  CHAVE,
  PADRAO,
  obter,
  salvar,
  validar,
  janela,
  competenciaDe,
  diaQueExiste,
  // Publicados para a verificacao exercitar as regras sem montar um mes inteiro.
  vigenciasDe,
  regraDe,
  saneiaVigencias,
};
