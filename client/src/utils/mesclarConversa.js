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
 *  3. NENHUMA versão antiga sobrescreve uma mais nova. Cada escrita no servidor
 *     incrementa `conversa.versao`; aqui um retrato com versão menor ou igual à
 *     que já está em tela é DESCARTADO. Sem isso, a resposta lenta de uma ação
 *     (ou um evento SSE atrasado) reescrevia o estado atual com o de antes --
 *     era o que fazia a conversa recém-assumida voltar para "Pendentes" e o
 *     responsável piscar entre dois nomes.
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

/**
 * A versão recebida é mais velha (ou igual) à que já está em tela?
 *
 * Igual também é descartada: nada de novo veio do servidor, e manter o que está
 * em tela preserva a atualização otimista que ainda espera confirmação.
 * Conversa sem `versao` (resposta de uma API antiga durante um deploy parcial)
 * nunca é descartada -- na dúvida, o mais novo é o que acabou de chegar.
 */
function ehDesatualizada(atual, recebida) {
  return (
    atual != null &&
    typeof atual.versao === 'number' &&
    typeof recebida?.versao === 'number' &&
    recebida.versao <= atual.versao
  );
}

export function mesclarConversa(atual, recebida) {
  if (!recebida || !Array.isArray(recebida.mensagens)) return recebida;

  // Retrato mais velho que o atual: fica o que já está em tela. Como toda
  // escrita (inclusive gravar mensagem) incrementa a versão, um retrato antigo
  // nunca traz mensagem que o atual não tenha.
  if (ehDesatualizada(atual, recebida)) return atual;

  let mensagens = recebida.mensagens;

  // 1. Reaplica as exclusões conhecidas (do registro + do que está na tela).
  const apagadas = new Set(apagadasLocais);
  if (atual && Array.isArray(atual.mensagens)) {
    for (const m of atual.mensagens) if (m.deletada && m.id) apagadas.add(m.id);
  }
  if (apagadas.size) {
    mensagens = mensagens.map(m => (m.id && apagadas.has(m.id) ? { ...m, deletada: true } : m));
  }

  if (atual && Array.isArray(atual.mensagens)) {
    // 2. Nenhuma mensagem já conhecida pode SUMIR. Uma atualização montada antes
    //    da última mensagem (comum ao enviar vídeo: o upload demora e nesse meio
    //    tempo chega um evento antigo) removia a recém-enviada, que só voltava
    //    com F5. Mensagem nunca é removida no servidor (o apagar é soft-delete),
    //    então manter o que já está na tela é sempre correto.
    const idsRecebidos = new Set(mensagens.map(m => m.id).filter(Boolean));
    const ausentes = atual.mensagens.filter(m => m.id && !idsRecebidos.has(m.id));

    // 3. Mantém as otimistas (ainda sem id) que o servidor não devolveu.
    const jaVeio = new Set(mensagens.map(m => `${m.de}|${m.texto}`));
    const otimistas = atual.mensagens.filter(m => !m.id && !jaVeio.has(`${m.de}|${m.texto}`));

    if (ausentes.length || otimistas.length) {
      // ORDEM: as ausentes vêm ANTES das recebidas.
      //
      // Um evento de tempo real traz só a CAUDA do histórico (`parcial`), que é
      // por definição o trecho mais RECENTE -- ver
      // conversa.repository.findByIdParaEvento. Logo, tudo que a tela já tinha e
      // não veio agora é mais ANTIGO e precisa ficar acima; concatenar no fim
      // (como era) jogaria o histórico para depois das mensagens novas e a
      // conversa apareceria de cabeça para baixo.
      //
      // As otimistas ficam por último: ainda não existem no servidor, então são
      // sempre as mais recentes.
      mensagens = recebida.parcial
        ? [...ausentes, ...mensagens, ...otimistas]
        : [...mensagens, ...ausentes, ...otimistas];
    }
  }

  // Status que chegou antes da sua mensagem (ver statusPendentes): agora que a
  // mensagem está aqui, o risquinho é aplicado.
  mensagens = aplicarPendentes(mensagens);

  return mensagens === recebida.mensagens ? recebida : { ...recebida, mensagens };
}

