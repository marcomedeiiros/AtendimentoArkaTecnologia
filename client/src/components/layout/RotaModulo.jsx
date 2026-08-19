import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

// Rota -> modulo. Mantido junto do menu (AppLayout) por definicao.
const ROTA_MODULO = {
  '/atendimento': 'atendimento',
  '/contatos': 'contatos',
  '/fluxos': 'fluxos',
  '/dashboard': 'dashboard',
  '/whatsapp': 'whatsapp',
  '/equipe': 'equipe',
  '/parceiros': 'parceiros',
  '/mensagens': 'mensagens',
  '/agenda': 'agenda',
  '/massa': 'massa',
  '/bugs': 'bugs',
  '/configuracoes': 'configuracoes',
};

// Ordem de preferencia para onde mandar quem cai numa tela sem permissao.
const PREFERENCIA = ['/atendimento', '/contatos', '/parceiros', '/mensagens', '/massa'];

/**
 * Guarda de rota por modulo (camada de UI).
 *
 * Impede ABRIR uma tela que o perfil nao tem, digitando a URL na mao. Nao
 * substitui o servidor, que e a autoridade e barra a API com 403 -- aqui e so
 * para nao renderizar uma tela vazia de erros. Se `permissoes` nao veio
 * (sessao antiga), libera e deixa o servidor decidir.
 */
export default function RotaModulo() {
  const { usuario } = useAuth();
  const { pathname } = useLocation();

  const permissoes = usuario?.permissoes;
  if (!Array.isArray(permissoes)) return <Outlet />; // sem lista: servidor decide

  const modulo = ROTA_MODULO[pathname];
  if (!modulo || permissoes.includes(modulo)) return <Outlet />;

  // Sem acesso a esta tela: manda para a primeira permitida.
  const destino =
    PREFERENCIA.find((p) => permissoes.includes(ROTA_MODULO[p])) ||
    Object.keys(ROTA_MODULO).find((p) => permissoes.includes(ROTA_MODULO[p]));

  if (destino && destino !== pathname) return <Navigate to={destino} replace />;

  // Nenhuma tela permitida (perfil sem nada liberado): mensagem, sem loop.
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 text-center text-texto-suave">
      <p className="text-sm font-semibold text-white">Sem acesso</p>
      <p className="max-w-sm text-xs">
        Seu perfil não tem nenhuma tela liberada. Fale com um Administrador para ajustar as permissões.
      </p>
    </div>
  );
}
