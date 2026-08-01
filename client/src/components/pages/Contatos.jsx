import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Users, Plus, Search, Trash2, Pencil, Save, X,
  Phone, MessageSquare, Star, StarOff, UserCheck, Circle, Building, Mail,
  AlertTriangle, RefreshCw
} from 'lucide-react';
import { ContatosAPI } from '../../services/api';
import Portal from '../Portal';

function limparTel(v) { return String(v || '').replace(/\D/g, ''); }
function mascararTel(v) {
  const n = limparTel(v).slice(0, 11);
  if (n.length === 11) return n.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
  if (n.length === 10) return n.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
  return n;
}

const TAGS_CORES = {
  cliente:   'bg-blue-500/15 text-blue-400 border-blue-500/30',
  parceiro:  'bg-ativo/15 text-ativo-400 border-ativo/30',
  suporte:   'bg-purple-500/15 text-purple-400 border-purple-500/30',
  vip:       'bg-espera/15 text-espera-400 border-espera/30',
  inativo:   'bg-slate-600/30 text-slate-400 border-linha',
};
const TAGS_DISPONIVEIS = Object.keys(TAGS_CORES);

function ModalContato({ contato, onSalvar, onFechar }) {
  const [nome,    setNome]    = useState(contato?.nome       || '');
  const [tel,     setTel]     = useState(contato?.telefone   || '');
  const [email,   setEmail]   = useState(contato?.email      || '');
  const [empresa, setEmpresa] = useState(contato?.empresa    || '');
  const [tag,     setTag]     = useState(contato?.tag        || 'cliente');
  const [obs,     setObs]     = useState(contato?.observacoes|| '');

  function salvar() {
    if (!nome.trim() || limparTel(tel).length < 10) return;
    onSalvar({
      id:           contato?.id,
      nome:         nome.trim(),
      telefone:     limparTel(tel),
      email:        email.trim(),
      empresa:      empresa.trim(),
      tag,
      favorito:     contato?.favorito || false,
      observacoes:  obs.trim(),
    });
  }

  return (
    // Portal + max-h + scroll interno: o Portal tira o modal de dentro do
    // container `.fade-in` (que tem transform e quebrava o position:fixed,
    // deixando o modal cortado); o max-h garante que o rodape (Salvar) nunca
    // saia da tela em viewport baixa.
    <Portal>
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-start sm:items-center justify-center z-50 p-3 sm:p-4 overflow-y-auto">
      <div className="glass-panel border border-linha rounded-2xl w-full max-w-md shadow-2xl fade-in my-auto flex flex-col max-h-[calc(100dvh-1.5rem)] sm:max-h-[90vh]">
        <div className="p-4 bg-grafite-600 border-b border-linha flex items-center justify-between shrink-0 rounded-t-2xl">
          <div className="flex items-center gap-2 font-bold text-sm text-white min-w-0">
            <UserCheck size={16} className="text-acao-200 shrink-0" />
            <span className="truncate">{contato?.id ? 'Editar Contato' : 'Novo Contato'}</span>
          </div>
          <button onClick={onFechar} className="text-slate-400 hover:text-white transition-colors shrink-0 ml-2"><X size={16}/></button>
        </div>
        <div className="p-4 sm:p-5 space-y-3 flex-1 overflow-y-auto min-h-0">
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="text-xs text-slate-400 font-medium block mb-1">Nome *</label>
              <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome completo"
                className="w-full bg-grafite-700 border border-linha rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-acao/50" />
            </div>
            <div>
              <label className="text-xs text-slate-400 font-medium block mb-1">Telefone * (WhatsApp)</label>
              <input value={tel} onChange={e => setTel(e.target.value)} placeholder="(11) 98765-4321"
                className="w-full bg-grafite-700 border border-linha rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-acao/50 font-mono" />
            </div>
            <div>
              <label className="text-xs text-slate-400 font-medium block mb-1">E-mail</label>
              <input value={email} onChange={e => setEmail(e.target.value)} placeholder="email@empresa.com" type="email"
                className="w-full bg-grafite-700 border border-linha rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-acao/50" />
            </div>
            <div>
              <label className="text-xs text-slate-400 font-medium block mb-1">Empresa</label>
              <input value={empresa} onChange={e => setEmpresa(e.target.value)} placeholder="Nome da empresa"
                className="w-full bg-grafite-700 border border-linha rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-acao/50" />
            </div>
            <div>
              <label className="text-xs text-slate-400 font-medium block mb-1">Classificação</label>
              <select value={tag} onChange={e => setTag(e.target.value)}
                className="w-full bg-grafite-700 border border-linha rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-acao/50">
                {TAGS_DISPONIVEIS.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 font-medium block mb-1">Observações</label>
              <textarea value={obs} onChange={e => setObs(e.target.value)} rows={3} placeholder="Notas internas..."
                className="w-full bg-grafite-700 border border-linha rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-acao/50 resize-none" />
            </div>
          </div>
        </div>
        <div className="p-4 bg-grafite-600 border-t border-linha flex flex-col-reverse sm:flex-row sm:justify-end gap-2 shrink-0 rounded-b-2xl">
          <button onClick={onFechar} className="px-3 py-2 sm:py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700 transition-colors">Cancelar</button>
          <button onClick={salvar} disabled={!nome.trim() || limparTel(tel).length < 10}
            className="px-4 py-2 sm:py-1.5 rounded-lg bg-acao hover:bg-acao-200 text-slate-950 text-xs font-bold flex items-center justify-center gap-1.5 shadow-md shadow-acao/20 disabled:opacity-50 transition-all">
            <Save size={13}/> Salvar
          </button>
        </div>
      </div>
    </div>
    </Portal>
  );
}

// Item em lista vertical WhatsApp
const ItemContatoWhatsApp = React.memo(function ItemContatoWhatsApp({ contato, onEditar, onRemover, onToggleFav, onIniciarChat }) {
  const tagCor = TAGS_CORES[contato.tag] || TAGS_CORES.inativo;
  const iniciais = (contato.nome || 'CT').split(' ').slice(0,2).map(p => p[0]).join('').toUpperCase();

  return (
    <div className="p-3.5 hover:bg-grafite-600/70 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-linha/60 last:border-b-0">
      <div className="flex items-center gap-3.5 min-w-0 flex-1">
        <div className="relative shrink-0">
          <div className="w-11 h-11 rounded-full bg-gradient-to-br from-acao/20 to-espera/20 border border-acao/30 text-acao-200 font-bold text-sm flex items-center justify-center shadow-inner">
            {iniciais}
          </div>
          <button onClick={() => onToggleFav(contato.id)} className="absolute -bottom-1 -right-1 bg-grafite-700 p-0.5 rounded-full border border-linha text-slate-500 hover:text-espera-400 transition-colors">
            {contato.favorito ? <Star size={11} className="text-espera-400 fill-espera-400"/> : <StarOff size={11}/>}
          </button>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-xs sm:text-sm text-white truncate">{contato.nome}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${tagCor}`}>
              {contato.tag}
            </span>
          </div>

          <div className="flex items-center gap-3 text-xs text-slate-400 mt-1 flex-wrap font-mono">
            <span className="flex items-center gap-1 text-slate-300">
              <Phone size={11} className="text-ativo-400 shrink-0"/>
              {mascararTel(contato.telefone)}
            </span>

            {contato.empresa && (
              <span className="flex items-center gap-1 text-slate-400 truncate">
                <Building size={11} className="text-slate-500 shrink-0"/>
                <span className="truncate">{contato.empresa}</span>
              </span>
            )}

            {contato.email && (
              <span className="flex items-center gap-1 text-slate-400 truncate hidden md:flex">
                <Mail size={11} className="text-slate-500 shrink-0"/>
                <span className="truncate">{contato.email}</span>
              </span>
            )}
          </div>
          {contato.observacoes && (
            <p className="text-[11px] text-slate-400/80 italic mt-0.5 truncate">{contato.observacoes}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center pt-2 sm:pt-0 border-t sm:border-t-0 border-linha/40 w-full sm:w-auto justify-end">
        <button onClick={() => onIniciarChat(contato)} title="Iniciar atendimento WhatsApp"
          className="px-3 py-1.5 rounded-xl bg-ativo/15 hover:bg-ativo/30 border border-ativo/30 text-ativo-400 text-xs font-semibold flex items-center gap-1.5 transition-colors">
          <MessageSquare size={13}/>
          <span className="hidden sm:inline">Conversar</span>
        </button>
        <button onClick={() => onEditar(contato)} title="Editar contato"
          className="p-2 rounded-xl bg-slate-800/80 hover:bg-blue-500/20 text-blue-400 border border-linha transition-colors">
          <Pencil size={13}/>
        </button>
        <button onClick={() => onRemover(contato.id)} title="Remover contato"
          className="p-2 rounded-xl bg-slate-800/80 hover:bg-falha/20 text-falha-400 border border-linha transition-colors">
          <Trash2 size={13}/>
        </button>
      </div>
    </div>
  );
});

export default function Contatos({ conversas = [], setConversas, setAba }) {
  const [contatos,     setContatos]   = useState([]);
  const [carregando,   setCarregando] = useState(true);
  const [modalAberto,  setModal]      = useState(false);
  const [editando,     setEditando]   = useState(null);
  const [busca,        setBusca]      = useState('');
  const [tagFiltro,    setTagFiltro]  = useState('todas');
  const [apenasEstrelas, setEstrelas] = useState(false);
  const [ordenacao,    setOrdenacao]  = useState('nome');
  const [erroApi,      setErroApi]    = useState(null);
  const [sincronizando, setSincronizando] = useState(false);

  // Importa a agenda real do WhatsApp conectado (via Evolution).
  const sincronizarWhatsApp = useCallback(async () => {
    setSincronizando(true);
    try {
      const r = await ContatosAPI.sincronizar();
      const lista = await ContatosAPI.listar();
      setContatos(Array.isArray(lista) ? lista : []);
      setErroApi(null);
      window.alert(
        r.total === 0
          ? 'A Evolution não retornou nenhum contato.\n\nIsso acontece quando o WhatsApp ainda não enviou a agenda — conecte o número e aguarde alguns instantes.'
          : `Agenda importada!\n\n${r.criados} contato(s) novo(s)\n${r.atualizados} atualizado(s)\n${r.ignorados} ignorado(s) (grupos/inválidos)`
      );
    } catch (e) {
      window.alert('Não foi possível importar a agenda: ' + e.message);
    } finally {
      setSincronizando(false);
    }
  }, []);

  const carregarContatosServidor = useCallback(async () => {
    setCarregando(true);
    try {
      const lista = await ContatosAPI.listar();
      // Lista vazia = o usuario apagou todos os contatos. Antes caia no
      // SEED_CONTATOS aqui, entao apagar o ultimo contato "desfazia" no F5.
      setContatos(Array.isArray(lista) ? lista : []);
      setErroApi(null);
    } catch (err) {
      // Back-end fora: nao inventamos contatos de exemplo (eles teriam ids que
      // a API nao reconhece e nunca poderiam ser apagados de verdade).
      setContatos([]);
      setErroApi(err.message || 'Nao foi possivel carregar os contatos.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregarContatosServidor();
  }, [carregarContatosServidor]);

  // So mexe no estado depois que o servidor confirma. Antes, o catch gravava
  // o contato apenas na tela: parecia salvo e sumia no F5.
  const salvarContato = useCallback(async (ct) => {
    try {
      if (ct.id && !ct.id.startsWith('ct_conv_')) {
        const atualizado = await ContatosAPI.atualizar(ct.id, ct);
        setContatos(prev => prev.map(c => c.id === ct.id ? atualizado : c));
      } else {
        const criado = await ContatosAPI.criar(ct);
        setContatos(prev => [criado, ...prev.filter(c => c.id !== ct.id)]);
      }
      setErroApi(null);
      setModal(false); setEditando(null);
    } catch (err) {
      setErroApi(`Nao foi possivel salvar: ${err.message}. Verifique se o back-end esta rodando.`);
    }
  }, []);

  // Idem: se o DELETE falhar, o contato CONTINUA na tela. Antes ele sumia e
  // reaparecia no F5, porque nunca tinha sido apagado no banco.
  const removerContato = useCallback(async (id) => {
    if (!window.confirm('Remover este contato?')) return;
    try {
      await ContatosAPI.remover(id);
      setContatos(prev => prev.filter(c => c.id !== id));
      setErroApi(null);
    } catch (err) {
      setErroApi(`Nao foi possivel remover: ${err.message}. Verifique se o back-end esta rodando.`);
    }
  }, []);

  const toggleFavorito = useCallback(async (id) => {
    const alvo = contatos.find(c => c.id === id);
    if (!alvo) return;
    const nFav = !alvo.favorito;
    // Otimista, mas desfaz se o servidor recusar -- assim a estrela na tela
    // sempre reflete o que esta gravado no banco.
    setContatos(prev => prev.map(c => c.id === id ? { ...c, favorito: nFav } : c));
    try {
      await ContatosAPI.atualizar(id, { favorito: nFav });
    } catch (err) {
      setContatos(prev => prev.map(c => c.id === id ? { ...c, favorito: !nFav } : c));
      setErroApi(`Nao foi possivel atualizar o favorito: ${err.message}`);
    }
  }, [contatos]);

  function iniciarChat(contato) {
    if (!setConversas) return;
    const id = 'c_' + Date.now();
    const nova = {
      id,
      cliente:          contato.nome,
      telefone:         mascararTel(contato.telefone),
      statusAtendimento:'aguardando',
      cnpj:             null,
      cnpjVerificado:   false,
      lido:             false,
      mensagens:        [{
        de:   'sistema',
        texto:`Conversa iniciada a partir dos contatos.`,
        hora: new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}),
      }],
    };
    setConversas(prev => [nova, ...prev]);
    if (setAba) setAba('atendimento');
  }

  const listaFiltrada = useMemo(() => {
    let lista = contatos;

    if (apenasEstrelas) lista = lista.filter(c => c.favorito);
    if (tagFiltro !== 'todas') lista = lista.filter(c => c.tag === tagFiltro);

    if (busca.trim()) {
      const q = busca.toLowerCase();
      lista = lista.filter(c =>
        (c.nome || '').toLowerCase().includes(q) ||
        (c.telefone || '').includes(limparTel(busca)) ||
        (c.empresa || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q)
      );
    }

    return [...lista].sort((a, b) => {
      if (ordenacao === 'nome') return (a.nome || '').localeCompare(b.nome || '', 'pt-BR');
      if (b.favorito !== a.favorito) return b.favorito ? 1 : -1;
      return String(b.id).localeCompare(String(a.id));
    });
  }, [contatos, busca, tagFiltro, apenasEstrelas, ordenacao]);

  const contagemPorTag = useMemo(() => {
    const m = { todas: contatos.length };
    TAGS_DISPONIVEIS.forEach(t => { m[t] = contatos.filter(c => c.tag === t).length; });
    return m;
  }, [contatos]);

  if (carregando) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-400 text-xs gap-2 py-24">
        <Circle size={16} className="animate-spin text-acao" />
        Carregando lista de contatos do servidor...
      </div>
    );
  }

  return (
    <div className="fade-in space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-linha">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight font-display">Contatos (WhatsApp)</h1>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">
            {contatos.length} contato{contatos.length !== 1 ? 's' : ''} sincronizados com a base de dados.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={sincronizarWhatsApp} disabled={sincronizando}
            title="Importa a agenda real do WhatsApp conectado"
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-ativo/15 hover:bg-ativo/25 text-ativo-400 text-xs font-bold border border-ativo/30 transition-all disabled:opacity-60">
            <RefreshCw size={14} className={sincronizando ? 'animate-spin' : ''} />
            {sincronizando ? 'Importando...' : 'Sincronizar do WhatsApp'}
          </button>
          <button onClick={() => { setEditando(null); setModal(true); }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-acao hover:bg-acao-200 text-slate-950 text-xs font-bold shadow-md shadow-acao/20 transition-all">
            <Plus size={14}/> Novo Contato
          </button>
        </div>
      </div>

      {erroApi && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-falha/10 border border-falha/30 text-falha-400 text-xs">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold">Operacao nao concluida</p>
            <p className="text-falha-400/80 mt-0.5">{erroApi}</p>
          </div>
          <button onClick={() => setErroApi(null)} className="text-falha-400/60 hover:text-falha-400 shrink-0">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="relative flex-1 min-w-0">
          <Search size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500"/>
          <input value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por nome, WhatsApp, empresa ou e-mail..."
            className="w-full bg-grafite-700 border border-linha rounded-xl pl-9 pr-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-acao/50" />
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <button onClick={() => setEstrelas(v => !v)}
            className={`p-2.5 rounded-xl border transition-all ${apenasEstrelas ? 'bg-espera/15 border-espera/30 text-espera-400' : 'bg-grafite-600 border-linha text-slate-400 hover:text-espera-400'}`}
            title="Apenas favoritos">
            <Star size={14}/>
          </button>
          <select value={ordenacao} onChange={e => setOrdenacao(e.target.value)}
            className="bg-grafite-700 border border-linha rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-acao/50">
            <option value="nome">A-Z</option>
            <option value="recente">Recentes</option>
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {[['todas', 'Todos'], ...TAGS_DISPONIVEIS.map(t => [t, t.charAt(0).toUpperCase()+t.slice(1)])].map(([key, label]) => {
          const count = contagemPorTag[key] || 0;
          if (key !== 'todas' && count === 0) return null;
          return (
            <button key={key} onClick={() => setTagFiltro(key)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                tagFiltro === key
                  ? 'bg-acao/20 border-acao/40 text-acao-200'
                  : 'bg-grafite-600 border-linha text-slate-400 hover:text-slate-200'
              }`}>
              {label} ({count})
            </button>
          );
        })}
      </div>

      {/* Lista Vertical de Contatos Estilo WhatsApp */}
      <div className="glass-panel border border-linha rounded-2xl overflow-hidden divide-y divide-linha/60 shadow-xl">
        {listaFiltrada.map(c => (
          <ItemContatoWhatsApp key={c.id} contato={c}
            onEditar={ct => { setEditando(ct); setModal(true); }}
            onRemover={removerContato}
            onToggleFav={toggleFavorito}
            onIniciarChat={iniciarChat} />
        ))}
        {listaFiltrada.length === 0 && (
          <div className="text-center text-slate-400 text-xs py-16">
            <Users size={32} className="text-slate-600 mx-auto mb-3"/>
            {busca ? 'Nenhum contato encontrado para esta busca.' : 'Nenhum contato cadastrado ainda.'}
          </div>
        )}
      </div>

      {modalAberto && (
        <ModalContato contato={editando} onSalvar={salvarContato}
          onFechar={() => { setModal(false); setEditando(null); }}/>
      )}
    </div>
  );
}
