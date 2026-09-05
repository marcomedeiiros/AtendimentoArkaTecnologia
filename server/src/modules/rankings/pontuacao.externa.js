/**
 * A PONTUACAO DO ATENDIMENTO FORA DA SEDE -- 0 a 100.
 *
 * ── POR QUE UMA FORMULA NOVA, E SO AQUI ────────────────────────────────────
 *
 * A pontuacao da SEDE nao foi tocada e nao e reimplementada em lugar nenhum:
 * o ranking da sede chama `painelService.rankingDoMes`, que e a mesma funcao do
 * painel de parede. Esta formula existe porque a equipe externa nao tem o
 * insumo daquela: ninguem manda pesquisa de satisfacao depois de uma visita
 * tecnica, e "tempo ate assumir" nao significa nada para quem pega a estrada.
 *
 * O que mede o trabalho deles e o RELATORIO de mapeamento: se saiu, se saiu
 * completo, se tem evidencia, se chegou no prazo e se voltou para correcao.
 *
 * ── AS CINCO PARCELAS, E O PORQUE DE CADA PESO ─────────────────────────────
 *
 *   VOLUME            25   quantos relatorios entregues no mes
 *   COMPLETUDE        25   quanto do formulario tecnico foi preenchido
 *   PRAZO             20   quantos chegaram dentro do prazo
 *   EVIDENCIAS        15   fotos/anexos por mapeamento
 *   RETRABALHO        15   desconta por devolucao para correcao
 *                    ---
 *                    100
 *
 * COMPLETUDE e PRAZO somam 45 de propósito: sao o que o supervisor recebe e o
 * que faz o relatorio ser util para a empresa visitada. VOLUME vem logo atras
 * porque visita que nao acontece nao gera nada -- mas ele nao lidera, senao a
 * corrida vira "quantas portas eu bato", que e exatamente o comportamento que
 * um mapeamento tecnico nao deve premiar.
 *
 * ── FAIXA x PROPORCIONAL, a mesma escolha que a sede ja fazia ──────────────
 *
 * VOLUME e EVIDENCIAS sao FAIXAS. Proporcional premiaria cada unidade a mais
 * para sempre -- e o incentivo vira visita apressada e album de 40 fotos do
 * mesmo rack. A faixa premia o habito e para de premiar depois, exatamente
 * como a agilidade da sede (ver FAIXAS_AGILIDADE em painel.service).
 *
 * COMPLETUDE e PRAZO sao PROPORCIONAIS, porque ali a media E a nota: entregar
 * 9 de 10 relatorios no prazo e mesmo 90% do trabalho, sem degrau a defender.
 *
 * ── O MINIMO DE AMOSTRA ────────────────────────────────────────────────────
 *
 * As parcelas de QUALIDADE (completude, prazo, evidencias) so contam com pelo
 * menos MINIMO_MAPEAMENTOS entregues. Sem isso, quem fez UMA visita perfeita no
 * mes ficaria com 65 pontos de qualidade e lideraria o ranking em cima de uma
 * amostra de um -- o mesmo defeito que o minimo de avaliacoes ja impede do
 * outro lado (ver MINIMO_AVALIACOES). Abaixo do minimo a tela diz "1 de 3", e
 * nao "0,0": e amostra pequena, nao trabalho ruim.
 */

// Quantos mapeamentos entregues para as parcelas de qualidade valerem.
const MINIMO_MAPEAMENTOS = 3;

const PESOS = { volume: 25, completude: 25, prazo: 20, evidencias: 15, retrabalho: 15 };

// Faixas de volume: relatorios ENTREGUES no mes -> pontos. Lidas de cima para
// baixo. Contavam aprovados; a aprovacao saiu (ver o bloco em pontuarExterno).
const FAIXAS_VOLUME = [
  { aPartirDe: 8, pontos: 25 },
  { aPartirDe: 6, pontos: 20 },
  { aPartirDe: 4, pontos: 15 },
  { aPartirDe: 2, pontos: 8 },
  { aPartirDe: 1, pontos: 3 },
];

// Faixas de evidencia: MEDIA de anexos por mapeamento -> pontos. Tres fotos ja
// contam a historia de uma visita; a quarta nao informa mais nada a quem le.
const FAIXAS_EVIDENCIAS = [
  { aPartirDe: 3, pontos: 15 },
  { aPartirDe: 2, pontos: 10 },
  { aPartirDe: 1, pontos: 5 },
];

// Cada devolucao para correcao custa isto, ate zerar a parcela.
const CUSTO_POR_DEVOLUCAO = 5;

