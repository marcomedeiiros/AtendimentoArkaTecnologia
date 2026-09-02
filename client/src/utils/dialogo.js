/**
 * DIÁLOGOS DA ARKA -- o substituto de `alert`, `confirm` e `prompt`.
 *
 * ── POR QUE SAIR DO NATIVO ──────────────────────────────────────────────────
 *
 * O diálogo do navegador carimba a origem no topo ("arka.brasil... diz"), usa a
 * tipografia do sistema e não aceita nem a nossa logo nem as nossas cores. Numa
 * ferramenta que a equipe usa o dia inteiro, ele parece um aviso de outro
 * programa -- e é justamente nos momentos de decisão (apagar uma conta, cancelar
 * uma campanha) que a interface precisa ser reconhecidamente nossa.
 *
 * Há um ganho de comportamento junto: o nativo TRAVA a aba (nenhum evento do SSE
 * é processado enquanto a caixa está aberta) e alguns navegadores permitem que a
 * pessoa marque "não mostrar mais", o que silencia avisos importantes sem que a
 * gente saiba.
 *
 * ── A ASSINATURA É ASSÍNCRONA, E ISSO É DE PROPÓSITO ───────────────────────
 *
 * `window.confirm` devolve o booleano na hora porque congela a página. Nenhum
 * modal em React pode fazer isso: a resposta só existe depois de o usuário
 * clicar, e no meio disso o React precisa renderizar. Então aqui devolve-se uma
 * Promise, e quem chama usa `await`:
 *
 *     if (!(await confirmar('Excluir este relato?'))) return;
 *
 * ── FILA, E NÃO SOBREPOSIÇÃO ───────────────────────────────────────────────
 *
 * O nativo é sequencial: dois `alert()` seguidos aparecem um depois do outro.
 * Código escrito para ele conta com isso. Por isso os pedidos entram numa FILA e
 * são mostrados um a um -- sobrepor dois cartões esconderia a primeira mensagem
 * atrás da segunda, e ninguém saberia que ela existiu.
 */

let sequencia = 0;
const fila = [];
let host = null;

function publicar() {
  // O host recebe SEMPRE o primeiro da fila (ou null). Ele não conhece a fila:
  // desenha um pedido de cada vez.
  if (host) host(fila[0] || null);
}

/** O componente que desenha os diálogos se registra por aqui. */
export function inscreverDialogo(fn) {
  host = fn;
  publicar();
  return () => { if (host === fn) host = null; };
}

/**
 * REDE DE SEGURANÇA: sem host, cai no nativo.
 *
 * Se por qualquer motivo o `DialogoArka` não estiver montado (uma tela nova que
 * esqueça de incluí-lo, um erro de render acima dele), a Promise ficaria
 * pendurada para sempre e a ação simplesmente não aconteceria -- sem erro, sem
 * mensagem, parecendo que o botão não funciona. Feio é melhor que travado.
 */
function nativo({ modo, mensagem, valorInicial }) {
  if (modo === 'confirmar') return window.confirm(mensagem);
  if (modo === 'texto') return window.prompt(mensagem, valorInicial || '');
  window.alert(mensagem);
  return undefined;
}

function abrir(pedido) {
  if (!host) return Promise.resolve(nativo(pedido));
  return new Promise((resolver) => {
    fila.push({ ...pedido, id: ++sequencia, resolver });
    publicar();
  });
}

/** Chamado pelo host quando o usuário decide. */
export function responderDialogo(id, valor) {
  const i = fila.findIndex((p) => p.id === id);
  if (i < 0) return;
  const [pedido] = fila.splice(i, 1);
  pedido.resolver(valor);
  publicar();
}

// ── API pública ────────────────────────────────────────────────────────────

/**
 * Aviso de uma via (substitui `alert`). Devolve Promise que resolve quando a
 * pessoa fecha -- dá para `await` quando a ordem importa, e dá para ignorar
 * quando não importa.
 *
 * `tipo` muda só a cor e o ícone: 'erro' para o que falhou, 'aviso' para o que
 * exige atenção, 'info' para o resto.
 */
export function avisar(mensagem, { titulo, tipo = 'erro', rotuloOk } = {}) {
  return abrir({ modo: 'aviso', mensagem, titulo, tipo, rotuloOk });
}

/**
 * Pergunta de sim/não (substitui `confirm`). Resolve `true` só no botão de
 * confirmação -- ESC, clique fora e Cancelar resolvem `false`.
 *
 * `perigo: true` pinta o botão de vermelho e é o padrão para o que não tem
 * volta: quem vai apagar uma conta precisa ver a diferença antes de clicar, não
 * depois.
 */
export function confirmar(mensagem, { titulo, rotuloConfirmar, rotuloCancelar, perigo = false } = {}) {
  return abrir({ modo: 'confirmar', mensagem, titulo, rotuloConfirmar, rotuloCancelar, perigo });
}

/**
 * Pede um texto (substitui `prompt`). Resolve com a string ou `null` se a pessoa
 * desistir -- mesmo contrato do nativo, para o `if (!resposta) return` de quem
 * chama continuar valendo.
 */
export function pedirTexto(mensagem, { titulo, valorInicial = '', placeholder, rotuloConfirmar, perigo = false } = {}) {
  return abrir({ modo: 'texto', mensagem, titulo, valorInicial, placeholder, rotuloConfirmar, perigo });
}
