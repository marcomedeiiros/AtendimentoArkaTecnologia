// FOTO DE PERFIL DO CLIENTE -- por que ela some sozinha depois de uns dias.
//
// A `fotoUrl` que guardamos e um link do CDN do WhatsApp
// (`pps.whatsapp.net/...`), e esse link TEM PRAZO: o parametro `oe=` e a data
// de validade, em hexadecimal, no formato Unix. Passou do prazo, o CDN
// responde 403 e o avatar do cliente vira as iniciais -- sem nenhum erro no
// log, porque quem recebe o 403 e o navegador do operador, nao o servidor.
//
// Medido em producao (02/09/2026): das 6 conversas com foto, 3 tinham link
// vencido (30/08, 30/08 e 31/08) e respondiam 403. As outras 3, com validade
// para 03, 04 e 05/09, apareciam normalmente. Era exatamente a divisao entre
// "algumas conversas mostram foto e outras nao".
//
// O codigo so buscava a foto quando ela era NULA (`if (!conversa.fotoUrl)`),
// entao um link vencido nunca era trocado: ficava gravado para sempre,
// apontando para um 403 permanente.
//
// A renovacao roda em segundo plano de proposito. A listagem da Central e um
// caminho quente (a tela faz polling) e ja foi otimizada para nao fazer
// chamada de rede -- pendurar um `fetchProfilePictureUrl` por conversa ali
// devolveria o problema de desempenho que aquele comentario descreve.
const prisma = require("../../infrastructure/database/prisma.client");
const conversaRepository = require("../../infrastructure/repositories/conversa.repository");
const evolutionApi = require("../../infrastructure/external/evolution-api.client");
const env = require("../../config/env");
const logger = require("../../config/logger");

const INTERVALO_MS = Number(process.env.FOTOS_RENOVACAO_INTERVALO_MS) || 60 * 60 * 1000;

// Teto por rodada: a renovacao e uma chamada de rede por conversa, e uma base
// grande com muita foto vencida nao pode virar uma rajada contra a Evolution.
// O que sobrar espera a proxima volta -- ninguem fica sem foto por isso, so
// demora mais um ciclo.
const MAX_POR_RODADA = Number(process.env.FOTOS_RENOVACAO_MAX) || 25;

// Renova um pouco ANTES de vencer: um link que expira em duas horas ja vai
// quebrar antes da proxima varredura.
const FOLGA_MS = 6 * 60 * 60 * 1000;

let timer = null;
let rodando = false;

/**
 * O link ja venceu (ou vence dentro da folga)?
 *
 * Link sem `oe=` responde `false`: nao da para afirmar que venceu, e trocar um
 * link que talvez esteja bom custaria uma chamada de rede por conversa a cada
 * varredura. Na duvida, deixa como esta -- o caminho de abrir a conversa ainda
 * conserta esse caso.
 */
function vencida(url) {
  const m = /[?&]oe=([0-9A-Fa-f]+)/.exec(String(url || ""));
  if (!m) return false;
  const expiraEm = parseInt(m[1], 16) * 1000;
  if (!Number.isFinite(expiraEm) || expiraEm <= 0) return false;
  return expiraEm - FOLGA_MS <= Date.now();
}

// A foto precisa ser buscada de novo? Vale tanto para a que nunca existiu
// quanto para a que apodreceu.
function precisaRenovar(url) {
  return !url || vencida(url);
}

async function renovarUma(conversa) {
  const foto = await evolutionApi
    .fetchProfilePictureUrl(conversa.telefone, env.evolutionApi.instance)
    .catch(() => null);
  // Sem foto publica a Evolution devolve null. Nesse caso NAO apagamos o link
  // vencido: ele nao serve para exibir, mas tambem nao atrapalha, e reescrever
  // para null a cada volta so geraria escrita a toa.
  if (!foto || foto === conversa.fotoUrl) return false;
  await conversaRepository.update(conversa.id, { fotoUrl: foto });
  return true;
}

async function varrer() {
  if (rodando) return { ignorado: "em_execucao" };
  rodando = true;
  try {
    // O filtro fino (vencida) e feito aqui, e nao no SQL: o prazo esta DENTRO
    // da string da URL, e nao existe indice que ajude a ler hexadecimal.
    const candidatas = await prisma.conversa.findMany({
      where: { fotoUrl: { not: null } },
      select: { id: true, telefone: true, fotoUrl: true },
    });

    const vencidas = candidatas.filter((c) => vencida(c.fotoUrl)).slice(0, MAX_POR_RODADA);
    if (!vencidas.length) return { verificadas: candidatas.length, renovadas: 0 };

    let renovadas = 0;
    for (const c of vencidas) {
      try {
        if (await renovarUma(c)) renovadas += 1;
      } catch (e) {
        logger.warn("Falha ao renovar foto de perfil", { telefone: c.telefone, message: e.message });
      }
    }

    logger.info("Fotos de perfil renovadas", {
      vencidas: vencidas.length,
      renovadas,
      restantes: candidatas.filter((c) => vencida(c.fotoUrl)).length - vencidas.length,
    });
    return { verificadas: candidatas.length, renovadas };
  } catch (e) {
    logger.warn("Varredura de fotos de perfil falhou", { message: e.message });
    return { erro: e.message };
  } finally {
    rodando = false;
  }
}

function iniciar() {
  if (timer) return timer;
  // Espera o boot assentar: no arranque a Evolution pode nem estar de pe, e a
  // varredura inteira falharia a toa.
  setTimeout(() => { varrer(); }, 60_000);
  timer = setInterval(() => { varrer(); }, INTERVALO_MS);
  if (timer.unref) timer.unref();
  logger.info("Renovacao de fotos de perfil iniciada", { intervaloMs: INTERVALO_MS });
  return timer;
}

function parar() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { iniciar, parar, varrer, vencida, precisaRenovar };
