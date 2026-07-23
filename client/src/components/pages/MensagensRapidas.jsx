import React, { useState, useEffect } from 'react';
import {
  Zap, Plus, Pencil, Trash2, Save, X, Copy, Check,
  CreditCard, Search, Clock, HandHeart, PhoneOff, Monitor
} from 'lucide-react';

<<<<<<< HEAD
=======
// ── Persistência ─────────────────────────────────────────────────────────────
>>>>>>> 5eddf9efedba389287d3c8bd67d57fa6f14c8fcf
async function carregar(chave, padrao) {
  try {
    const raw = localStorage.getItem(chave);
    return raw ? JSON.parse(raw) : padrao;
  } catch { return padrao; }
}
async function salvar(chave, valor) {
  try { localStorage.setItem(chave, JSON.stringify(valor)); } catch {}
}

<<<<<<< HEAD
=======
// ── Mensagens padrão ─────────────────────────────────────────────────────────
>>>>>>> 5eddf9efedba389287d3c8bd67d57fa6f14c8fcf
const MENSAGENS_PADRAO = [
  {
    id: 'mr_pix',
    titulo: 'PIX',
    categoria: 'pagamento',
    icon: 'pix',
    texto: 'Olá! Para realizar o pagamento via PIX, utilize a chave abaixo:\n\n🔑 Chave PIX: pagamentos@arkatecnologia.com.br\n\nApós o pagamento, envie o comprovante neste chat para confirmarmos. 😊',
    editavel: true,
  },
  {
    id: 'mr_limite',
    titulo: 'Limite de Pesquisa',
    categoria: 'consulta',
    icon: 'search',
    texto: 'Olá! Informamos que você atingiu o limite de pesquisas disponíveis para este período.\n\nPara continuar utilizando o serviço, entre em contato com nossa equipe comercial para verificar as opções disponíveis.',
    editavel: true,
  },
  {
    id: 'mr_tempo',
    titulo: 'Pesquisa Finalizada por Tempo',
    categoria: 'consulta',
    icon: 'clock',
    texto: 'Olá! Sua pesquisa foi encerrada automaticamente por exceder o tempo limite configurado.\n\nCaso precise de mais informações, fique à vontade para iniciar uma nova consulta ou entrar em contato com nosso suporte.',
    editavel: true,
  },
  {
    id: 'mr_proxima',
    titulo: 'Até a Próxima!',
    categoria: 'encerramento',
    icon: 'bye',
<<<<<<< HEAD
    texto: 'Foi um prazer atendê-lo(a)! 😊\n\nSe precisar de mais alguma coisa, é só entrar em contato. Estamos sempre aqui para ajudar.\n\n*Equipe Arka Tecnologia* Até a próxima! 👋',
=======
    texto: 'Foi um prazer atendê-lo(a)! 😊\n\nSe precisar de mais alguma coisa, é só entrar em contato. Estamos sempre aqui para ajudar.\n\n*Equipe Arka Tecnologia* — Até a próxima! 👋',
>>>>>>> 5eddf9efedba389287d3c8bd67d57fa6f14c8fcf
    editavel: true,
  },
  {
    id: 'mr_sem_retorno',
    titulo: 'Sem Retorno',
    categoria: 'encerramento',
    icon: 'noreturn',
<<<<<<< HEAD
    texto: 'Olá! Percebemos que não obtivemos retorno após nossos contatos.\n\nEste atendimento será encerrado por falta de resposta. Caso precise de auxílio, basta enviar uma nova mensagem será um prazer atendê-lo(a) novamente!',
=======
    texto: 'Olá! Percebemos que não obtivemos retorno após nossos contatos.\n\nEste atendimento será encerrado por falta de resposta. Caso precise de auxílio, basta enviar uma nova mensagem — será um prazer atendê-lo(a) novamente!',
>>>>>>> 5eddf9efedba389287d3c8bd67d57fa6f14c8fcf
    editavel: true,
  },
  {
    id: 'mr_anydesk',
    titulo: 'AnyDesk',
    categoria: 'suporte',
    icon: 'monitor',
<<<<<<< HEAD
    texto: 'Olá! Para darmos continuidade ao suporte remoto, precisamos acessar seu computador via AnyDesk.\n\n📥 *Download AnyDesk:* https://anydesk.com/pt\n\n1. Baixe e instale o AnyDesk\n2. Abra o programa\n3. Envie o número de 9 dígitos que aparecer na tela\n\nAguardamos! 🛠️',
=======
    texto: 'Olá! Para darmos continuidade ao suporte remoto, precisamos acessar seu computador via AnyDesk.\n\n📥 *Download AnyDesk:* https://anydesk.com/pt/downloads\n\n1. Baixe e instale o AnyDesk\n2. Abra o programa\n3. Envie o número de 9 dígitos que aparecer na tela\n\nAguardamos! 🛠️',
>>>>>>> 5eddf9efedba389287d3c8bd67d57fa6f14c8fcf
    editavel: true,
  },
];

