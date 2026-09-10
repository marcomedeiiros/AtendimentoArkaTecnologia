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
function padraoDe({ PONTOS_POR_ATENDIMENTO, PONTOS_POR_ESTRELA, MINIMO_AVALIACOES }) {
  return {
    // VALORES POR UNIDADE, e nao tetos -- ver o bloco "A PONTUACAO DEIXOU DE
    // TER TETO" em painel.service. Cada atendimento avaliado vale
    // `atendimento`; cada estrela recebida vale `estrela`.
    unidades: {
      atendimento: PONTOS_POR_ATENDIMENTO,
      estrela: PONTOS_POR_ESTRELA,
    },
    minimoAvaliacoes: MINIMO_AVALIACOES,
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

  // ── A REGRA "OS PESOS PRECISAM SOMAR 100" SAIU ──────────────────────────
  //
  // Ela era a INVARIANTE do teto: com as tres parcelas somando 100, a pontuacao
  // era um indice de 0 a 100 por construcao. Com a pontuacao sem teto (ver
  // painel.service), exigir soma 100 nao teria mais sentido nenhum -- os valores
  // agora sao "quanto vale UMA unidade", e nao "quanto vale a parcela cheia".
  //
  // `alvoAtendimentos` saiu junto: ele dizia quantos atendimentos valiam a
  // parcela cheia de volume, e nao existe mais parcela cheia.
  //
  // Um valor gravado por versao anterior (com `pesos` e `alvoAtendimentos`) nao
  // quebra nada: `validar` ignora chave que nao conhece, e o padrao entra por
  // baixo -- entao a regua volta ao padrao novo em vez de virar zero. Foi por
  // isso que `validar` sempre rodou tambem na LEITURA.
  if (entrada.unidades && typeof entrada.unidades === "object") {
    const unidades = {};
    for (const chave of Object.keys(base.unidades)) {
      // Minimo 0 para poder DESLIGAR uma parcela (quem nao quer premiar volume
      // pode zera-la), e maximo folgado -- a escala e livre agora.
      unidades[chave] = inteiro(entrada.unidades[chave], 0, 1000, base.unidades[chave]);
    }
    // TUDO ZERO E RECUSADO. Nao e uma regua "sem premiacao": e um ranking em que
    // ninguem pontua nunca, e a tela ficaria com a equipe inteira em zero sem
    // nada explicando. Errar aqui e barato de dizer e caro de descobrir.
    if (Object.values(unidades).every((v) => v === 0)) {
      throw new AppError(
        "Ao menos uma parcela precisa valer algo -- com tudo zero ninguem pontua nunca.",
        400,
        "REGUA_TODA_ZERO"
      );
    }
    out.unidades = unidades;
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
