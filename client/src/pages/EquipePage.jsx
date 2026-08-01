import React, { useState } from 'react';
import { Plus, Trash2, Circle, AlertTriangle, X } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { EquipeAPI } from '../services/api';

export default function EquipePage() {
  const { equipe, atualizarEquipe } = useAppContext();
  const [nome,  setNome]  = useState('');
  const [cargo, setCargo] = useState('');
  const [erro,  setErro]  = useState(null);

  // Regra desta tela: a lista so muda depois que o servidor confirma. Antes o
  // catch alterava so o estado local -- parecia funcionar e desfazia no F5.
  async function adicionar() {
    if (!nome.trim()) return;
    const novo = { nome: nome.trim(), cargo: cargo.trim() || 'Atendimento', status: 'offline' };
    try {
      const criado = await EquipeAPI.criar(novo);
      atualizarEquipe([...equipe, criado]);
      setErro(null);
      setNome(''); setCargo('');
    } catch (err) {
      setErro(`Nao foi possivel adicionar: ${err.message}. Verifique se o back-end esta rodando.`);
    }
  }

  async function remover(id) {
    if (!window.confirm('Remover este membro da equipe?')) return;
    try {
      await EquipeAPI.remover(id);
      atualizarEquipe(equipe.filter(e => e.id !== id));
      setErro(null);
    } catch (err) {
      setErro(`Nao foi possivel remover: ${err.message}. Verifique se o back-end esta rodando.`);
    }
  }

  async function alternarStatus(id) {
    const alvo = equipe.find(e => e.id === id);
    if (!alvo) return;
    const novoStatus = alvo.status === 'online' ? 'offline' : 'online';
    try {
      const atualizado = await EquipeAPI.atualizar(id, { status: novoStatus });
      atualizarEquipe(equipe.map(e => e.id === id ? atualizado : e));
      setErro(null);
    } catch (err) {
      setErro(`Nao foi possivel mudar o status: ${err.message}`);
    }
  }

  return (
    <div className="fade-in space-y-6">
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight font-display">Gestão da Equipe de Atendimento</h1>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">Gerencie os operadores e atendentes autorizados da Arka Tecnologia.</p>
        </div>
      </div>

      {erro && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-falha/10 border border-falha/30 text-falha-400 text-xs">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <p className="flex-1">{erro}</p>
          <button onClick={() => setErro(null)} className="text-falha-400/60 hover:text-falha-400 shrink-0">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2.5">
        <input
          value={nome}
          onChange={e => setNome(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && adicionar()}
          placeholder="Nome do atendente"
          className="flex-1 min-w-[200px] bg-grafite-700 border border-linha rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-osso/50"
        />
        <input
          value={cargo}
          onChange={e => setCargo(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && adicionar()}
          placeholder="Cargo (ex: Suporte N2)"
          className="flex-1 min-w-[200px] bg-grafite-700 border border-linha rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-osso/50"
        />
        <button
          onClick={adicionar}
          className="px-4 py-2 rounded-xl bg-osso hover:bg-osso-200 text-slate-950 text-xs font-bold flex items-center gap-1.5 shadow-md shadow-osso/20 transition-all"
        >
          <Plus size={15} /> Adicionar Atendente
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {equipe.map(e => (
          <div key={e.id} className="glass-panel p-4 rounded-2xl border border-linha space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-osso/15 text-osso-200 font-bold text-sm flex items-center justify-center border border-osso/30">
                {e.nome.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-xs text-white truncate">{e.nome}</div>
                <div className="text-[11px] text-slate-400 truncate">{e.cargo}</div>
              </div>
              <button
                onClick={() => remover(e.id)}
                className="text-falha-400 hover:bg-slate-800 p-1.5 rounded-lg transition-colors"
              >
                <Trash2 size={13} />
              </button>
            </div>
            <button
              onClick={() => alternarStatus(e.id)}
              className={`w-full py-2 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                e.status === 'online'
                  ? 'bg-ativo/15 border-ativo/30 text-ativo-400'
                  : 'bg-slate-800 border-slate-700 text-slate-400'
              }`}
            >
              <Circle size={8} fill="currentColor" />
              {e.status === 'online' ? 'Online' : 'Offline'}
            </button>
          </div>
        ))}

        {equipe.length === 0 && (
          <div className="col-span-full text-center text-slate-400 text-xs py-12 glass-panel rounded-2xl border border-linha">
            Nenhum atendente cadastrado ainda.
          </div>
        )}
      </div>
    </div>
  );
}
