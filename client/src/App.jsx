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
import DialogoArka from './components/DialogoArka';

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
import RelatoriosVisitaPage from './pages/RelatoriosVisitaPage';

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

            {/* O PAINEL DE PAREDE NAO E MAIS UMA ROTA.
                
                Ele era `/painel`, fora do AppLayout, para nao gastar 17rem de
                barra lateral numa tela lida de longe. Hoje ele e o Modo TV: o
                botao da TV, no cabecalho da Central, abre o mesmo painel em
                tela cheia por cima de tudo -- sem moldura, sem rota e sem um
                item de menu que ninguem clicava na TV. */}
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
                <Route path="/relatorios"  element={<RelatoriosVisitaPage />} />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>

        {/* OS DIÁLOGOS DA ARKA, no lugar de alert/confirm/prompt do navegador.
            
            Montado FORA das rotas, e uma vez só: qualquer tela (inclusive login
            e cadastro, que ficam fora do portão de sessão) chama
            `confirmar()`/`avisar()` de utils/dialogo e este componente desenha.
            Sem isso, cada tela precisaria hospedar o próprio modal. */}
        <DialogoArka />
      </AuthProvider>
    </Router>
  );
}
