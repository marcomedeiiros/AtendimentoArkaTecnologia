import './index.css';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';

import Home from './components/pages/Home';
import Automacao from './components/pages/Automacao';
import GestaoEquipe from './components/pages/gestaoEquipe';
import ParceirosCNPJ from './components/pages/ParceirosCNPJ';
import Atendimento from './components/pages/Atendimento';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/automacao" element={<Automacao />} />
        <Route path="/atendimento" element={<Atendimento />} />
        <Route path="/equipe" element={<GestaoEquipe />} />
        <Route path="/cnpj" element={<ParceirosCNPJ />} />
      </Routes>
    </Router>
  );
}

export default App;