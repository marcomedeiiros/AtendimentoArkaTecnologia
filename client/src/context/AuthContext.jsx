/**
 * Sessao do operador.
 *
 * Fica FORA do AppProvider de proposito: as telas de acesso nao devem carregar
 * conversas, fluxos nem abrir SSE. Quem esta na tela de login ainda nao tem
 * permissao para nada disso, e sem essa separacao o painel dispararia um punhado
 * de 401 antes mesmo de a pessoa digitar o e-mail.
 */
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { AuthAPI, getToken } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(null);
  // `verificando` cobre a janela entre abrir a pagina e saber se o token
  // guardado ainda vale. Sem esse estado, um F5 dentro do painel piscaria a
  // tela de login antes de o /auth/me responder.
  const [verificando, setVerificando] = useState(true);

  useEffect(() => {
    let vivo = true;
    (async () => {
      if (!getToken()) { setVerificando(false); return; }
      try {
        const eu = await AuthAPI.eu();
        if (vivo) setUsuario(eu);
      } catch {
        // Token vencido ou revogado: segue para o login sem alarde.
        AuthAPI.sair();
      } finally {
        if (vivo) setVerificando(false);
      }
    })();
    return () => { vivo = false; };
  }, []);

  // Qualquer 401 vindo de qualquer chamada derruba a sessao aqui.
  useEffect(() => {
    const aoPerderSessao = () => setUsuario(null);
    window.addEventListener(AuthAPI.EVENTO_SEM_SESSAO, aoPerderSessao);
    return () => window.removeEventListener(AuthAPI.EVENTO_SEM_SESSAO, aoPerderSessao);
  }, []);

  const entrar = useCallback(async (email, senha) => {
    setUsuario(await AuthAPI.entrar(email, senha));
  }, []);

  const cadastrar = useCallback(async (dados) => {
    setUsuario(await AuthAPI.cadastrar(dados));
  }, []);

  const sair = useCallback(() => {
    AuthAPI.sair();
    setUsuario(null);
  }, []);

  return (
    <AuthContext.Provider value={{ usuario, verificando, entrar, cadastrar, sair }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>');
  return ctx;
}
