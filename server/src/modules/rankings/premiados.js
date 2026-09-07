/**
 * QUANTAS PESSOAS SOBEM AO PÓDIO. Por padrão, UMA por competição.
 *
 * ── O PROBLEMA ─────────────────────────────────────────────────────────────
 *
 * O pódio eram sempre três lugares. Na equipe externa, que tem TRÊS pessoas,
 * isso premiava o time inteiro: o "3º lugar" era o último colocado recebendo
 * medalha, e o "2º" era apenas "não foi o último". Pódio que inclui todo mundo
 * não premia ninguém -- e ainda constrange quem chegou por último.
 *
 * ── A REGRA: UM CAMPEÃO POR COMPETIÇÃO ─────────────────────────────────────
 *
 * Houve uma tentativa anterior de derivar isto do tamanho da equipe (um terço,
 * entre 1 e 3). Ela resolvia o caso da equipe externa, mas deixava as duas
 * competições com números diferentes -- 2 na sede, 1 fora --, e a assimetria não
 * se explica para quem é avaliado: as duas são disputas do mesmo mês, na mesma
 * empresa.
 *
 * A decisão foi um campeão em cada, e ela é mais simples de defender: o prêmio é
 * do primeiro lugar. Não depende do tamanho da equipe, não muda sozinha quando
 * alguém entra ou sai, e não precisa ser recalibrada.
 *
 * (A regra do terço foi REMOVIDA, e não guardada como alternativa desligada: uma
 * segunda forma de decidir a mesma coisa, sem ninguém usando, é o começo das
 * duas discordarem.)
 *
 * ── E A ESCOLHA MANUAL ─────────────────────────────────────────────────────
 *
 * O número é configurável por ranking. Se a operação crescer e um pódio de três
 * voltar a fazer sentido, é um campo -- não um deploy.
 */
const prisma = require("../../infrastructure/database/prisma.client");
const logger = require("../../config/logger");

const CHAVE = "ranking.premiados";

// Um campeão em cada competição.
const UM_CAMPEAO = 1;
const PADRAO = { sede: UM_CAMPEAO, externo: UM_CAMPEAO };

/**
 * Quantos premiados numa classificação deste tamanho.
 *
 * O teto é quem existe: pódio com vaga vazia é pior que pódio pequeno, e um
 * "3º lugar" numa lista de dois seria um lugar que ninguém pode ocupar.
 */
function quantos(total, configurado = null) {
  const n = Number(total) || 0;
  if (n <= 0) return 0;
  const desejado = Number(configurado) > 0 ? Math.round(Number(configurado)) : UM_CAMPEAO;
  return Math.min(desejado, n);
}

function validar(entrada, base = PADRAO) {
  const out = { ...base };
  for (const chave of ["sede", "externo"]) {
    if (entrada?.[chave] === undefined) continue;
    const v = entrada[chave];
    // Vazio, nulo ou zero voltam ao padrão -- é assim que se desfaz uma escolha
    // sem precisar de um segundo campo "usar o padrão".
    if (v === null || v === "" || Number(v) === 0) {
      out[chave] = PADRAO[chave];
      continue;
    }
    const n = Number(v);
    out[chave] = Number.isFinite(n) ? Math.min(50, Math.max(1, Math.round(n))) : base[chave];
  }
  return out;
}

async function obter() {
  try {
    const linha = await prisma.configuracao.findUnique({ where: { chave: CHAVE } });
    if (!linha?.valor) return PADRAO;
    return validar(JSON.parse(linha.valor), PADRAO);
  } catch (e) {
    logger.warn("Config de premiados invalida no banco; usando o padrao", { message: e.message });
    return PADRAO;
  }
}

async function salvar(entrada, autor = null) {
  const novo = validar(entrada || {}, await obter());
  await prisma.configuracao.upsert({
    where: { chave: CHAVE },
    update: { valor: JSON.stringify(novo) },
    create: { chave: CHAVE, valor: JSON.stringify(novo) },
  });
  logger.warn("Numero de premiados alterado", {
    por: autor?.nome || autor?.email || autor?.sub || "desconhecido",
    premiados: novo,
  });
  return novo;
}

module.exports = { CHAVE, PADRAO, quantos, validar, obter, salvar };
