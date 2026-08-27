import { useState, useEffect, useRef } from 'react';
import {
  Zap, Plus, Pencil, Trash2, Save, X, Copy, Check,
  CreditCard, Search, Clock, HandHeart, PhoneOff, Monitor, ImagePlus, Paperclip, Loader2
} from 'lucide-react';
import Portal from '../Portal';
import { MensagensRapidasAPI } from '../../services/api';

// Segurança (defesa em profundidade): o anexo de uma mensagem rápida e uma
// imagem que sera enviada ao cliente e exibida no painel. Aqui validamos tipo e
// tamanho ANTES de mandar ao servidor; SVG e recusado de proposito (pode
// carregar script). O servidor revalida tudo de novo (whitelist de MIME, magic
// bytes, tamanho) e e a autoridade -- esta checagem do cliente e so conveniencia.
const TIPOS_IMG = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const TIPOS_VIDEO = ['video/mp4', 'video/webm', 'video/quicktime', 'video/3gpp'];
const TIPOS_ANEXO = [...TIPOS_IMG, ...TIPOS_VIDEO];
const MAX_ANEXO_BYTES = 20 * 1024 * 1024; // 20 MB (mesmo teto do servidor)

const ehVideoMime = (m) => String(m || '').startsWith('video/');

function lerAnexo(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('Nenhum arquivo.'));
    if (!TIPOS_ANEXO.includes(file.type)) {
      return reject(new Error('Aceitos: imagem (PNG, JPEG, WebP, GIF) ou vídeo (MP4).'));
    }
    if (file.size > MAX_ANEXO_BYTES) {
      return reject(new Error('Arquivo muito grande (máx. 20 MB).'));
    }
    const reader = new FileReader();
    reader.onload = () => resolve({ media: reader.result, mimetype: file.type, fileName: file.name });
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}



function IconeMensagem({ icon, size = 16 }) {
  const mapa = {
    pix: { Icon: CreditCard, color: 'text-ativo-400' },
    search: { Icon: Search, color: 'text-blue-400' },
    clock: { Icon: Clock, color: 'text-espera-400' },
    bye: { Icon: HandHeart, color: 'text-pink-400' },
    noreturn: { Icon: PhoneOff, color: 'text-falha-400' },
    monitor: { Icon: Monitor, color: 'text-purple-400' },
    default: { Icon: Zap, color: 'text-acao-200' }
  };
  const { Icon, color } = mapa[icon] || mapa.default;
  return <Icon size={size} className={color} />;
}

