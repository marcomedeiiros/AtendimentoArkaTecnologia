import React, { useState } from 'react';
import { Plus, Trash2, Search } from 'lucide-react';
import { useAppContext } from '../context/AppContext';

function limparCnpj(v) { return String(v || '').replace(/\D/g, ''); }

function mascararCnpj(v) {
  const c = limparCnpj(v).slice(0, 14);
  return c
    .replace(/^(\d{2})(\d)/,             '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/,    '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/,            '.$1/$2')
    .replace(/(\d{4})(\d)/,              '$1-$2');
}

function cnpjValido(v) {
  const c = limparCnpj(v);
  if (c.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(c)) return false;
  const calc = (base, pesos) => {
    const soma = pesos.reduce((acc, p, i) => acc + Number(base[i]) * p, 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const p2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const d1 = calc(c.slice(0, 12), p1);
  const d2 = calc(c.slice(0, 12) + d1, p2);
  return c === c.slice(0, 12) + String(d1) + String(d2);
}

export default function ParceirosPage() {
  const { parceiros, atualizarParceiros } = useAppContext();
  const [cnpjInput, setCnpjInput] = useState('');
  const [nome,      setNome]      = useState('');
  const [erro,      setErro]      = useState('');
  const [busca,     setBusca]     = useState('');

  function adicionar() {
    const c = limparCnpj(cnpjInput);
    if (!cnpjValido(c)) { setErro('CNPJ inválido confira os números.'); return; }
    if (!nome.trim())   { setErro('Informe a razão social.'); return; }
    setErro('');
    atualizarParceiros([
      ...parceiros.filter(p => p.cnpj !== c),
      { cnpj: c, razaoSocial: nome.trim(), status: 'ativo' },
    ]);
    setCnpjInput(''); setNome('');
  }

  function remover(c) {
    atualizarParceiros(parceiros.filter(p => p.cnpj !== c));
  }

  function alternarStatus(c) {
    atualizarParceiros(parceiros.map(p =>
      p.cnpj === c ? { ...p, status: p.status === 'ativo' ? 'inativo' : 'ativo' } : p
    ));
  }

  const filtrados = parceiros.filter(p =>
    p.razaoSocial.toLowerCase().includes(busca.toLowerCase()) ||
    p.cnpj.includes(limparCnpj(busca))
  );

  return (
    <div className="fade-in space-y-6">
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight font-display">Parceiros Cadastrados (CNPJ)</h1>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">Cadastro oficial de empresas com contrato ativo para validação automatizada.</p>
        </div>
      </div>

      <div className="glass-panel p-5 rounded-2xl border border-[#2A3040] space-y-3">
        <div className="flex flex-wrap gap-2.5">
          <input
            value={cnpjInput}
            onChange={e => { setCnpjInput(mascararCnpj(e.target.value)); setErro(''); }}
            onKeyDown={e => e.key === 'Enter' && adicionar()}
            placeholder="00.000.000/0000-00"
            className="w-48 bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2 text-xs text-white font-mono placeholder-slate-500 focus:outline-none focus:border-orange-500/50"
          />
          <input
            value={nome}
            onChange={e => setNome(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && adicionar()}
            placeholder="Nome da empresa"
            className="flex-1 min-w-[200px] bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50"
          />
          <button
            onClick={adicionar}
            className="px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 shadow-md shadow-orange-500/20 transition-all"
          >
            <Plus size={15} /> Cadastrar Parceiro
          </button>
        </div>
        {erro && <div className="text-xs text-rose-400 font-semibold">{erro}</div>}
      </div>

      <div className="relative max-w-xs">
        <Search size={14} className="absolute left-3.5 top-3 text-slate-500" />
        <input
          value={busca}
          onChange={e => setBusca(e.target.value)}
          placeholder="Buscar por nome ou CNPJ"
          className="w-full bg-[#161922] border border-[#2A3040] rounded-xl pl-9 pr-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50"
        />
      </div>

      <div className="space-y-2.5">
        {filtrados.map(p => (
          <div key={p.cnpj} className="glass-panel p-4 rounded-xl border border-[#2A3040] flex items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="font-bold text-xs text-white">{p.razaoSocial}</div>
              <div className="text-[11px] text-slate-400 font-mono mt-0.5">{mascararCnpj(p.cnpj)}</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => alternarStatus(p.cnpj)}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                  p.status === 'ativo'
                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                    : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                }`}
              >
                {p.status === 'ativo' ? 'Ativo' : 'Inativo'}
              </button>
              <button
                onClick={() => remover(p.cnpj)}
                className="text-rose-400 hover:bg-slate-800 p-1.5 rounded-lg transition-colors"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}

        {filtrados.length === 0 && (
          <div className="text-xs text-slate-400 text-center py-8 glass-panel rounded-2xl border border-[#2A3040]">
            Nenhum parceiro encontrado.
          </div>
        )}
      </div>
    </div>
  );
}
