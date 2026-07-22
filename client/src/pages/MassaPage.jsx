import React from 'react';
import EnvioEmMassa from '../components/pages/EnvioEmMassa';
import { useAppContext } from '../context/AppContext';

export default function MassaPage() {
  const { conversas } = useAppContext();

  return <EnvioEmMassa conversas={conversas} />;
}
