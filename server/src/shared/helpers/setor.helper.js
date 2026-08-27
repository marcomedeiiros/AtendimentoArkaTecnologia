/**
 * Setores de atendimento lista canonica.
 *
 * Estes nomes nao sao decorativos: `podeAcessarSetor` (conversa.service.js) usa
 * exatamente estas strings para decidir quem ve qual conversa, e elas casam com
 * os cargos aceitos em equipe.service.js. Uma conversa gravada com "tecnico"
 * minusculo ou "Suporte" simplesmente nunca casaria com o cargo de ninguem e
 * ficaria visivel so para Administrador -- por isso tudo que grava setor passa
 * por aqui.
 *
 * "Geral" e o setor de quem ainda nao foi triado, e todo mundo o ve.
 */
const SETORES = ["Geral", "Financeiro", "Técnico", "Comercial"];

const SETOR_PADRAO = "Geral";

function setorValido(valor) {
  return SETORES.includes(String(valor || "").trim());
}

// Regra unica de "quem enxerga qual setor". Fonte da verdade compartilhada
// entre a listagem/leitura (conversa.service) e o stream em tempo real
// (conversa.stream) -- os dois PRECISAM decidir igual, senao o SSE vaza ao
// vivo o que a leitura esconde. `userCargo` vem do token ja validado.
//
//   - sem cargo / Administrador: ve tudo
//   - "Geral": setor de quem ainda nao foi triado; todos veem
//   - Financeiro/Tecnico/Comercial: so o proprio setor (e Tecnico nunca ve
//     Financeiro, nem por engano de normalizacao)
function podeAcessarSetor(userCargo, setorConversa) {
  if (!userCargo || userCargo === "Administrador") return true;
  const setorNorm = normalizarSetor(setorConversa);
  if (setorNorm === SETOR_PADRAO) return true;
  if (setorNorm === "Financeiro" && userCargo === "Técnico") return false;
  if (["Financeiro", "Técnico", "Comercial"].includes(userCargo)) {
    return setorNorm === userCargo;
  }
  return true;
}

// Aceita o que der para aproveitar (espaco sobrando, caixa diferente, sem
// acento) e cai no padrao em vez de gravar lixo no banco.
function normalizarSetor(valor) {
  const bruto = String(valor || "").trim();
  if (!bruto) return SETOR_PADRAO;

  const semAcento = (s) =>
    s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const achado = SETORES.find((s) => semAcento(s) === semAcento(bruto));
  return achado || SETOR_PADRAO;
}

/**
 * SETOR SO E DEFINIDO POR ESCOLHA -- nunca deduzido do que o cliente escreveu.
 *
 * Existiu aqui um `setorDetectado.helper` que lia as mensagens e adivinhava o
 * setor por palavra-chave ("nao funciona" -> Tecnico, "boleto" -> Financeiro).
 * A intencao era boa (o mapa fila->setor costuma estar vazio, e sem ele tudo
 * caia em "Geral"), mas o efeito era pior que o problema: uma conversa NOVA,
 * cujo cliente apenas disse "meu computador travou", ja nascia gravada como
 * Tecnico -- antes de o menu ser respondido, e sem ninguem ter escolhido nada.
 *
 * A regra agora e simples: o setor vem de uma DECLARACAO -- a opcao de menu que
 * o cliente escolheu (`opcao.setor`, definido no JSON do fluxo), o mapa de filas
 * de Configuracoes, ou o setor que a conversa JA tem gravado de uma escolha
 * anterior. Sem nenhuma das tres, fica "Geral" = ainda sem triagem.
 *
 * `setorAtual` importa: um handoff no meio do caminho (timeout, "quero um
 * atendente") nao pode APAGAR o setor que o cliente ja escolheu no menu.
 */
function resolverSetorDeclarado({ setorExplicito, setorDaFila, setorAtual } = {}) {
  const declarado = setorExplicito || setorDaFila || setorAtual;
  return declarado ? normalizarSetor(declarado) : SETOR_PADRAO;
}

module.exports = {
  SETORES,
  SETOR_PADRAO,
  setorValido,
  normalizarSetor,
  podeAcessarSetor,
  resolverSetorDeclarado,
};
