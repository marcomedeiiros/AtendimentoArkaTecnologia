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
 * Dia de 1 a 28, e não a 31.
 *
 * Fevereiro não tem dia 30. Um ciclo marcado para o dia 31 pularia meses, ou
 * cairia no dia 1 do mês seguinte conforme o `Date` decide -- e o ranking
 * mudaria de janela sozinho, sem ninguém ter mexido em nada. 28 é o maior dia
 * que existe em todo mês.
 */
function validar(entrada, base = PADRAO) {
  const out = { ...base };
  if (entrada?.dia !== undefined) out.dia = inteiro(entrada.dia, 1, 28, base.dia);
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
  return {
    inicio: new Date(ano, mes - 1, dia, hora, minuto, 0, 0),
    fim: new Date(ano, mes, dia, hora, minuto, 0, 0),
    // Para a tela dizer o intervalo por extenso, em vez de deixar quem lê
    // adivinhar se o dia 25 é o começo ou o fim.
    personalizada: !!valeAqui,
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

  const viradaDesteMes = new Date(
    agora.getFullYear(),
    agora.getMonth(),
    cfg.dia,
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

module.exports = { CHAVE, PADRAO, obter, salvar, validar, janela, competenciaDe };
