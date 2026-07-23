import React from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom';
import './index.css';

import { AppProvider } from './context/AppContext';

import AppLayout from './components/layout/AppLayout';

import NotFound from './pages/NotFound';

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

export default function App() {
  return (
    <Router>
      <AppProvider>
        <Routes>
          <Route path="/" element={<Navigate to="/atendimento" replace />} />
          <Route element={<AppLayout />}>
            <Route path="/dashboard"   element={<DashboardPage />} />
            <Route path="/atendimento" element={<AtendimentoPage />} />
            <Route path="/contatos"    element={<ContatosPage />} />
            <Route path="/fluxos"      element={<FluxosPage />} />
            <Route path="/whatsapp"    element={<WhatsAppPage />} />
            <Route path="/equipe"      element={<EquipePage />} />
            <Route path="/parceiros"   element={<ParceirosPage />} />
            <Route path="/mensagens"   element={<MensagensPage />} />
            <Route path="/agenda"      element={<AgendaPage />} />
            <Route path="/massa"       element={<MassaPage />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </AppProvider>
    </Router>
  );
}
