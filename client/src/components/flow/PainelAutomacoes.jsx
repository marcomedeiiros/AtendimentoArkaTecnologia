/**
 * "Automações do BOT" a lista completa do que o bot faz, fluxo a fluxo.
 *
 * Existe para responder de um lugar só a pergunta que antes exigia ler código:
 * *o que exatamente o bot vai fazer?* As regras viviam espalhadas entre
 * variáveis de ambiente (tentativas de CNPJ), uma configuração global (pesquisa
 * de satisfação) e textos embutidos no motor. Nada disso aparecia na tela, e
 * mudar qualquer coisa exigia deploy.
 *
 * Agora cada parâmetro mora no `config` de um passo do fluxo, e este painel
 * mostra o valor que está REALMENTE valendo -- o que foi digitado, ou o padrão
 * que o servidor aplica quando o campo está em branco.
 *
 * Só leitura: para mudar, clique no bloco correspondente no editor.
 */
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Loader2, AlertTriangle, Pause, Play, Bot } from 'lucide-react';
import { FluxosAPI } from '../../services/api';

export default function PainelAutomacoes() {
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      setDados(await FluxosAPI.automacoes());
    } catch (e) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-bold text-white font-display flex items-center gap-2">
            <Bot size={15} className="text-acao-200" /> Automações do BOT
          </h2>
          <p className="text-[11px] text-slate-400 mt-1 max-w-2xl leading-relaxed">
            Tudo que o bot faz sozinho está aqui, com o valor que está valendo agora
            para alterar, abra o fluxo e clique no bloco correspondente
            <strong className="text-slate-300"> Fluxo pausado não executa nenhuma destas regras.</strong>
          </p>
        </div>
        <button
          onClick={carregar}
          disabled={carregando}
          className="px-2.5 py-1.5 rounded-lg bg-grafite-700 border border-linha text-slate-300 hover:text-white text-[11px] font-semibold flex items-center gap-1.5 disabled:opacity-60"
        >
          {carregando ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Atualizar
        </button>
      </div>

      {erro && (
        <div className="p-3 rounded-xl bg-falha/10 border border-falha/30 text-[11px] text-falha-400 flex items-center gap-2">
          <AlertTriangle size={13} /> {erro}
        </div>
      )}

      {!erro && !carregando && (dados || []).length === 0 && (
        <div className="p-6 rounded-xl bg-grafite-700/40 border border-linha text-center text-[11px] text-slate-400">
          Nenhum fluxo cadastrado o bot não vai responder sozinho.
        </div>
      )}

      {(dados || []).map((f, i) => (
        <div key={f.nome + i} className="rounded-2xl border border-linha bg-grafite-700/40 overflow-hidden">
          <div className="px-4 py-2.5 bg-grafite-600/60 border-b border-linha flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-bold text-xs text-white truncate">{f.nome}</span>
              <span className="text-[10px] font-mono text-slate-400 shrink-0">gatilho: {f.gatilho}</span>
            </div>
            <span
              className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${
                f.ativo
                  ? 'bg-ativo/15 border-ativo/30 text-ativo-400'
                  : 'bg-espera/15 border-espera/30 text-espera-400'
              }`}
            >
              {f.ativo ? <Play size={9} /> : <Pause size={9} />}
              {f.ativo ? 'Ativo' : 'Pausado nada é executado'}
            </span>
          </div>

          {f.itens.length === 0 ? (
            <div className="px-4 py-3 text-[11px] text-slate-500">
              Este fluxo não tem etapas de automação configuráveis (só mensagens).
            </div>
          ) : (
            <div className="divide-y divide-linha/60">
              {f.itens.map((item) => (
                <div key={item.passoId} className="px-4 py-3">
                  <div className="text-[11px] font-bold text-acao-200 mb-2">
                    {item.grupo}
                    <span className="ml-2 font-normal text-slate-500">bloco “{item.passoTitulo}”</span>
                  </div>
                  <dl className="space-y-1">
                    {item.regras.map((r) => (
                      <div key={r.rotulo} className="flex items-start gap-2 text-[11px]">
                        <dt className="text-slate-400 shrink-0 w-48">{r.rotulo}</dt>
                        <dd className={`flex-1 min-w-0 break-words ${f.ativo ? 'text-slate-200' : 'text-slate-500 line-through decoration-slate-600'}`}>
                          {r.valor}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
