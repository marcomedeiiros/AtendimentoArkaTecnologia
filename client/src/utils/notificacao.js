/**
 * NOTIFICAÇÃO DO SISTEMA -- o aviso que chega com o painel fora da vista.
 *
 * ── O PROBLEMA QUE ELA RESOLVE ─────────────────────────────────────────────
 *
 * O som (`utils/sound`) só serve para quem está com o painel na frente. Quem
 * está em outra aba, em outro programa, ou com o navegador minimizado não vê o
 * contador subir nem lê o cabeçalho -- e mensagem de cliente parada é a única
 * coisa que esta plataforma existe para evitar.
 *
 * ── O QUE ELA ALCANÇA, E O QUE NÃO ─────────────────────────────────────────
 *
 * Enquanto a ABA ESTIVER ABERTA -- mesmo em segundo plano, em outra área de
 * trabalho, ou com a janela minimizada -- o SSE continua entregando e a
 * notificação aparece. É o caso da esmagadora maioria de um turno de trabalho.
 *
 * COM O NAVEGADOR FECHADO ela NÃO chega, e nenhum ajuste aqui muda isso: sem
 * aba não há JavaScript rodando. Só um Service Worker com Web Push resolveria,
 * e isso é outro assunto (chave VAPID, envio pelo servidor, assinatura por
 * aparelho). Está escrito aqui para ninguém prometer o que este arquivo não faz.
 *
 * ── SÓ AVISA QUANDO A PESSOA NÃO ESTÁ OLHANDO ──────────────────────────────
 *
 * Notificação do sistema por cima do painel que está em foco é ruído: a pessoa
 * já viu a conversa entrar na lista. `deveAvisar()` é o corte, e ele usa
 * `document.hidden` E `document.hasFocus()` -- a aba pode estar visível numa
 * janela que está atrás de outro programa, e nesse caso `hidden` é falso mas a
 * pessoa não está lendo.
 */

const ICONE = '/arka_tecnologia_logo-removebg-preview.png';

export function suportado() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function permissao() {
  if (!suportado()) return 'indisponivel';
  return Notification.permission; // 'granted' | 'denied' | 'default'
}

/**
 * Pede a permissão ao navegador.
 *
 * TEM DE SER CHAMADA A PARTIR DE UM CLIQUE. Os navegadores recusam (e alguns
 * marcam o site como abusivo) quando o pedido aparece sozinho no carregamento --
 * por isso não há chamada automática em lugar nenhum: quem dispara é o botão da
 * tela de configurações.
 */
export async function pedirPermissao() {
  if (!suportado()) return 'indisponivel';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/** A pessoa está de fato olhando para o painel agora? */
export function estaOlhando() {
  if (typeof document === 'undefined') return true;
  if (document.hidden) return false;
  // `hasFocus` cobre o caso que `hidden` não cobre: janela visível, mas atrás
  // de outro programa. Nem todo navegador antigo tem, daí o `typeof`.
  if (typeof document.hasFocus === 'function') return document.hasFocus();
  return true;
}

/**
 * Mostra a notificação. Devolve `true` se ela foi mesmo criada.
 *
 * `tag` agrupa por conversa: cinco mensagens seguidas do mesmo cliente viram um
 * aviso que se atualiza, e não cinco empilhados na tela de quem voltou do café.
 * `renotify` mantém o alerta do sistema mesmo quando a tag se repete -- sem ele
 * a segunda mensagem trocaria o texto em silêncio.
 */
export function notificar({ titulo, corpo, tag, aoClicar }) {
  if (!suportado() || Notification.permission !== 'granted') return false;
  try {
    const n = new Notification(titulo, {
      body: corpo,
      icon: ICONE,
      badge: ICONE,
      tag: tag || 'arka-mensagem',
      renotify: true,
      // Não é `requireInteraction`: um aviso que só some no clique vira parede
      // de cartões quando ninguém está na mesa.
    });
    n.onclick = () => {
      try {
        window.focus();
        aoClicar?.();
        n.close();
      } catch { /* janela já fechada */ }
    };
    return true;
  } catch {
    // Alguns navegadores lançam quando o construtor é usado onde só o Service
    // Worker pode notificar. Falhar aqui não pode derrubar o recebimento.
    return false;
  }
}
