import React from 'react';
import AtendimentoView from '../components/pages/AtendimentoView';
import { useAppContext } from '../context/AppContext';

export default function AtendimentoPage() {
  const { conversas, atualizarConversas, fluxos, parceiros } = useAppContext();
  return (
    <AtendimentoView
      conversas={conversas}
      setConversas={atualizarConversas}
      fluxos={fluxos}
      parceiros={parceiros}
    />
  );
}
