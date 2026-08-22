/**
 * Registro de Conversas log das conversas para a Visão Geral.
 *
 * É montado no cliente a partir das conversas que o painel já carrega (com as
 * mensagens), então não há endpoint próprio. Permite filtrar, exportar a lista
 * em CSV e baixar a transcrição completa de cada conversa em .txt.
 */
import { useState, useMemo } from 'react';
import { Search, Download, FileText } from 'lucide-react';
import { exportarTranscricaoPdf } from '../../utils/exportarPdf';

function fmtData(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
}

// Mesmo "protocolo" curto que a Central mostra (#408619D2): tira os hifens,
// pega os 8 primeiros e passa pra maiusculo. O UUID completo fica no tooltip
// (e no CSV/PDF) para rastreio.
function idCurto(id) {
  return String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase();
}

const STATUS = {
  pendente: { label: 'Na fila', cls: 'bg-espera/15 text-espera-400 border-espera/30' },
  aberta: { label: 'Em atendimento', cls: 'bg-ativo/15 text-ativo-400 border-ativo/30' },
  fechada: { label: 'Fechada', cls: 'bg-slate-500/15 text-slate-300 border-slate-500/30' },
};

// Normaliza para comparar palavra-chave (minusculo, sem acento).
function semAcento(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Mesmas palavras-chave do badge da Central: o que o cliente escreveu revela o
// setor. `explicito` (ele nomeou o setor) vale mais que `assunto` (deduzido).
const GATILHOS_SETOR = [
  {
    setor: 'Técnico',
    explicito: ['tecnico', 'tecnica'],
    assunto: [
      'nao funciona', 'nao esta funcionando', 'parou de funcionar', 'deu erro',
      'erro no', 'travou', 'travando', 'lento', 'sem sinal', 'sem internet',
      'sem conexao', 'configurar', 'configuracao', 'instalacao', 'instalar',
      'manutencao', 'defeito', 'suporte',
    ],
  },
  {
    setor: 'Financeiro',
    explicito: ['financeiro', 'financeira'],
    assunto: [
      'boleto', 'fatura', 'segunda via', '2 via', 'pagamento', 'pagar',
      'cobranca', 'cobrado', 'mensalidade', 'nota fiscal', 'pix', 'estorno',
      'reembolso', 'vencimento', 'em atraso', 'debito',
    ],
  },
  {
    setor: 'Comercial',
    explicito: ['comercial', 'vendas', 'vendedor'],
    assunto: [
      'orcamento', 'proposta', 'contratar', 'quanto custa', 'preco', 'valor',
      'plano', 'assinar', 'upgrade', 'revenda', 'parceria', 'tabela de preco',
    ],
  },
];

const SETORES_CONHECIDOS = ['Financeiro', 'Técnico', 'Comercial'];

// Setor "efetivo" mostrado no Registro: o que o CLIENTE escolheu.
//   1) se a conversa ja tem um setor especifico gravado, usa ele;
//   2) senao, deduz pelo que o cliente escreveu (explicito > assunto), lendo
//      da fala mais recente para a mais antiga;
//   3) senao, "Geral".
function setorEfetivo(c) {
  if (SETORES_CONHECIDOS.includes(c.setor)) return c.setor;

  const falas = (c.mensagens || [])
    .filter((m) => m.de === 'cliente' && m.texto)
    .map((m) => semAcento(m.texto))
    .reverse();

  for (const t of falas) {
    const achou = GATILHOS_SETOR.find((g) => g.explicito.some((p) => t.includes(p)));
    if (achou) return achou.setor;
  }
  for (const t of falas) {
    const achou = GATILHOS_SETOR.find((g) => g.assunto.some((p) => t.includes(p)));
    if (achou) return achou.setor;
  }
  return 'Geral';
}

function baixar(nome, conteudo, tipo = 'text/plain;charset=utf-8;') {
  const blob = new Blob(['﻿' + conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

export default function RegistroConversas({ conversas = [], equipe = [] }) {
  const [busca, setBusca] = useState('');
  const [status, setStatus] = useState('');
  const [setor, setSetor] = useState('');
  const [atendente, setAtendente] = useState('');
  const [periodo, setPeriodo] = useState('tudo'); // '7' | '30' | 'tudo'

  const nomePorId = useMemo(
    () => Object.fromEntries((equipe || []).map((m) => [m.id, m.nome])),
    [equipe]
  );
  // Quem atendeu a conversa: prioriza o nome que o servidor ja manda
  // (atendenteNome), com o mapa da equipe como reserva. Vazio = sem atendente.
  const atendenteDe = (c) => c.atendenteNome || nomePorId[c.atendenteId] || '';
  const setores = useMemo(
    () => Array.from(new Set(conversas.map(setorEfetivo))).sort(),
    [conversas]
  );
  const atendentes = useMemo(
    () => Array.from(new Set(conversas.map(atendenteDe).filter(Boolean))).sort(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversas, nomePorId]
  );

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const agora = Date.now();
    const limite = periodo === '7' ? 7 * 86400000 : periodo === '30' ? 30 * 86400000 : null;
    return conversas
      .filter((c) => {
        if (status && c.statusAtendimento !== status) return false;
        if (setor && setorEfetivo(c) !== setor) return false;
        if (atendente && atendenteDe(c) !== atendente) return false;
        if (limite != null) {
          const base = c.criadoEm || c.ultimaMensagemEm;
          if (!base || agora - new Date(base).getTime() > limite) return false;
        }
        if (termo) {
          const alvo = `${c.cliente || ''} ${c.telefone || ''}`.toLowerCase();
          if (!alvo.includes(termo)) return false;
        }
        return true;
      })
      .sort(
        (a, b) =>
          new Date(b.criadoEm || b.ultimaMensagemEm || 0) -
          new Date(a.criadoEm || a.ultimaMensagemEm || 0)
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversas, busca, status, setor, atendente, periodo]);

  function exportarCsv() {
    const linhas = [
      ['OS', 'ID', 'Cliente', 'Telefone', 'Setor', 'Status', 'Início', 'Fim', 'Mensagens', 'Avaliação', 'Atendente'],
      ...filtradas.map((c) => [
        c.ticket || '',
        c.id || '',
        c.cliente || '',
        c.telefone || '',
        setorEfetivo(c),
        STATUS[c.statusAtendimento]?.label || c.statusAtendimento || '',
        fmtData(c.criadoEm),
        fmtData(c.fechadoEm),
        (c.mensagens || []).length,
        c.avaliacao || '',
        atendenteDe(c) || '',
      ]),
    ];
    const csv = linhas
      .map((r) => r.map((v) => String(v).replace(/[\r\n;]+/g, ' ')).join(';'))
      .join('\n');
    baixar(`registro-conversas-${Date.now()}.csv`, csv, 'text/csv;charset=utf-8;');
  }

  // Baixa a transcricao da conversa em PDF (antes era .txt). Inclui o ID da
  // conversa no cabecalho do documento.
  function baixarTranscricao(c) {
    return exportarTranscricaoPdf({ ...c, setor: setorEfetivo(c) }, {
      atendente: atendenteDe(c) || '-',
      statusLabel: STATUS[c.statusAtendimento]?.label || c.statusAtendimento || '',
    });
  }

  const selectCls =
    'bg-grafite-700 border border-linha rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-acao/50';

  return (
    <div className="space-y-4">
      {/* Filtros + export */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-2.5 text-slate-500" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Cliente ou telefone..."
              className="bg-grafite-700 border border-linha rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-acao/50 w-52"
            />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls}>
            <option value="">Todos os status</option>
            <option value="pendente">Na fila</option>
            <option value="aberta">Em atendimento</option>
            <option value="fechada">Fechadas</option>
          </select>
          <select value={setor} onChange={(e) => setSetor(e.target.value)} className={selectCls}>
            <option value="">Todos os setores</option>
            {setores.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={atendente} onChange={(e) => setAtendente(e.target.value)} className={selectCls}>
            <option value="">Todos os atendentes</option>
            {atendentes.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={periodo} onChange={(e) => setPeriodo(e.target.value)} className={selectCls}>
            <option value="tudo">Todo o período</option>
            <option value="7">Últimos 7 dias</option>
            <option value="30">Últimos 30 dias</option>
          </select>
        </div>

        <button
          onClick={exportarCsv}
          disabled={filtradas.length === 0}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-acao/10 hover:bg-acao/20 text-acao-200 text-xs font-semibold border border-acao/30 transition-all shrink-0 disabled:opacity-50">
          <Download size={14} /> Exportar CSV ({filtradas.length})
        </button>
      </div>

      {/* Tabela */}
      <div className="glass-panel rounded-2xl border border-linha overflow-hidden">
        {filtradas.length === 0 ? (
          <div className="text-center text-xs text-slate-400 py-12">
            Nenhuma conversa para os filtros selecionados.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-linha text-slate-400 bg-grafite-700/40">
                  <th className="text-left py-2.5 px-3 font-semibold">OS</th>
                  <th className="text-left py-2.5 px-3 font-semibold">Cliente</th>
                  <th className="text-left py-2.5 px-3 font-semibold">Telefone</th>
                  <th className="text-left py-2.5 px-3 font-semibold">Setor</th>
                  <th className="text-left py-2.5 px-3 font-semibold">Atendente</th>
                  <th className="text-left py-2.5 px-3 font-semibold">Status</th>
                  <th className="text-left py-2.5 px-3 font-semibold">Início</th>
                  <th className="text-left py-2.5 px-3 font-semibold">Fim</th>
                  <th className="text-center py-2.5 px-3 font-semibold">Msgs</th>
                  <th className="text-center py-2.5 px-3 font-semibold">Nota</th>
                  <th className="text-right py-2.5 px-3 font-semibold">Transcrição</th>
                </tr>
              </thead>
              <tbody>
                {filtradas.slice(0, 200).map((c) => {
                  const st = STATUS[c.statusAtendimento] || { label: c.statusAtendimento, cls: 'bg-slate-500/15 text-slate-300 border-slate-500/30' };
                  return (
                    <tr key={c.id} className="border-b border-linha/40 hover:bg-grafite-600/40 transition-colors">
                      <td className="py-2.5 px-3 text-acao-200 font-mono font-bold text-[11px] whitespace-nowrap" title={c.id}>#{c.ticket || idCurto(c.id)}</td>
                      <td className="py-2.5 px-3 text-white font-semibold whitespace-nowrap">{c.cliente || '-'}</td>
                      <td className="py-2.5 px-3 text-slate-400 font-mono whitespace-nowrap">{c.telefone || '-'}</td>
                      <td className="py-2.5 px-3 text-slate-300">{setorEfetivo(c)}</td>
                      <td className="py-2.5 px-3 text-slate-300 whitespace-nowrap">{atendenteDe(c) || '-'}</td>
                      <td className="py-2.5 px-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${st.cls}`}>{st.label}</span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-400 whitespace-nowrap">{fmtData(c.criadoEm)}</td>
                      <td className="py-2.5 px-3 text-slate-400 whitespace-nowrap">{fmtData(c.fechadoEm)}</td>
                      <td className="py-2.5 px-3 text-center text-slate-300">{(c.mensagens || []).length}</td>
                      <td className="py-2.5 px-3 text-center">{c.avaliacao ? `${c.avaliacao}★` : '-'}</td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          onClick={() => baixarTranscricao(c)}
                          title="Baixar transcrição (PDF)"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-grafite-700 border border-linha text-slate-300 hover:text-acao-200 hover:border-acao/30 text-[10px] font-semibold transition-all">
                          <FileText size={11} /> Baixar PDF
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {filtradas.length > 200 && (
        <p className="text-[10px] text-slate-500 text-center">
          Mostrando as 200 conversas mais recentes. Refine os filtros ou use o CSV para o log completo.
        </p>
      )}
    </div>
  );
}
