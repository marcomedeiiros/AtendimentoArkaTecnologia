/**
 * Relatos de Bugs (administracao).
 *
 * Lista tudo que foi enviado pelo botao flutuante de "Reportar bug". Tela
 * restrita a Administrador -- o mesmo cargo tambem e exigido no servidor, entao
 * esconder aqui e so cortesia de interface, nao a barreira de fato.
 */
import { useState, useEffect, useRef } from 'react';
import { Bug, Loader2, CheckCircle2, RotateCcw, Trash2, X, ShieldAlert, MapPin, User, Flag, Pencil, Save, ImagePlus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { BugsAPI } from '../services/api';
import Portal from '../components/Portal';
import { FUSO_BR } from '../utils/data';
import { confirmar } from '../utils/dialogo';
import VisualizadorImagem from '../components/VisualizadorImagem';

// ── Constantes de imagem (espelham o servidor: bug.imagens.js) ─────────────
// A barreira real fica no backend (whitelist de mime + magic bytes +
// reserializacao); aqui evitamos converter arquivos obviamente errados.
const MAX_IMAGENS  = 3;
const MAX_BYTES    = 3 * 1024 * 1024; // 3 MB
const TIPOS_ACEITOS = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const ACCEPT_ATTR  = TIPOS_ACEITOS.join(',');

function lerComoDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Converte uma lista de File em objetos { id, dataUrl }, validando tipo e
 * tamanho antes. Devolve { novas, erro } erro é string ou ''.
 * `qtdAtual` é quantas imagens já existem na lista atual do modal.
 */
async function prepararImagens(files, qtdAtual) {
  const lista = Array.from(files || []).filter(Boolean);
  if (lista.length === 0) return { novas: [], erro: '' };

  let restantes = MAX_IMAGENS - qtdAtual;
  if (restantes <= 0) return { novas: [], erro: `Máximo de ${MAX_IMAGENS} imagens atingido.` };

  const novas = [];
  let ultimoErro = '';

  for (const file of lista) {
    if (restantes <= 0) { ultimoErro = `Só foram adicionadas as primeiras ${MAX_IMAGENS - qtdAtual}.`; break; }
    if (!TIPOS_ACEITOS.includes(file.type)) { ultimoErro = 'Só são aceitas imagens PNG, JPEG, WebP ou GIF.'; continue; }
    if (file.size > MAX_BYTES)              { ultimoErro = 'Cada imagem deve ter no máximo 3 MB.'; continue; }
    try {
      const dataUrl = await lerComoDataUrl(file);
      novas.push({ id: `edit-${file.name}-${file.size}-${novas.length}`, dataUrl });
      restantes -= 1;
    } catch {
      ultimoErro = 'Não foi possível ler uma das imagens.';
    }
  }

  return { novas, erro: ultimoErro };
}


function quando(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const data = d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', timeZone: FUSO_BR });
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: FUSO_BR });
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

/**
 * Edicao de um relato na triagem: corrigir o texto e reajustar a prioridade.
 *
 * Por que so estes dois campos: autoria, pagina e prints sao o registro de onde
 * e de quem veio o problema -- reescrever isso apagaria a rastreabilidade. O
 * servidor recusa qualquer outro campo, entao a tela nem os oferece.
 *
 * Vai num Portal porque o container da pagina tem `.fade-in`, que termina com
 * `transform` aplicado: dentro dele, `position: fixed` passa a se medir pela
 * caixa da pagina em vez da janela, e o modal aparece cortado.
 */
