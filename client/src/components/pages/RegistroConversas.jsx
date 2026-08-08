/**
 * Registro de Conversas log das conversas para a Visão Geral.
 *
 * É montado no cliente a partir das conversas que o painel já carrega (com as
 * mensagens), então não há endpoint próprio. Permite filtrar, exportar a lista
 * em CSV e baixar a transcrição completa de cada conversa em .txt.
 */
import { useState, useMemo } from 'react';
import { Search, Download, FileText } from 'lucide-react';

function fmtData(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

const STATUS = {
  pendente: { label: 'Na fila', cls: 'bg-espera/15 text-espera-400 border-espera/30' },
  aberta: { label: 'Em atendimento', cls: 'bg-ativo/15 text-ativo-400 border-ativo/30' },
  fechada: { label: 'Fechada', cls: 'bg-slate-500/15 text-slate-300 border-slate-500/30' },
};

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
  const [periodo, setPeriodo] = useState('tudo'); // '7' | '30' | 'tudo'

  const nomePorId = useMemo(
    () => Object.fromEntries((equipe || []).map((m) => [m.id, m.nome])),
    [equipe]
  );
  const setores = useMemo(
    () => Array.from(new Set(conversas.map((c) => c.setor || 'Geral'))).sort(),
    [conversas]
  );

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const agora = Date.now();
    const limite = periodo === '7' ? 7 * 86400000 : periodo === '30' ? 30 * 86400000 : null;
    return conversas
      .filter((c) => {
        if (status && c.statusAtendimento !== status) return false;
        if (setor && (c.setor || 'Geral') !== setor) return false;
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
  }, [conversas, busca, status, setor, periodo]);

  function exportarCsv() {
    const linhas = [
      ['Cliente', 'Telefone', 'Setor', 'Status', 'Início', 'Fim', 'Mensagens', 'Avaliação', 'Atendente'],
      ...filtradas.map((c) => [
        c.cliente || '',
        c.telefone || '',
        c.setor || 'Geral',
        STATUS[c.statusAtendimento]?.label || c.statusAtendimento || '',
        fmtData(c.criadoEm),
        fmtData(c.fechadoEm),
        (c.mensagens || []).length,
        c.avaliacao || '',
        nomePorId[c.atendenteId] || '',
      ]),
    ];
    const csv = linhas
      .map((r) => r.map((v) => String(v).replace(/[\r\n;]+/g, ' ')).join(';'))
      .join('\n');
    baixar(`registro-conversas-${Date.now()}.csv`, csv, 'text/csv;charset=utf-8;');
  }

  function baixarTranscricao(c) {
    const cab = [
      `Conversa com ${c.cliente || 'Cliente'} (${c.telefone || 'sem telefone'})`,
      `Setor: ${c.setor || 'Geral'} · Status: ${STATUS[c.statusAtendimento]?.label || c.statusAtendimento}`,
      `Início: ${fmtData(c.criadoEm)} · Fim: ${fmtData(c.fechadoEm)}`,
      `Atendente: ${nomePorId[c.atendenteId] || '-'}`,
      `Avaliação: ${c.avaliacao ? `${c.avaliacao}/5` : '-'}${c.feedback ? ` - ${c.feedback}` : ''}`,
      '-'.repeat(50),
      '',
    ];
    const linhas = (c.mensagens || []).map((m) => {
      const quem = m.de === 'cliente' ? (c.cliente || 'Cliente') : m.de === 'sistema' ? 'Sistema' : 'Atendente';
      return `[${m.hora || ''}] ${quem}: ${m.texto || ''}`;
    });
    const nomeArq = `conversa-${String(c.cliente || 'cliente').replace(/[^\w]+/g, '-').toLowerCase()}.txt`;
    baixar(nomeArq, cab.concat(linhas).join('\n'));
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
                  <th className="text-left py-2.5 px-3 font-semibold">Cliente</th>
                  <th className="text-left py-2.5 px-3 font-semibold">Telefone</th>
                  <th className="text-left py-2.5 px-3 font-semibold">Setor</th>
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
                      <td className="py-2.5 px-3 text-white font-semibold whitespace-nowrap">{c.cliente || '-'}</td>
                      <td className="py-2.5 px-3 text-slate-400 font-mono whitespace-nowrap">{c.telefone || '-'}</td>
                      <td className="py-2.5 px-3 text-slate-300">{c.setor || 'Geral'}</td>
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
                          title="Baixar transcrição (.txt)"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-grafite-700 border border-linha text-slate-300 hover:text-acao-200 hover:border-acao/30 text-[10px] font-semibold transition-all">
                          <FileText size={11} /> Baixar
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
