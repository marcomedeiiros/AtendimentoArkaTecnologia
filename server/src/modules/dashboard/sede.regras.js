/**
 * AS REGRAS DO ATENDIMENTO NA SEDE -- o que o administrador decide sem deploy.
 *
 * Irma de `rankings/relatorio.regras`, e de proposito com a mesma forma: as duas
 * telas de configuracao pedem a mesma coisa (tetos que somam 100 e um minimo de
 * amostra), e duas formas diferentes para a mesma ideia so dariam duas telas
 * para aprender.
 *
 * ── O QUE MORA AQUI ────────────────────────────────────────────────────────
 *
 *   pesos              quanto vale cada parcela: atendimentos, nota, agilidade
 *   minimoAvaliacoes   quantas notas ja permitem julgar alguem
 *   alvoAtendimentos   quantos atendimentos valem a pontuacao maxima de volume
 *
 * ── E O QUE NAO MORA ───────────────────────────────────────────────────────
 *
 * Os DEGRAUS um a um, e a formula. Eles continuam em `painel.service` e sao
 * derivados: o peso move quanto a escada vale, o `alvoAtendimentos` move onde
 * ela termina, e a forma (a distancia entre os degraus) e sempre a mesma.
 *
 * Abrir os seis degraus para edicao seria dar corda para uma escada que nao
 * sobe -- e "por que 6 atendimentos valem menos que 4?" e uma pergunta que
 * ninguem quer ter de responder. Um numero so nao tem como ficar incoerente.
 *
 * ── O MESMO CUIDADO DA OUTRA TELA ──────────────────────────────────────────
 *
 * Um registro so, em JSON, na tabela de configuracao. O padrao vive no codigo e
 * e aplicado por cima do que estiver salvo, entao um campo novo nasce com valor
 * sensato e um banco vazio nao significa "tudo zero". E `validar` roda tambem na
 * LEITURA: valor gravado por versao anterior, ou editado na mao, nao vira peso
 * invalido rodando na conta do mes.
 */
const prisma = require("../../infrastructure/database/prisma.client");
const AppError = require("../../shared/errors/AppError");
const logger = require("../../config/logger");

const CHAVE = "sede.regras";

// O padrao sai das constantes do painel -- e nao de numeros repetidos aqui.
// Duas listas para a mesma coisa e o comeco da divergencia.
function padraoDe({ PESO_NOTA, MINIMO_AVALIACOES, FAIXAS_VOLUME, FAIXAS_AGILIDADE }) {
  return {
    pesos: {
      atendimentos: FAIXAS_VOLUME[0].pontos,
      nota: 5 * PESO_NOTA,
      agilidade: FAIXAS_AGILIDADE[0].pontos,
    },
    minimoAvaliacoes: MINIMO_AVALIACOES,
    // O degrau de cima da escada de volume, que e o alvo do mes.
    alvoAtendimentos: FAIXAS_VOLUME[0].aPartirDe,
  };
}

const inteiro = (v, min, max, atual) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return atual;
  return Math.min(max, Math.max(min, Math.round(n)));
};

function validar(entrada, base) {
  const out = { ...base };

  if (entrada.minimoAvaliacoes !== undefined) {
    out.minimoAvaliacoes = inteiro(entrada.minimoAvaliacoes, 1, 20, base.minimoAvaliacoes);
  }

  if (entrada.alvoAtendimentos !== undefined) {
    // Minimo 1: alvo zero deixaria todo mundo no teto sempre, que e o oposto
    // do problema que este campo existe para resolver. O maximo e folgado --
    // quem tiver uma operacao de 500 atendimentos por mes tem de poder dizer.
    out.alvoAtendimentos = inteiro(entrada.alvoAtendimentos, 1, 1000, base.alvoAtendimentos);
  }

  if (entrada.pesos && typeof entrada.pesos === "object") {
    const pesos = {};
    for (const chave of Object.keys(base.pesos)) {
      pesos[chave] = inteiro(entrada.pesos[chave], 0, 100, base.pesos[chave]);
    }
    const soma = Object.values(pesos).reduce((a, b) => a + b, 0);
    // RECUSA em vez de aparar: aparar sozinho gravaria um quadro diferente do
    // que a pessoa digitou, e ela so descobriria pela pontuacao do mes.
    if (soma !== 100) {
      throw new AppError(`Os pesos precisam somar 100. Somaram ${soma}.`, 400, "PESOS_NAO_SOMAM_100");
    }
    out.pesos = pesos;
  }

  return out;
}

async function obter(padrao) {
  try {
    const linha = await prisma.configuracao.findUnique({ where: { chave: CHAVE } });
    if (!linha?.valor) return padrao;
    return validar(JSON.parse(linha.valor), padrao);
  } catch (e) {
    logger.warn("Regras da sede invalidas no banco; usando o padrao", { message: e.message });
    return padrao;
  }
}

async function salvar(entrada, padrao, autor = null) {
  const atual = await obter(padrao);
  const novo = validar(entrada || {}, atual);
  const valor = JSON.stringify(novo);
  await prisma.configuracao.upsert({
    where: { chave: CHAVE },
    update: { valor },
    create: { chave: CHAVE, valor },
  });
  // Com AUTORIA: muda a pontuacao da equipe inteira, inclusive de meses ja
  // fechados (o historico e recalculado a cada consulta).
  logger.warn("Regras do atendimento na sede alteradas", {
    por: autor?.nome || autor?.email || autor?.sub || "desconhecido",
    regras: novo,
  });
  return novo;
}

module.exports = { obter, salvar, validar, padraoDe, CHAVE };
