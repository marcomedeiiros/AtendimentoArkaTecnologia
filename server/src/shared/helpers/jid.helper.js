/**
 * O QUE E, E O QUE NAO E, UMA CONVERSA DE ATENDIMENTO.
 *
 * O WhatsApp entrega tudo pelo mesmo webhook: conversa de uma pessoa, mensagem
 * de grupo, status ("stories"), lista de transmissao e canal. Quem separa e o
 * SUFIXO do `remoteJid` -- e ate aqui o recebimento nao separava nada.
 *
 * ── O QUE ACONTECEU, PARA NAO ACONTECER DE NOVO ────────────────────────────
 *
 * `extrairTelefone` faz `split("@")[0]` e limpa o que nao e digito. Para um
 * grupo antigo, cujo jid e "5527998189226-1620131695@g.us", isso devolve
 * "55279981892261620131695" -- 23 digitos, o hifen comido -- e o recebimento
 * seguiu em frente e ABRIU UMA CONVERSA. As mensagens que a equipe trocava no
 * grupo passaram a cair na fila de atendimento, com o pushName de quem falou
 * como se fosse um cliente.
 *
 * Nao dava para responder de volta: o envio monta "<telefone>@s.whatsapp.net" e
 * aquele numero nao existe. Entao o estrago foi de RUIDO -- conversa fantasma na
 * fila, com nao-lidas -- e nao de mensagem nossa vazando para o grupo.
 *
 * ── LISTA DE RECUSA, E NAO LISTA DE PERMISSAO ──────────────────────────────
 *
 * A tentacao e exigir `@s.whatsapp.net` e pronto. E mais apertado e seria
 * errado aqui: o WhatsApp vem introduzindo identificadores novos (`@lid`, por
 * exemplo) para conversas de pessoas de verdade, e uma allowlist transformaria
 * cada novidade dessas em CLIENTE QUE SOME EM SILENCIO -- o pior defeito
 * possivel numa caixa de atendimento, porque ninguem reclama do que nao viu.
 *
 * Entao aqui se recusa o que sabidamente NAO e atendimento, e o resto passa. Um
 * sufixo desconhecido entra e alguem estranha; um cliente perdido, nao.
 */

// Sufixos que nunca sao conversa de atendimento.
//
//   @g.us              grupo
//   @broadcast         lista de transmissao (inclui "status@broadcast")
//   @newsletter        canal
const SUFIXOS_QUE_NAO_ATENDEM = ["@g.us", "@broadcast", "@newsletter"];

/**
 * @param {string} jid remoteJid como veio do WhatsApp
 * @returns {string|null} o motivo da recusa, ou null quando e atendimento
 */
function motivoParaIgnorarJid(jid) {
  const bruto = String(jid || "").toLowerCase();
  if (!bruto) return null; // sem jid: nao e este helper que decide

  if (bruto.endsWith("@g.us")) return "grupo";
  if (bruto.endsWith("@broadcast")) return "transmissao";
  if (bruto.endsWith("@newsletter")) return "canal";
  return null;
}

const ehConversaDeAtendimento = (jid) => motivoParaIgnorarJid(jid) === null;

module.exports = {
  SUFIXOS_QUE_NAO_ATENDEM,
  motivoParaIgnorarJid,
  ehConversaDeAtendimento,
};
