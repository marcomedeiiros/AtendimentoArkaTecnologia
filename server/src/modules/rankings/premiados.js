/**
 * QUANTAS PESSOAS SOBEM AO PÓDIO -- e por que isso não pode ser um `3` fixo.
 *
 * ── O PROBLEMA ─────────────────────────────────────────────────────────────
 *
 * O pódio eram sempre três lugares. Na equipe externa, que tem TRÊS pessoas,
 * isso premiava o time inteiro: o "3º lugar" era o último colocado recebendo
 * medalha, e o "2º" era apenas "não foi o último". Um pódio que inclui todo
 * mundo não premia ninguém -- e ainda constrange quem chegou por último.
 *
 * ── A REGRA: UM TERÇO, ENTRE 1 E 3 ─────────────────────────────────────────
 *
 * O que dá sentido ao pódio é a PROPORÇÃO, não o número. Premiar o terço de
 * cima mantém o significado em qualquer tamanho de equipe:
 *
 *     3 a 5 pessoas   ->  1 premiado
 *     6 a 8 pessoas   ->  2 premiados
 *     9 ou mais       ->  3 premiados
 *
 * O teto de 3 existe porque pódio é pódio: numa equipe de 30, premiar 10 volta
 * a diluir. O piso de 1 existe porque ranking sem vencedor não é ranking.
 *
 * Derivar do tamanho, em vez de fixar, é o que impede o problema de voltar: se
 * a equipe externa crescer para nove, o pódio volta a três sozinho -- ninguém
 * precisa lembrar de editar isto.
 *
 * ── E A ESCOLHA MANUAL ─────────────────────────────────────────────────────
 *
 * A regra é o PADRÃO, não uma imposição. Pode haver motivo de gestão que o
 * código não conhece (o que a equipe já espera, o custo do prêmio, um acordo
 * antigo), e nesse caso o número configurado vence. Um mecanismo só, com padrão
 * inteligente -- e não uma regra automática mais uma exceção espalhada.
 */
const prisma = require("../../infrastructure/database/prisma.client");
const logger = require("../../config/logger");

const CHAVE = "ranking.premiados";
const MAX = 3;

// `null` = automático. Não é `3`: gravar o número aqui faria a escolha
// automática desaparecer no primeiro salvamento, mesmo sem ninguém pedir.
const PADRAO = { sede: null, externo: null };

/**
 * Quantos premiados para uma classificação deste tamanho.
 *
 * @param {number} total quantas pessoas estão classificadas
 * @param {number|null} configurado o que o administrador escolheu, se escolheu
 */
function quantos(total, configurado = null) {
  const n = Number(total) || 0;
  if (n <= 0) return 0;
  if (Number.isFinite(Number(configurado)) && Number(configurado) > 0) {
    // Nunca mais do que existe: pódio com vaga vazia é pior que pódio pequeno.
    return Math.min(Math.round(Number(configurado)), n);
  }
  return Math.min(MAX, Math.max(1, Math.floor(n / 3)));
}

function validar(entrada, base = PADRAO) {
  const out = { ...base };
  for (const chave of ["sede", "externo"]) {
    if (entrada?.[chave] === undefined) continue;
    const v = entrada[chave];
    // Vazio, nulo ou zero voltam para o automático -- é assim que se DESFAZ uma
    // escolha manual sem precisar de um segundo campo "usar o padrão".
    if (v === null || v === "" || Number(v) === 0) {
      out[chave] = null;
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
    logger.warn("Config de premiados invalida no banco; usando o automatico", { message: e.message });
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

module.exports = { CHAVE, PADRAO, MAX, quantos, validar, obter, salvar };
