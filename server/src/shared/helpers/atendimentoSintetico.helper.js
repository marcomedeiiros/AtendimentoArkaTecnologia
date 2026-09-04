/**
 * A OS SINTETICA do historico importado -- e por que ela precisa de um nome
 * publicado, em vez de uma string solta no repositorio.
 *
 * ── O QUE E ────────────────────────────────────────────────────────────────
 *
 * Quando alguem importa o historico do celular para dentro de uma conversa, as
 * mensagens antigas precisam pertencer a ALGUMA OS -- senao a Central, que
 * recorta o historico por atendimento, nao teria onde encaixa-las. Entao e
 * criada uma OS propria, ja fechada, carimbada com este rotulo no campo
 * `atendenteNome` (ver conversa.repository.criarAtendimentoImportado).
 *
 * ── O DEFEITO QUE ISTO CONSERTA ────────────────────────────────────────────
 *
 * O rotulo mora no mesmo campo em que moram os NOMES DE PESSOAS. O ranking
 * agrupa por esse campo e so descarta quem esta em branco ("sem responsavel" =
 * atendimento do bot). Resultado: "Historico do WhatsApp" aparecia na
 * classificacao como se fosse um atendente, com um atendimento fechado e um
 * ponto -- e ninguem na equipe conhecia essa pessoa.
 *
 * Valia para as DUAS telas, porque as duas usam a mesma funcao de pontuacao: a
 * Visao Geral (onde foi notado) e o painel de parede, onde bastaria a operacao
 * estar comecando para o rotulo subir ao podio na frente da equipe inteira.
 *
 * ── POR QUE UMA CONSTANTE, E NAO A STRING REPETIDA ─────────────────────────
 *
 * Quem grava e quem filtra estao em modulos diferentes e nao se conhecem. Com
 * a string escrita duas vezes, mudar o rotulo (um acento, uma maiuscula) faria
 * a gravacao e o filtro deixarem de casar EM SILENCIO -- e o falso atendente
 * voltaria a aparecer sem nada indicando o porque.
 */
const ATENDENTE_HISTORICO_IMPORTADO = "Histórico do WhatsApp";

/**
 * Este `atendenteNome` e uma pessoa de verdade?
 *
 * Nulo/vazio e o atendimento que o bot resolveu sozinho; o rotulo acima e um
 * carimbo de sistema. Nenhum dos dois entra em ranking de gente.
 */
function ehAtendenteReal(nome) {
  const limpo = String(nome || "").trim();
  return limpo.length > 0 && limpo !== ATENDENTE_HISTORICO_IMPORTADO;
}

module.exports = { ATENDENTE_HISTORICO_IMPORTADO, ehAtendenteReal };
