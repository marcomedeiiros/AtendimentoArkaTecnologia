import { useState } from 'react';
import { Plus, Trash2, Search, Building2, Mail, Phone, MapPin, Pencil, X, Loader2 } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { ParceirosAPI } from '../services/api';

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
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [telefones, setTelefones] = useState('');
  const [cidades, setCidades] = useState('');
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');

  // Edicao: guarda o parceiro em edicao e o rascunho dos campos. O CNPJ nao
  // entra no rascunho porque e a chave -- so leitura no modal.
  const [editando, setEditando] = useState(null);
  const [rascunho, setRascunho] = useState({ razaoSocial: '', email: '', telefones: '', cidades: '' });
  const [editErro, setEditErro] = useState('');
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);

  function abrirEdicao(p) {
    setEditando(p);
    setRascunho({
      razaoSocial: p.razaoSocial || '',
      email: p.email || '',
      telefones: p.telefones || '',
      cidades: p.cidades || '',
    });
    setEditErro('');
  }

  function fecharEdicao() {
    if (salvandoEdicao) return;
    setEditando(null);
    setEditErro('');
  }

  async function salvarEdicao(e) {
    e.preventDefault();
    if (!rascunho.razaoSocial.trim()) { setEditErro('Informe a razão social.'); return; }
    setSalvandoEdicao(true);
    setEditErro('');
    try {
      const atualizado = await ParceirosAPI.atualizar(editando.cnpj, {
        razaoSocial: rascunho.razaoSocial.trim(),
        email: rascunho.email.trim() || null,
        telefones: rascunho.telefones.trim() || null,
        cidades: rascunho.cidades.trim() || null,
      });
      atualizarParceiros(parceiros.map(p => p.cnpj === editando.cnpj ? atualizado : p));
      setEditando(null);
    } catch (err) {
      setEditErro(`Não foi possível salvar: ${err.message}`);
    } finally {
      setSalvandoEdicao(false);
    }
  }

  async function adicionar() {
    const c = limparCnpj(cnpjInput);
    if (!cnpjValido(c)) { setErro('CNPJ inválido confira os números.'); return; }
    if (!nome.trim()) { setErro('Informe a razão social.'); return; }
    setErro('');

    const novo = {
      cnpj: c,
      razaoSocial: nome.trim(),
      email: email.trim() || null,
      telefones: telefones.trim() || null,
      cidades: cidades.trim() || null,
      status: 'ativo'
    };

    try {
      const criado = await ParceirosAPI.criar(novo);
      atualizarParceiros([...parceiros.filter(p => p.cnpj !== c), criado]);
      setCnpjInput(''); setNome(''); setEmail(''); setTelefones(''); setCidades('');
    } catch (err) {
      setErro(`Não foi possível salvar: ${err.message}. Verifique se o back-end está rodando.`);
    }
  }

  async function remover(c) {
    if (!window.confirm('Deseja remover este parceiro?')) return;
    try {
      await ParceirosAPI.remover(c);
      atualizarParceiros(parceiros.filter(p => p.cnpj !== c));
      setErro('');
    } catch (err) {
      setErro(`Não foi possível remover: ${err.message}. Verifique se o back-end está rodando.`);
    }
  }

  async function alternarStatus(c) {
    try {
      const alt = await ParceirosAPI.alternarStatus(c);
      atualizarParceiros(parceiros.map(p => p.cnpj === c ? alt : p));
      setErro('');
    } catch (err) {
      setErro(`Não foi possível mudar o status: ${err.message}`);
    }
  }

  const filtrados = parceiros.filter(p => {
    if (!busca.trim()) return true;
    const term = busca.toLowerCase().trim();
    const cnpjDigits = limparCnpj(busca);
    const matchNome = (p.razaoSocial || '').toLowerCase().includes(term);
    const matchCnpj = cnpjDigits ? (p.cnpj || '').includes(cnpjDigits) : false;
    const matchEmail = (p.email || '').toLowerCase().includes(term);
    const matchCidade = (p.cidades || '').toLowerCase().includes(term);
    return matchNome || matchCnpj || matchEmail || matchCidade;
  });

  return (
    <div className="fade-in space-y-6">
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-linha">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight font-display">Cadastro de Clientes (CNPJ)</h1>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">Cadastro oficial de parceiros com dados de e-mail, telefones e cidades atendidas.</p>
        </div>
      </div>

      <div className="glass-panel p-5 rounded-2xl border border-linha space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <input
            value={cnpjInput}
            onChange={e => { setCnpjInput(mascararCnpj(e.target.value)); setErro(''); }}
            placeholder="CNPJ (00.000.000/0000-00)"
            className="bg-grafite-700 border border-linha rounded-xl px-3.5 py-2 text-xs text-white font-mono placeholder-slate-500 focus:outline-none focus:border-acao/50"
          />
          <input
            value={nome}
            onChange={e => setNome(e.target.value)}
            placeholder="Razão Social / Nome da Empresa"
            className="bg-grafite-700 border border-linha rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-acao/50"
          />
          <input
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="E-mail de contato"
            type="email"
            className="bg-grafite-700 border border-linha rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-acao/50"
          />
          <input
            value={telefones}
            onChange={e => setTelefones(e.target.value)}
            placeholder="Telefones (ex: 11 9999-9999, 11 8888-8888)"
            className="bg-grafite-700 border border-linha rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-acao/50"
          />
          <input
            value={cidades}
            onChange={e => setCidades(e.target.value)}
            placeholder="Cidades atendidas (ex: São Paulo, Campinas)"
            className="bg-grafite-700 border border-linha rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-acao/50"
          />
          <button
            onClick={adicionar}
            className="px-4 py-2 rounded-xl bg-acao hover:bg-acao-200 text-slate-950 text-xs font-bold flex items-center justify-center gap-1.5 shadow-md shadow-acao/20 transition-all"
          >
            <Plus size={15} /> Cadastrar Parceiro
          </button>
        </div>
        {erro && <div className="text-xs text-falha-400 font-semibold">{erro}</div>}
      </div>

      <div className="relative max-w-md">
        <Search size={14} className="absolute left-3.5 top-3 text-slate-500" />
        <input
          value={busca}
          onChange={e => setBusca(e.target.value)}
          placeholder="Pesquisar por Nome, CNPJ, E-mail ou Cidade..."
          className="w-full bg-grafite-700 border border-linha rounded-xl pl-9 pr-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-acao/50"
        />
      </div>

      <div className="space-y-2.5">
        {filtrados.map(p => (
          <div key={p.cnpj} className="glass-panel p-4 rounded-xl border border-linha hover:border-linha-forte transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center shrink-0 mt-0.5">
                <Building2 size={18} />
              </div>
              <div className="min-w-0 space-y-1">
                <div className="font-bold text-xs sm:text-sm text-white truncate">{p.razaoSocial}</div>
                <div className="text-[11px] text-slate-400 font-mono">{mascararCnpj(p.cnpj)}</div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400 pt-1">
                  {p.email && (
                    <span className="flex items-center gap-1">
                      <Mail size={12} className="text-slate-500" /> {p.email}
                    </span>
                  )}
                  {p.telefones && (
                    <span className="flex items-center gap-1">
                      <Phone size={12} className="text-slate-500" /> {p.telefones}
                    </span>
                  )}
                  {p.cidades && (
                    <span className="flex items-center gap-1">
                      <MapPin size={12} className="text-slate-500" /> {p.cidades}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
              <button
                onClick={() => alternarStatus(p.cnpj)}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                  p.status === 'ativo'
                    ? 'bg-ativo/15 text-ativo-400 border border-ativo/30'
                    : 'bg-falha/15 text-falha-400 border border-falha/30'
                }`}
              >
                {p.status === 'ativo' ? 'Ativo' : 'Inativo'}
              </button>
              <button
                onClick={() => abrirEdicao(p)}
                className="text-slate-300 hover:text-white hover:bg-slate-800 p-1.5 rounded-lg transition-colors"
                title="Editar parceiro"
              >
                <Pencil size={13} />
              </button>
              <button
                onClick={() => remover(p.cnpj)}
                className="text-falha-400 hover:bg-slate-800 p-1.5 rounded-lg transition-colors"
                title="Excluir parceiro"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}

        {filtrados.length === 0 && (
          <div className="text-xs text-slate-400 text-center py-10 glass-panel rounded-2xl border border-linha">
            Nenhum parceiro encontrado para &quot;{busca}&quot;.
          </div>
        )}
      </div>

      {editando && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={fecharEdicao}
        >
          <form
            onSubmit={salvarEdicao}
            onClick={e => e.stopPropagation()}
            className="glass-panel w-full max-w-md space-y-4 rounded-2xl border border-linha p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <Pencil size={15} className="text-acao-200 shrink-0" />
                <h2 className="text-sm font-bold text-white truncate">Editar parceiro</h2>
              </div>
              <button
                type="button"
                onClick={fecharEdicao}
                disabled={salvandoEdicao}
                className="text-slate-400 hover:text-white disabled:opacity-50 shrink-0"
              >
                <X size={16} />
              </button>
            </div>

            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-slate-400">CNPJ</label>
              <div className="rounded-xl border border-linha bg-grafite-800/60 px-3.5 py-2 text-xs font-mono text-slate-400">
                {mascararCnpj(editando.cnpj)}
              </div>
            </div>

            <div className="space-y-3">
              <input
                value={rascunho.razaoSocial}
                onChange={e => setRascunho(r => ({ ...r, razaoSocial: e.target.value }))}
                placeholder="Razão Social / Nome da Empresa"
                autoFocus
                className="w-full bg-grafite-700 border border-linha rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-acao/50"
              />
              <input
                value={rascunho.email}
                onChange={e => setRascunho(r => ({ ...r, email: e.target.value }))}
                placeholder="E-mail de contato"
                type="email"
                className="w-full bg-grafite-700 border border-linha rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-acao/50"
              />
              <input
                value={rascunho.telefones}
                onChange={e => setRascunho(r => ({ ...r, telefones: e.target.value }))}
                placeholder="Telefones"
                className="w-full bg-grafite-700 border border-linha rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-acao/50"
              />
              <input
                value={rascunho.cidades}
                onChange={e => setRascunho(r => ({ ...r, cidades: e.target.value }))}
                placeholder="Cidades atendidas"
                className="w-full bg-grafite-700 border border-linha rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-acao/50"
              />
            </div>

            {editErro && <div className="text-[11px] font-semibold text-falha-400">{editErro}</div>}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={fecharEdicao}
                disabled={salvandoEdicao}
                className="px-3 py-2 rounded-xl border border-linha text-xs font-semibold text-slate-300 hover:text-white disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={salvandoEdicao}
                className="flex items-center gap-1.5 rounded-xl bg-acao px-3 py-2 text-xs font-bold text-slate-950 hover:bg-acao-200 disabled:opacity-60"
              >
                {salvandoEdicao
                  ? <><Loader2 size={13} className="animate-spin" /> Salvando...</>
                  : <>Salvar alterações</>}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
