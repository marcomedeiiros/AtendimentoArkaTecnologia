/**
 * Sessao do operador.
 *
 * Fica FORA do AppProvider de proposito: as telas de acesso nao devem carregar
 * conversas, fluxos nem abrir SSE. Quem esta na tela de login ainda nao tem
 * permissao para nada disso, e sem essa separacao o painel dispararia um punhado
 * de 401 antes mesmo de a pessoa digitar o e-mail.
 */
import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { AuthAPI, getToken } from '../services/api';
import AvisoSessao from '../components/AvisoSessao';

const AuthContext = createContext(null);

const DURACAO_AVISO = 4500;

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(null);
  // `verificando` cobre a janela entre abrir a pagina e saber se o token
  // guardado ainda vale. Sem esse estado, um F5 dentro do painel piscaria a
  // tela de login antes de o /auth/me responder.
  const [verificando, setVerificando] = useState(true);
  const [aviso, setAviso] = useState(null);
  const timerAviso = useRef(null);

  const avisar = useCallback((texto, tipo = 'entrada') => {
    clearTimeout(timerAviso.current);
    setAviso({ texto, tipo });
    timerAviso.current = setTimeout(() => setAviso(null), DURACAO_AVISO);
  }, []);

  useEffect(() => () => clearTimeout(timerAviso.current), []);

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

  // Qualquer 401 vindo de qualquer chamada derruba a sessao aqui. Antes isso
  // acontecia em silencio e a pessoa era jogada no login sem entender por que.
  useEffect(() => {
    const aoPerderSessao = () => {
      setUsuario(atual => {
        if (atual) avisar('Sua sessão expirou. Entre novamente para continuar.', 'expirou');
        return null;
      });
    };
    window.addEventListener(AuthAPI.EVENTO_SEM_SESSAO, aoPerderSessao);
    return () => window.removeEventListener(AuthAPI.EVENTO_SEM_SESSAO, aoPerderSessao);
  }, [avisar]);

  const entrar = useCallback(async (email, senha) => {
    const eu = await AuthAPI.entrar(email, senha);
    setUsuario(eu);
    // Primeiro nome: o aviso e uma saudacao curta, nao um cabecalho de cadastro.
    avisar(`Você entrou como ${String(eu.nome || '').split(' ')[0]}.`, 'entrada');
    return eu;
  }, [avisar]);

  // Cadastrar NAO autentica: o servidor nao devolve token, e quem acabou de
  // criar a conta passa pelo login como qualquer outra pessoa.
  const cadastrar = useCallback((dados) => AuthAPI.cadastrar(dados), []);

  const sair = useCallback(() => {
    AuthAPI.sair();
    setUsuario(null);
    avisar('Você saiu da plataforma.', 'saida');
  }, [avisar]);

  return (
    <AuthContext.Provider value={{ usuario, verificando, entrar, cadastrar, sair, avisar }}>
      {children}
      <AvisoSessao aviso={aviso} onFechar={() => setAviso(null)} />
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>');
  return ctx;
}
