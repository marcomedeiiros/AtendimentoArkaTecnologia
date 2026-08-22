// Tema da interface (claro/escuro). O visual é todo controlado por CSS
// variables (index.css); aqui só ligamos/desligamos o atributo data-theme no
// <html>.
//
// A fonte da verdade do tema é a PREFERÊNCIA POR USUÁRIO no backend, aplicada
// pelo AuthContext DEPOIS do login. As telas de acesso (login/cadastro) e a de
// carregamento ficam SEMPRE no tema escuro fixo -- por isso o boot não lê mais
// nenhum tema salvo; ele só garante o escuro (ver `aplicarTemaAcesso`).
const KEY = 'arka_tema';

export function temaAtual() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

export function aplicarTema(t) {
  if (t === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
  // Cache local só para reduzir "flash" em navegações internas; NÃO é lido no
  // boot (as telas de acesso são sempre escuras).
  try { localStorage.setItem(KEY, t); } catch { /* modo privado */ }
}

// Tema FIXO das telas de acesso e de carregamento: sempre escuro,
// independentemente do que o usuário tenha escolhido. O tema pessoal só passa a
// valer após o login.
export function aplicarTemaAcesso() {
  document.documentElement.removeAttribute('data-theme');
}
