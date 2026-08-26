import { createPortal } from 'react-dom';

/**
 * Renderiza o conteúdo direto no <body>, fora da árvore de layout -- é o que
 * permite a um modal cobrir a tela sem ser recortado por `overflow` de algum
 * container acima dele.
 *
 * O invólucro carrega `data-portal-modal` de propósito: atalhos globais de
 * teclado (o ESC que sai da conversa, em AtendimentoView) precisam saber que há
 * um modal aberto para NÃO agir por baixo dele. Sem uma marca no DOM, cada
 * atalho teria de conhecer o estado de cada modal do sistema -- e esqueceria do
 * próximo modal que alguém criasse.
 */
export default function Portal({ children }) {
  return createPortal(<div data-portal-modal="">{children}</div>, document.body);
}
