/**
 * Relatos de Bugs (administracao).
 *
 * Lista tudo que foi enviado pelo botao flutuante de "Reportar bug". Tela
 * restrita a Administrador -- o mesmo cargo tambem e exigido no servidor, entao
 * esconder aqui e so cortesia de interface, nao a barreira de fato.
 */
import { useState, useEffect } from 'react';
import { Bug, Loader2, CheckCircle2, RotateCcw, Trash2, X, ShieldAlert, MapPin, User } from 'lucide-react';
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

export default function BugsPage() {
  const { usuario } = useAuth();
  const ehAdmin = usuario?.cargo === 'Administrador';

  const [relatos, setRelatos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [filtro, setFiltro] = useState('');
  const [loadingId, setLoadingId] = useState(null);
  const [erro, setErro] = useState('');

  async function carregar() {
    setCarregando(true);
    setErro('');
    try {
      const dados = await BugsAPI.listar(filtro);
      setRelatos(dados);
    } catch (e) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    if (ehAdmin) carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro, ehAdmin]);

  async function mudarStatus(relato, status) {
    setLoadingId(relato.id);
    setErro('');
    try {
      await BugsAPI.atualizarStatus(relato.id, status);
      await carregar();
    } catch (e) {
      setErro(e.message);
    } finally {
      setLoadingId(null);
    }
  }

  async function excluir(relato) {
    if (!window.confirm('Excluir este relato definitivamente?')) return;
    setLoadingId(relato.id);
    setErro('');
    try {
      await BugsAPI.remover(relato.id);
      await carregar();
    } catch (e) {
      setErro(e.message);
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

      <div className="flex items-center gap-2">
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

      {erro && (
        <div className="rounded-xl border border-falha/30 bg-falha/15 p-3 text-xs font-semibold text-falha-400">
          {erro}
        </div>
      )}

      {carregando ? (
        <div className="flex items-center justify-center gap-2 py-16 text-texto-suave">
          <Loader2 size={18} className="animate-spin" /> Carregando relatos...
        </div>
      ) : relatos.length === 0 ? (
        <div className="glass-panel rounded-2xl border border-linha py-16 text-center text-xs text-texto-suave">
          Nenhum relato {filtro === 'aberto' ? 'aberto' : filtro === 'resolvido' ? 'resolvido' : ''} por aqui.
        </div>
      ) : (
        <div className="space-y-3">
          {relatos.map(r => {
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
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                      resolvido
                        ? 'bg-ativo/15 text-ativo-400'
                        : 'bg-espera/15 text-espera-400'
                    }`}
                  >
                    {resolvido ? 'Resolvido' : 'Aberto'}
                  </span>
                </div>

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
    </div>
  );
}
