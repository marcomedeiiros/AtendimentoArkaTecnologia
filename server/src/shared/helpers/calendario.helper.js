/**
 * O CALENDARIO, na unica pergunta que este sistema faz a ele: QUE DIA EXISTE.
 *
 * ── POR QUE ISTO E UM HELPER, E NAO UMA LINHA EM CADA LUGAR ────────────────
 *
 * Duas regras configuraveis marcam um DIA DO MES e precisam sobreviver a
 * fevereiro:
 *
 *   `rankings/ciclo`            o dia em que o ciclo do ranking vira;
 *   `rankings/relatorio.regras` o vencimento mensal do relatorio de visita.
 *
 * As duas eram limitadas ao dia 28, com a MESMA justificativa escrita duas
 * vezes ("fevereiro nao tem 30"). O limite resolvia o problema errado: quem
 * fecha folha no dia 30 precisa do dia 30, e "escolha 28" custa dois dias de
 * trabalho caindo no periodo seguinte, todo mes.
 *
 * ── O QUE ACONTECE SEM ISTO ────────────────────────────────────────────────
 *
 * `new Date(2026, 1, 30)` nao estoura: ele TRANSBORDA para 02 de marco. Uma
 * data inventada nao falha alto -- ela vira um periodo deslocado, silencioso,
 * que ninguem relaciona com a configuracao salva meses antes.
 *
 * ── A REGRA ────────────────────────────────────────────────────────────────
 *
 * O dia escolhido, ou o ultimo que aquele mes tiver. Dia 30 cai em 28/02 (29 em
 * ano bissexto); dia 31 significa, na pratica, "sempre no ultimo dia do mes".
 *
 * MORA AQUI e nao dentro de um dos dois porque QUEM PERGUNTA SAO DOIS -- e uma
 * segunda copia desta aparagem e o comeco de dois calendarios diferentes na
 * mesma tela.
 */

/** Quantos dias tem o mes. `mesIdx` e o indice do `Date` (0 = janeiro). */
const diasNoMes = (ano, mesIdx) => new Date(ano, mesIdx + 1, 0).getDate();

/**
 * O dia pedido, aparado para um dia que existe naquele mes.
 *
 * @param {number} ano
 * @param {number} mesIdx indice do mes como no `Date` (0 = janeiro). Aceita 12
 *   e vai para janeiro do ano seguinte, igual ao `Date` -- e o caso de "o mes
 *   seguinte" em dezembro, que os dois consumidores calculam.
 * @param {number} dia 1 a 31
 */
const diaQueExiste = (ano, mesIdx, dia) => Math.min(dia, diasNoMes(ano, mesIdx));

module.exports = { diasNoMes, diaQueExiste };
