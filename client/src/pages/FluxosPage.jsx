import { useState } from 'react';
import { GitBranch, Workflow, Bot, Clock } from 'lucide-react';
import { VisualFlowEditor } from '../components/flow/VisualFlowEditor';
import PainelN8n from '../components/flow/PainelN8n';
import PainelAutomacoes from '../components/flow/PainelAutomacoes';
import PainelHorarioAtendimento from '../components/flow/PainelHorarioAtendimento';
import { useAppContext } from '../context/AppContext';

// Duas fontes de automacao convivem: os fluxos locais (executados pelo motor de
// chatbot no WhatsApp) e os workflows do n8n. As abas separam os dois sem
// alterar o editor visual existente.
//
// O horario de atendimento entra aqui, e nao em Configuracoes, porque e uma
// regra DO BOT: fora do expediente nenhum fluxo inicia. Ao lado dos fluxos ele
// e lido junto do que governa; entre chaves de API ele era so mais um campo.
const ABAS = [
  { id: 'locais', label: 'Fluxos do Chatbot', Icon: GitBranch },
  { id: 'automacoes', label: 'Automações do BOT', Icon: Bot },
  { id: 'horario', label: 'Horário de atendimento', Icon: Clock },
  { id: 'n8n',    label: 'Workflows n8n',     Icon: Workflow },
];

export default function FluxosPage() {
  const { fluxos, atualizarFluxos, equipe } = useAppContext();
  const [aba, setAba] = useState('locais');

  // A rota /fluxos recebe `main` sem padding e com overflow-hidden, e o editor
  // usa h-full. Por isso a coluna precisa ter altura definida (h-full + min-h-0)
  // e a barra de abas precisa ser shrink-0: sem isso o canvas fica cortado.
  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Barra enxuta de proposito: cada pixel aqui e altura tirada do canvas. */}
      <div className="shrink-0 flex items-center gap-1 px-3 py-1.5 border-b border-linha bg-grafite-900">
        {ABAS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setAba(id)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-bold flex items-center gap-1.5 transition-all ${
              aba === id
                ? 'bg-acao/15 text-acao-200'
                : 'text-slate-500 hover:text-slate-200 hover:bg-grafite-700'
            }`}
          >
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0">
        {aba === 'locais' ? (
          <VisualFlowEditor fluxos={fluxos} setFluxos={atualizarFluxos} equipe={equipe} />
        ) : aba === 'automacoes' ? (
          <PainelAutomacoes />
        ) : aba === 'horario' ? (
          /* Scroll proprio: o `main` da rota vem com overflow-hidden (por causa
             do canvas do editor) e este formulario e alto. */
          <div className="h-full overflow-y-auto p-4 sm:p-6">
            <PainelHorarioAtendimento />
          </div>
        ) : (
          <div className="h-full overflow-y-auto p-4 sm:p-6">
            <PainelN8n />
          </div>
        )}
      </div>
    </div>
  );
}
