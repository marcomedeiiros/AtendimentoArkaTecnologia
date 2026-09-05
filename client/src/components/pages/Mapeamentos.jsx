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
  ChevronDown, ChevronRight, SlidersHorizontal, Trophy,
} from 'lucide-react';
import { RankingsAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { avisar, confirmar, pedirTexto } from '../../utils/dialogo';
import Portal from '../Portal';
import { FUSO_BR } from '../../utils/data';
import { ehDaEquipeExterna } from '../../utils/equipeRanking';

const STATUS_META = {
  rascunho:    { rotulo: 'Rascunho',    classe: 'bg-quieto/20 text-quieto-400 border-quieto/30' },
  entregue:    { rotulo: 'Entregue',    classe: 'bg-acao/15 text-acao-200 border-acao/30' },
  em_correcao: { rotulo: 'Em correção', classe: 'bg-espera/15 text-espera-400 border-espera/30' },
  aprovado:    { rotulo: 'Aprovado',    classe: 'bg-ativo/15 text-ativo-400 border-ativo/30' },
};

const hojeISO = () => new Date().toISOString().slice(0, 10);
// Prazo sugerido: N dias após a visita. O N vem da CONFIGURAÇÃO (o servidor
// manda junto com a leitura do PDF); o 3 aqui é só o valor de partida para o
// formulário aberto antes de qualquer leitura.
function prazoSugerido(dataVisita, dias = 3) {
  const d = new Date(`${dataVisita || hojeISO()}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

// "1,2 MB" -- o tamanho do PDF, para a pessoa saber o que está mandando.
function tamanho(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

/**
 * A DATA, sem perder um dia no caminho.
 *
 * "2026-09-01" (data pura, sem hora) é lida pelo JavaScript como MEIA-NOITE
 * UTC. Formatada no fuso de Brasília (−3), vira 31/08 -- a visita de setembro
 * aparecia como agosto, e o mês é justamente o que decide em qual competência
 * o trabalho conta.
 *
 * Data pura é montada componente a componente, sem passar pelo fuso. O que tem
 * hora (o que vem do banco) continua no caminho de sempre, que aí está certo.
 */
const data = (iso) => {
  if (!iso) return '—';
  const puro = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (puro) return `${puro[3]}/${puro[2]}/${puro[1]}`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: FUSO_BR });
};

function Selo({ status }) {
  const m = STATUS_META[status] || STATUS_META.rascunho;
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${m.classe}`}>{m.rotulo}</span>;
}

/**
 * VER O RELATÓRIO -- tudo que foi enviado, aberto.
 *
 * ── O QUE FALTAVA ─────────────────────────────────────────────────────────
 *
 * Só o PDF abria. O resumo, o checklist, as pendências e as fotos avulsas
 * ficavam gravados e sem nenhum caminho até eles: quem precisava conferir uma
 * visita via o nome da empresa, a porcentagem e mais nada. Anexar evidência
 * virava fé -- a pessoa mandava a foto e nunca mais a via.
 *
 * ── POR QUE UM MODAL, E NÃO A LINHA ABRINDO ────────────────────────────────
 *
 * A lista precisa continuar sendo uma lista: com o detalhe inteiro dentro dela,
 * dois relatórios abertos já empurram o resto para fora da tela. E o detalhe
 * tem foto, que quer espaço.
 *
 * As FOTOS abrem pela rota do servidor, por índice -- o caminho em disco nunca
 * chega ao navegador, e a permissão é reconferida a cada arquivo.
 */
function ModalDetalhe({ id, itensRegra, onFechar, onEditar, podeEditar }) {
  const [m, setM] = useState(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let vivo = true;
    RankingsAPI.obterMapeamento(id)
      .then((d) => { if (vivo) setM(d); })
      .catch((e) => { if (vivo) setErro(e?.message || 'Não foi possível abrir.'); });
    return () => { vivo = false; };
  }, [id]);

  const itensPreenchidos = (itensRegra || []).filter((i) => String(m?.itens?.[i.chave] || '').trim());

  return (
    <Portal>
      <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-start sm:items-center justify-center z-50 p-3 overflow-y-auto">
        <div className="glass-panel border border-linha rounded-2xl w-full max-w-2xl shadow-2xl fade-in my-auto flex flex-col max-h-[calc(100dvh-1.5rem)]">
          <div className="p-4 bg-grafite-600 border-b border-linha flex items-center justify-between shrink-0 rounded-t-2xl gap-3">
            <span className="flex items-center gap-2 font-bold text-sm text-white min-w-0">
              <Building2 size={16} className="text-acao-200 shrink-0" />
              <span className="truncate">{m?.empresa || 'Relatório'}</span>
              {m && <Selo status={m.status} />}
            </span>
            <button onClick={onFechar} className="text-slate-400 hover:text-white shrink-0"><X size={16} /></button>
          </div>

          <div className="p-4 sm:p-5 space-y-4 overflow-y-auto">
            {erro && (
              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-falha/10 border border-falha/30 text-falha-400 text-[11px]">
                <AlertCircle size={13} className="shrink-0" /> {erro}
              </div>
            )}
            {!m && !erro && <div className="py-10 grid place-items-center"><Loader2 size={20} className="animate-spin text-acao" /></div>}

            {m && (
              <>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-texto-fraco">
                  <span>Técnico <strong className="text-texto-suave">{m.tecnicoNome}</strong></span>
                  <span>Visita <strong className="text-texto-suave">{data(m.dataVisita)}</strong></span>
                  <span>Prazo <strong className="text-texto-suave">{data(m.prazoEm)}</strong></span>
                  {m.entregueEm && <span>Entregue <strong className={m.noPrazo ? 'text-ativo-400' : 'text-falha-400'}>{data(m.entregueEm)}</strong></span>}
                  {m.cnpj && <span className="font-mono">{m.cnpj}</span>}
                </div>

                {m.observacaoValidacao && (
                  <div className="p-2.5 rounded-xl bg-espera/10 border border-espera/30">
                    <p className="text-[10px] font-bold text-espera-400 uppercase tracking-wider mb-1">
                      Devolvido para correção{m.validadoPorNome ? ` por ${m.validadoPorNome}` : ''}
                    </p>
                    <p className="text-xs text-texto-suave leading-relaxed">{m.observacaoValidacao}</p>
                  </div>
                )}

                {/* O PDF primeiro: é a entrega. */}
                <div>
                  <p className="text-[11px] font-semibold text-texto-suave mb-1.5">Relatório em PDF</p>
                  {m.arquivo ? (
                    <a href={RankingsAPI.urlArquivoMapeamento(m.id)} target="_blank" rel="noreferrer"
                      className="flex items-center gap-2 p-2.5 rounded-xl border border-acao/30 bg-acao/10 hover:bg-acao/20 transition-colors">
                      <FileText size={16} className="text-acao-200 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-semibold text-texto truncate">{m.arquivo.nome}</span>
                        <span className="block text-[10px] text-texto-fraco">
                          {tamanho(m.arquivo.bytes)}{m.arquivo.fotos ? ` · ${m.arquivo.fotos} foto${m.arquivo.fotos === 1 ? '' : 's'} dentro` : ''}
                        </span>
                      </span>
                      <span className="text-[11px] font-bold text-acao-200 shrink-0">Abrir</span>
                    </a>
                  ) : (
                    <p className="text-[11px] text-texto-fraco">Nenhum PDF anexado.</p>
                  )}
                </div>

                {m.resumo && (
                  <div>
                    <p className="text-[11px] font-semibold text-texto-suave mb-1">Resumo</p>
                    <p className="text-xs text-texto leading-relaxed whitespace-pre-wrap">{m.resumo}</p>
                  </div>
                )}

                {/* O CHECKLIST, com o que foi escrito. Mostra só o preenchido:
                    oito rótulos vazios não informam nada e afogam o que tem. */}
                {itensPreenchidos.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold text-texto-suave mb-1.5">
                      Checklist técnico <span className="text-texto-fraco font-normal">({itensPreenchidos.length} de {itensRegra.length})</span>
                    </p>
                    <div className="space-y-2">
                      {itensPreenchidos.map((i) => (
                        <div key={i.chave} className="p-2.5 rounded-xl bg-grafite-700 border border-linha">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-ativo-400 flex items-center gap-1 mb-1">
                            <CheckCircle2 size={10} /> {i.rotulo}
                          </p>
                          <p className="text-xs text-texto leading-relaxed whitespace-pre-wrap">{m.itens[i.chave]}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {m.pendencias && (
                  <div>
                    <p className="text-[11px] font-semibold text-texto-suave mb-1">Pendências e recomendações</p>
                    <p className="text-xs text-texto leading-relaxed whitespace-pre-wrap">{m.pendencias}</p>
                  </div>
                )}

                {/* AS FOTOS AVULSAS, abrindo. Cada uma pelo índice, na rota que
                    reconfere a permissão -- o caminho em disco não sai daqui. */}
                <div>
                  <p className="text-[11px] font-semibold text-texto-suave mb-1.5">
                    Evidências avulsas <span className="text-texto-fraco font-normal">({(m.arquivos || []).length})</span>
                  </p>
                  {(m.arquivos || []).length === 0 ? (
                    <p className="text-[11px] text-texto-fraco">Nenhuma foto anexada fora do PDF.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {m.arquivos.map((ev, i) => {
                        const url = RankingsAPI.urlEvidenciaMapeamento(m.id, i);
                        const ehImagem = String(ev?.mimetype || '').startsWith('image/');
                        return (
                          <a key={i} href={url} target="_blank" rel="noreferrer"
                            title={ev?.nome || `Evidência ${i + 1}`}
                            className="w-20 h-20 rounded-lg border border-linha bg-grafite-700 grid place-items-center overflow-hidden hover:border-acao/50 transition-colors">
                            {ehImagem
                              ? <img src={url} alt={`Evidência ${i + 1}`} className="w-full h-full object-cover" />
                              : <FileText size={18} className="text-texto-fraco" />}
                          </a>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="p-4 bg-grafite-600 border-t border-linha flex flex-col-reverse sm:flex-row sm:justify-end gap-2 shrink-0 rounded-b-2xl">
            <button onClick={onFechar}
              className="px-3 py-2 rounded-lg bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700">
              Fechar
            </button>
            {m && podeEditar && (
              <button onClick={() => onEditar(m)}
                className="px-4 py-2 rounded-lg bg-acao hover:bg-acao-200 text-slate-950 text-xs font-bold">
                Editar
              </button>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
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
  // O PDF do relatório. `pdf` é o arquivo novo escolhido agora; `pdfSalvo` é o
  // que já estava no servidor. Os dois separados porque "não mexi no PDF" e
  // "quero remover o PDF" precisam ser distinguíveis na hora de salvar.
  const [pdf, setPdf] = useState(null);
  const [pdfSalvo, setPdfSalvo] = useState(() => inicial?.arquivo || null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  // O que foi lido do PDF. `null` = ainda não leu nada.
  const [analise, setAnalise] = useState(null);
  const [lendo, setLendo] = useState(false);
  // Os campos que o PDF preenche sozinho ficam escondidos até alguém pedir.
  // Eles continuam existindo para o caso de um PDF que a leitura não entendeu.
  const [manual, setManual] = useState(false);
  // As regras da empresa que a TELA precisa saber (prazo em dias, e se o PDF é
  // obrigatório para entregar). Vêm junto com a leitura do PDF: o técnico não
  // tem acesso à tela de Configuração, mas precisa saber o que ela decidiu
  // para ele -- descobrir a regra pelo erro ao clicar em Entregar é o pior
  // jeito possível.
  const [regras, setRegras] = useState(null);

  // A MESMA conta do servidor: itens preenchidos + resumo com pelo menos 20
  // caracteres, sobre o total. Espelhada aqui para o número aparecer enquanto
  // se digita -- se as duas divergirem, a do servidor é a que vale.
  /**
   * A COMPLETUDE SOMA AS DUAS FONTES: o que o PDF cobre e o que foi digitado.
   *
   * ── O DEFEITO QUE ISTO CORRIGE ─────────────────────────────────────────────
   *
   * Com PDF lido, este número usava SÓ a leitura. Quem anexava o relatório e
   * depois completava os itens à mão via o número travado -- digitava, e
   * continuava 67%. Não era só o mostrador: o servidor também sobrescrevia o
   * checklist, então o trabalho sumia de verdade.
   *
   * Agora conta o item que o PDF cobriu OU que a pessoa escreveu -- a mesma
   * soma que o servidor grava, para os dois números nunca discordarem.
   */
  const completude = useMemo(() => {
    const cobertos = itensRegra.filter(
      (i) => analise?.cobertura?.[i.chave]?.coberto || String(itens[i.chave] || '').trim()
    ).length;
    // Com PDF lido o resumo é escrito pelo servidor quando a pessoa não escreve
    // um -- então ele conta de qualquer jeito.
    const comResumo = analise?.lido || resumo.trim().length >= 20 ? 1 : 0;
    return Math.round(((cobertos + comResumo) / (itensRegra.length + 1)) * 100);
  }, [itens, resumo, itensRegra, analise]);

  // As fotos DE DENTRO do PDF somam com as evidências anexadas (ver
  // pontuacao.externa.quantidadeEvidencias). Era o MAIOR das duas, e com um PDF
  // de 2 fotos anexar 1 ou 2 não mexia em nada -- a pessoa mandava a foto e o
  // número não subia.
  const evidenciasContadas = evidencias.length + (analise?.fotos || 0);

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

  /**
   * O PDF do relatório -- barrado aqui por tamanho e extensão.
   *
   * O servidor confere os BYTES (nome de arquivo não prova nada), mas a
   * checagem daqui existe para a pessoa saber na hora, e não depois de esperar
   * 15 MB subirem só para receber um erro.
   */
  const anexarPdf = (e) => {
    const f = (e.target.files || [])[0];
    e.target.value = '';
    if (!f) return;
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
      setErro('O relatório precisa ser um arquivo PDF.');
      return;
    }
    if (f.size > 15 * 1024 * 1024) { setErro(`"${f.name}" passa de 15 MB.`); return; }
    setErro('');
    const r = new FileReader();
    r.onload = () => {
      const escolhido = { conteudo: r.result, nome: f.name, bytes: f.size };
      setPdf(escolhido);
      lerPdf(escolhido);
    };
    r.readAsDataURL(f);
  };

  /**
   * LÊ O PDF e preenche o formulário com o que ele já diz.
   *
   * ── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
   *
   * Empresa, data, o que foi vistoriado e as fotos já estão dentro do relatório
   * que a pessoa acabou de montar. Digitar de novo é transcrever o próprio
   * trabalho -- e o efeito prático era campo em branco, que derrubava a
   * completude e fazia a nota medir preenchimento de formulário.
   *
   * ── E POR QUE O RESULTADO É SÓ SUGESTÃO ────────────────────────────────────
   *
   * A leitura depende do layout do documento, que é feito fora deste sistema.
   * Então nada aqui sobrescreve o que a pessoa já digitou, e tudo continua
   * editável: um campo preenchido errado em silêncio é pior que um vazio.
   *
   * Falhar aqui não impede nada -- o formulário continua funcionando à mão.
   */
  const lerPdf = async (escolhido) => {
    setLendo(true);
    setAnalise(null);
    try {
      const r = await RankingsAPI.analisarMapeamento({ conteudo: escolhido.conteudo, nome: escolhido.nome });
      setAnalise(r);
      if (!r?.lido) return;
      // `||` e não sobrescrita: o que a pessoa escreveu vale mais que o que eu li.
      if (r.empresa && !empresa.trim()) setEmpresa(r.empresa);
      if (r.dataVisita) {
        setDataVisita(r.dataVisita);
        // O PRAZO SAI DA REGRA DA EMPRESA, calculada pelo servidor -- ele
        // combina o prazo por relatório com o vencimento mensal, quando existe.
        // Repetir essa conta aqui criaria uma segunda regra para manter em dia.
        //
        // E ELE NÃO PODE NASCER VENCIDO: quando o relatório traz só mês e ano, a
        // visita cai no dia 1º, e "1º + N dias" já passou faz tempo para quem
        // lança no fim do mês. O quadro abria escrito "vencido" antes de a
        // pessoa digitar qualquer coisa, acusando um atraso que ninguém sabe se
        // houve. Com dia presumido, a sugestão sai de HOJE.
        if (!edicao) {
          const dias = r.regras?.prazoDias ?? 3;
          setPrazoEm(
            r.dataDiaPresumido || !r.prazoSugerido
              ? prazoSugerido(hojeISO(), dias)
              : r.prazoSugerido
          );
        }
        if (r.regras) setRegras(r.regras);
      }
    } catch (e2) {
      setAnalise({ lido: false, motivo: e2?.message || 'Não foi possível ler o PDF.' });
    } finally {
      setLendo(false);
    }
  };

  const salvar = async (entregar) => {
    if (!empresa.trim()) { setErro('Informe a empresa visitada.'); return; }
    // A regra é do servidor, que recusa de qualquer jeito. Isto aqui existe
    // para a pessoa não montar o registro inteiro e só descobrir a exigência no
    // clique final -- e ainda oferece o caminho que funciona (rascunho).
    if (entregar && regras?.exigirPdf && !pdf && !pdfSalvo) {
      setErro('A empresa exige o relatório em PDF para entregar. Anexe o arquivo ou salve como rascunho.');
      return;
    }
    if (entregar) {
      const ok = await confirmar(
        `O relatório entra na contagem de ${data(dataVisita)} e passa para a validação do supervisor ` +
        `você ainda pode corrigir enquanto ele não aprovar, mas a data de entrega não muda depois` +
        `é ela que define se ficou dentro do prazo`,
        { titulo: 'Entregar o mapeamento?', rotuloConfirmar: 'Entregar', rotuloCancelar: 'Continuar editando' }
      );
      if (!ok) return;
    }
    setSalvando(true);
    setErro('');
    const corpo = { empresa: empresa.trim(), cnpj: cnpj.replace(/\D/g, '') || null, dataVisita, prazoEm, resumo, itens, pendencias, evidencias, entregar };
    // `arquivo` só entra no corpo quando houve mudança. Campo AUSENTE quer
    // dizer "não mexi nisso" -- é o que impede um salvamento comum de apagar o
    // relatório que já tinha sido enviado.
    if (pdf) corpo.arquivo = { conteudo: pdf.conteudo, nome: pdf.nome };
    else if (!pdfSalvo && inicial?.arquivo) corpo.arquivo = null;
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
            {/* `flex flex-wrap` e não grade de 3: numa tela estreita os três
                mostradores ficam com ~100px cada e o rótulo quebra no meio.
                Assim eles ficam lado a lado quando há espaço e passam para a
                linha de baixo quando não há -- sem precisar escolher um ponto
                de quebra fixo. */}
            <div className="flex flex-wrap gap-2 [&>*]:flex-1 [&>*]:min-w-[7rem]">
              <div className="rounded-xl border border-linha bg-grafite-700 p-2.5 text-center">
                <p className="text-[10px] uppercase tracking-wider text-texto-fraco font-bold">Completo</p>
                <p className={`font-display font-extrabold text-lg ${completude >= 80 ? 'text-ativo-400' : completude >= 50 ? 'text-espera-400' : 'text-falha-400'}`}>
                  {completude}%
                </p>
              </div>
              <div className="rounded-xl border border-linha bg-grafite-700 p-2.5 text-center">
                <p className="text-[10px] uppercase tracking-wider text-texto-fraco font-bold">Evidências</p>
                <p className={`font-display font-extrabold text-lg ${evidenciasContadas >= 3 ? 'text-ativo-400' : 'text-espera-400'}`}>
                  {evidenciasContadas}
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

            {/* O PDF VEM PRIMEIRO -- é ele que preenche o resto.
                Antes ele ficava no fim, depois de doze campos que a pessoa
                digitava com o relatório aberto do lado. Invertido, o formulário
                começa pelo trabalho que já está pronto. */}
            <div>
              <p className="text-[11px] font-semibold text-texto-suave mb-1.5">
                Relatório em PDF <span className="text-texto-fraco font-normal">(o arquivo que vai para o cliente · até 15 MB)</span>
              </p>
              {pdf || pdfSalvo ? (
                <div className="flex items-center gap-2 p-2.5 rounded-xl border border-acao/30 bg-acao/10">
                  <FileText size={16} className="text-acao-200 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-texto truncate">
                      {pdf?.nome || pdfSalvo?.nome}
                    </span>
                    <span className="block text-[10px] text-texto-fraco">
                      {tamanho(pdf?.bytes ?? pdfSalvo?.bytes)}{pdf ? ' · será enviado ao salvar' : ' · já enviado'}
                    </span>
                  </span>
                  {/* Sem PDF novo escolhido, remover significa apagar o que está
                      no servidor -- e isso só acontece ao salvar. */}
                  <button
                    onClick={() => { if (pdf) { setPdf(null); setAnalise(null); } else setPdfSalvo(null); }}
                    className="shrink-0 p-1.5 rounded-lg text-falha-400 hover:bg-falha/15"
                    title={pdf ? 'Descartar o arquivo escolhido' : 'Remover o relatório ao salvar'}
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <label className="flex items-center gap-2 p-3 rounded-xl border border-dashed border-linha-forte cursor-pointer text-texto-fraco hover:text-acao-200 hover:border-acao/50 transition-colors">
                  <FileText size={16} className="shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold">Anexar o relatório em PDF</span>
                    <span className="block text-[10px]">A empresa, a data e o que foi vistoriado são lidos daqui.</span>
                  </span>
                  <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={anexarPdf} />
                </label>
              )}

              {lendo && (
                <p className="mt-2 text-[11px] text-texto-fraco flex items-center gap-1.5">
                  <Loader2 size={12} className="animate-spin" /> Lendo o relatório
                </p>
              )}

              {/* O QUE FOI LIDO, à vista.
                  Mostrar de onde saiu cada achado é o que torna a leitura
                  automática confiável: quando ela errar, dá para ver o que ela
                  leu -- em vez de a pessoa descobrir pelo campo errado. */}
              {!lendo && analise && (
                analise.lido ? (
                  <div className="mt-2 p-2.5 rounded-xl border border-ativo/30 bg-ativo/10 space-y-1.5">
                    <p className="text-[11px] font-bold text-ativo-400 flex items-center gap-1.5">
                      <CheckCircle2 size={12} /> Li o relatório {analise.paginas} página{analise.paginas === 1 ? '' : 's'}
                    </p>
                    <p className="text-[10px] text-texto-suave leading-relaxed">
                      {analise.empresa && <>Empresa <strong className="text-texto">{analise.empresa}</strong>. </>}
                      {analise.dataVisita && (
                        <>
                          Visita em <strong className="text-texto">{data(analise.dataVisita)}</strong>
                          {analise.dataDiaPresumido && ' (o relatório traz só mês e ano confira o dia)'}. {' '}
                        </>
                      )}
                      {analise.fotos > 0 && <>{analise.fotos} foto{analise.fotos === 1 ? '' : 's'} de campo. </>}
                      Cobre <strong className="text-texto">{analise.itensCobertos} de {analise.totalItens}</strong> itens do checklist.
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {itensRegra.map((i) => {
                        const c = analise.cobertura?.[i.chave];
                        return (
                          <span key={i.chave}
                            className={`text-[9px] px-1.5 py-0.5 rounded-full border ${c?.coberto ? 'border-ativo/40 bg-ativo/10 text-ativo-400' : 'border-linha text-texto-fraco'}`}
                            title={c?.coberto ? `Encontrado: ${c.palavras.join(', ')}` : 'Não encontrado no relatório'}>
                            {i.rotulo}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 p-2.5 rounded-xl border border-espera/30 bg-espera/10 text-[10px] text-espera-400 leading-relaxed">
                    {analise.motivo || 'Não consegui ler este PDF.'}
                    {' '}O arquivo será enviado do mesmo jeito preencha os campos abaixo à mão.
                  </p>
                )
              )}
            </div>

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

            {/* O RESUMO E O CHECKLIST SAEM DO PDF -- e por isso não aparecem.
                São eles que formam a completude, e o servidor os preenche lendo
                o arquivo. Deixá-los à mostra pediria de novo o que a pessoa
                acabou de escrever no relatório, que era exatamente o problema.
                Ficam disponíveis para o caso do PDF que a leitura não entendeu
                (e para os relatórios antigos, em edição). */}
            <button
              onClick={() => setManual((v) => !v)}
              className="text-[11px] font-semibold text-texto-fraco hover:text-acao-200 flex items-center gap-1.5 self-start"
            >
              {manual ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              Preencher resumo e checklist à mão
              {analise?.lido && <span className="font-normal">(soma ao que o PDF já cobriu)</span>}
            </button>

            <div hidden={!manual} className="space-y-3">
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
                  // O QUE O PDF JÁ COBRIU fica dito no próprio item. Sem isso a
                  // pessoa não tem como saber onde digitar ACRESCENTA e onde só
                  // repete o que o relatório já diz -- e a completude parece
                  // teimar num número sem explicação.
                  const noPdf = !!analise?.cobertura?.[i.chave]?.coberto;
                  const conta = preenchido || noPdf;
                  return (
                    <div key={i.chave}>
                      <label className={`text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 mb-1 ${conta ? 'text-ativo-400' : 'text-texto-fraco'}`}>
                        {conta && <CheckCircle2 size={10} />} {i.rotulo}
                        {noPdf && !preenchido && <span className="font-normal normal-case tracking-normal">no PDF</span>}
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
                {/* As fotos DE DENTRO do PDF já contam nesta parcela (o servidor
                    conta ao ler o arquivo), então anexar aqui virou opcional --
                    serve para o que não entrou no relatório. */}
                Evidências avulsas <span className="text-texto-fraco font-normal">({evidencias.length}/12 · 3 já valem a faixa cheia{analise?.fotos ? ` · o PDF já traz ${analise.fotos}` : ''})</span>
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

/**
 * HISTÓRICO DE RELATÓRIOS -- o que já saiu da mão, com o PDF para baixar.
 *
 * ── POR QUE ELE NÃO FAZ UMA CONSULTA PRÓPRIA ───────────────────────────────
 *
 * Ele reaproveita a MESMA lista da outra aba. Não é economia de request: é o
 * que garante que as duas abas enxerguem exatamente o mesmo recorte. O
 * servidor já devolve só o que esta pessoa pode ver (técnico vê o próprio,
 * administrador vê todos), e uma segunda consulta seria um segundo lugar onde
 * esse recorte poderia sair diferente.
 *
 * ── O QUE ENTRA ────────────────────────────────────────────────────────────
 *
 * Só o que foi ENTREGUE. Rascunho é trabalho em andamento, não histórico --
 * misturado aqui, a pessoa não saberia dizer o que o cliente já recebeu.
 */
function Historico({ lista, mostrarTecnico, onVer }) {
  const [busca, setBusca] = useState('');
  const [mes, setMes] = useState('');

  const entregues = useMemo(
    () => lista.filter((m) => m.status !== 'rascunho'),
    [lista]
  );

  const meses = useMemo(() => {
    const s = new Set(entregues.map((m) => String(m.dataVisita || '').slice(0, 7)).filter(Boolean));
    return [...s].sort().reverse();
  }, [entregues]);

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return entregues
      .filter((m) => !mes || String(m.dataVisita || '').startsWith(mes))
      .filter((m) => !t || m.empresa?.toLowerCase().includes(t) || m.tecnicoNome?.toLowerCase().includes(t))
      // Pelo que foi entregue por último: a pergunta do histórico é "o que saiu
      // agora há pouco", e não "que visita é a mais recente".
      .sort((a, b) => new Date(b.entregueEm || b.dataVisita) - new Date(a.entregueEm || a.dataVisita));
  }, [entregues, busca, mes]);

  const comPdf = filtrados.filter((m) => m.arquivo).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder={mostrarTecnico ? 'Buscar por empresa ou técnico' : 'Buscar por empresa'}
          className="flex-1 min-w-[180px] bg-grafite-700 border border-linha rounded-xl px-3 py-2 text-xs text-texto placeholder:text-texto-fraco focus:outline-none focus:border-acao/50"
        />
        <select
          value={mes}
          onChange={(e) => setMes(e.target.value)}
          className="bg-grafite-700 border border-linha rounded-xl px-3 py-2 text-xs text-texto focus:outline-none focus:border-acao/50"
        >
          <option value="">Todos os meses</option>
          {meses.map((m) => <option key={m} value={m}>{m.split('-').reverse().join('/')}</option>)}
        </select>
        <span className="text-[11px] text-texto-fraco shrink-0">
          {filtrados.length} relatório{filtrados.length === 1 ? '' : 's'} · {comPdf} com PDF
        </span>
      </div>

      <div className="glass-panel border border-linha rounded-2xl overflow-hidden">
        {filtrados.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm font-semibold text-texto-suave">
              {entregues.length === 0 ? 'Nenhum relatório entregue ainda.' : 'Nada com esse filtro.'}
            </p>
            <p className="text-[11px] text-texto-fraco mt-1">
              {entregues.length === 0
                ? 'O histórico mostra os relatórios depois que você entrega rascunho não aparece aqui.'
                : 'Tente outro mês ou limpe a busca.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-linha">
            {filtrados.map((m) => (
              <div key={m.id} className="p-3.5 flex flex-col sm:flex-row sm:items-center gap-3 hover:bg-grafite-700/40">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Building2 size={13} className="text-texto-fraco shrink-0" />
                    <span className="font-bold text-xs text-texto truncate">{m.empresa}</span>
                    <Selo status={m.status} />
                  </div>
                  <p className="text-[11px] text-texto-fraco mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    {/* O nome do técnico só para quem vê os relatórios de mais
                        de uma pessoa -- para o técnico, todos são dele. */}
                    {mostrarTecnico && <span className="font-semibold text-texto-suave">{m.tecnicoNome}</span>}
                    <span>Visita {data(m.dataVisita)}</span>
                    <span>Entregue {data(m.entregueEm)}</span>
                    {m.arquivo && <span>{tamanho(m.arquivo.bytes)}</span>}
                  </p>
                </div>

                {/* DOIS CAMINHOS, e não um.
                    O histórico só oferecia "Abrir PDF", então o resumo, o
                    checklist, as pendências e as fotos avulsas continuavam sem
                    caminho ATÉ AQUI -- e o histórico é justamente a tela onde
                    se procura uma visita antiga. Um relatório sem PDF ficava
                    sem nada para clicar.

                    "Ver" primeiro: abre o relatório inteiro, do qual o PDF é
                    uma parte. */}
                <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                  <button
                    onClick={() => onVer(m.id)}
                    className="px-3 py-2 rounded-xl bg-grafite-700 border border-linha text-texto-suave hover:text-texto hover:border-linha-forte text-[11px] font-bold transition-colors"
                  >
                    Ver
                  </button>
                  {m.arquivo ? (
                    <a
                      href={RankingsAPI.urlArquivoMapeamento(m.id)}
                      target="_blank"
                      rel="noreferrer"
                      title={m.arquivo.nome}
                      className="px-3 py-2 rounded-xl bg-acao/15 border border-acao/40 text-acao-200 hover:bg-acao/25 text-[11px] font-bold flex items-center gap-1.5 transition-colors"
                    >
                      <FileText size={13} /> Abrir PDF
                    </a>
                  ) : (
                    // Dizer que NÃO TEM é mais útil que esconder: quem procura o
                    // relatório de uma visita precisa saber se ele não foi
                    // anexado, e não ficar achando que a tela está com defeito.
                    <span className="text-[11px] text-texto-fraco px-1">Sem PDF</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * CONFIGURAÇÃO DOS RELATÓRIOS -- as regras que o administrador define.
 *
 * ── O QUE ENTRA AQUI ───────────────────────────────────────────────────────
 *
 * O que é POLÍTICA da empresa e antes só mudava com deploy: quanto tempo se tem
 * para entregar, quanto cada coisa vale na nota, quantos relatórios já permitem
 * julgar alguém, e o vocabulário que a leitura do PDF procura.
 *
 * ── E O QUE NÃO ENTRA ──────────────────────────────────────────────────────
 *
 * A fórmula. O jeito de somar as parcelas continua no servidor, fechado: peso é
 * decisão de negócio, mas "como se calcula" é decisão de engenharia -- e abrir
 * as duas na mesma tela é como ninguém mais conseguir explicar o número.
 */
/**
 * FORA do componente de propósito -- e isso não é estilo, é correção.
 *
 * `Campo` estava definido DENTRO de `Configuracao`. A cada render ele virava um
 * tipo de componente novo, e o React desmontava e remontava toda a árvore de
 * campos: o cursor pulava do input a cada tecla, e uma alteração feita logo
 * depois de outra era perdida porque o nó anterior já tinha sido descartado.
 *
 * Foi assim que "mudar o prazo de 7 para 5" salvou 7.
 */
function Campo({ rotulo, dica, children }) {
  return (
    <div>
      <label className="text-[11px] font-semibold text-texto-suave block mb-1">{rotulo}</label>
      {children}
      {dica && <p className="text-[10px] text-texto-fraco mt-1 leading-relaxed">{dica}</p>}
    </div>
  );
}

const ENTRADA = 'w-full bg-grafite-700 border border-linha rounded-xl px-3 py-2 text-xs text-texto focus:outline-none focus:border-acao/50';

function Configuracao() {
  const [dados, setDados] = useState(null);
  const [rascunho, setRascunho] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let vivo = true;
    RankingsAPI.configuracaoRelatorios()
      .then((d) => { if (vivo) { setDados(d); setRascunho(d.regras); } })
      .catch((e) => { if (vivo) setErro(e?.message || 'Não foi possível carregar.'); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, []);

  const mexer = (campo, valor) => { setErro(''); setRascunho((r) => ({ ...r, [campo]: valor })); };
  const mexerPeso = (chave, valor) =>
    setRascunho((r) => ({ ...r, pesos: { ...r.pesos, [chave]: Math.max(0, Math.min(100, Number(valor) || 0)) } }));

  const somaPesos = useMemo(
    () => Object.values(rascunho?.pesos || {}).reduce((a, b) => a + Number(b || 0), 0),
    [rascunho]
  );

  const salvar = async () => {
    setSalvando(true);
    setErro('');
    try {
      const salvo = await RankingsAPI.salvarConfiguracaoRelatorios(rascunho);
      setRascunho(salvo);
      setDados((d) => ({ ...d, regras: salvo }));
      avisar('As novas regras já valem para o ranking do mês.', { titulo: 'Configuração salva', tipo: 'info' });
    } catch (e) {
      setErro(e?.message || 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  };

  const restaurar = async () => {
    const ok = await confirmar(
      'Todas as regras voltam ao padrão do sistema: prazo de 3 dias, os pesos originais e o vocabulário de fábrica.',
      { titulo: 'Restaurar o padrão?', rotuloConfirmar: 'Restaurar', perigo: true }
    );
    if (ok) { setRascunho(dados.padrao); setErro(''); }
  };

  if (carregando) {
    return <div className="glass-panel border border-linha rounded-2xl py-14 grid place-items-center">
      <Loader2 size={22} className="animate-spin text-acao" />
    </div>;
  }
  if (!rascunho) {
    return <div className="glass-panel border border-linha rounded-2xl p-6 text-center text-xs text-falha-400">{erro || 'Sem dados.'}</div>;
  }

  return (
    <div className="space-y-3">
      {erro && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-falha/10 border border-falha/30 text-falha-400 text-xs">
          <AlertCircle size={14} className="shrink-0" /> {erro}
        </div>
      )}

      <div className="glass-panel border border-linha rounded-2xl p-4 sm:p-5 space-y-4">
        <p className="text-[11px] font-bold text-acao-200 flex items-center gap-1.5">
          <Clock size={13} /> Prazos
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Campo rotulo="Prazo de entrega (dias após a visita)"
            dica="É o prazo de cada relatório. Ele decide a parcela “no prazo” da pontuação.">
            <input type="number" min={1} max={90} className={ENTRADA}
              value={rascunho.prazoDias}
              onChange={(e) => mexer('prazoDias', Number(e.target.value))} />
          </Campo>
          <Campo rotulo="Vencimento mensal (dia do mês seguinte)"
            dica="Todos os relatórios de um mês precisam estar entregues até esse dia do mês seguinte. Vazio = a empresa não usa essa regra. Valendo as duas, vale a mais apertada.">
            <input type="number" min={1} max={28} placeholder="não usar" className={ENTRADA}
              value={rascunho.vencimentoDiaDoMes ?? ''}
              onChange={(e) => mexer('vencimentoDiaDoMes', e.target.value === '' ? null : Number(e.target.value))} />
          </Campo>
        </div>
        <label className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" className="mt-0.5 accent-acao"
            checked={!!rascunho.exigirPdf}
            onChange={(e) => mexer('exigirPdf', e.target.checked)} />
          <span>
            <span className="text-[11px] font-semibold text-texto-suave block">Exigir o PDF anexado para entregar</span>
            <span className="text-[10px] text-texto-fraco">
              Vale só na entrega o rascunho continua podendo ser salvo sem arquivo, para a pessoa começar o registro e voltar depois.
            </span>
          </span>
        </label>
      </div>

      <div className="glass-panel border border-linha rounded-2xl p-4 sm:p-5 space-y-4">
        <p className="text-[11px] font-bold text-acao-200 flex items-center gap-1.5">
          <Trophy size={13} /> Pontuação
        </p>
        {/* O AVISO QUE PRECISA ESTAR AQUI: o histórico é recalculado a cada
            consulta, então mexer nos pesos muda também os meses passados -- e a
            premiação já registrada continua apontando para a posição antiga. */}
        <p className="text-[10px] text-espera-400 leading-relaxed border border-espera/30 bg-espera/10 rounded-xl p-2.5">
          O ranking é recalculado a cada consulta, então mudar os pesos muda também os
          <strong> meses já passados</strong>. Premiações já registradas continuam como estão.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {Object.entries(rascunho.pesos).map(([chave, valor]) => (
            <Campo key={chave} rotulo={{
              volume: 'Volume', completude: 'Completude', prazo: 'Prazo',
              evidencias: 'Evidências', retrabalho: 'Retrabalho',
            }[chave] || chave}>
              <input type="number" min={0} max={100} className={ENTRADA}
                value={valor} onChange={(e) => mexerPeso(chave, e.target.value)} />
            </Campo>
          ))}
          <div className={`rounded-xl border p-2.5 text-center self-end ${somaPesos === 100 ? 'border-ativo/40 bg-ativo/10' : 'border-falha/40 bg-falha/10'}`}>
            <p className="text-[10px] uppercase tracking-wider text-texto-fraco font-bold">Soma</p>
            <p className={`font-display font-extrabold text-lg ${somaPesos === 100 ? 'text-ativo-400' : 'text-falha-400'}`}>
              {somaPesos}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Campo rotulo="Mínimo de relatórios no mês"
            dica="Abaixo disso, as parcelas de qualidade (completude, prazo e evidências) não contam. Impede que uma única visita perfeita lidere o mês.">
            <input type="number" min={1} max={20} className={ENTRADA}
              value={rascunho.minimoRelatorios}
              onChange={(e) => mexer('minimoRelatorios', Number(e.target.value))} />
          </Campo>
          <Campo rotulo="Desconto por devolução"
            dica="Quanto cada devolução para correção tira da parcela de retrabalho, até zerá-la.">
            <input type="number" min={0} max={25} className={ENTRADA}
              value={rascunho.custoPorDevolucao}
              onChange={(e) => mexer('custoPorDevolucao', Number(e.target.value))} />
          </Campo>
        </div>
      </div>

      <div className="glass-panel border border-linha rounded-2xl p-4 sm:p-5 space-y-3">
        <p className="text-[11px] font-bold text-acao-200 flex items-center gap-1.5">
          <FileText size={13} /> Leitura do PDF
        </p>
        <p className="text-[10px] text-texto-fraco leading-relaxed">
          Um item do checklist é dado como coberto quando o relatório traz alguma destas palavras.
          É o ajuste mais provável: cada empresa escreve o relatório com o vocabulário dela, e um item
          que nunca casa vira completude perdida sem ninguém entender por quê. Separe por vírgula
          deixar em branco devolve as palavras padrão.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(dados.itens || []).map((i) => (
            <Campo key={i.chave} rotulo={i.rotulo}>
              <input className={ENTRADA}
                value={(rascunho.palavras?.[i.chave] || []).join(', ')}
                onChange={(e) => setRascunho((r) => ({
                  ...r,
                  palavras: { ...r.palavras, [i.chave]: e.target.value.split(',').map((p) => p.trim()).filter(Boolean) },
                }))} />
            </Campo>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button onClick={restaurar} disabled={salvando}
          className="px-3 py-2 rounded-xl bg-grafite-700 border border-linha text-texto-suave text-[11px] font-bold hover:border-linha-forte disabled:opacity-50 flex items-center gap-1.5">
          <RotateCcw size={12} /> Restaurar o padrão
        </button>
        <button onClick={salvar} disabled={salvando || somaPesos !== 100}
          title={somaPesos !== 100 ? 'Os pesos precisam somar 100' : undefined}
          className="px-4 py-2 rounded-xl bg-acao hover:bg-acao-200 text-slate-950 text-xs font-bold disabled:opacity-50 flex items-center gap-1.5">
          {salvando ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Salvar regras
        </button>
      </div>
    </div>
  );
}

const ABAS = [
  { id: 'mapeamentos', rotulo: 'Mapeamentos', Icon: ClipboardList },
  { id: 'historico', rotulo: 'Histórico de relatórios', Icon: FileText },
  // Só administrador. O servidor recusa os outros nos dois verbos -- isto aqui
  // decide o que desenhar, não quem pode.
  { id: 'configuracao', rotulo: 'Configuração', Icon: SlidersHorizontal, soAdmin: true },
];

export default function Mapeamentos() {
  const { usuario } = useAuth();
  const [lista, setLista] = useState([]);
  const [regras, setRegras] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [editando, setEditando] = useState(null);
  const [aba, setAba] = useState('mapeamentos');
  // Qual relatório está aberto para leitura. Só o id: o detalhe (resumo,
  // checklist, pendências e as fotos) vem do servidor, que é quem reconfere se
  // esta pessoa pode ver ESTE relatório.
  const [vendo, setVendo] = useState(null);

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
  const devolver = async (m) => {
    const observacao = await pedirMotivo();
    if (!observacao) return;
    try {
      await RankingsAPI.devolverMapeamento(m.id, { observacao });
      await carregar();
    } catch (e) {
      avisar(e?.message || 'Não foi possível devolver.', { titulo: 'Devolução não concluída' });
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

  // Quem aprova e devolve é o Administrador -- não há marca separada de
  // supervisor. Isto é só a dica de interface: o servidor confere o cargo NO
  // BANCO a cada chamada, então esconder o botão nunca foi a proteção.
  const ehSupervisor = usuario?.cargo === 'Administrador';
  // Quem lança relatório aqui é a equipe que VISITA cliente. O Administrador
  // entra porque valida os relatórios dos outros -- ele não lança, mas precisa
  // ver todos.
  const podeUsar = ehDaEquipeExterna(usuario) || ehSupervisor;

  /**
   * A tela não some para quem não é da equipe externa -- ela EXPLICA.
   *
   * O item já não aparece no menu, então quem chega aqui veio por um link
   * antigo, um favorito ou o botão de voltar. Uma página em branco (ou um
   * redirecionamento silencioso) faria a pessoa achar que o sistema quebrou;
   * um formulário completo seria pior, porque ela lançaria um relatório que
   * não conta em ranking nenhum e ainda entraria na fila de validação como
   * ruído.
   */
  if (!podeUsar) {
    return (
      <div className="p-4 sm:p-6 fade-in">
        <div className="glass-panel border border-linha rounded-2xl p-8 text-center max-w-lg mx-auto">
          <ClipboardList size={28} className="mx-auto text-texto-fraco mb-3" />
          <p className="text-sm font-semibold text-texto">Esta tela é da equipe de fora da sede.</p>
          <p className="text-[11px] text-texto-fraco mt-2 leading-relaxed">
            Os relatórios de mapeamento são a entrega de quem faz visita técnica, e é deles
            que sai a pontuação do ranking <strong className="text-texto-suave">Fora da Sede</strong>.
            {' '}Se você passou a fazer visitas, peça a um administrador para incluir você nessa
            equipe em Gestão da Equipe.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-texto flex items-center gap-2">
            <ClipboardList size={20} className="text-acao-200" /> Relatórios
          </h2>
          <p className="text-xs text-texto-fraco mt-0.5">
            {/* A frase muda com o perfil porque a REGRA muda com o perfil, e é
                melhor a tela dizer isso do que a pessoa descobrir estranhando
                a lista curta (ou a lista com nome dos outros). */}
            {ehSupervisor
              ? 'Visitas fora da sede daqui sai a pontuação do ranking externo (como administrador, você vê os relatórios de toda a equipe)'
              : 'Visitas fora da sede daqui sai a pontuação do ranking externo (você vê apenas os relatórios que enviou)'}
          </p>
        </div>
        {/* O botão só na aba de lançamento: no histórico ele leria como "novo
            item do histórico", que não é o que ele faz. */}
        <button onClick={abrirNovo} hidden={aba !== 'mapeamentos'}
          className="px-4 py-2 rounded-xl bg-acao hover:bg-acao-200 text-slate-950 text-xs font-bold flex items-center gap-1.5">
          <Plus size={14} /> Novo mapeamento
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {ABAS.filter((a) => !a.soAdmin || ehSupervisor).map(({ id, rotulo, Icon }) => (
          <button
            key={id}
            onClick={() => setAba(id)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border flex items-center gap-1.5 ${
              aba === id
                ? 'bg-acao/15 border-acao/40 text-acao-200'
                : 'bg-grafite-700 border-linha text-texto-suave hover:text-texto hover:border-linha-forte'
            }`}
          >
            <Icon size={13} /> {rotulo}
          </button>
        ))}
      </div>

      {erro && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-falha/10 border border-falha/30 text-falha-400 text-xs">
          <AlertCircle size={14} className="shrink-0" /> {erro}
        </div>
      )}

      {aba === 'configuracao' && ehSupervisor ? (
        <Configuracao />
      ) : aba === 'historico' ? (
        carregando ? (
          <div className="glass-panel border border-linha rounded-2xl py-14 grid place-items-center">
            <Loader2 size={22} className="animate-spin text-acao" />
          </div>
        ) : (
          // A MESMA lista da outra aba: o recorte por perfil já veio pronto do
          // servidor, e uma segunda consulta seria um segundo lugar onde ele
          // poderia sair diferente.
          <Historico lista={lista} mostrarTecnico={ehSupervisor} onVer={setVendo} />
        )
      ) : (
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
                    {/* O MESMO número que pontua: o maior entre as fotos
                        anexadas e as que estão dentro do PDF. Mostrar só as
                        anexadas escreveria "0" num relatório com duas fotos,
                        e a pessoa iria anexar de novo o que já entregou. */}
                    <span className="flex items-center gap-1" title="Fotos que contam na pontuação">
                      <Camera size={10} /> {(m.evidencias || 0) + (m.arquivo?.fotos || 0)}
                    </span>
                  </div>
                  {m.observacaoValidacao && (
                    <p className="text-[11px] text-espera-400 mt-1 flex items-start gap-1">
                      <AlertCircle size={11} className="shrink-0 mt-0.5" />
                      {m.validadoPorNome}: {m.observacaoValidacao}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                  {/* VER abre tudo que foi enviado -- inclusive as fotos
                      avulsas e o que foi digitado à mão, que antes ficavam
                      gravados sem nenhum caminho até eles. */}
                  <button onClick={() => setVendo(m.id)}
                    className="px-2.5 py-1.5 rounded-lg bg-grafite-700 border border-linha text-texto-suave hover:text-texto text-[11px] font-semibold">
                    Ver
                  </button>
                  {m.status !== 'aprovado' && m.tecnicoId === usuario?.id && (
                    <button onClick={() => abrirEdicao(m)}
                      className="px-2.5 py-1.5 rounded-lg bg-grafite-700 border border-linha text-texto-suave hover:text-texto text-[11px] font-semibold">
                      Editar
                    </button>
                  )}
                  {/* SÓ DEVOLVER -- não há mais aprovar.
                      Entregar virou o fim do caminho: o relatório vai para o
                      cliente, e o supervisor aponta problema quando há. Um
                      "aprovar" clicado sem leitura não validava nada, e ainda
                      segurava a pontuação de quem já tinha entregado. */}
                  {ehSupervisor && m.status !== 'rascunho' && (
                    <button onClick={() => devolver(m)}
                      className="px-2.5 py-1.5 rounded-lg bg-espera/15 border border-espera/30 text-espera-400 text-[11px] font-bold flex items-center gap-1">
                      <RotateCcw size={12} /> Devolver
                    </button>
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
      )}

      {vendo && regras && (
        <ModalDetalhe
          id={vendo}
          itensRegra={regras.itens}
          onFechar={() => setVendo(null)}
          podeEditar={lista.find((x) => x.id === vendo)?.tecnicoId === usuario?.id}
          onEditar={(m) => { setVendo(null); abrirEdicao(m); }}
        />
      )}

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