<<<<<<< HEAD
=======
// ── Ícones por categoria ──────────────────────────────────────────────────────
>>>>>>> 5eddf9efedba389287d3c8bd67d57fa6f14c8fcf
function IconeMensagem({ icon, size = 16 }) {
  const mapa = {
    pix: { Icon: CreditCard, color: 'text-emerald-400' },
    search: { Icon: Search, color: 'text-blue-400' },
    clock: { Icon: Clock, color: 'text-amber-400' },
    bye: { Icon: HandHeart, color: 'text-pink-400' },
    noreturn: { Icon: PhoneOff, color: 'text-rose-400' },
    monitor: { Icon: Monitor, color: 'text-purple-400' },
    default: { Icon: Zap, color: 'text-orange-400' },
  };
  const { Icon, color } = mapa[icon] || mapa.default;
  return <Icon size={size} className={color} />;
}

const CATEGORIAS = {
  pagamento: { label: 'Pagamento', color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  consulta: { label: 'Consulta', color: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  encerramento: { label: 'Encerramento', color: 'bg-rose-500/15 text-rose-400 border-rose-500/30' },
  suporte: { label: 'Suporte', color: 'bg-purple-500/15 text-purple-400 border-purple-500/30' },
  geral: { label: 'Geral', color: 'bg-slate-600/30 text-slate-300 border-slate-600/40' },
};

<<<<<<< HEAD
=======
// ── Modal de edição / criação ─────────────────────────────────────────────────
>>>>>>> 5eddf9efedba389287d3c8bd67d57fa6f14c8fcf
function ModalEdicao({ msg, onSalvar, onFechar }) {
  const [titulo, setTitulo] = useState(msg?.titulo || '');
  const [texto, setTexto] = useState(msg?.texto || '');
  const [categoria, setCategoria] = useState(msg?.categoria || 'geral');

  function salvar() {
    if (!titulo.trim() || !texto.trim()) return;
    onSalvar({
      id: msg?.id || 'mr_' + Date.now(),
      titulo: titulo.trim(),
      texto: texto.trim(),
      categoria,
      icon: msg?.icon || 'default',
      editavel: true,
    });
  }

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass-panel border border-[#2A3040] rounded-2xl w-full max-w-xl shadow-2xl fade-in">
        <div className="p-4 bg-[#1E2330] border-b border-[#2A3040] flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-sm text-white">
            <Zap size={16} className="text-orange-400" />
            {msg?.id ? 'Editar Mensagem Rápida' : 'Nova Mensagem Rápida'}
          </div>
          <button onClick={onFechar} className="text-slate-400 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs text-slate-400 font-medium block mb-1.5">Título / Atalho</label>
            <input
              value={titulo}
              onChange={e => setTitulo(e.target.value)}
              placeholder="Ex: PIX, AnyDesk, Boas-vindas..."
              className="w-full bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50 transition-colors"
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 font-medium block mb-1.5">Categoria</label>
            <select
              value={categoria}
              onChange={e => setCategoria(e.target.value)}
              className="w-full bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-orange-500/50"
            >
              {Object.entries(CATEGORIAS).map(([key, val]) => (
                <option key={key} value={key}>{val.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-slate-400 font-medium block mb-1.5">
              Texto da Mensagem
              <span className="ml-2 text-slate-500">({texto.length} caracteres)</span>
            </label>
            <textarea
              value={texto}
              onChange={e => setTexto(e.target.value)}
              rows={7}
              placeholder="Digite o texto completo da mensagem..."
              className="w-full bg-[#161922] border border-[#2A3040] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50 resize-none transition-colors font-mono leading-relaxed"
            />
          </div>
        </div>

        <div className="p-4 bg-[#1E2330] border-t border-[#2A3040] flex justify-end gap-2">
          <button
            onClick={onFechar}
            className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={salvar}
            disabled={!titulo.trim() || !texto.trim()}
            className="px-4 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 shadow-md shadow-orange-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save size={13} /> Salvar Mensagem
          </button>
        </div>
      </div>
    </div>
  );
}

<<<<<<< HEAD
=======
// ── Card de mensagem rápida ──────────────────────────────────────────────────
>>>>>>> 5eddf9efedba389287d3c8bd67d57fa6f14c8fcf
function CardMensagem({ msg, onEditar, onRemover, onCopiar, copiado }) {
  const cat = CATEGORIAS[msg.categoria] || CATEGORIAS.geral;

  return (
    <div className="glass-panel p-4 rounded-2xl border border-[#2A3040] space-y-3 hover:border-slate-600/60 transition-all">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-2 rounded-xl bg-[#1E2330] border border-[#2A3040] shrink-0">
            <IconeMensagem icon={msg.icon} size={15} />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-xs text-white truncate">{msg.titulo}</div>
            <span className={`inline-flex items-center text-[10px] px-2 py-0.5 rounded-full border font-semibold mt-0.5 ${cat.color}`}>
              {cat.label}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onCopiar(msg)}
            title="Copiar texto"
            className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 transition-colors"
          >
            {copiado === msg.id
              ? <Check size={13} className="text-emerald-400" />
              : <Copy size={13} className="text-slate-400" />}
          </button>
          {msg.editavel && (
            <>
              <button
                onClick={() => onEditar(msg)}
                title="Editar mensagem"
                className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-blue-400 transition-colors"
              >
                <Pencil size={13} />
              </button>
              <button
                onClick={() => onRemover(msg.id)}
                title="Remover mensagem"
                className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-rose-400 transition-colors"
              >
                <Trash2 size={13} />
              </button>
            </>
          )}
        </div>
      </div>

<<<<<<< HEAD
=======
      {/* Preview do texto */}
>>>>>>> 5eddf9efedba389287d3c8bd67d57fa6f14c8fcf
      <div className="bg-[#161922] rounded-xl p-3 border border-[#2A3040]">
        <p className="text-[11px] text-slate-300 leading-relaxed line-clamp-3 whitespace-pre-line">
          {msg.texto}
        </p>
      </div>
    </div>
  );
}

<<<<<<< HEAD
=======
// ── Componente principal ─────────────────────────────────────────────────────
>>>>>>> 5eddf9efedba389287d3c8bd67d57fa6f14c8fcf
export default function MensagensRapidas({ onUsarMensagem }) {
  const [mensagens, setMensagens] = useState([]);
  const [modalAberto, setModalAberto] = useState(false);
  const [editando, setEditando] = useState(null);
  const [copiado, setCopiado] = useState(null);
  const [busca, setBusca] = useState('');
  const [catFiltro, setCatFiltro] = useState('todas');

<<<<<<< HEAD
=======
  // Carrega do localStorage, com seed padrão
>>>>>>> 5eddf9efedba389287d3c8bd67d57fa6f14c8fcf
  useEffect(() => {
    carregar('arka:mensagens_rapidas', null).then(salvas => {
      setMensagens(salvas || MENSAGENS_PADRAO);
    });
  }, []);

<<<<<<< HEAD
=======
  // Persiste sempre que houver mudança
>>>>>>> 5eddf9efedba389287d3c8bd67d57fa6f14c8fcf
  useEffect(() => {
    if (mensagens.length > 0) {
      salvar('arka:mensagens_rapidas', mensagens);
    }
  }, [mensagens]);

  function salvarMensagem(msg) {
    setMensagens(prev => {
      const idx = prev.findIndex(m => m.id === msg.id);
      if (idx >= 0) {
        const nova = [...prev];
        nova[idx] = msg;
        return nova;
      }
      return [...prev, msg];
    });
    setModalAberto(false);
    setEditando(null);
  }

  function removerMensagem(id) {
    if (!window.confirm('Remover esta mensagem rápida?')) return;
    setMensagens(prev => prev.filter(m => m.id !== id));
  }

  function copiarTexto(msg) {
    navigator.clipboard.writeText(msg.texto).then(() => {
      setCopiado(msg.id);
      setTimeout(() => setCopiado(null), 2000);
    });
  }

  function abrirEdicao(msg) {
    setEditando(msg);
    setModalAberto(true);
  }

  function abrirNova() {
    setEditando(null);
    setModalAberto(true);
  }

  const filtradas = mensagens.filter(m => {
    const matchBusca = m.titulo.toLowerCase().includes(busca.toLowerCase()) ||
                       m.texto.toLowerCase().includes(busca.toLowerCase());
    const matchCat = catFiltro === 'todas' || m.categoria === catFiltro;
    return matchBusca && matchCat;
  });

  return (
    <div className="fade-in space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight font-display">
            Mensagens Rápidas
          </h1>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">
            Respostas pré-definidas e editáveis para agilizar o atendimento.
          </p>
        </div>
        <button
          onClick={abrirNova}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-400 text-slate-950 text-xs font-bold shadow-md shadow-orange-500/20 transition-all shrink-0"
        >
          <Plus size={14} /> Nova Mensagem
        </button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar mensagem..."
            className="w-full bg-[#161922] border border-[#2A3040] rounded-xl pl-9 pr-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50"
          />
        </div>

        <button
          onClick={() => setCatFiltro('todas')}
          className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
            catFiltro === 'todas'
              ? 'bg-orange-500/20 border-orange-500/40 text-orange-400'
              : 'bg-[#1E2330] border-[#2A3040] text-slate-400 hover:text-slate-200'
          }`}
        >
          Todas ({mensagens.length})
        </button>
        {Object.entries(CATEGORIAS).map(([key, val]) => {
          const count = mensagens.filter(m => m.categoria === key).length;
          if (count === 0) return null;
          return (
            <button
              key={key}
              onClick={() => setCatFiltro(key)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                catFiltro === key
                  ? 'bg-orange-500/20 border-orange-500/40 text-orange-400'
                  : 'bg-[#1E2330] border-[#2A3040] text-slate-400 hover:text-slate-200'
              }`}
            >
              {val.label} ({count})
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtradas.map(msg => (
          <CardMensagem
            key={msg.id}
            msg={msg}
            onEditar={abrirEdicao}
            onRemover={removerMensagem}
            onCopiar={copiarTexto}
            copiado={copiado}
          />
        ))}
        {filtradas.length === 0 && (
          <div className="col-span-full text-center text-slate-400 text-xs py-10">
            Nenhuma mensagem encontrada.
          </div>
        )}
      </div>

<<<<<<< HEAD
=======
      {/* Modal de edição */}
>>>>>>> 5eddf9efedba389287d3c8bd67d57fa6f14c8fcf
      {modalAberto && (
        <ModalEdicao
          msg={editando}
          onSalvar={salvarMensagem}
          onFechar={() => { setModalAberto(false); setEditando(null); }}
        />
      )}
    </div>
  );
}

export function useMensagensRapidas() {
  const [mensagens, setMensagens] = useState(MENSAGENS_PADRAO);

  useEffect(() => {
    carregar('arka:mensagens_rapidas', null).then(salvas => {
      if (salvas) setMensagens(salvas);
    });
  }, []);

  return mensagens;
}
