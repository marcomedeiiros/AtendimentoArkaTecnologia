/**
 * MAPEAMENTOS TÉCNICOS -- o relatório da visita fora da sede.
 *
 * É daqui que sai a pontuação do Ranking Fora da Sede, e a tela foi desenhada
 * em cima disso: cada campo que pontua mostra QUANTO já valeu. Um formulário
 * que só diz "salvo" deixaria a pessoa descobrir no fim do mês que perdeu
 * pontos por um item em branco -- quando já não dá para voltar.
 *
 * ── O QUE A TELA DEIXA CLARO ANTES DE ENTREGAR ─────────────────────────────
 *
 *   completude   quantos itens do checklist estão preenchidos, ao vivo.
 *   prazo        se a data de hoje ainda está dentro do prazo gravado.
 *   evidências   quantas fotos foram anexadas (3 já valem a faixa cheia).
 *
 * ── ENTREGAR É IRREVERSÍVEL O BASTANTE PARA PERGUNTAR ──────────────────────
 *
 * Depois de entregue o relatório entra na conta do mês e passa a ser do
 * supervisor: o técnico ainda corrige (enquanto não for aprovado), mas o
 * carimbo de entrega não volta atrás -- é ele que decide "no prazo".
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ClipboardList, Plus, Loader2, AlertCircle, Camera, CheckCircle2, RotateCcw,
  Clock, Building2, X, Save, Send, Trash2, ShieldCheck, FileText,
} from 'lucide-react';
import { RankingsAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { avisar, confirmar, pedirTexto } from '../../utils/dialogo';
import Portal from '../Portal';
import { FUSO_BR } from '../../utils/data';

const STATUS_META = {
  rascunho:    { rotulo: 'Rascunho',    classe: 'bg-quieto/20 text-quieto-400 border-quieto/30' },
  entregue:    { rotulo: 'Entregue',    classe: 'bg-acao/15 text-acao-200 border-acao/30' },
  em_correcao: { rotulo: 'Em correção', classe: 'bg-espera/15 text-espera-400 border-espera/30' },
  aprovado:    { rotulo: 'Aprovado',    classe: 'bg-ativo/15 text-ativo-400 border-ativo/30' },
};

const hojeISO = () => new Date().toISOString().slice(0, 10);
// Prazo padrão: 3 dias após a visita. Sugestão, não regra -- o campo é editável.
function prazoSugerido(dataVisita) {
  const d = new Date(`${dataVisita || hojeISO()}T12:00:00`);
  d.setDate(d.getDate() + 3);
  return d.toISOString().slice(0, 10);
}

const data = (iso) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: FUSO_BR }) : '—';

function Selo({ status }) {
  const m = STATUS_META[status] || STATUS_META.rascunho;
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${m.classe}`}>{m.rotulo}</span>;
}

/** Formulário do mapeamento. Mostra o efeito de cada campo na pontuação. */
function ModalMapeamento({ itensRegra, inicial, onFechar, onSalvo }) {
  const edicao = !!inicial?.id;
  const [empresa, setEmpresa] = useState(inicial?.empresa || '');
  const [cnpj, setCnpj] = useState(inicial?.cnpj || '');
  const [dataVisita, setDataVisita] = useState(
    inicial?.dataVisita ? String(inicial.dataVisita).slice(0, 10) : hojeISO()
  );
  const [prazoEm, setPrazoEm] = useState(
    inicial?.prazoEm ? String(inicial.prazoEm).slice(0, 10) : prazoSugerido(hojeISO())
  );
  const [resumo, setResumo] = useState(inicial?.resumo || '');
  const [itens, setItens] = useState(() => ({ ...(inicial?.itens || {}) }));
  const [pendencias, setPendencias] = useState(inicial?.pendencias || '');
  const [evidencias, setEvidencias] = useState(() => inicial?.arquivos || []);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  // A MESMA conta do servidor: itens preenchidos + resumo com pelo menos 20
  // caracteres, sobre o total. Espelhada aqui para o número aparecer enquanto
  // se digita -- se as duas divergirem, a do servidor é a que vale.
  const completude = useMemo(() => {
    const preenchidos = itensRegra.filter((i) => String(itens[i.chave] || '').trim()).length;
    const comResumo = resumo.trim().length >= 20 ? 1 : 0;
    return Math.round(((preenchidos + comResumo) / (itensRegra.length + 1)) * 100);
  }, [itens, resumo, itensRegra]);

  const dentroDoPrazo = useMemo(() => hojeISO() <= prazoEm, [prazoEm]);

  const anexar = (e) => {
    const arquivos = [...(e.target.files || [])];
    e.target.value = '';
    for (const f of arquivos) {
      if (f.size > 6 * 1024 * 1024) { setErro(`"${f.name}" passa de 6 MB.`); continue; }
      const r = new FileReader();
      r.onload = () => setEvidencias((l) => (l.length >= 12 ? l : [...l, r.result]));
      r.readAsDataURL(f);
    }
  };

  const salvar = async (entregar) => {
    if (!empresa.trim()) { setErro('Informe a empresa visitada.'); return; }
    if (entregar) {
      const ok = await confirmar(
        `O relatório entra na contagem de ${data(dataVisita)} e passa para a validação do supervisor. ` +
        `Você ainda pode corrigir enquanto ele não aprovar, mas a data de entrega não muda depois — ` +
        `é ela que define se ficou dentro do prazo.`,
        { titulo: 'Entregar o mapeamento?', rotuloConfirmar: 'Entregar', rotuloCancelar: 'Continuar editando' }
      );
      if (!ok) return;
    }
    setSalvando(true);
    setErro('');
    const corpo = { empresa: empresa.trim(), cnpj: cnpj.replace(/\D/g, '') || null, dataVisita, prazoEm, resumo, itens, pendencias, evidencias, entregar };
    try {
      if (edicao) await RankingsAPI.atualizarMapeamento(inicial.id, corpo);
      else await RankingsAPI.criarMapeamento(corpo);
      onSalvo();
    } catch (e2) {
      setErro(e2?.message || 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Portal>
      <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-start sm:items-center justify-center z-50 p-3 overflow-y-auto">
        <div className="glass-panel border border-linha rounded-2xl w-full max-w-2xl shadow-2xl fade-in my-auto flex flex-col max-h-[calc(100dvh-1.5rem)]">
          <div className="p-4 bg-grafite-600 border-b border-linha flex items-center justify-between shrink-0 rounded-t-2xl">
            <span className="flex items-center gap-2 font-bold text-sm text-white">
              <ClipboardList size={16} className="text-acao-200" />
              {edicao ? 'Editar mapeamento' : 'Novo mapeamento técnico'}
            </span>
            <button onClick={onFechar} className="text-slate-400 hover:text-white"><X size={16} /></button>
          </div>

          <div className="p-4 space-y-3 flex-1 overflow-y-auto min-h-0">
            {/* O PLACAR AO VIVO. É o que transforma o formulário em algo que a
                pessoa entende antes de entregar, e não depois do fechamento. */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-linha bg-grafite-700 p-2.5 text-center">
                <p className="text-[10px] uppercase tracking-wider text-texto-fraco font-bold">Completo</p>
                <p className={`font-display font-extrabold text-lg ${completude >= 80 ? 'text-ativo-400' : completude >= 50 ? 'text-espera-400' : 'text-falha-400'}`}>
                  {completude}%
                </p>
              </div>
              <div className="rounded-xl border border-linha bg-grafite-700 p-2.5 text-center">
                <p className="text-[10px] uppercase tracking-wider text-texto-fraco font-bold">Evidências</p>
                <p className={`font-display font-extrabold text-lg ${evidencias.length >= 3 ? 'text-ativo-400' : 'text-espera-400'}`}>
                  {evidencias.length}
                </p>
              </div>
              <div className="rounded-xl border border-linha bg-grafite-700 p-2.5 text-center">
                <p className="text-[10px] uppercase tracking-wider text-texto-fraco font-bold">Prazo</p>
                <p className={`font-display font-extrabold text-sm mt-1 ${dentroDoPrazo ? 'text-ativo-400' : 'text-falha-400'}`}>
                  {dentroDoPrazo ? 'dentro' : 'vencido'}
                </p>
              </div>
            </div>

            {erro && (
              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-falha/10 border border-falha/30 text-falha-400 text-[11px]">
                <AlertCircle size={13} className="shrink-0" /> {erro}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-semibold text-texto-suave block mb-1">Empresa visitada *</label>
                <input value={empresa} onChange={(e) => setEmpresa(e.target.value)}
                  className="w-full bg-grafite-700 border border-linha rounded-xl px-3 py-2 text-xs text-texto focus:outline-none focus:border-acao/50" />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-texto-suave block mb-1">CNPJ (opcional)</label>
                <input value={cnpj} onChange={(e) => setCnpj(e.target.value)} inputMode="numeric"
                  className="w-full bg-grafite-700 border border-linha rounded-xl px-3 py-2 text-xs text-texto font-mono focus:outline-none focus:border-acao/50" />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-texto-suave block mb-1">Data da visita</label>
                <input type="date" value={dataVisita}
                  onChange={(e) => { setDataVisita(e.target.value); if (!edicao) setPrazoEm(prazoSugerido(e.target.value)); }}
                  className="w-full bg-grafite-700 border border-linha rounded-xl px-3 py-2 text-xs text-texto focus:outline-none focus:border-acao/50" />
                <p className="text-[10px] text-texto-fraco mt-1">É ela que define em qual mês o trabalho conta.</p>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-texto-suave block mb-1">Prazo de entrega</label>
                <input type="date" value={prazoEm} onChange={(e) => setPrazoEm(e.target.value)}
                  className="w-full bg-grafite-700 border border-linha rounded-xl px-3 py-2 text-xs text-texto focus:outline-none focus:border-acao/50" />
              </div>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-texto-suave block mb-1">
                Resumo da visita <span className="text-texto-fraco font-normal">(conta na completude a partir de 20 caracteres)</span>
              </label>
              <textarea value={resumo} onChange={(e) => setResumo(e.target.value)} rows={3}
                className="w-full bg-grafite-700 border border-linha rounded-xl px-3 py-2 text-xs text-texto resize-none focus:outline-none focus:border-acao/50" />
            </div>

            <div>
              <p className="text-[11px] font-semibold text-texto-suave mb-1.5">Checklist técnico</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {itensRegra.map((i) => {
                  const preenchido = String(itens[i.chave] || '').trim().length > 0;
                  return (
                    <div key={i.chave}>
                      <label className={`text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 mb-1 ${preenchido ? 'text-ativo-400' : 'text-texto-fraco'}`}>
                        {preenchido && <CheckCircle2 size={10} />} {i.rotulo}
                      </label>
                      <textarea
                        value={itens[i.chave] || ''}
                        onChange={(e) => setItens((s) => ({ ...s, [i.chave]: e.target.value }))}
                        rows={2}
                        className="w-full bg-grafite-700 border border-linha rounded-lg px-2.5 py-1.5 text-[11px] text-texto resize-none focus:outline-none focus:border-acao/50"
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-texto-suave block mb-1">Pendências e recomendações</label>
              <textarea value={pendencias} onChange={(e) => setPendencias(e.target.value)} rows={2}
                className="w-full bg-grafite-700 border border-linha rounded-xl px-3 py-2 text-xs text-texto resize-none focus:outline-none focus:border-acao/50" />
            </div>

            <div>
              <p className="text-[11px] font-semibold text-texto-suave mb-1.5">
                Evidências <span className="text-texto-fraco font-normal">({evidencias.length}/12 · 3 já valem a faixa cheia)</span>
              </p>
              <div className="flex flex-wrap gap-2">
                {evidencias.map((ev, i) => (
                  <span key={i} className="relative w-16 h-16 rounded-lg border border-linha bg-grafite-700 grid place-items-center overflow-hidden">
                    {typeof ev === 'string' && ev.startsWith('data:image') ? (
                      <img src={ev} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <FileText size={18} className="text-texto-fraco" />
                    )}
                    <button
                      onClick={() => setEvidencias((l) => l.filter((_, j) => j !== i))}
                      className="absolute top-0.5 right-0.5 bg-slate-950/80 rounded-full p-0.5 text-falha-400"
                      title="Remover"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
                {evidencias.length < 12 && (
                  <label className="w-16 h-16 rounded-lg border border-dashed border-linha-forte grid place-items-center cursor-pointer text-texto-fraco hover:text-acao-200 hover:border-acao/50 transition-colors">
                    <Camera size={18} />
                    <input type="file" accept="image/*" multiple className="hidden" onChange={anexar} />
                  </label>
                )}
              </div>
            </div>
          </div>

          <div className="p-4 bg-grafite-600 border-t border-linha flex flex-col-reverse sm:flex-row sm:justify-end gap-2 shrink-0 rounded-b-2xl">
            <button onClick={onFechar} disabled={salvando}
              className="px-3 py-2 rounded-lg bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700 disabled:opacity-50">
              Cancelar
            </button>
            <button onClick={() => salvar(false)} disabled={salvando}
              className="px-3 py-2 rounded-lg bg-grafite-700 border border-linha text-texto text-xs font-semibold hover:border-linha-forte disabled:opacity-50 flex items-center justify-center gap-1.5">
              {salvando ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Salvar rascunho
            </button>
            <button onClick={() => salvar(true)} disabled={salvando}
              className="px-4 py-2 rounded-lg bg-acao hover:bg-acao-200 text-slate-950 text-xs font-bold disabled:opacity-50 flex items-center justify-center gap-1.5">
              <Send size={13} /> Entregar
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}

export default function Mapeamentos() {
  const { usuario } = useAuth();
  const [lista, setLista] = useState([]);
  const [regras, setRegras] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [editando, setEditando] = useState(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      const [l, r] = await Promise.all([RankingsAPI.listarMapeamentos(), RankingsAPI.regras()]);
      setLista(l);
      setRegras(r.externo);
    } catch (e) {
      setErro(e?.message || 'Não foi possível carregar os mapeamentos.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const abrirNovo = () => setEditando({ novo: true });
  const abrirEdicao = async (m) => {
    try { setEditando(await RankingsAPI.obterMapeamento(m.id)); }
    catch (e) { avisar(e?.message || 'Não foi possível abrir.'); }
  };

  /**
   * Validar: aprovar ou devolver.
   *
   * Devolver EXIGE motivo. A devolução desconta ponto do técnico -- devolver
   * sem dizer o que corrigir seria tirar ponto de alguém e não deixar caminho
   * para recuperar. O servidor também exige, então não adianta contornar a tela.
   */
  const validar = async (m, aprovado) => {
    let observacao = '';
    if (!aprovado) {
      const texto = await pedirMotivo();
      if (!texto) return;
      observacao = texto;
    }
    try {
      await RankingsAPI.validarMapeamento(m.id, { aprovado, observacao: observacao || undefined });
      await carregar();
    } catch (e) {
      avisar(e?.message || 'Não foi possível validar.', { titulo: 'Validação não concluída' });
    }
  };

  const excluir = async (m) => {
    const ok = await confirmar(`Excluir o mapeamento de ${m.empresa}?`, {
      titulo: 'Excluir mapeamento', rotuloConfirmar: 'Excluir', perigo: true,
    });
    if (!ok) return;
    try { await RankingsAPI.removerMapeamento(m.id); await carregar(); }
    catch (e) { avisar(e?.message || 'Não foi possível excluir.'); }
  };

  const ehSupervisor = usuario?.cargo === 'Administrador' || usuario?.supervisorRanking;

  return (
    <div className="p-4 sm:p-6 space-y-4 fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-texto flex items-center gap-2">
            <ClipboardList size={20} className="text-acao-200" /> Mapeamentos técnicos
          </h2>
          <p className="text-xs text-texto-fraco mt-0.5">
            Relatório das visitas fora da sede — é daqui que sai a pontuação do ranking externo.
          </p>
        </div>
        <button onClick={abrirNovo}
          className="px-4 py-2 rounded-xl bg-acao hover:bg-acao-200 text-slate-950 text-xs font-bold flex items-center gap-1.5">
          <Plus size={14} /> Novo mapeamento
        </button>
      </div>

      {erro && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-falha/10 border border-falha/30 text-falha-400 text-xs">
          <AlertCircle size={14} className="shrink-0" /> {erro}
        </div>
      )}

      <div className="glass-panel border border-linha rounded-2xl overflow-hidden">
        {carregando ? (
          <div className="py-14 grid place-items-center"><Loader2 size={22} className="animate-spin text-acao" /></div>
        ) : lista.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm font-semibold text-texto-suave">Nenhum mapeamento ainda.</p>
            <p className="text-[11px] text-texto-fraco mt-1">Cada visita registrada aqui vira ponto no ranking do mês.</p>
          </div>
        ) : (
          <div className="divide-y divide-linha">
            {lista.map((m) => (
              <div key={m.id} className="p-3.5 flex flex-col sm:flex-row sm:items-center gap-3 hover:bg-grafite-700/40">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Building2 size={13} className="text-texto-fraco shrink-0" />
                    <span className="font-bold text-xs text-texto truncate">{m.empresa}</span>
                    <Selo status={m.status} />
                    {m.devolucoes > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-espera/30 bg-espera/10 text-espera-400"
                        title="Cada devolução desconta 5 pontos da parcela de retrabalho">
                        {m.devolucoes} devolução{m.devolucoes > 1 ? 'ões' : ''}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-[11px] text-texto-fraco flex-wrap">
                    <span>{m.tecnicoNome}</span>
                    <span className="flex items-center gap-1"><Clock size={10} /> visita {data(m.dataVisita)}</span>
                    <span className={m.entregueEm ? (m.noPrazo ? 'text-ativo-400' : 'text-falha-400') : ''}>
                      {m.entregueEm ? (m.noPrazo ? 'entregue no prazo' : 'entregue com atraso') : `prazo ${data(m.prazoEm)}`}
                    </span>
                    <span>{m.completude}% completo</span>
                    <span className="flex items-center gap-1"><Camera size={10} /> {m.evidencias}</span>
                  </div>
                  {m.observacaoValidacao && (
                    <p className="text-[11px] text-espera-400 mt-1 flex items-start gap-1">
                      <AlertCircle size={11} className="shrink-0 mt-0.5" />
                      {m.validadoPorNome}: {m.observacaoValidacao}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                  {m.status !== 'aprovado' && m.tecnicoId === usuario?.id && (
                    <button onClick={() => abrirEdicao(m)}
                      className="px-2.5 py-1.5 rounded-lg bg-grafite-700 border border-linha text-texto-suave hover:text-texto text-[11px] font-semibold">
                      Editar
                    </button>
                  )}
                  {ehSupervisor && m.status !== 'rascunho' && (
                    <>
                      {m.status !== 'aprovado' && (
                        <button onClick={() => validar(m, true)}
                          className="px-2.5 py-1.5 rounded-lg bg-ativo/15 border border-ativo/30 text-ativo-400 text-[11px] font-bold flex items-center gap-1">
                          <ShieldCheck size={12} /> Aprovar
                        </button>
                      )}
                      <button onClick={() => validar(m, false)}
                        className="px-2.5 py-1.5 rounded-lg bg-espera/15 border border-espera/30 text-espera-400 text-[11px] font-bold flex items-center gap-1">
                        <RotateCcw size={12} /> Devolver
                      </button>
                    </>
                  )}
                  {(m.status === 'rascunho' || ehSupervisor) && (
                    <button onClick={() => excluir(m)} title="Excluir"
                      className="p-1.5 rounded-lg text-texto-fraco hover:text-falha-400 hover:bg-falha/10">
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editando && regras && (
        <ModalMapeamento
          itensRegra={regras.itens}
          inicial={editando.novo ? null : editando}
          onFechar={() => setEditando(null)}
          onSalvo={() => { setEditando(null); carregar(); }}
        />
      )}
    </div>
  );
}

// Motivo da devolução, num lugar só. A devolução DESCONTA ponto do técnico:
// devolver sem dizer o que corrigir seria tirar ponto de alguém e não deixar
// caminho para recuperar. O servidor também exige, então não adianta contornar
// a tela.
function pedirMotivo() {
  return pedirTexto('O que precisa ser corrigido neste relatório?', {
    titulo: 'Devolver para correção',
    placeholder: 'Ex.: faltou o levantamento de backup e fotos do rack',
    rotuloConfirmar: 'Devolver',
    perigo: true,
  });
}
