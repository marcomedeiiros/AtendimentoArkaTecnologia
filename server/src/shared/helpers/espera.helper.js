/**
 * DESDE QUANDO ESTA CONVERSA ESPERA UM ATENDENTE.
 *
 * ── O DEFEITO QUE ISTO FECHA ────────────────────────────────────────────────
 *
 * A espera era contada da ULTIMA MENSAGEM da conversa -- qualquer uma, de
 * qualquer lado. Aos 10 minutos na fila o proprio sistema manda "estamos com
 * uma demanda alta, em breve um atendente estara disponivel" (ver
 * `aplicarEsperaFila`), essa mensagem passa a ser a ultima do fio, e o painel
 * de parede voltava a marcar "agora".
 *
 * Nao era so o numero. A fila do Modo TV e ordenada pela mesma data, entao a
 * conversa que acabou de ser avisada ia para o FIM da lista: quem mais esperou
 * descia para baixo no instante seguinte ao sistema reconhecer que esperou
 * demais. E a cor acompanhava -- o cartao ambar voltava a verde.
 *
 * Vale para qualquer mensagem de saida (timeout da avaliacao, aviso de fora do
 * horario, atendente escrevendo sem assumir). A de demanda alta so era a mais
 * visivel por ser automatica e cair sempre no mesmo minuto.
 *
 * ── A ANCORA CERTA ──────────────────────────────────────────────────────────
 *
 * O instante em que a conversa ENTROU NA FILA. E uma data que nao se mexe
 * enquanto a pessoa espera: o relogio de quem desenha conta sozinho a partir
 * dela, e nenhuma mensagem -- de nenhum lado -- a desloca.
 *
 * A escada de fallback e a MESMA que o motor ja usava para decidir a hora de
 * avisar (`chatbot.engine.aplicarEsperaFila`), e nao uma segunda opiniao:
 *
 *   `sessao.concluidoEm`  o instante exato do handoff do bot para a fila. E o
 *                         melhor dado: exclui a triagem, em que ninguem estava
 *                         devendo resposta ao cliente.
 *   `abertoEm` da OS      conversa que chegou a fila sem passar por fluxo, ou
 *                         reaberta pelo atendente -- nao ha handoff a citar.
 *   `criadoEm`            fio antigo, sem OS. Ultimo recurso.
 *
 * ── POR QUE UM HELPER, E NAO A CONTA REPETIDA ───────────────────────────────
 *
 * Porque ela ja estava escrita em tres lugares, com tres respostas diferentes
 * para a mesma pergunta: `ultimaMensagemEm` na fila da Central, `atualizadoEm`
 * no `_fila` do painel (pior ainda -- anda a cada gravacao na linha) e a escada
 * correta dentro do motor. Tres respostas e o mesmo que nenhuma.
 */

/**
 * @param {object} conversa linha de Conversa com `sessao`, `atendimentos` e
 *   `atendimentoAtualId` carregados (ver INCLUDE_CONVERSA e o select do
 *   `_fila`). Campo ausente nao quebra: a escada simplesmente desce um degrau.
 * @returns {Date|string|null} o instante, no formato em que veio do banco.
 */
function entrouNaFilaEm(conversa) {
  if (!conversa) return null;

  const atendimentos = conversa.atendimentos || [];
  const atual =
    atendimentos.find((a) => a.id === conversa.atendimentoAtualId) || atendimentos[0] || null;

  return conversa.sessao?.concluidoEm || atual?.abertoEm || conversa.criadoEm || null;
}

/** O mesmo instante, em ISO -- o formato que os DTOs falam. */
function entrouNaFilaISO(conversa) {
  const d = entrouNaFilaEm(conversa);
  if (!d) return null;
  return d.toISOString?.() || d;
}

module.exports = { entrouNaFilaEm, entrouNaFilaISO };
