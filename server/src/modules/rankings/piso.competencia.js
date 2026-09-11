/**
 * RECOMEÇAR A CONTAGEM DE **UMA** COMPETÊNCIA -- e só dela.
 *
 * ── O QUE ISTO É, E O QUE ELE NÃO É ────────────────────────────────────────
 *
 * Guarda um instante para uma competência específica: aquela competência passa
 * a contar dali, e **nenhuma outra é afetada**. Nada é apagado -- é piso de
 * janela, igual ao que o ciclo já faz.
 *
 * Não é o "Limpar dados do painel" que existiu até 11/09/2026 e foi removido a
 * pedido (ver o §11 de `docs/auditoria-ranking-zerado-10-09.md`). As três
 * diferenças são o motivo de este poder existir:
 *
 *   ESCOPO       aquele valia "de agora em diante, para sempre": cortava o mês
 *                corrente, o seguinte e todos os outros. Este pertence a UMA
 *                competência, e a próxima nasce limpa -- o corte não segue a
 *                equipe;
 *   VISIBILIDADE a tela do ranking escreve, na competência cortada, desde
 *                quando ela está contando. Sem isso, "a pontuação sumiu" é
 *                indistinguível de defeito -- e foi exatamente assim que o
 *                recurso antigo acabou;
 *   SEM BOTÃO    quem dispara é um script (`recomecar-contagem.js`), com
 *                autoria no log. Um clique numa tela de gestão que apaga o
 *                placar do time inteiro é barato de dar e caro de descobrir.
 *
 * ── POR QUE UM PISO, E NÃO UM DELETE ──────────────────────────────────────
 *
 * A razão é a mesma de sempre, e vale repetir porque a tentação volta: as OS
 * são lidas por mais gente do que o ranking. Os relatórios por CNPJ leem as
 * MESMAS linhas -- o documento de agosto de um cliente voltaria vazio depois de
 * ele já ter recebido a versão com números --, o histórico de CSAT do ano sai
 * junto, e o número da OS já foi dito ao cliente. Nada disso é recuperável; um
 * piso é.
 *
 * ── DESFAZER ───────────────────────────────────────────────────────────────
 *
 * `remover()`, e a pontuação volta inteira -- porque ela nunca saiu.
 */
const prisma = require("../../infrastructure/database/prisma.client");
const logger = require("../../config/logger");

const RANKINGS = ["sede", "externo"];
const chaveDe = (ranking) => `ranking.piso.${ranking}`;

const ehCompetencia = (v) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v || ""));

/**
 * O piso gravado para um ranking, se ele for DESTA competência.
 *
 * A competência guardada é parte da chave da resposta, e não um detalhe: é ela
 * que faz o corte não vazar para os meses seguintes. Pedido de outra
 * competência recebe `null`, e a janela dela fica como o ciclo manda.
 *
 * Valor corrompido devolve `null` em vez de estourar: um piso ilegível não pode
 * esconder o placar de ninguém -- seria o defeito antigo de volta, agora sem
 * nem um clique para explicá-lo.
 */
async function obter(ranking, competencia) {
  if (!RANKINGS.includes(ranking) || !ehCompetencia(competencia)) return null;
  try {
    const linha = await prisma.configuracao.findUnique({ where: { chave: chaveDe(ranking) } });
    if (!linha?.valor) return null;
    const salvo = JSON.parse(linha.valor);
    if (salvo?.competencia !== competencia) return null;
    const desde = new Date(salvo.desde);
    if (Number.isNaN(desde.getTime())) return null;
    return desde;
  } catch (e) {
    logger.warn("Piso de competencia invalido no banco; ignorando", {
      ranking,
      message: e.message,
    });
    return null;
  }
}

/** O piso cru, para o script dizer o que existe sem precisar saber o formato. */
async function bruto(ranking) {
  if (!RANKINGS.includes(ranking)) return null;
  const linha = await prisma.configuracao.findUnique({ where: { chave: chaveDe(ranking) } });
  if (!linha?.valor) return null;
  try {
    return JSON.parse(linha.valor);
  } catch {
    return { invalido: linha.valor };
  }
}

/**
 * Grava o piso: esta competência passa a contar a partir de agora.
 *
 * O INSTANTE É DO SERVIDOR, e a competência também. Recebê-los de fora deixaria
 * pedir piso em mês já premiado -- e o passado é justamente o que nem o ciclo
 * mexe (ver `ranking.ciclo`, o bloco das vigências).
 */
async function definir(ranking, competencia, autor = null) {
  if (!RANKINGS.includes(ranking)) throw new Error(`Ranking desconhecido: ${ranking}`);
  if (!ehCompetencia(competencia)) throw new Error(`Competencia invalida: ${competencia}`);

  const desde = new Date().toISOString();
  const valor = JSON.stringify({ competencia, desde });
  await prisma.configuracao.upsert({
    where: { chave: chaveDe(ranking) },
    update: { valor },
    create: { chave: chaveDe(ranking), valor },
  });
  // Com AUTORIA e no nivel de aviso: e o placar da equipe inteira mudando de
  // conteudo, e "os pontos sumiram" sem rastro de quem e quando e uma manha
  // perdida procurando defeito onde houve decisao.
  logger.warn("Contagem da competencia recomecada", {
    ranking,
    competencia,
    desde,
    por: autor || "script",
  });
  return { ranking, competencia, desde };
}

/** Desfaz. A pontuação volta inteira, porque ela nunca saiu. */
async function remover(ranking, autor = null) {
  if (!RANKINGS.includes(ranking)) throw new Error(`Ranking desconhecido: ${ranking}`);
  const { count } = await prisma.configuracao.deleteMany({ where: { chave: chaveDe(ranking) } });
  if (count) {
    logger.warn("Piso de competencia removido -- a pontuacao anterior volta", {
      ranking,
      por: autor || "script",
    });
  }
  return { ranking, removido: !!count };
}

module.exports = { RANKINGS, chaveDe, obter, bruto, definir, remover };
