import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate
} from 'react-router-dom';
import './index.css';

import { AuthProvider } from './context/AuthContext';

import AppLayout from './components/layout/AppLayout';
import RotaProtegida from './components/layout/RotaProtegida';
import RotaModulo from './components/layout/RotaModulo';

import NotFound from './pages/NotFound';
import LoginPage from './pages/LoginPage';
import CadastroPage from './pages/CadastroPage';
import EsqueciSenhaPage from './pages/EsqueciSenhaPage';

import DashboardPage    from './pages/DashboardPage';
import AtendimentoPage  from './pages/AtendimentoPage';
import ContatosPage     from './pages/ContatosPage';
import FluxosPage       from './pages/FluxosPage';
import WhatsAppPage     from './pages/WhatsAppPage';
import EquipePage       from './pages/EquipePage';
import ParceirosPage    from './pages/ParceirosPage';
import MensagensPage    from './pages/MensagensPage';
import AgendaPage       from './pages/AgendaPage';
import MassaPage        from './pages/MassaPage';
import ConfiguracoesPage from './pages/ConfiguracoesPage';
import BugsPage         from './pages/BugsPage';
import PerfilPage       from './pages/PerfilPage';

export default function App() {
  return (
    <Router>
      <AuthProvider>
        <Routes>
          {/* Acesso: fora do portao, e as unicas rotas publicas do app. */}
          <Route path="/login"     element={<LoginPage />} />
          <Route path="/cadastrar" element={<CadastroPage />} />
          <Route path="/esqueci-senha" element={<EsqueciSenhaPage />} />

          {/* Painel: tudo daqui para baixo exige sessao. */}
          <Route element={<RotaProtegida />}>
            <Route path="/" element={<Navigate to="/atendimento" replace />} />
            <Route element={<AppLayout />}>
              {/* Acesso por modulo, dirigido pela matriz de permissoes.
                  RotaModulo guarda no front; o servidor barra de verdade. */}
              {/* Perfil: proprio de cada usuario, sem gate de modulo. */}
              <Route path="/perfil" element={<PerfilPage />} />

              <Route element={<RotaModulo />}>
                <Route path="/atendimento" element={<AtendimentoPage />} />
                <Route path="/contatos"    element={<ContatosPage />} />
                <Route path="/parceiros"   element={<ParceirosPage />} />
                <Route path="/mensagens"   element={<MensagensPage />} />
                <Route path="/massa"       element={<MassaPage />} />
                <Route path="/dashboard"   element={<DashboardPage />} />
                <Route path="/fluxos"      element={<FluxosPage />} />
                <Route path="/whatsapp"    element={<WhatsAppPage />} />
                <Route path="/configuracoes" element={<ConfiguracoesPage />} />
                <Route path="/equipe"      element={<EquipePage />} />
                <Route path="/agenda"      element={<AgendaPage />} />
                <Route path="/bugs"        element={<BugsPage />} />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider>
    </Router>
  );
}