function ModalEditarRelato({ relato, onSalvar, onFechar, salvando, erro }) {
  const [descricao, setDescricao] = useState(relato.descricao || '');
  const [prioridade, setPrioridade] = useState(relato.prioridade || 'media');
  // Prints já anexados + os novos, na mesma lista: para a tela e para o servidor
  // não existe diferença entre "veio do banco" e "acabei de colar".
  const [imagens, setImagens] = useState(
    () => (Array.isArray(relato.imagens) ? relato.imagens : []).map((dataUrl, i) => ({ id: `atual-${i}`, dataUrl }))
  );
  const [erroImagem, setErroImagem] = useState('');
  const inputRef = useRef(null);

  // Esc fecha, como nos outros modais do painel.
  useEffect(() => {
    const onTecla = (e) => { if (e.key === 'Escape' && !salvando) onFechar(); };
    window.addEventListener('keydown', onTecla);
    return () => window.removeEventListener('keydown', onTecla);
  }, [onFechar, salvando]);

  async function anexar(files) {
    setErroImagem('');
    const { novas, erro: recusa } = await prepararImagens(files, imagens.length);
    if (recusa) setErroImagem(recusa);
    if (novas.length) setImagens(prev => [...prev, ...novas].slice(0, MAX_IMAGENS));
  }

  // Ctrl+V com print na área de transferência: é assim que a pessoa anexa
  // screenshot sem salvar arquivo antes -- e o caso que motivou este campo
  // (relato enviado sem imagem, print ainda na memória).
  function aoColar(e) {
    const arquivos = Array.from(e.clipboardData?.items || [])
      .filter(i => i.kind === 'file')
      .map(i => i.getAsFile())
      .filter(Boolean);
    if (arquivos.length) { e.preventDefault(); anexar(arquivos); }
  }

  const texto = descricao.trim();
  // Mesma regra do servidor (DTO + service): 5 a 4000 caracteres.
  const podeSalvar = texto.length >= 5 && texto.length <= 4000 && !salvando;
  const imagensAtuais = (Array.isArray(relato.imagens) ? relato.imagens : []);
  const listaAtual = imagens.map(i => i.dataUrl);
  const imagensMudaram =
    listaAtual.length !== imagensAtuais.length ||
    listaAtual.some((url, i) => url !== imagensAtuais[i]);
  const semMudanca =
    texto === (relato.descricao || '').trim() &&
    prioridade === (relato.prioridade || 'media') &&
    !imagensMudaram;

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/80 p-3 backdrop-blur-sm sm:items-center sm:p-4">
        {/* `onPaste` no PAINEL, e nao na textarea: o evento de colar nasce em
            quem tem o foco e SOBE. No painel, ele e capturado com o foco em
            qualquer campo do modal -- descricao, prioridade ou os proprios
            anexos -- em vez de so quando o cursor esta no texto.
            (Mesma amarracao do ReportarBug.jsx, que ja funcionava.) */}
        <div
          onPaste={aoColar}
          className="glass-panel my-auto flex max-h-[calc(100dvh-1.5rem)] w-full max-w-lg flex-col rounded-2xl border border-linha shadow-2xl sm:max-h-[90vh]"
        >
          <div className="flex shrink-0 items-center justify-between gap-2 rounded-t-2xl border-b border-linha bg-grafite-600 p-4">
            <div className="flex min-w-0 items-center gap-2 text-sm font-bold text-white">
              <Pencil size={15} className="shrink-0 text-acao-200" />
              <span className="truncate">Editar relato</span>
            </div>
            <button
              onClick={onFechar}
              disabled={salvando}
              className="shrink-0 text-texto-suave hover:text-white disabled:opacity-50"
            >
              <X size={16} />
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold text-texto">Descrição do problema</label>
              <textarea
                value={descricao}
                onChange={e => setDescricao(e.target.value)}
                rows={6}
                autoFocus
                className="w-full resize-none rounded-xl border border-linha bg-grafite-700 px-3.5 py-2.5 text-xs text-white placeholder-texto-fraco focus:border-acao/50 focus:outline-none"
              />
              <p className="mt-1 text-[10px] text-texto-fraco">{texto.length}/4000 · mínimo de 5 caracteres</p>
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-semibold text-texto">Prioridade</label>
              <div className="flex flex-wrap gap-2">
                {Object.entries(PRIORIDADES).map(([valor, meta]) => {
                  const ativo = prioridade === valor;
                  return (
                    <button
                      key={valor}
                      type="button"
                      onClick={() => setPrioridade(valor)}
                      aria-pressed={ativo}
                      className={`flex items-center gap-1 rounded-xl border px-3 py-1.5 text-xs font-bold transition-all ${
                        ativo ? meta.classe : 'border-linha text-texto-suave hover:text-white'
                      }`}
                    >
                      <Flag size={11} /> {meta.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-semibold text-texto">
                Prints <span className="font-normal text-texto-fraco">({imagens.length}/{MAX_IMAGENS})</span>
              </label>

              {imagens.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {imagens.map(img => (
                    <div key={img.id} className="relative">
                      <img
                        src={img.dataUrl}
                        alt="Print anexado"
                        className="h-20 w-20 rounded-lg border border-linha bg-grafite-800 object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => setImagens(prev => prev.filter(i => i.id !== img.id))}
                        title="Remover este print"
                        aria-label="Remover este print"
                        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-falha/40 bg-grafite-800 text-falha-400 transition-colors hover:bg-falha/20"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {imagens.length < MAX_IMAGENS && (
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="flex items-center gap-1.5 rounded-lg border border-linha bg-grafite-700 px-2.5 py-1.5 text-[11px] font-semibold text-texto-suave transition-colors hover:border-acao/40 hover:text-acao-200"
                >
                  <ImagePlus size={13} /> Anexar print
                </button>
              )}

              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT_ATTR}
                multiple
                className="hidden"
                // `Array.from` ANTES de limpar o input, e não depois.
                //
                // `e.target.files` é um FileList VIVO, preso ao input: zerar
                // `value` esvazia a mesma lista que `f` aponta. Como `anexar` é
                // async, ele lia a lista já vazia -- o print escolhido nunca
                // entrava, sem erro nenhum na tela. (O modal de criar o relato
                // não tinha o bug porque copia a lista na primeira linha.)
                onChange={e => { const f = Array.from(e.target.files || []); e.target.value = ''; anexar(f); }}
              />

              <p className="mt-1.5 text-[10px] text-texto-fraco">
                Até {MAX_IMAGENS} · PNG, JPEG, WebP ou GIF · máx. 3 MB cada · ou cole com Ctrl+V
              </p>
              {erroImagem && (
                <p className="mt-1 text-[11px] text-espera-400">{erroImagem}</p>
              )}
            </div>

            {erro && (
              <p className="rounded-lg border border-falha/30 bg-falha/10 p-2.5 text-[11px] text-falha-400">{erro}</p>
            )}
          </div>

          <div className="flex shrink-0 flex-col-reverse gap-2 rounded-b-2xl border-t border-linha bg-grafite-600 p-4 sm:flex-row sm:justify-end">
            <button
              onClick={onFechar}
              disabled={salvando}
              className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-300 transition-colors hover:bg-slate-700 disabled:opacity-50 sm:py-1.5"
            >
              Cancelar
            </button>
            <button
              onClick={() => onSalvar({ descricao: texto, prioridade, imagens: listaAtual })}
              disabled={!podeSalvar || semMudanca}
              title={
                texto.length < 5 ? 'Descreva o problema com pelo menos 5 caracteres'
                  : semMudanca ? 'Nada foi alterado'
                  : 'Salvar alterações'
              }
              className="flex items-center justify-center gap-1.5 rounded-lg bg-acao px-4 py-2 text-xs font-bold text-slate-950 shadow-md shadow-acao/20 transition-all hover:bg-acao-200 disabled:cursor-not-allowed disabled:opacity-50 sm:py-1.5"
            >
              {salvando ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              {salvando ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}

export default function BugsPage() {
  const { usuario } = useAuth();
  const ehAdmin = usuario?.cargo === 'Administrador';

  const [relatos, setRelatos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [filtro, setFiltro] = useState('aberto'); // abre já na lista de abertos
  const [prioridadeFiltro, setPrioridadeFiltro] = useState(''); // filtro client-side
  const [loadingId, setLoadingId] = useState(null);
  const [erro, setErro] = useState('');
  // { url, nome } do print aberto no visualizador. O nome vira o do arquivo
  // baixado -- sem ele, o download de um data URL sai como "download" sem extensão.
  const [ampliada, setAmpliada] = useState(null);
  // Relato aberto no modal de edicao (o lapis da lista).
  const [editando, setEditando] = useState(null);
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);
  const [erroEdicao, setErroEdicao] = useState('');

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

  // Edicao: ao contrario de resolver/excluir, aqui NAO ha otimismo. O texto e o
  // que o admin acabou de digitar -- se o servidor recusar (validacao, sessao
  // expirada), o modal fica aberto com o erro e o rascunho intacto, em vez de a
  // lista mostrar uma versao que nunca foi gravada.
  async function salvarEdicao({ descricao, prioridade, imagens }) {
    setSalvandoEdicao(true);
    setErroEdicao('');
    try {
      const atualizado = await BugsAPI.atualizar(editando.id, { descricao, prioridade, imagens });
      setRelatos(prev => prev.map(r => (r.id === atualizado.id ? atualizado : r)));
      setEditando(null);
    } catch (e) {
      setErroEdicao(e.message);
    } finally {
      setSalvandoEdicao(false);
    }
  }

  async function excluir(relato) {
    if (!(await confirmar('Excluir este relato definitivamente?', {
      titulo: 'Excluir relato',
      rotuloConfirmar: 'Excluir',
      perigo: true,
    }))) return;
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
    <div className="fade-in space-y-6 baixa:lg:space-y-4">
      <div className="mb-8 baixa:lg:mb-4 flex flex-col gap-4 border-b border-linha pb-4 sm:flex-row sm:items-center sm:justify-between">
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
                        onClick={() => setAmpliada({ url: src, nome: `print-${i + 1}.png` })}
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

                  <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                    <button
                      disabled={loadingId === r.id}
                      onClick={() => { setErroEdicao(''); setEditando(r); }}
                      title="Editar descrição e prioridade"
                      aria-label="Editar relato"
                      className="flex items-center gap-1 rounded-lg border border-linha px-2.5 py-1 font-semibold text-texto-suave transition-all hover:border-acao/40 hover:text-acao-200 disabled:opacity-50"
                    >
                      <Pencil size={12} />
                    </button>
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

      {editando && (
        <ModalEditarRelato
          // key: o modal le o relato no estado inicial dos campos, entao trocar
          // de relato precisa remontar.
          key={editando.id}
          relato={editando}
          onSalvar={salvarEdicao}
          onFechar={() => { if (!salvandoEdicao) { setEditando(null); setErroEdicao(''); } }}
          salvando={salvandoEdicao}
          erro={erroEdicao}
        />
      )}

      {/* PRINT AMPLIADO -- o mesmo visualizador da Central.
          
          Aqui havia um `<img>` limitado a `max-h-[85dvh] object-contain` e nada
          mais. Dava para ver que existe um print; não dava para LER o print --
          que é o motivo de alguém anexar uma captura de tela num relato de bug.
          Uma captura de 1920px encolhida para caber na altura da janela fica com
          o texto ilegível, e não havia zoom, arraste nem download.
          
          Agora vem com roda do mouse, +/-, duplo clique, arraste acima de 100% e
          botão de baixar. Ver components/VisualizadorImagem. */}
      {ampliada && (
        <VisualizadorImagem
          url={ampliada.url}
          nomeArquivo={ampliada.nome}
          onFechar={() => setAmpliada(null)}
        />
      )}
    </div>
  );
}
