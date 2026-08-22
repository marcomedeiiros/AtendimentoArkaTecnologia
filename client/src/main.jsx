import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { aplicarTemaAcesso } from './utils/tema';

// Boot sempre no tema ESCURO fixo: login, cadastro e carregamento não mudam de
// tema. A preferência pessoal (claro/escuro) só é aplicada após o login, pelo
// AuthContext.
aplicarTemaAcesso();

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