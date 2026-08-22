/**
 * Mescla a conversa que veio do servidor com a que já está na tela.
 *
 * Por que existe: o estado chega por DOIS caminhos concorrentes -- a resposta
 * HTTP de cada ação e o patch em tempo real (SSE). Quando um deles traz uma
 * versão montada ANTES da última mudança, uma substituição crua faz a tela
 * "piscar": a mensagem apagada volta, ou a recém-enviada some e reaparece.
 *
 * Duas regras resolvem isso:
 *
 *  1. Exclusão é MONOTÔNICA: uma vez apagada na tela, nenhuma resposta atrasada
 *     "des-apaga" (o soft-delete é permanente no banco, então manter é correto).
 *  2. Mensagens OTIMISTAS (ainda sem `id`, enviadas há instantes) sobrevivem até
 *     o servidor confirmá-las -- senão somem e voltam.
 */
export function mesclarConversa(atual, recebida) {
  if (!recebida) return recebida;
  if (!atual || !Array.isArray(atual.mensagens) || !Array.isArray(recebida.mensagens)) {
    return recebida;
  }

  let mensagens = recebida.mensagens;

  // 1. Preserva as exclusões já refletidas na tela.
  const apagadas = new Set(atual.mensagens.filter(m => m.deletada && m.id).map(m => m.id));
  if (apagadas.size) {
    mensagens = mensagens.map(m => (apagadas.has(m.id) ? { ...m, deletada: true } : m));
  }

  // 2. Mantém as otimistas que o servidor ainda não devolveu.
  const otimistas = atual.mensagens.filter(m => !m.id);
  if (otimistas.length) {
    const jaVeio = new Set(mensagens.map(m => `${m.de}|${m.texto}`));
    const pendentes = otimistas.filter(m => !jaVeio.has(`${m.de}|${m.texto}`));
    if (pendentes.length) mensagens = [...mensagens, ...pendentes];
  }

  return mensagens === recebida.mensagens ? recebida : { ...recebida, mensagens };
}
