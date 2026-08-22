/**
 * Mescla a conversa que veio do servidor com a que já está na tela.
 *
 * Por que existe: o estado chega por VÁRIOS caminhos concorrentes -- a resposta
 * HTTP de cada ação, o patch em tempo real (SSE) e a releitura periódica. Quando
 * um deles traz uma versão montada ANTES da última mudança, uma substituição
 * crua faz a tela "piscar": a mensagem apagada volta, ou a recém-enviada some e
 * reaparece.
 *
 * Duas regras resolvem isso:
 *
 *  1. Exclusão é MONOTÔNICA e PERSISTENTE. Guardamos os ids apagados num
 *     registro próprio (não dependemos do estado anterior): mesmo que um caminho
 *     substitua tudo e perca a marca, a próxima mesclagem a recoloca. Sem isso,
 *     bastava UM caminho sem merge para a mensagem apagada voltar e nunca mais
 *     ser corrigida. O soft-delete é permanente no banco, então manter é correto.
 *  2. Mensagens OTIMISTAS (ainda sem `id`, enviadas há instantes) sobrevivem até
 *     o servidor confirmá-las -- senão somem e voltam.
 */

// Ids apagados nesta sessão. Sobrevive a qualquer substituição de estado; é
// zerado só no F5 (aí o servidor já é a fonte da verdade).
const apagadasLocais = new Set();

export function registrarApagada(id) {
  if (id) apagadasLocais.add(id);
}

export function desfazerApagada(id) {
  if (id) apagadasLocais.delete(id);
}

export function mesclarConversa(atual, recebida) {
  if (!recebida || !Array.isArray(recebida.mensagens)) return recebida;

  let mensagens = recebida.mensagens;

  // 1. Reaplica as exclusões conhecidas (do registro + do que está na tela).
  const apagadas = new Set(apagadasLocais);
  if (atual && Array.isArray(atual.mensagens)) {
    for (const m of atual.mensagens) if (m.deletada && m.id) apagadas.add(m.id);
  }
  if (apagadas.size) {
    mensagens = mensagens.map(m => (m.id && apagadas.has(m.id) ? { ...m, deletada: true } : m));
  }

  // 2. Mantém as otimistas que o servidor ainda não devolveu.
  if (atual && Array.isArray(atual.mensagens)) {
    const otimistas = atual.mensagens.filter(m => !m.id);
    if (otimistas.length) {
      const jaVeio = new Set(mensagens.map(m => `${m.de}|${m.texto}`));
      const pendentes = otimistas.filter(m => !jaVeio.has(`${m.de}|${m.texto}`));
      if (pendentes.length) mensagens = [...mensagens, ...pendentes];
    }
  }

  return mensagens === recebida.mensagens ? recebida : { ...recebida, mensagens };
}
