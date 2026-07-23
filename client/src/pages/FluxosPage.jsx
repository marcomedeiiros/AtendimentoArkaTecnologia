import React from 'react';
import { VisualFlowEditor } from '../components/flow/VisualFlowEditor';
import { useAppContext } from '../context/AppContext';

export default function FluxosPage() {
  const { fluxos, atualizarFluxos, equipe } = useAppContext();
  return (
    <VisualFlowEditor
      fluxos={fluxos}
      setFluxos={atualizarFluxos}
      equipe={equipe}
    />
  );
}
