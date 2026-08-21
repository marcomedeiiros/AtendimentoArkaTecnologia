// Tema da interface (claro/escuro). O visual é todo controlado por CSS
// variables (index.css); aqui só ligamos/desligamos o atributo data-theme no
// <html> e guardamos a preferência no navegador (é uma escolha do aparelho).
const KEY = 'arka_tema';

export function temaAtual() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

export function aplicarTema(t) {
  if (t === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
  try { localStorage.setItem(KEY, t); } catch { /* modo privado */ }
}

export function alternarTema() {
  const novo = temaAtual() === 'light' ? 'dark' : 'light';
  aplicarTema(novo);
  return novo;
}

// Chamado no boot (antes do React) para não piscar: aplica o tema salvo.
export function initTema() {
  let t = 'dark';
  try { t = localStorage.getItem(KEY) || 'dark'; } catch { /* ignore */ }
  aplicarTema(t);
}
