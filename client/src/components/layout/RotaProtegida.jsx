import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { AppProvider } from '../../context/AppContext';

/**
 * Portao do painel.
 *
 * O AppProvider vive aqui dentro, e nao na raiz, porque ele busca conversas,
 * fluxos e equipe e abre o SSE assim que monta. Na raiz, isso rodaria tambem
 * para quem esta na tela de login -- um punhado de 401 antes de a pessoa
 * digitar qualquer coisa.
 */
export default function RotaProtegida() {
  const { usuario, verificando } = useAuth();
  const local = useLocation();

  if (verificando) {
    return (
      <div className="altura-app-min bg-grafite-900 flex flex-col items-center justify-center gap-3 text-texto-suave">
        <Loader2 className="w-7 h-7 text-acao animate-spin" />
        <span className="text-sm font-medium tracking-wide">Verificando sessão...</span>
      </div>
    );
  }

  // `state` guarda onde a pessoa queria chegar, para o login devolver ela ao
  // destino em vez de despejar todo mundo na mesma tela inicial.
  if (!usuario) return <Navigate to="/login" replace state={{ de: local.pathname }} />;

  return (
    <AppProvider>
      <Outlet />
    </AppProvider>
  );
}