const CATEGORIAS = {
  pagamento: { label: 'Pagamento', color: 'bg-ativo/15 text-ativo-400 border-ativo/30' },
  consulta: { label: 'Consulta', color: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  encerramento: { label: 'Encerramento', color: 'bg-falha/15 text-falha-400 border-falha/30' },
  suporte: { label: 'Suporte', color: 'bg-purple-500/15 text-purple-400 border-purple-500/30' },
  geral: { label: 'Geral', color: 'bg-slate-600/30 text-slate-300 border-linha' }
};

function ModalEdicao({ msg, onSalvar, onFechar, salvando }) {
  const [titulo, setTitulo] = useState(msg?.titulo || '');
  const [texto, setTexto] = useState(msg?.texto || '');
  const [categoria, setCategoria] = useState(msg?.categoria || 'geral');
  const [anexo, setAnexo] = useState(msg?.anexo || null); // { media, mimetype, fileName }
  const [erroAnexo, setErroAnexo] = useState('');
  const fileRef = useRef(null);

  // Permite salvar quando ha titulo e (texto OU anexo) -- uma mensagem so com
  // imagem (ex.: QR Code) tambem e valida.
  const podeSalvar = !!titulo.trim() && (!!texto.trim() || !!anexo);

  async function escolherAnexo(file) {
    if (!file) return;
    setErroAnexo('');
    try {
      setAnexo(await lerAnexo(file));
    } catch (e) {
      setErroAnexo(e.message);
    }
  }

  function salvar() {
    if (!podeSalvar) return;
    // O id NAO e fabricado aqui: quem cria vs. edita e decidido pelo componente
    // pai (com base no registro que estava sendo editado) e o id vem do servidor.
    onSalvar({
      titulo: titulo.trim(),
      texto: texto.trim(),
      categoria,
      icon: msg?.icon || 'default',
      anexo: anexo || null,
    });
  }

  return (
    // Portal: tira o modal do container `.fade-in` (transform quebrava o
    // position:fixed e cortava o modal). max-h + scroll interno garantem que o
    // rodape com o botao Salvar nunca fique fora da tela em viewport baixa.
    <Portal>
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-start sm:items-center justify-center z-50 p-3 sm:p-4 overflow-y-auto">
      <div className="glass-panel border border-linha rounded-2xl w-full max-w-xl shadow-2xl fade-in my-auto flex flex-col max-h-[calc(100dvh-1.5rem)] sm:max-h-[90vh]">
        <div className="p-4 bg-grafite-600 border-b border-linha flex items-center justify-between shrink-0 rounded-t-2xl">
          <div className="flex items-center gap-2 font-bold text-sm text-white min-w-0">
            <Zap size={16} className="text-acao-200 shrink-0" />
            <span className="truncate">{msg?.id ? 'Editar Mensagem Rápida' : 'Nova Mensagem Rápida'}</span>
          </div>
          <button onClick={onFechar} className="text-slate-400 hover:text-white transition-colors shrink-0 ml-2">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-4 flex-1 overflow-y-auto min-h-0">
          <div>
            <label className="text-xs text-slate-400 font-medium block mb-1.5">Título / Atalho</label>
            <input
              value={titulo}
              onChange={e => setTitulo(e.target.value)}
              placeholder="Ex: PIX, AnyDesk, Boas-vindas..."
              className="w-full bg-grafite-700 border border-linha rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-acao/50 transition-colors"
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 font-medium block mb-1.5">Categoria</label>
            <select
              value={categoria}
              onChange={e => setCategoria(e.target.value)}
              className="w-full bg-grafite-700 border border-linha rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-acao/50"
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
              className="w-full min-h-[140px] bg-grafite-700 border border-linha rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-acao/50 resize-y transition-colors font-mono leading-relaxed"
            />
          </div>

          {/* Anexo de imagem (ex.: QR Code do PIX). Enviado junto com o texto
              quando a mensagem for usada no atendimento. */}
          <div>
            <label className="text-xs text-slate-400 font-medium block mb-1.5">
              Anexo (imagem ou vídeo) <span className="text-slate-500">(opcional)</span>
            </label>

            {anexo ? (
              <div className="flex items-center gap-3 bg-grafite-700 border border-linha rounded-xl p-2.5">
                {ehVideoMime(anexo.mimetype) ? (
                  <video
                    src={anexo.media}
                    muted
                    className="w-14 h-14 rounded-lg object-cover border border-linha shrink-0 bg-grafite-800"
                  />
                ) : (
                  <img
                    src={anexo.media}
                    alt="Anexo"
                    className="w-14 h-14 rounded-lg object-cover border border-linha shrink-0 bg-grafite-800"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold text-white truncate flex items-center gap-1">
                    <Paperclip size={11} className="text-acao-200 shrink-0" /> {anexo.fileName || 'anexo'}
                  </div>
                  <div className="text-[10px] text-slate-500 uppercase">{(anexo.mimetype || '').replace(/^(image|video)\//, '') || 'anexo'}</div>
                </div>
                <button
                  type="button"
                  onClick={() => { setAnexo(null); setErroAnexo(''); }}
                  title="Remover anexo"
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-falha/20 text-falha-400 shrink-0"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-linha px-3 py-2.5 text-xs font-semibold text-slate-400 transition-colors hover:border-acao/50 hover:text-white"
              >
                <ImagePlus size={15} /> Anexar imagem ou vídeo
              </button>
            )}

            <input
              ref={fileRef}
              type="file"
              accept={TIPOS_ANEXO.join(',')}
              className="hidden"
              onChange={e => { escolherAnexo(e.target.files?.[0]); e.target.value = ''; }}
            />
            {erroAnexo && <p className="mt-1.5 text-[11px] font-semibold text-falha-400">{erroAnexo}</p>}
            <p className="mt-1 text-[10px] text-slate-500">Imagem (PNG, JPEG, WebP, GIF) ou vídeo (MP4) · máx. 20 MB</p>
          </div>
        </div>

        <div className="p-4 bg-grafite-600 border-t border-linha flex flex-col-reverse sm:flex-row sm:justify-end gap-2 shrink-0 rounded-b-2xl">
          <button
            onClick={onFechar}
            className="px-3 py-2 sm:py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={salvar}
            disabled={!podeSalvar || salvando}
            className="px-4 py-2 sm:py-1.5 rounded-lg bg-acao hover:bg-acao-200 text-slate-950 text-xs font-bold flex items-center justify-center gap-1.5 shadow-md shadow-acao/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {salvando ? <><Loader2 size={13} className="animate-spin" /> Salvando...</> : <><Save size={13} /> Salvar Mensagem</>}
          </button>
        </div>
      </div>
    </div>
    </Portal>
  );
}

function CardMensagem({ msg, onEditar, onRemover, onCopiar, copiado }) {
  const cat = CATEGORIAS[msg.categoria] || CATEGORIAS.geral;

  return (
    <div className="glass-panel p-4 rounded-2xl border border-linha space-y-3 hover:border-linha-forte transition-all">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-2 rounded-xl bg-grafite-600 border border-linha shrink-0">
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
              ? <Check size={13} className="text-ativo-400" />
              : <Copy size={13} className="text-slate-400" />}
          </button>
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
            className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-falha-400 transition-colors"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <div className="bg-grafite-700 rounded-xl p-3 border border-linha flex gap-3">
        {msg.anexo?.media && (
          ehVideoMime(msg.anexo.mimetype) ? (
            <video
              src={msg.anexo.media}
              muted
              className="w-12 h-12 rounded-lg object-cover border border-linha shrink-0 bg-grafite-800"
              title="Vídeo anexado"
            />
          ) : (
            <img
              src={msg.anexo.media}
              alt="Anexo"
              className="w-12 h-12 rounded-lg object-cover border border-linha shrink-0 bg-grafite-800"
              title="Imagem anexada"
            />
          )
        )}
        <p className="text-[11px] text-slate-300 leading-relaxed line-clamp-3 whitespace-pre-line flex-1 min-w-0">
          {msg.texto || (msg.anexo ? (ehVideoMime(msg.anexo.mimetype) ? '(somente vídeo)' : '(somente imagem)') : '')}
        </p>
      </div>
    </div>
  );
}

export default function MensagensRapidas({ onUsarMensagem }) {
  const [mensagens, setMensagens] = useState([]);
  const [modalAberto, setModalAberto] = useState(false);
  const [editando, setEditando] = useState(null);
  const [copiado, setCopiado] = useState(null);
  const [busca, setBusca] = useState('');
  const [catFiltro, setCatFiltro] = useState('todas');
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  // Mensagens rapidas agora vivem no servidor (compartilhadas pela equipe).
  async function carregarLista() {
    setCarregando(true);
    setErro('');
    try {
      setMensagens(await MensagensRapidasAPI.listar());
    } catch (e) {
      setErro(e.message || 'Não foi possível carregar as mensagens.');
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => { carregarLista(); }, []);

  // Cria (sem id em edicao) ou atualiza (id do registro que estava aberto). O
  // servidor valida titulo/conteudo e a imagem do anexo antes de gravar.
  async function salvarMensagem(payload) {
    setSalvando(true);
    setErro('');
    try {
      if (editando?.id) {
        await MensagensRapidasAPI.atualizar(editando.id, payload);
      } else {
        await MensagensRapidasAPI.criar(payload);
      }
      setModalAberto(false);
      setEditando(null);
      await carregarLista();
    } catch (e) {
      window.alert('Não foi possível salvar: ' + (e.message || 'erro desconhecido'));
    } finally {
      setSalvando(false);
    }
  }

  async function removerMensagem(id) {
    if (!window.confirm('Remover esta mensagem rápida? Isso vale para toda a equipe.')) return;
    setErro('');
    try {
      await MensagensRapidasAPI.remover(id);
      await carregarLista();
    } catch (e) {
      window.alert('Não foi possível remover: ' + (e.message || 'erro desconhecido'));
    }
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
    <div className="fade-in space-y-6 baixa:lg:space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-linha">
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
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-acao hover:bg-acao-200 text-slate-950 text-xs font-bold shadow-md shadow-acao/20 transition-all shrink-0"
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
            className="w-full bg-grafite-700 border border-linha rounded-xl pl-9 pr-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-acao/50"
          />
        </div>

        <button
          onClick={() => setCatFiltro('todas')}
          className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
            catFiltro === 'todas'
              ? 'bg-acao/20 border-acao/40 text-acao-200'
              : 'bg-grafite-600 border-linha text-slate-400 hover:text-slate-200'
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
                  ? 'bg-acao/20 border-acao/40 text-acao-200'
                  : 'bg-grafite-600 border-linha text-slate-400 hover:text-slate-200'
              }`}
            >
              {val.label} ({count})
            </button>
          );
        })}
      </div>
      {erro && (
        <div className="rounded-xl border border-falha/30 bg-falha/15 p-3 text-xs font-semibold text-falha-400">
          {erro}
        </div>
      )}

      {carregando ? (
        <div className="flex items-center justify-center gap-2 py-16 text-slate-400 text-xs">
          <Loader2 size={16} className="animate-spin" /> Carregando mensagens...
        </div>
      ) : (
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
      )}

      {modalAberto && (
        <ModalEdicao
          msg={editando}
          salvando={salvando}
          onSalvar={salvarMensagem}
          onFechar={() => { if (!salvando) { setModalAberto(false); setEditando(null); } }}
        />
      )}
    </div>
  );
}

// Hook usado pelo painel de mensagens rapidas no atendimento (somente leitura).
// Busca do servidor a cada montagem (o painel so monta ao ser aberto).
export function useMensagensRapidas() {
  const [mensagens, setMensagens] = useState([]);

  useEffect(() => {
    let vivo = true;
    MensagensRapidasAPI.listar()
      .then(lista => { if (vivo) setMensagens(Array.isArray(lista) ? lista : []); })
      .catch(() => { if (vivo) setMensagens([]); });
    return () => { vivo = false; };
  }, []);

  return mensagens;
}
