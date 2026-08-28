/**
 * Botao flutuante de "Reportar bug", presente em toda tela do painel (montado
 * no AppLayout). Abre um modal onde a pessoa logada descreve o problema; ao
 * enviar, grava via BugsAPI. A autoria (quem reportou) e derivada do token no
 * servidor -- aqui so mandamos a descricao e a rota atual, para o administrador
 * saber de onde o relato partiu.
 */
import { useState, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { Bug, X, Send, Loader2, CheckCircle2, ImagePlus } from 'lucide-react';
import Portal from './Portal';
import { BugsAPI } from '../services/api';

// Espelha os limites do servidor (bug.imagens.js). Aqui e so conveniencia de
// UX -- quem barra de verdade e o backend, que revalida tipo e magic bytes.
const MAX_IMAGENS = 3;
const MAX_BYTES = 3 * 1024 * 1024; // 3 MB
const TIPOS_ACEITOS = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const ACCEPT_ATTR = TIPOS_ACEITOS.join(',');

// Prioridade escolhida por quem reporta (o admin pode reajustar depois na tela
// de gestão). As classes marcam a cor quando o nível está selecionado.
const PRIORIDADES = [
  { valor: 'baixa',   label: 'Baixa',   ativo: 'bg-slate-600/40 text-slate-200 border-slate-500/50' },
  { valor: 'media',   label: 'Média',   ativo: 'bg-blue-500/20 text-blue-300 border-blue-500/50' },
  { valor: 'alta',    label: 'Alta',    ativo: 'bg-espera/20 text-espera-400 border-espera/50' },
  { valor: 'critica', label: 'Crítica', ativo: 'bg-falha/20 text-falha-400 border-falha/50' },
];

function lerComoDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}

export default function ReportarBug() {
  const location = useLocation();
  const inputRef = useRef(null);
  const [aberto, setAberto] = useState(false);
  const [descricao, setDescricao] = useState('');
  const [imagens, setImagens] = useState([]); // { id, dataUrl }
  const [prioridade, setPrioridade] = useState('media');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const [enviado, setEnviado] = useState(false);

  function abrir() {
    setDescricao('');
    setImagens([]);
    setPrioridade('media');
    setErro('');
    setEnviado(false);
    setAberto(true);
  }

  function fechar() {
    if (enviando) return;
    setAberto(false);
  }

  // Recebe uma lista de File (do seletor ou do Ctrl+V), valida tipo/tamanho e
  // acrescenta as que passarem, respeitando o teto de MAX_IMAGENS.
  async function adicionarArquivos(files) {
    const lista = Array.from(files || []).filter(Boolean);
    if (lista.length === 0) return;
    setErro('');

    let restantes = MAX_IMAGENS - imagens.length;
    if (restantes <= 0) {
      setErro(`Você pode anexar no máximo ${MAX_IMAGENS} imagens.`);
      return;
    }

    const novas = [];
    for (const file of lista) {
      if (restantes <= 0) {
        setErro(`Você pode anexar no máximo ${MAX_IMAGENS} imagens.`);
        break;
      }
      if (!TIPOS_ACEITOS.includes(file.type)) {
        setErro('Só são aceitas imagens PNG, JPEG, WebP ou GIF.');
        continue;
      }
      if (file.size > MAX_BYTES) {
        setErro('Cada imagem deve ter no máximo 3 MB.');
        continue;
      }
      try {
        const dataUrl = await lerComoDataUrl(file);
        novas.push({ id: `${file.name}-${file.size}-${novas.length}`, dataUrl });
        restantes -= 1;
      } catch {
        setErro('Não foi possível ler uma das imagens.');
      }
    }

    if (novas.length) setImagens(prev => [...prev, ...novas].slice(0, MAX_IMAGENS));
  }

  function removerImagem(id) {
    setImagens(prev => prev.filter(img => img.id !== id));
  }

  // Colar print direto da area de transferencia (Ctrl+V).
  function aoColar(e) {
    const itens = e.clipboardData?.items;
    if (!itens) return;
    const arquivos = [];
    for (const item of itens) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) arquivos.push(f);
      }
    }
    if (arquivos.length) {
      e.preventDefault();
      adicionarArquivos(arquivos);
    }
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
      await BugsAPI.criar({
        descricao: descricao.trim(),
        pagina: location.pathname,
        imagens: imagens.map(img => img.dataUrl),
        prioridade,
      });
      setEnviado(true);
      setDescricao('');
      setImagens([]);
      setPrioridade('media');
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
              onPaste={aoColar}
              className="glass-panel modal-cabe w-full max-w-md space-y-4 rounded-2xl border border-linha p-5"
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

                  {/* Prioridade: quem reporta indica a urgência; o admin pode
                      reajustar depois na tela de Relatos de Bugs. */}
                  <div>
                    <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-texto-suave">
                      Prioridade
                    </label>
                    <div className="grid grid-cols-4 gap-1.5">
                      {PRIORIDADES.map(p => (
                        <button
                          key={p.valor}
                          type="button"
                          onClick={() => setPrioridade(p.valor)}
                          className={`rounded-lg border px-2 py-1.5 text-[11px] font-bold transition-all ${
                            prioridade === p.valor
                              ? p.ativo
                              : 'border-linha text-texto-suave hover:text-white'
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Anexos: prints ajudam muito a entender o bug. */}
                  <div>
                    <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-texto-suave">
                      Anexar prints <span className="text-texto-fraco normal-case tracking-normal">(opcional)</span>
                    </label>

                    {imagens.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-2">
                        {imagens.map(img => (
                          <div key={img.id} className="group relative h-16 w-16 overflow-hidden rounded-lg border border-linha bg-grafite-800">
                            <img src={img.dataUrl} alt="Print anexado" className="h-full w-full object-cover" />
                            <button
                              type="button"
                              onClick={() => removerImagem(img.id)}
                              title="Remover"
                              className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover:opacity-100"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {imagens.length < MAX_IMAGENS && (
                      <button
                        type="button"
                        onClick={() => inputRef.current?.click()}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-linha px-3 py-2.5 text-xs font-semibold text-texto-suave transition-colors hover:border-acao hover:text-white"
                      >
                        <ImagePlus size={15} /> Selecionar imagem ou colar (Ctrl+V)
                      </button>
                    )}
                    <input
                      ref={inputRef}
                      type="file"
                      accept={ACCEPT_ATTR}
                      multiple
                      className="hidden"
                      onChange={e => { adicionarArquivos(e.target.files); e.target.value = ''; }}
                    />
                    <p className="mt-1 text-[10px] text-texto-fraco">
                      Até {MAX_IMAGENS} imagens · PNG, JPEG, WebP ou GIF · máx. 3 MB cada
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
