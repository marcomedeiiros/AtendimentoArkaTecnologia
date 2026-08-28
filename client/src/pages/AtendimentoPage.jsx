import AtendimentoView from '../components/pages/AtendimentoView';
import { useAppContext } from '../context/AppContext';

export default function AtendimentoPage() {
  // `equipe` nao e mais repassada: o seletor de transferencia carrega os
  // destinos de `/conversas/atendentes` quando o modal abre. A lista global vem
  // de `/api/equipe`, que exige o modulo de GESTAO da equipe -- e era por isso
  // que Tecnico e Financeiro viam "nenhum outro operador com conta".
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
