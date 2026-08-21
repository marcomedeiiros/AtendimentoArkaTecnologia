import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { initTema } from './utils/tema';

// Aplica o tema salvo o quanto antes (antes do React montar), para não piscar.
initTema();

// Remove chaves orfas apos migracoes para o backend:
//  - 'arka:mensagens_rapidas': defaults antigos das mensagens rapidas
//  - 'arka_conversa_atendentes': o responsavel agora vem do banco (atendenteId)
// Sao dado morto que nada mais le.
// NAO apagamos 'arka:agenda' de proposito: se alguem tiver compromissos antigos
// so no navegador, eles continuam recuperaveis ali (a agenda nova vem do banco).
try {
  ['arka:mensagens_rapidas', 'arka_conversa_atendentes'].forEach(k => localStorage.removeItem(k));
} catch { /* modo privado pode bloquear */ }

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);