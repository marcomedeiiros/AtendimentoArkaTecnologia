/**
 * Datas SEMPRE no fuso de Brasília.
 *
 * Por que existe: `new Date().toISOString().slice(0,10)` devolve a data em UTC.
 * Às 21h de Brasília já é o dia SEGUINTE em UTC — então, toda noite, a Agenda
 * marcava o dia errado como "hoje", o formulário de novo compromisso abria com a
 * data de amanhã e a contagem de pendentes (`data >= hoje`) deixava de contar os
 * compromissos do próprio dia.
 *
 * O mesmo vale para nome de arquivo de relatório: exportar às 21h30 do dia 22
 * gerava "relatorio-arka-2026-08-23.csv".
 *
 * Fuso FIXO, e não o do navegador, pela mesma razão que o resto do sistema fixa
 * (ver formatarHora no servidor): a operação é uma só, em Brasília, e o painel
 * pode ser aberto de qualquer lugar.
 */
export const FUSO_BR = 'America/Sao_Paulo';

// "en-CA" dá exatamente YYYY-MM-DD, o formato que o banco e as comparações usam.
const formatador = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO_BR,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Data (YYYY-MM-DD) de um instante, no fuso de Brasília. */
export function dataISO(quando = new Date()) {
  const d = quando instanceof Date ? quando : new Date(quando);
  if (Number.isNaN(d.getTime())) return '';
  return formatador.format(d);
}

/** Hoje (YYYY-MM-DD) em Brasília. */
export function hojeISO() {
  return dataISO(new Date());
}

/** Ano e mês (0-11) de hoje em Brasília — para o calendário abrir no mês certo. */
export function anoMesHoje() {
  const [ano, mes] = hojeISO().split('-');
  return { ano: Number(ano), mes: Number(mes) - 1 };
}