/**
 * Itens do checklist tecnico que a completude mede.
 *
 * A lista vive aqui e NAO no formulario da tela: se ela morasse so no front,
 * bastava alguem adicionar um campo novo para a completude de todo mundo cair
 * sem ninguem ter feito nada de diferente. Mudar esta lista e uma decisao
 * consciente sobre o que conta como relatorio completo.
 */
const ITENS_MAPEAMENTO = [
  { chave: "infraestrutura", rotulo: "Infraestrutura e rede" },
  { chave: "servidores", rotulo: "Servidores e estações" },
  { chave: "backup", rotulo: "Backup e retenção" },
  { chave: "seguranca", rotulo: "Segurança e antivírus" },
  { chave: "internet", rotulo: "Links e provedores" },
  { chave: "telefonia", rotulo: "Telefonia e ramais" },
  { chave: "softwares", rotulo: "Sistemas e licenças" },
  { chave: "riscos", rotulo: "Riscos identificados" },
];

const faixa = (lista, valor) => lista.find((f) => valor >= f.aPartirDe)?.pontos || 0;
const media = (l) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : 0);

/**
 * Quanto deste mapeamento foi preenchido, de 0 a 1.
 *
 * Conta o CHECKLIST mais o resumo. Um relatorio com todos os itens marcados e
 * nenhuma linha escrita nao e um relatorio completo -- e uma lista de caixas.
 */
function completudeDe(m) {
  const itens = m.itens && typeof m.itens === "object" ? m.itens : {};
  const preenchidos = ITENS_MAPEAMENTO.filter((i) => {
    const v = itens[i.chave];
    return typeof v === "string" ? v.trim().length > 0 : !!v;
  }).length;
  const comResumo = String(m.resumo || "").trim().length >= 20 ? 1 : 0;
  return (preenchidos + comResumo) / (ITENS_MAPEAMENTO.length + 1);
}

/**
 * Quantas evidencias este relatorio tem.
 *
 * O MAIOR entre as fotos anexadas a parte e as fotos que estao DENTRO do PDF.
 * Nao a soma: as duas contam a mesma coisa por caminhos diferentes, e somar
 * daria ponto dobrado para quem anexasse a mesma foto nos dois lugares.
 *
 * `fotosRelatorio` nulo (relatorio anterior a leitura automatica) nao tira nada
 * de ninguem -- so nao acrescenta.
 */
const quantidadeEvidencias = (m) =>
  Math.max(Array.isArray(m.evidencias) ? m.evidencias.length : 0, m.fotosRelatorio || 0);

// No prazo = entregue ate o fim do dia do prazo. Comparar por instante puniria
// quem entregou as 18h de um prazo gravado as 9h da manha.
function noPrazo(m) {
  if (!m.entregueEm || !m.prazoEm) return false;
  const limite = new Date(m.prazoEm);
  limite.setHours(23, 59, 59, 999);
  return new Date(m.entregueEm) <= limite;
}

/**
 * Pontua UMA pessoa a partir dos mapeamentos dela no mes.
 *
 * Devolve as parcelas SEPARADAS, e nao so o total -- pelo mesmo motivo que a
 * formula da sede faz isso: quem discorda do peso precisa poder discordar de
 * uma conta visivel, e quem esta em terceiro precisa saber em qual parcela
 * perdeu. Um numero unico nao responde nem uma coisa nem outra.
 *
 * ── OS NUMEROS PODEM VIR DA CONFIGURACAO ───────────────────────────────────
 *
 * `regras` traz o que o administrador define na tela de Configuracao de
 * relatorios: pesos, minimo de relatorios e desconto por devolucao. Ausente,
 * valem as constantes deste arquivo -- que continuam sendo a FONTE do padrao, e
 * nao uma copia dele.
 *
 * A FORMULA nao vem de fora. O jeito de somar as parcelas continua aqui,
 * fechado: peso e decisao de negocio, mas "como se calcula" e decisao de
 * engenharia, e abrir as duas na mesma tela e como ninguem mais conseguir
 * explicar por que o numero deu aquilo.
 *
 * @param {Array} lista mapeamentos ENTREGUES da pessoa no mes
 * @param {object} [regras] pesos e limites vindos da configuracao
 */
