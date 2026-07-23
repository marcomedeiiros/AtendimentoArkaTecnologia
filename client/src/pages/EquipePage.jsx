import React, { useState } from 'react';
import { Plus, Trash2, Circle } from 'lucide-react';
import { useAppContext } from '../context/AppContext';

export default function EquipePage() {
  const { equipe, atualizarEquipe } = useAppContext();
  const [nome,  setNome]  = useState('');
  const [cargo, setCargo] = useState('');

  function adicionar() {
    if (!nome.trim()) return;
    atualizarEquipe([
      ...equipe,
      { id: 'e' + Date.now(), nome: nome.trim(), cargo: cargo.trim() || 'Atendimento', status: 'offline' },
    ]);
    setNome(''); setCargo('');
  }

  function remover(id) {
    atualizarEquipe(equipe.filter(e => e.id !== id));
  }

  function alternarStatus(id) {
    atualizarEquipe(equipe.map(e =>
      e.id === id ? { ...e, status: e.status === 'online' ? 'offline' : 'online' } : e
    ));
  }

  return (
    <div className="fade-in space-y-6">
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight font-display">Gestão da Equipe de Atendimento</h1>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">Gerencie os operadores e atendentes autorizados da Arka Tecnologia.</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2.5">
        <input
          value={nome}
          onChange={e => setNome(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && adicionar()}
          placeholder="Nome do atendente"
          className="flex-1 min-w-[200px] bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50"
        />
        <input
          value={cargo}
          onChange={e => setCargo(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && adicionar()}
          placeholder="Cargo (ex: Suporte N2)"
          className="flex-1 min-w-[200px] bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50"
        />
        <button
          onClick={adicionar}
          className="px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 shadow-md shadow-orange-500/20 transition-all"
        >
          <Plus size={15} /> Adicionar Atendente
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {equipe.map(e => (
          <div key={e.id} className="glass-panel p-4 rounded-2xl border border-[#2A3040] space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-orange-500/15 text-orange-400 font-bold text-sm flex items-center justify-center border border-orange-500/30">
                {e.nome.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-xs text-white truncate">{e.nome}</div>
                <div className="text-[11px] text-slate-400 truncate">{e.cargo}</div>
              </div>
              <button
                onClick={() => remover(e.id)}
                className="text-rose-400 hover:bg-slate-800 p-1.5 rounded-lg transition-colors"
              >
                <Trash2 size={13} />
              </button>
            </div>
            <button
              onClick={() => alternarStatus(e.id)}
              className={`w-full py-2 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                e.status === 'online'
                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                  : 'bg-slate-800 border-slate-700 text-slate-400'
              }`}
            >
              <Circle size={8} fill="currentColor" />
              {e.status === 'online' ? 'Online' : 'Offline'}
            </button>
          </div>
        ))}

        {equipe.length === 0 && (
          <div className="col-span-full text-center text-slate-400 text-xs py-12 glass-panel rounded-2xl border border-[#2A3040]">
            Nenhum atendente cadastrado ainda.
          </div>
        )}
      </div>
    </div>
  );
}