/**
 * Aplica o patch de status de UMA mensagem (o risquinho de entrega/leitura).
 *
 * Existe para o ACK do WhatsApp não precisar redesenhar a conversa: antes, cada
 * "entregue"/"lida" trazia o histórico inteiro de volta -- até quatro vezes por
 * mensagem enviada. Aqui muda um campo de um item e o resto do estado é o mesmo
 * objeto, então nada além daquela bolha precisa ser reprocessado.
 *
 * Devolve a MESMA conversa quando não há o que mudar, para o React não
 * re-renderizar à toa.
 */
export function aplicarStatusMensagem(conversa, { mensagemId, status, versao }) {
  if (!conversa || !Array.isArray(conversa.mensagens)) return conversa;
  const i = conversa.mensagens.findIndex(m => m.id === mensagemId);
  // Mensagem que a tela ainda não conhece: guarda o status para aplicar quando
  // ela chegar. Ver `statusPendentes` -- sem isto o patch se perdia em silêncio
  // e a bolha ficava presa no relógio até um F5.
  if (i < 0) {
    guardarStatusPendente(mensagemId, status);
    return conversa;
  }
  if (conversa.mensagens[i].status === status) return conversa;

  const mensagens = conversa.mensagens.slice();
  mensagens[i] = { ...mensagens[i], status };
  return {
    ...conversa,
    mensagens,
    // A versão acompanha a do servidor: sem isso, o próximo retrato completo
    // seria descartado por `ehDesatualizada` como "igual ao que já tenho".
    versao: typeof versao === 'number' ? versao : conversa.versao,
  };
}

/**
 * STATUS QUE CHEGOU ANTES DA MENSAGEM.
 *
 * O patch de status (`mensagem:status`) é minúsculo de propósito: ele diz "a
 * mensagem X agora está entregue" e nada mais. Isso pressupõe que a tela já
 * conheça X -- e quase sempre conhece, porque o SSE entrega em ordem e o
 * retrato que traz a mensagem sai antes do patch.
 *
 * "Quase sempre" não basta para um risquinho preso no relógio: basta a conversa
 * não estar carregada naquele instante (recém-reconectado, primeira carga em
 * andamento) para o patch cair no vazio e a bolha mentir até alguém apertar F5.
 *
 * Então o status fica guardado e é aplicado no próximo retrato daquela
 * conversa. Só a ORDEM de entrega é resolvida aqui -- a verdade continua sendo
 * a do servidor, que é quem manda o status.
 *
 * O mapa é pequeno por construção (some ao ser aplicado) e tem teto, para uma
 * sequência de patches órfãos não virar vazamento de memória.
 */
const statusPendentes = new Map(); // mensagemId -> status
const MAX_PENDENTES = 200;

function guardarStatusPendente(mensagemId, status) {
  if (!mensagemId || !status) return;
  if (statusPendentes.size >= MAX_PENDENTES) {
    // Descarta o mais antigo: um patch órfão que nunca casou é lixo, e segurar
    // todos custaria mais do que perder um risquinho.
    statusPendentes.delete(statusPendentes.keys().next().value);
  }
  statusPendentes.set(mensagemId, status);
}

// Aplica (e consome) os status que chegaram antes das suas mensagens.
function aplicarPendentes(mensagens) {
  if (!statusPendentes.size) return mensagens;
  let mudou = false;
  const saida = mensagens.map(m => {
    const pendente = m.id && statusPendentes.get(m.id);
    if (!pendente || m.status === pendente) return m;
    statusPendentes.delete(m.id);
    mudou = true;
    return { ...m, status: pendente };
  });
  return mudou ? saida : mensagens;
}
