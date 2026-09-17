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
  Clock, Building2, X, Save, Send, Trash2, FileText,
  ArrowLeft, SlidersHorizontal, Trophy,
} from 'lucide-react';
import { RankingsAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { avisar, confirmar, pedirTexto } from '../../utils/dialogo';
import Portal from '../Portal';
import { FUSO_BR } from '../../utils/data';
import { ehDaEquipeExterna } from '../../utils/equipeRanking';
import { montarDocumentoMapeamento, nomeArquivoMapeamento } from '../../utils/documentoMapeamento';
// O `jspdf` continua chegando so no primeiro PDF: quem importa a biblioteca e o
// proprio `exportarPdf`, por dentro (ver `libs()`).
import { gerarMapeamentoPdf } from '../../utils/exportarPdf';

// A MARCA, no mesmo arquivo que o login e o Modo TV usam. Ela aparece duas
// vezes na folha: pequena no cabeçalho (o remetente do documento) e grande,
// quase transparente, atrás do texto.
const LOGO_ARKA = '/arka_tecnologia_logo-removebg-preview.png';

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
  if (!bytes) return '-';
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
  if (!iso) return '-';
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
                    <p className="text-[11px] text-texto-fraco">Ainda sem PDF: ele é gerado ao salvar o relatório.</p>
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

/**
 * A FOLHA -- o relatório como o cliente vai receber, ao vivo.
 *
 * ── POR QUE ELA É BRANCA NA MARRA ──────────────────────────────────────────
 *
 * `bg-white` aqui NÃO daria branco: neste projeto `--c-white` vale 17 27 33 no
 * tema claro (index.css), então a classe entrega quase-preto. E mesmo que
 * desse, o papel não acompanha o tema de quem digita -- o PDF é o mesmo
 * documento para quem está no escuro e para quem está no claro. Por isso as
 * cores desta folha são hexadecimais literais, e são as mesmas da paleta do
 * PDF (exportarPdf.js).
 *
 * ── E POR QUE ELA MOSTRA O QUE AINDA ESTÁ VAZIO ────────────────────────────
 *
 * Seção sem conteúdo aparece como espaço reservado, em cinza claro: é isso que
 * diz à pessoa o que falta escrever ANTES de entregar. No PDF ela não entra --
 * ninguém manda para a validação um título com nada embaixo.
 */
const TINTA_FOLHA = '#111b21';
const TINTA_SUAVE_FOLHA = '#54666e';
const MARCA_FOLHA = '#017561';
const LINHA_FOLHA = '#d1d7db';

function FolhaRelatorio({ documento }) {
  return (
    <div
      className="relative mx-auto w-full max-w-[52rem] rounded-xl shadow-2xl overflow-hidden"
      style={{ backgroundColor: '#ffffff', color: TINTA_FOLHA, aspectRatio: 'auto' }}
    >
      {/* A MARCA D'ÁGUA, grande e atrás de tudo. `pointer-events-none` porque
          ela é papel, não conteúdo: não pode roubar o clique de nada. */}
      <img
        src={LOGO_ARKA}
        alt=""
        aria-hidden="true"
        className="pointer-events-none select-none absolute left-1/2 top-1/2 w-[55%] -translate-x-1/2 -translate-y-1/2 opacity-[0.07]"
      />

      <div className="relative p-6 sm:p-9">
        {/* Cabeçalho: a marca, o título e a régua dupla -- o mesmo topo do PDF. */}
        <div className="flex items-start gap-4">
          <img src={LOGO_ARKA} alt="Arka Tecnologia" className="w-16 shrink-0 object-contain" />
          <div className="min-w-0">
            <p className="text-[15px] font-bold leading-tight" style={{ color: TINTA_FOLHA }}>
              {documento.titulo}
            </p>
            <p className="text-[11px] mt-0.5" style={{ color: TINTA_SUAVE_FOLHA }}>
              {documento.subtitulo}
            </p>
          </div>
        </div>
        <div className="mt-3" style={{ borderTop: `2px solid ${MARCA_FOLHA}` }} />
        <div className="mt-[2px]" style={{ borderTop: `1px solid ${LINHA_FOLHA}` }} />

        {/* Identificação */}
        <div className="mt-5 space-y-1">
          {documento.identificacao.map(({ rotulo, valor, vazia }) => (
            <p key={rotulo} className="text-[12px] flex gap-2">
              <span className="font-bold shrink-0 w-36" style={{ color: TINTA_FOLHA }}>{rotulo}:</span>
              <span className="min-w-0" style={{ color: vazia ? '#9aa6ad' : TINTA_SUAVE_FOLHA }}>{valor}</span>
            </p>
          ))}
        </div>

        {/* As seções, na mesma ordem do PDF */}
        <div className="mt-6 space-y-5">
          {documento.secoes.map((secao) => (
            <div key={secao.id}>
              <p className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: MARCA_FOLHA }}>
                {secao.titulo}
              </p>

              {secao.vazia ? (
                <p className="mt-1.5 text-[12px] italic" style={{ color: '#9aa6ad' }}>
                  {secao.espera} <span className="not-italic">(não entra no PDF enquanto estiver vazio)</span>
                </p>
              ) : secao.tipo === 'texto' ? (
                <p className="mt-1.5 text-[12.5px] leading-relaxed whitespace-pre-wrap" style={{ color: TINTA_FOLHA }}>
                  {secao.texto}
                </p>
              ) : secao.tipo === 'itens' ? (
                <div className="mt-1.5">
                  {secao.itens.map((item) => (
                    <div key={item.chave} className="py-2" style={{ borderBottom: `1px solid ${LINHA_FOLHA}` }}>
                      <p className="text-[9.5px] font-bold uppercase tracking-[0.1em]" style={{ color: MARCA_FOLHA }}>
                        {item.rotulo}
                      </p>
                      <p className="mt-0.5 text-[12.5px] leading-relaxed whitespace-pre-wrap pl-1.5" style={{ color: TINTA_FOLHA }}>
                        {item.texto}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                // A MESMA FILEIRA DO PDF, aproximada: lá o número de colunas
                // sai do espaço que sobrou na folha (poucas fotos ficam em duas
                // colunas, grandes; muitas, em três). Aqui não há folha para
                // medir, então vale a regra simples -- até quatro fotos, duas
                // colunas. O que a prévia promete é o CONTEÚDO; a fileira pode
                // sair de outro tamanho quando a página estiver apertada.
                <div className={`mt-2 grid gap-1.5 ${secao.fotos.length <= 4 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                  {secao.fotos.map((src, i) => (
                    <img key={i} src={src} alt={`Evidência ${i + 1}`}
                      className="w-full max-h-28 object-contain rounded"
                      style={{ border: `1px solid ${LINHA_FOLHA}` }} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <p className="mt-8 pt-2 text-[9.5px]" style={{ borderTop: `1px solid ${LINHA_FOLHA}`, color: TINTA_SUAVE_FOLHA }}>
          {documento.legenda}
        </p>
      </div>
    </div>
  );
}

/**
 * O EDITOR DO MAPEAMENTO -- formulário de um lado, o PDF do outro.
 *
 * ── O QUE MUDOU, E POR QUÊ ─────────────────────────────────────────────────
 *
 * Isto era um pop-up com um campo de anexar PDF no topo. O relatório era feito
 * FORA da plataforma, subia como arquivo, e o servidor tentava LER o arquivo
 * para descobrir o que havia dentro. Duas consequências: cada técnico entregava
 * um documento com uma cara, e a nota media o quanto o extrator entendeu do
 * layout de cada um -- um PDF ilegível derrubava a completude de quem tinha
 * feito a visita inteira.
 *
 * Agora o relatório é MONTADO aqui. O que se digita à esquerda aparece na folha
 * à direita, e é essa folha que vira o PDF ao salvar. Não há mais upload, não
 * há mais leitura para dar errado, e o supervisor recebe sempre o mesmo
 * documento -- este relatório é a entrega INTERNA da visita, e é por ele que a
 * validação acontece.
 *
 * ── POR QUE TELA CHEIA, E NÃO O POP-UP DE ANTES ────────────────────────────
 *
 * Preview e formulário lado a lado precisam de largura. Num modal centralizado
 * sobraria meia tela para cada, e a folha -- que tem proporção de papel --
 * ficaria pequena demais para se ler o que está sendo escrito. O pop-up também
 * obrigava a fechar tudo para consultar a lista, e escrever relatório é tarefa
 * longa: agora é uma tela, com volta explícita.
 */
function EditorMapeamento({ itensRegra, minimoResumo, inicial, tecnicoNome, onFechar, onSalvo }) {
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
  // As empresas sugeridas para o campo de cima, e se a lista esta aberta.
  const [sugestoes, setSugestoes] = useState([]);
  const [buscando, setBuscando] = useState(false);

  /**
   * BUSCA A EMPRESA NO CADASTRO enquanto se digita -- com freio.
   *
   * O atraso de 250ms nao e enfeite: sem ele, "Costa Camargo" dispara treze
   * consultas, doze delas jogadas fora, e a lista pisca a cada tecla. O
   * `cancelado` descarta a resposta que chega depois de a busca ter mudado --
   * senao a resposta lenta de "cos" sobrescreveria a de "costa camargo".
   *
   * Falha e silenciosa de proposito: sem cadastro, sem rede ou sem permissao,
   * o campo continua sendo um campo de texto comum. Autocompletar e atalho, e
   * atalho que quebra nao pode impedir de lancar o relatorio.
   */
  useEffect(() => {
    const q = empresa.trim();
    if (!buscando || q.length < 2) { setSugestoes([]); return; }
    let cancelado = false;
    const t = setTimeout(() => {
      RankingsAPI.buscarEmpresasMapeamento(q)
        .then((r) => { if (!cancelado) setSugestoes(Array.isArray(r) ? r : []); })
        .catch(() => { if (!cancelado) setSugestoes([]); });
    }, 250);
    return () => { cancelado = true; clearTimeout(t); };
  }, [empresa, buscando]);

  /**
   * COMO VER UMA EVIDÊNCIA QUE JÁ ESTÁ NO SERVIDOR.
   *
   * A foto recém-anexada é uma data URL, e se desenha sozinha. A que já estava
   * gravada é só uma referência (`{ arquivo: "..." }`) -- o caminho em disco
   * nunca chega ao navegador. Ela abre pela rota por ÍNDICE, e o índice é o da
   * ordem em que o servidor guardou.
   *
   * Por isso o mapa é montado UMA VEZ, na abertura: remover uma foto reordena a
   * lista da tela, e recalcular o índice depois disso mostraria a foto errada.
   */
  const [urlSalva] = useState(() => {
    const mapa = new Map();
    (inicial?.arquivos || []).forEach((ev, i) => {
      if (ev && typeof ev === 'object') mapa.set(ev, RankingsAPI.urlEvidenciaMapeamento(inicial.id, i));
    });
    return mapa;
  });
  const fotos = useMemo(
    () => evidencias.map((ev) => (typeof ev === 'string' ? ev : urlSalva.get(ev))).filter(Boolean),
    [evidencias, urlSalva]
  );

  // A MESMA conta do servidor: itens preenchidos + resumo com o mínimo de
  // caracteres, sobre o total. Espelhada aqui para o número aparecer enquanto
  // se digita -- se as duas divergirem, a do servidor é a que vale.
  //
  // Sem PDF lido, ela voltou a ser o que sempre foi: o que a pessoa escreveu.
  const completude = useMemo(() => {
    const cobertos = itensRegra.filter((i) => String(itens[i.chave] || '').trim()).length;
    const minimo = minimoResumo ?? 20;
    return Math.round(((cobertos + (resumo.trim().length >= minimo ? 1 : 0)) / (itensRegra.length + 1)) * 100);
  }, [itens, resumo, itensRegra, minimoResumo]);

  const dentroDoPrazo = useMemo(() => hojeISO() <= prazoEm, [prazoEm]);

  // A DESCRIÇÃO DO DOCUMENTO, que a folha desenha e o PDF desenha.
  const documento = useMemo(
    () => montarDocumentoMapeamento(
      { empresa, cnpj, dataVisita, prazoEm, resumo, itens, pendencias, tecnicoNome, evidencias: fotos },
      itensRegra
    ),
    [empresa, cnpj, dataVisita, prazoEm, resumo, itens, pendencias, tecnicoNome, fotos, itensRegra]
  );

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
   * SALVAR -- e, junto, gerar o PDF.
   *
   * O arquivo é montado A CADA salvamento, da mesma descrição que está na tela:
   * o PDF guardado nunca fica descrevendo uma versão anterior do relatório, que
   * é o que aconteceria se ele só fosse gerado na entrega.
   *
   * Se a geração falhar (a biblioteca não baixou, por exemplo), o salvamento
   * segue SEM o arquivo em vez de perder o que foi digitado -- os campos são o
   * registro; o PDF é a apresentação deles.
   */
  const salvar = async (entregar) => {
    if (!empresa.trim()) { setErro('Informe a empresa visitada.'); return; }
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
    const corpo = {
      empresa: empresa.trim(),
      cnpj: cnpj.replace(/\D/g, '') || null,
      dataVisita, prazoEm, resumo, itens, pendencias, evidencias, entregar,
    };
    try {
      const pdf = await gerarMapeamentoPdf(documento, {
        nome: nomeArquivoMapeamento({ empresa, dataVisita }),
      });
      // `gerado: true` diz ao servidor que este PDF saiu daqui -- ele não tenta
      // LER o arquivo para preencher o checklist, porque o checklist é
      // justamente o que o gerou. Sem isso, o texto digitado voltaria do banco
      // trocado por "No relatório: ..." e as fotos contariam duas vezes.
      corpo.arquivo = { conteudo: pdf.conteudo, nome: pdf.nome, gerado: true };
    } catch {
      /**
       * FALHOU A GERAÇÃO -- e o que acontece depende do que se pediu.
       *
       * ENTREGAR para sem entregar nada: entrega é o documento indo para o
       * cliente, e um relatório entregue sem relatório dentro é pior que um
       * botão que não funcionou. Era isto que a opção "exigir PDF" tentava
       * garantir lá na Configuração -- com o arquivo montado aqui, a garantia
       * fica no único lugar que sabe se ele existe.
       *
       * RASCUNHO segue em frente: os campos são o registro, o PDF é a
       * apresentação deles, e perder o que foi digitado por causa de uma
       * biblioteca que não baixou seria o pior desfecho possível.
       */
      if (entregar) {
        setErro('Não consegui montar o PDF do relatório agora. Salve como rascunho e tente entregar de novo.');
        setSalvando(false);
        return;
      }
    }
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
    /* `h-full`: a area de conteudo do AppLayout ja tem altura definida e rolagem
       propria -- e dela que os dois paineis herdam o teto. Uma altura em `dvh`
       aqui ignoraria o cabecalho do painel e deixaria a barra de botoes fora da
       tela em notebook. */
    <div className="fade-in flex flex-col h-full min-h-[34rem]">
      {/* A BARRA: quem sai, e quem salva. Fica fora dos dois painéis porque vale
          para os dois -- e porque o botão de entregar não pode ficar no fim de
          um formulário que rola. */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-5 py-2.5 border-b border-linha shrink-0">
        <span className="flex items-center gap-2 font-bold text-sm text-texto min-w-0">
          <button onClick={onFechar} disabled={salvando}
            className="p-1.5 rounded-lg text-texto-fraco hover:text-texto hover:bg-grafite-700 disabled:opacity-50"
            title="Voltar para a lista">
            <ArrowLeft size={16} />
          </button>
          <ClipboardList size={16} className="text-acao-200 shrink-0" />
          <span className="truncate">{edicao ? 'Editar relatório' : 'Novo relatório de visita'}</span>
        </span>
        <div className="flex items-center gap-2">
          <button onClick={() => salvar(false)} disabled={salvando}
            className="px-3 py-2 rounded-lg bg-grafite-700 border border-linha text-texto text-xs font-semibold hover:border-linha-forte disabled:opacity-50 flex items-center gap-1.5">
            {salvando ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Salvar
          </button>
          <button onClick={() => salvar(true)} disabled={salvando}
            className="px-4 py-2 rounded-lg bg-acao hover:bg-acao-200 text-slate-950 text-xs font-bold disabled:opacity-50 flex items-center gap-1.5">
            <Send size={13} /> Entregar
          </button>
        </div>
      </div>

      {/* A TELA DIVIDIDA. A linha do meio é a borda do painel direito.
          Em tela estreita não há divisão possível: o formulário vem primeiro e
          a folha fica embaixo, que é a ordem em que se usa. */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 overflow-y-auto lg:overflow-hidden">
        {/* ── ESQUERDA: o que a pessoa preenche ── */}
        <div className="p-3 sm:p-5 space-y-3 lg:overflow-y-auto">
          {/* O PLACAR AO VIVO -- o que a tela sabe sobre a pontuação antes de
              entregar, e não depois do fechamento do mês. */}
          <div className="flex flex-wrap gap-2 [&>*]:flex-1 [&>*]:min-w-[7rem]">
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
            {/* A EMPRESA SAI DO CADASTRO, e traz o CNPJ com ela. Digitar o nome
                à mão em cada visita era reescrever o que já está em Clientes --
                e cada grafia diferente ("Costa Camargo", "COSTA CAMARGO LTDA")
                virava uma empresa diferente no relatório, com o CNPJ em branco
                ou digitado errado. */}
            <div className="relative">
              <label className="text-[11px] font-semibold text-texto-suave block mb-1">Empresa visitada *</label>
              <input
                value={empresa}
                onChange={(e) => { setEmpresa(e.target.value); setBuscando(true); }}
                onFocus={() => setBuscando(true)}
                /* O clique na sugestão precisa acontecer ANTES de a lista
                   fechar. Por isso o fechamento espera um instante -- sem isso
                   o `blur` do campo apagava o item debaixo do dedo. */
                onBlur={() => setTimeout(() => setBuscando(false), 150)}
                autoComplete="off"
                className={ENTRADA}
              />
              {buscando && sugestoes.length > 0 && (
                <ul className="absolute z-20 left-0 right-0 mt-1 glass-panel border border-linha rounded-xl shadow-2xl overflow-hidden max-h-56 overflow-y-auto">
                  {sugestoes.map((s) => (
                    <li key={s.cnpj}>
                      <button
                        type="button"
                        /* `onMouseDown`, e nao `onClick`: o clique dispara
                           depois do `blur`, e aí a lista já não existe. */
                        onMouseDown={() => {
                          setEmpresa(s.razaoSocial);
                          setCnpj(s.cnpj || '');
                          setBuscando(false);
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-acao/15 transition-colors"
                      >
                        <span className="block text-[11px] font-semibold text-texto truncate">{s.razaoSocial}</span>
                        <span className="block text-[10px] text-texto-fraco font-mono">{s.cnpj}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[10px] text-texto-fraco mt-1">
                Comece a digitar: o cliente cadastrado aparece abaixo e preenche o CNPJ.
              </p>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-texto-suave block mb-1">CNPJ (opcional)</label>
              <input value={cnpj} onChange={(e) => setCnpj(e.target.value)} inputMode="numeric"
                className={`${ENTRADA} font-mono`} />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-texto-suave block mb-1">Data da visita</label>
              <input type="date" value={dataVisita}
                onChange={(e) => { setDataVisita(e.target.value); if (!edicao) setPrazoEm(prazoSugerido(e.target.value)); }}
                className={ENTRADA} />
              <p className="text-[10px] text-texto-fraco mt-1">É ela que define em qual mês o trabalho conta.</p>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-texto-suave block mb-1">Prazo de entrega</label>
              <input type="date" value={prazoEm} onChange={(e) => setPrazoEm(e.target.value)} className={ENTRADA} />
            </div>
          </div>

          <div>
            <label className="text-[11px] font-semibold text-texto-suave block mb-1">
              Resumo da visita <span className="text-texto-fraco font-normal">(conta na completude a partir de {minimoResumo ?? 20} caracteres)</span>
            </label>
            <textarea value={resumo} onChange={(e) => setResumo(e.target.value)} rows={4}
              className={`${ENTRADA} resize-none`} />
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
            <textarea value={pendencias} onChange={(e) => setPendencias(e.target.value)} rows={3}
              className={`${ENTRADA} resize-none`} />
          </div>

          <div>
            <p className="text-[11px] font-semibold text-texto-suave mb-1.5">
              Evidências <span className="text-texto-fraco font-normal">({evidencias.length}/12 · 3 já valem a faixa cheia · entram no fim do PDF)</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {evidencias.map((ev, i) => {
                const src = typeof ev === 'string' ? ev : urlSalva.get(ev);
                return (
                  <span key={i} className="relative w-16 h-16 rounded-lg border border-linha bg-grafite-700 grid place-items-center overflow-hidden">
                    {src ? <img src={src} alt="" className="w-full h-full object-cover" />
                         : <FileText size={18} className="text-texto-fraco" />}
                    <button
                      onClick={() => setEvidencias((l) => l.filter((_, j) => j !== i))}
                      className="absolute top-0.5 right-0.5 bg-slate-950/80 rounded-full p-0.5 text-falha-400"
                      title="Remover"
                    >
                      <X size={10} />
                    </button>
                  </span>
                );
              })}
              {evidencias.length < 12 && (
                <label className="w-16 h-16 rounded-lg border border-dashed border-linha-forte grid place-items-center cursor-pointer text-texto-fraco hover:text-acao-200 hover:border-acao/50 transition-colors">
                  <Camera size={18} />
                  <input type="file" accept="image/*" multiple className="hidden" onChange={anexar} />
                </label>
              )}
            </div>
          </div>
        </div>

        {/* ── DIREITA: a folha que vira o PDF ── */}
        <div className="border-t lg:border-t-0 lg:border-l border-linha-forte bg-grafite-800/40 p-3 sm:p-5 lg:overflow-y-auto">
          <p className="text-[10px] uppercase tracking-wider text-texto-fraco font-bold mb-2.5 flex items-center gap-1.5">
            <FileText size={12} /> Prévia do PDF
            <span className="font-normal normal-case tracking-normal">é este arquivo que vai para o supervisor</span>
          </p>
          <FolhaRelatorio documento={documento} />
        </div>
      </div>
    </div>
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
            dica="É o prazo de cada relatório ele decide a parcela “no prazo” da pontuação">
            <input type="number" min={1} max={90} className={ENTRADA}
              value={rascunho.prazoDias}
              onChange={(e) => mexer('prazoDias', Number(e.target.value))} />
          </Campo>
          <Campo rotulo="Vencimento mensal (dia do mês seguinte)"
            dica="Todos os relatórios de um mês precisam estar entregues até esse dia do mês seguinte No mês que não tiver esse dia, vence no último dia dele (31 = sempre no último dia) Vazio = a empresa não usa essa regra valendo as duas, vale a mais apertada">
            <input type="number" min={1} max={31} placeholder="não usar" className={ENTRADA}
              value={rascunho.vencimentoDiaDoMes ?? ''}
              onChange={(e) => mexer('vencimentoDiaDoMes', e.target.value === '' ? null : Number(e.target.value))} />
          </Campo>
        </div>
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
          <strong> meses já passados</strong> premiações já registradas continuam como estão
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
            dica="Abaixo disso, as parcelas de qualidade (completude, prazo e evidências) não contam impede que uma única visita perfeita lidere o mês">
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
          <FileText size={13} /> Checklist da visita
        </p>
        <p className="text-[10px] text-texto-fraco leading-relaxed">
          Cada linha é um campo do formulário e uma seção do PDF a ordem daqui é a ordem da folha
          as palavras ao lado valem só para os relatórios antigos, que eram lidos de um PDF
          anexado hoje o documento é montado na plataforma, e o que conta é o que o técnico
          escreve em cada item
        </p>

        {/* MEXER NO CHECKLIST MUDA O PASSADO, e isso precisa estar escrito.

            A completude é "itens preenchidos ÷ total", e nada de ranking é
            guardado: tudo é recalculado a cada consulta. Acrescentar um item
            baixa a nota de TODOS os relatórios já entregues, que não têm o
            campo novo. É o mesmo efeito dos pesos, e o aviso é o mesmo. */}
        <p className="text-[10px] text-espera-400 leading-relaxed border border-espera/30 bg-espera/10 rounded-xl p-2.5">
          Acrescentar um item <strong>baixa a completude dos relatórios já entregues</strong> eles não
          têm o campo novo, e a conta é sobre o total de itens remover faz o contrário o texto já
          escrito num item removido <strong>não é apagado</strong> ele deixa de contar, e continua lá
        </p>

        <div className="space-y-2">
          {(rascunho.itens || []).map((item, idx) => (
            <div key={item.chave || `novo-${idx}`} className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_auto] gap-2 items-start">
              <input
                className={ENTRADA}
                placeholder="Nome do item"
                value={item.rotulo || ''}
                onChange={(e) => setRascunho((r) => {
                  const itens = [...(r.itens || [])];
                  itens[idx] = { ...itens[idx], rotulo: e.target.value };
                  return { ...r, itens };
                })}
              />
              <input
                className={ENTRADA}
                placeholder="palavras que o PDF pode trazer, separadas por vírgula"
                value={(rascunho.palavras?.[item.chave] || []).join(', ')}
                onChange={(e) => setRascunho((r) => ({
                  ...r,
                  palavras: { ...r.palavras, [item.chave]: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) },
                }))}
                // Item recém-criado ainda não tem chave: ela nasce no servidor,
                // a partir do nome. Sem nome, não há onde guardar as palavras.
                disabled={!item.chave}
                title={!item.chave ? 'Salve o item primeiro: a chave dele nasce do nome.' : undefined}
              />
              <button
                onClick={() => setRascunho((r) => ({ ...r, itens: (r.itens || []).filter((_, i) => i !== idx) }))}
                className="px-2.5 py-2 rounded-xl border border-falha/40 bg-falha/10 text-falha-400 text-[11px] font-bold hover:bg-falha/20 transition-colors"
                title="Remover este item do checklist"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={() => setRascunho((r) => ({ ...r, itens: [...(r.itens || []), { chave: '', rotulo: '' }] }))}
          className="px-3 py-2 rounded-xl bg-grafite-700 border border-linha text-texto-suave text-[11px] font-bold hover:border-linha-forte flex items-center gap-1.5"
        >
          <Plus size={12} /> Adicionar item
        </button>
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

  /**
   * O EDITOR TOMA A TELA -- ele não é mais um pop-up por cima da lista.
   *
   * Escrever relatório com a folha do lado precisa da largura inteira, e a
   * lista atrás de um formulário desse tamanho não servia para nada: quem está
   * escrevendo não consulta a lista, e quem consulta a lista não está
   * escrevendo. A volta é explícita, pelo botão da barra.
   */
  if (editando && regras) {
    return (
      <EditorMapeamento
        itensRegra={regras.itens}
        minimoResumo={regras.minimoResumo}
        inicial={editando.novo ? null : editando}
        tecnicoNome={editando.novo ? usuario?.nome : editando.tecnicoNome || usuario?.nome}
        onFechar={() => setEditando(null)}
        onSalvo={() => { setEditando(null); carregar(); }}
      />
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
            item do histórico", e na configuração não faz sentido nenhum.

            NÃO É `hidden`. Ele estava aqui e nunca escondeu nada: o atributo
            vira `[hidden]{display:none}` no preflight do Tailwind, e a classe
            `flex` deste mesmo botão vira `.flex{display:flex}` -- mesma
            especificidade, e as utilities vêm DEPOIS do base no CSS gerado.
            Conferido no bundle: `[hidden]` na posição 4572, `.flex` na 10815.

            Não renderizar não tem como perder essa disputa. */}
        {aba === 'mapeamentos' && (
        <button onClick={abrirNovo}
          className="px-4 py-2 rounded-xl bg-acao hover:bg-acao-200 text-slate-950 text-xs font-bold flex items-center gap-1.5">
          <Plus size={14} /> Novo mapeamento
        </button>
        )}
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
