import React from 'react';
import { useNavigate } from 'react-router-dom';
import Contatos from '../components/pages/Contatos';
import { useAppContext } from '../context/AppContext';

export default function ContatosPage() {
  const { conversas, atualizarConversas } = useAppContext();
  const navigate = useNavigate();
  return (
    <Contatos
      conversas={conversas}
      setConversas={atualizarConversas}
      setAba={(aba) => navigate('/' + aba)}
    />
  );
}
