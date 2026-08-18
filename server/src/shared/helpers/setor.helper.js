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

module.exports = { SETORES, SETOR_PADRAO, setorValido, normalizarSetor };