function pontuarExterno(lista, regras = null) {
  const pesos = { ...PESOS, ...(regras?.pesos || {}) };
  const minimo = regras?.minimoRelatorios ?? MINIMO_MAPEAMENTOS;
  const custoDevolucao = regras?.custoPorDevolucao ?? CUSTO_POR_DEVOLUCAO;
  // So o que ja saiu da mao do tecnico entra na conta: rascunho e trabalho em
  // andamento, e pontuar rascunho premiaria abrir formulario.
  const entregues = lista.filter((m) => m.status !== "rascunho");
  // Continua sendo lido para a TELA mostrar quantos foram aprovados no tempo em
  // que a aprovacao existia. Nao entra mais em conta nenhuma.
  const aprovados = entregues.filter((m) => m.status === "aprovado");
  const temAmostra = entregues.length >= minimo;

  /**
   * AS FAIXAS ESCALAM COM O PESO.
   *
   * FAIXAS_VOLUME e FAIXAS_EVIDENCIAS foram escritas para os tetos padrao (25 e
   * 15). Se o administrador der 40 a volume e a faixa continuasse cravada em 25,
   * mexer no peso nao mudaria quase nada e a tela passaria a mentir sobre a
   * propria regra -- "volume vale 40" com o maximo real em 25.
   *
   * Reescalar mantem a FORMA da faixa (os degraus, e onde eles ficam) e muda so
   * o quanto ela vale no total, que e exatamente o que o peso significa.
   */
  const escalar = (pontos, tetoPadrao, tetoAtual) =>
    tetoPadrao === tetoAtual ? pontos : Math.round((pontos / tetoPadrao) * tetoAtual);

  /**
   * VOLUME conta os ENTREGUES, e nao os aprovados.
   *
   * Contava aprovados enquanto existia o passo de aprovacao. Ele saiu -- o
   * supervisor agora so devolve o que tem problema -- e a parcela ficaria
   * zerada para todo mundo, para sempre, se continuasse esperando um carimbo
   * que ninguem mais da.
   *
   * Medir o entregue tambem e mais honesto com o que a parcela sempre quis
   * dizer: "quantas visitas viraram relatorio neste mes". A qualidade continua
   * cobrada nas outras quatro parcelas, e a devolucao desconta em retrabalho.
   */
  const ptsVolume = escalar(faixa(FAIXAS_VOLUME, entregues.length), PESOS.volume, pesos.volume);

  const mediaCompletude = media(entregues.map(completudeDe));
  const ptsCompletude = temAmostra ? Math.round(mediaCompletude * pesos.completude) : 0;

  const proporcaoPrazo = entregues.length ? entregues.filter(noPrazo).length / entregues.length : 0;
  const ptsPrazo = temAmostra ? Math.round(proporcaoPrazo * pesos.prazo) : 0;

  const mediaEvidencias = media(entregues.map(quantidadeEvidencias));
  const ptsEvidencias = temAmostra
    ? escalar(faixa(FAIXAS_EVIDENCIAS, mediaEvidencias), PESOS.evidencias, pesos.evidencias)
    : 0;

  const devolucoes = entregues.reduce((s, m) => s + (Number(m.devolucoes) || 0), 0);
  // Sem nenhum mapeamento nao ha retrabalho a premiar: a parcela cheia iria
  // para quem nao trabalhou, que e o oposto do que ela mede.
  const ptsRetrabalho = entregues.length
    ? Math.max(0, pesos.retrabalho - devolucoes * custoDevolucao)
    : 0;

  return {
    pontos: ptsVolume + ptsCompletude + ptsPrazo + ptsEvidencias + ptsRetrabalho,
    volume: { valor: entregues.length, aprovados: aprovados.length, entregues: entregues.length, pontos: ptsVolume },
    completude: {
      valor: entregues.length ? Math.round(mediaCompletude * 100) : null,
      conta: temAmostra,
      amostra: entregues.length,
      pontos: ptsCompletude,
    },
    prazo: {
      valor: entregues.length ? Math.round(proporcaoPrazo * 100) : null,
      conta: temAmostra,
      amostra: entregues.length,
      pontos: ptsPrazo,
    },
    evidencias: {
      valor: entregues.length ? Math.round(mediaEvidencias * 10) / 10 : null,
      conta: temAmostra,
      amostra: entregues.length,
      pontos: ptsEvidencias,
    },
    retrabalho: { devolucoes, pontos: ptsRetrabalho },
  };
}

module.exports = {
  pontuarExterno,
  completudeDe,
  noPrazo,
  ITENS_MAPEAMENTO,
  MINIMO_MAPEAMENTOS,
  PESOS,
  FAIXAS_VOLUME,
  FAIXAS_EVIDENCIAS,
  CUSTO_POR_DEVOLUCAO,
};
