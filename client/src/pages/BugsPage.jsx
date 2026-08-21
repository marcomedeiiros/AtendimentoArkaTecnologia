/**
 * Relatos de Bugs (administracao).
 *
 * Lista tudo que foi enviado pelo botao flutuante de "Reportar bug". Tela
 * restrita a Administrador -- o mesmo cargo tambem e exigido no servidor, entao
 * esconder aqui e so cortesia de interface, nao a barreira de fato.
 */
import { useState, useEffect } from 'react';
import { Bug, Loader2, CheckCircle2, RotateCcw, Trash2, X, ShieldAlert, MapPin, User, Flag } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { BugsAPI } from '../services/api';

function quando(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const data = d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${data} · ${hora}`;
}

const FILTROS = [
  { valor: '', label: 'Todos' },
  { valor: 'aberto', label: 'Abertos' },
  { valor: 'resolvido', label: 'Resolvidos' },
];

// Prioridades (triagem do admin). `ordem` menor = mais urgente, usado para
// ordenar a lista. As classes seguem a paleta do projeto.
const PRIORIDADES = {
  critica: { label: 'Crítica', ordem: 0, classe: 'bg-falha/15 text-falha-400 border-falha/30' },
  alta:    { label: 'Alta',    ordem: 1, classe: 'bg-espera/15 text-espera-400 border-espera/30' },
  media:   { label: 'Média',   ordem: 2, classe: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  baixa:   { label: 'Baixa',   ordem: 3, classe: 'bg-slate-600/30 text-slate-300 border-linha' },
};
function metaPrioridade(p) {
  return PRIORIDADES[p] || PRIORIDADES.media;
}

const FILTROS_PRIORIDADE = [
  { valor: '', label: 'Todas' },
  { valor: 'critica', label: 'Crítica' },
  { valor: 'alta', label: 'Alta' },
  { valor: 'media', label: 'Média' },
  { valor: 'baixa', label: 'Baixa' },
];

export default function BugsPage() {
  const { usuario } = useAuth();
  const ehAdmin = usuario?.cargo === 'Administrador';

  const [relatos, setRelatos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [filtro, setFiltro] = useState('aberto'); // abre já na lista de abertos
  const [prioridadeFiltro, setPrioridadeFiltro] = useState(''); // filtro client-side
  const [loadingId, setLoadingId] = useState(null);
  const [erro, setErro] = useState('');
  const [ampliada, setAmpliada] = useState(null); // data URL do print aberto

  // `silencioso`: reconcilia com o servidor SEM o spinner de tela cheia. Usado
  // depois de uma acao otimista (resolver/reabrir/excluir), que ja atualizou a
  // tela -- assim nao ha o "flash" de recarregar tudo.
  async function carregar(silencioso = false) {
    if (!silencioso) setCarregando(true);
    setErro('');
    try {
      const dados = await BugsAPI.listar(filtro);
      setRelatos(dados);
    } catch (e) {
      setErro(e.message);
    } finally {
      if (!silencioso) setCarregando(false);
    }
  }

  useEffect(() => {
    if (ehAdmin) carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro, ehAdmin]);

  async function mudarStatus(relato, status) {
    setLoadingId(relato.id);
    setErro('');
    // Otimista: ao resolver, o item some da aba "Abertos" na hora (e vice-versa
    // ao reabrir), sem esperar o round-trip. O carregar() logo depois reconcilia
    // com o servidor; se der erro, o carregar() no catch desfaz o otimismo.
    setRelatos(prev => prev.map(r => (r.id === relato.id ? { ...r, status } : r)));
    try {
      await BugsAPI.atualizarStatus(relato.id, status);
      await carregar(true); // reconcilia em silencio (sem flash)
    } catch (e) {
      setErro(e.message);
      await carregar(true); // desfaz o otimismo, tambem sem flash
    } finally {
      setLoadingId(null);
    }
  }

  async function excluir(relato) {
    if (!window.confirm('Excluir este relato definitivamente?')) return;
    setLoadingId(relato.id);
    setErro('');
    // Otimista: some da lista na hora; o servidor confirma em segundo plano.
    setRelatos(prev => prev.filter(r => r.id !== relato.id));
    try {
      await BugsAPI.remover(relato.id);
      await carregar(true);
    } catch (e) {
      setErro(e.message);
      await carregar(true); // falhou: traz o item de volta
    } finally {
      setLoadingId(null);
    }
  }

  if (!ehAdmin) {
    return (
      <div className="fade-in flex flex-col items-center justify-center gap-3 py-24 text-center">
        <ShieldAlert size={32} className="text-espera-400" />
        <h1 className="text-lg font-bold text-white">Acesso restrito</h1>
        <p className="max-w-sm text-xs text-texto-suave">
          Os relatos de bugs só podem ser vistos por administradores.
        </p>
      </div>
    );
  }

  const abertos = relatos.filter(r => r.status === 'aberto').length;

  // Lista exibida: aplica os filtros de status e prioridade no cliente (o de
  // status tambem no servidor, mas repetir aqui faz o "Resolver" otimista tirar
  // o item da aba na hora) e ordena por status, prioridade e data.
  const visiveis = relatos
    .filter(r => !filtro || (r.status || 'aberto') === filtro)
    .filter(r => !prioridadeFiltro || (r.prioridade || 'media') === prioridadeFiltro)
    .slice()
    .sort((a, b) => {
      const sa = a.status === 'resolvido' ? 1 : 0;
      const sb = b.status === 'resolvido' ? 1 : 0;
      if (sa !== sb) return sa - sb;
      const pa = metaPrioridade(a.prioridade).ordem;
      const pb = metaPrioridade(b.prioridade).ordem;
      if (pa !== pb) return pa - pb;
      return new Date(b.criadoEm || 0) - new Date(a.criadoEm || 0);
    });

  return (
    <div className="fade-in space-y-6">
      <div className="mb-8 flex flex-col gap-4 border-b border-linha pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white">Relatos de Bugs</h1>
          <p className="mt-1 text-xs text-texto-suave sm:text-sm">
            Problemas enviados pela equipe através do botão de reportar bug.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-xs">
          {abertos > 0 && (
            <span className="flex items-center gap-1.5 rounded-full border border-espera/30 bg-espera/20 px-2.5 py-1 font-semibold text-espera-400">
              <Bug size={13} /> {abertos} aberto(s)
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTROS.map(f => (
          <button
            key={f.valor}
            onClick={() => setFiltro(f.valor)}
            className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all ${
              filtro === f.valor
                ? 'border-acao/40 bg-acao/15 text-acao-200'
                : 'border-linha text-texto-suave hover:text-white'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-texto-fraco">
          <Flag size={12} /> Prioridade
        </span>
        {FILTROS_PRIORIDADE.map(f => (
          <button
            key={f.valor}
            onClick={() => setPrioridadeFiltro(f.valor)}
            className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all ${
              prioridadeFiltro === f.valor
                ? 'border-acao/40 bg-acao/15 text-acao-200'
                : 'border-linha text-texto-suave hover:text-white'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {erro && (
        <div className="rounded-xl border border-falha/30 bg-falha/15 p-3 text-xs font-semibold text-falha-400">
          {erro}
        </div>
      )}

      {carregando ? (
        <div className="flex items-center justify-center gap-2 py-16 text-texto-suave">
          <Loader2 size={18} className="animate-spin" /> Carregando relatos...
        </div>
      ) : visiveis.length === 0 ? (
        <div className="glass-panel rounded-2xl border border-linha py-16 text-center text-xs text-texto-suave">
          Nenhum relato {prioridadeFiltro ? `de prioridade ${metaPrioridade(prioridadeFiltro).label.toLowerCase()} ` : ''}
          {filtro === 'aberto' ? 'aberto' : filtro === 'resolvido' ? 'resolvido' : ''} por aqui.
        </div>
      ) : (
        <div className="space-y-3">
          {visiveis.map(r => {
            const resolvido = r.status === 'resolvido';
            return (
              <div
                key={r.id}
                className={`glass-panel rounded-2xl border p-4 ${
                  resolvido ? 'border-linha opacity-70' : 'border-espera/30'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className={`flex-1 whitespace-pre-wrap text-sm leading-relaxed ${resolvido ? 'text-texto-suave line-through' : 'text-texto'}`}>
                    {r.descricao}
                  </p>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${metaPrioridade(r.prioridade).classe}`}
                      title={`Prioridade: ${metaPrioridade(r.prioridade).label}`}
                    >
                      <Flag size={10} /> {metaPrioridade(r.prioridade).label}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                        resolvido
                          ? 'bg-ativo/15 text-ativo-400'
                          : 'bg-espera/15 text-espera-400'
                      }`}
                    >
                      {resolvido ? 'Resolvido' : 'Aberto'}
                    </span>
                  </div>
                </div>

                {/* Prints anexados. Renderizados so como <img> (nunca HTML): o
                    servidor ja garante que sao imagens raster de verdade. */}
                {Array.isArray(r.imagens) && r.imagens.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {r.imagens.map((src, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setAmpliada(src)}
                        className="h-20 w-20 overflow-hidden rounded-lg border border-linha bg-grafite-800 transition-transform hover:scale-[1.03]"
                        title="Ampliar print"
                      >
                        <img src={src} alt={`Print ${i + 1}`} className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-linha pt-3 text-[11px] text-texto-suave">
                  <span className="flex items-center gap-1">
                    <User size={12} /> {r.usuarioNome || 'Anônimo'}
                    {r.usuarioEmail && <span className="text-texto-fraco">· {r.usuarioEmail}</span>}
                  </span>
                  {r.pagina && (
                    <span className="flex items-center gap-1">
                      <MapPin size={12} /> <code className="font-mono">{r.pagina}</code>
                    </span>
                  )}
                  <span className="text-texto-fraco">{quando(r.criadoEm)}</span>

                  <div className="ml-auto flex items-center gap-2">
                    {resolvido ? (
                      <button
                        disabled={loadingId === r.id}
                        onClick={() => mudarStatus(r, 'aberto')}
                        className="flex items-center gap-1 rounded-lg border border-linha px-2.5 py-1 font-semibold text-texto-suave transition-all hover:text-white disabled:opacity-50"
                      >
                        <RotateCcw size={12} /> Reabrir
                      </button>
                    ) : (
                      <button
                        disabled={loadingId === r.id}
                        onClick={() => mudarStatus(r, 'resolvido')}
                        className="flex items-center gap-1 rounded-lg border border-ativo/30 bg-ativo/15 px-2.5 py-1 font-semibold text-ativo-400 transition-all hover:bg-ativo/25 disabled:opacity-50"
                      >
                        <CheckCircle2 size={12} /> Resolver
                      </button>
                    )}
                    <button
                      disabled={loadingId === r.id}
                      onClick={() => excluir(r)}
                      title="Excluir relato"
                      className="flex items-center gap-1 rounded-lg border border-falha/30 bg-falha/15 px-2.5 py-1 font-semibold text-falha-400 transition-all hover:bg-falha/25 disabled:opacity-50"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {ampliada && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setAmpliada(null)}
        >
          <button
            type="button"
            onClick={() => setAmpliada(null)}
            title="Fechar"
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
          >
            <X size={18} />
          </button>
          <img
            src={ampliada}
            alt="Print ampliado"
            onClick={e => e.stopPropagation()}
            className="max-h-[90vh] max-w-full rounded-lg object-contain shadow-2xl"
          />
        </div>
      )}
    </div>
  );
}
