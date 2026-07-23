import React from 'react';
import { useNavigate } from 'react-router-dom';
import DashboardView from '../components/pages/Dashboard';
import { useAppContext } from '../context/AppContext';

export default function DashboardPage() {
  const { equipe, fluxos, parceiros, conversas } = useAppContext();
  const navigate = useNavigate();
  
  return (
    <DashboardView
      equipe={equipe}
      fluxos={fluxos}
      parceiros={parceiros}
      conversas={conversas}
      setAba={(aba) => navigate('/' + aba)}
    />
  );
}
