/**
 * Botao flutuante de "Reportar bug", presente em toda tela do painel (montado
 * no AppLayout). Abre um modal onde a pessoa logada descreve o problema; ao
 * enviar, grava via BugsAPI. A autoria (quem reportou) e derivada do token no
 * servidor -- aqui so mandamos a descricao e a rota atual, para o administrador
 * saber de onde o relato partiu.
 */
import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Bug, X, Send, Loader2, CheckCircle2 } from 'lucide-react';
import Portal from './Portal';
import { BugsAPI } from '../services/api';

export default function ReportarBug() {
  const location = useLocation();
  const [aberto, setAberto] = useState(false);
  const [descricao, setDescricao] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const [enviado, setEnviado] = useState(false);

  function abrir() {
    setDescricao('');
    setErro('');
    setEnviado(false);
    setAberto(true);
  }

  function fechar() {
    if (enviando) return;
    setAberto(false);
  }

  async function enviar(e) {
    e.preventDefault();
    if (descricao.trim().length < 5) {
      setErro('Descreva o problema com um pouco mais de detalhe.');
      return;
    }
    setEnviando(true);
    setErro('');
    try {
      await BugsAPI.criar({ descricao: descricao.trim(), pagina: location.pathname });
      setEnviado(true);
      setDescricao('');
      // Fecha sozinho depois de mostrar o "obrigado".
      setTimeout(() => setAberto(false), 1800);
    } catch (err) {
      setErro(err.message || 'Não foi possível enviar. Tente novamente.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      {/* Gatilho discreto: por padrao so aparece uma alcinha fina na borda
          direita. Ao passar o mouse pela area, o botao de reportar bug surge --
          assim ele nao fica ocupando a tela o tempo todo. */}
      <div className="group fixed bottom-6 right-0 z-40 flex items-center justify-end py-4 pl-10">
        <span
          className="h-16 w-1.5 rounded-l-full bg-acao/40 transition-opacity duration-200 group-hover:opacity-0"
          title="Reportar um bug"
          aria-hidden="true"
        />
        <button
          onClick={abrir}
          title="Reportar um bug"
          aria-label="Reportar um bug"
          className="absolute right-4 top-1/2 flex h-12 w-12 -translate-y-1/2 translate-x-3 items-center justify-center rounded-full bg-acao text-slate-950 opacity-0 shadow-lg shadow-acao/25 transition-all duration-200 pointer-events-none group-hover:translate-x-0 group-hover:opacity-100 group-hover:pointer-events-auto hover:bg-acao-200 active:scale-95"
        >
          <Bug size={20} />
        </button>
      </div>

      {aberto && (
        <Portal>
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
            onClick={fechar}
          >
            <form
              onSubmit={enviar}
              onClick={e => e.stopPropagation()}
              className="glass-panel w-full max-w-md space-y-4 rounded-2xl border border-linha p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="rounded-lg bg-acao/15 p-1.5">
                    <Bug size={16} className="text-acao-200" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-white">Reportar um bug</h2>
                    <p className="text-[11px] text-texto-suave">Encontrou algo errado? Conte pra gente.</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={fechar}
                  disabled={enviando}
                  className="text-texto-suave hover:text-white disabled:opacity-50"
                >
                  <X size={16} />
                </button>
              </div>

              {enviado ? (
                <div className="flex flex-col items-center gap-2 py-6 text-center">
                  <CheckCircle2 size={32} className="text-ativo-400" />
                  <p className="text-sm font-semibold text-white">Relato enviado!</p>
                  <p className="text-xs text-texto-suave">Obrigado por ajudar a melhorar o sistema.</p>
                </div>
              ) : (
                <>
                  <div>
                    <label htmlFor="bug-descricao" className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-texto-suave">
                      O que aconteceu?
                    </label>
                    <textarea
                      id="bug-descricao"
                      autoFocus
                      rows={5}
                      value={descricao}
                      onChange={e => setDescricao(e.target.value)}
                      placeholder="Descreva o problema: o que você fez, o que esperava e o que aconteceu."
                      className="w-full resize-none rounded-xl border border-linha bg-grafite-800 px-3.5 py-2.5 text-sm text-texto placeholder-texto-fraco outline-none transition-colors focus:border-acao focus:ring-2 focus:ring-acao/25"
                    />
                    <p className="mt-1.5 flex items-center gap-1 text-[10px] text-texto-fraco">
                      Enviando de: <code className="rounded bg-grafite-700 px-1 py-0.5 font-mono">{location.pathname}</code>
                    </p>
                  </div>

                  {erro && (
                    <p className="text-[11px] font-semibold text-falha-400">{erro}</p>
                  )}

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={fechar}
                      disabled={enviando}
                      className="rounded-xl border border-linha px-3 py-2 text-xs font-semibold text-texto-suave hover:text-white disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={enviando}
                      className="flex items-center gap-1.5 rounded-xl bg-acao px-3 py-2 text-xs font-bold text-slate-950 hover:bg-acao-200 disabled:opacity-60"
                    >
                      {enviando
                        ? <><Loader2 size={13} className="animate-spin" /> Enviando...</>
                        : <><Send size={13} /> Enviar relato</>}
                    </button>
                  </div>
                </>
              )}
            </form>
          </div>
        </Portal>
      )}
    </>
  );
}
