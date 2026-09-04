import { useState, useEffect, useCallback } from 'react';
import { FileText, Download, RefreshCw, Loader2, Search, AlertCircle } from 'lucide-react';
import { RelatoriosAPI } from '../../services/api';
import { exportarRelatorioEmpresaPdf } from '../../utils/exportarPdf';
import { mascararDocumento } from '../../utils/documento';

/**
 * RELATORIOS POR CLIENTE (CNPJ).
 *
 * A aba parte da lista de Clientes (CNPJ) -- todas as empresas cadastradas --
 * e nao das conversas. Uma empresa sem nenhum chamado no periodo aparece com
 * zero, e isso e informacao: e o cliente que nao precisou de suporte, ou o que
 * foi esquecido. Listar so quem teve movimento esconderia os dois casos.
 *
 * OS DADOS VEM DO SERVIDOR, e nao das props do Dashboard, ainda que ele ja
 * receba `conversas` com o historico de OS dentro. A listagem da Central e
 * FILTRADA POR SETOR para quem nao e Administrador: montar o relatorio aqui
 * faria um Tecnico gerar o PDF de uma empresa sem os chamados do Financeiro --
 * e o arquivo vai para o cliente, que nao tem como perceber a falta.
 */

const PERIODOS = [
  { id: 'dia', label: 'Hoje' },
  { id: '7dias', label: '7 dias' },
  { id: 'mes', label: 'Mês' },
  { id: 'ano', label: 'Ano' },
];

// Mesmo teto das outras tabelas do projeto (Dashboard e Registro cortam em 100
// e 200). Um cliente com milhares de OS trava a renderizacao, e a resposta
// certa e o PDF -- que nao tem teto.
const TETO_LINHAS = 100;

function fmtData(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '-' : d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

export default function RelatoriosClientes() {
  const [periodo, setPeriodo] = useState('mes');
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');
  // Qual empresa esta gerando PDF agora: o botao vira spinner so na linha dela,
  // e nao na tabela inteira.
  const [gerando, setGerando] = useState(null);

  const carregar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCarregando(true);
    setErro('');
    try {
      setDados(await RelatoriosAPI.clientes(periodo));
    } catch (e) {
      setErro(e?.message || 'Não foi possível carregar os relatórios.');
    } finally {
      setCarregando(false);
    }
  }, [periodo]);

  useEffect(() => { carregar(); }, [carregar]);

  const gerarPdf = async (cnpj) => {
    setGerando(cnpj);
    setErro('');
    try {
      // O DETALHE E BUSCADO NA HORA, e nao guardado da listagem: o PDF precisa
      // do extrato chamado a chamado, e carregar isso para TODAS as empresas so
      // porque uma delas talvez vire PDF seria pagar o custo do pior caso em
      // toda abertura da aba.
      const relatorio = await RelatoriosAPI.empresa(cnpj, periodo);
      await exportarRelatorioEmpresaPdf(relatorio);
    } catch (e) {
      setErro(`Não foi possível gerar o PDF: ${e?.message || 'erro desconhecido'}`);
    } finally {
      setGerando(null);
    }
  };

  const clientes = (dados?.clientes || []).filter((c) => {
    const q = busca.trim().toLowerCase();
    if (!q) return true;
    return (
      String(c.razaoSocial || '').toLowerCase().includes(q) ||
      String(c.cnpj || '').includes(q.replace(/\D/g, ''))
    );
  });

  return (
    <div className="fade-in space-y-4">
      {/* Controles */}
      <div className="glass-panel rounded-2xl p-4 border border-linha flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="flex items-center gap-1.5 shrink-0">
          {PERIODOS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPeriodo(p.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                periodo === p.id
                  ? 'bg-acao/15 border-acao/40 text-acao-200'
                  : 'bg-grafite-700 border-linha text-slate-400 hover:text-white hover:border-slate-500'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="relative flex-1 min-w-0">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar empresa ou CNPJ..."
            className="w-full bg-grafite-700 border border-linha rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-acao/50"
          />
        </div>

        {/* `() => carregar()` e nao `carregar`: passar a funcao direto entrega o
            EVENTO de clique como o argumento `silencioso`, que e um objeto
            truthy -- e o spinner nunca apareceria. */}
        <button
          onClick={() => carregar()}
          disabled={carregando}
          className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg bg-grafite-700 border border-linha text-slate-300 hover:text-white text-xs font-semibold transition-colors disabled:opacity-50"
        >
          <RefreshCw size={13} className={carregando ? 'animate-spin' : ''} /> Atualizar
        </button>
      </div>

      {dados?.periodo && (
        <p className="text-[11px] text-slate-500 px-1">
          {dados.periodo.rotulo} · {fmtData(dados.periodo.inicio)} a {fmtData(dados.periodo.fim)} ·{' '}
          <strong className="text-slate-400">{dados.totalOS}</strong> chamado(s) encerrado(s) em{' '}
          <strong className="text-slate-400">{dados.totalEmpresas}</strong> empresa(s) cadastrada(s).
        </p>
      )}

      {erro && (
        <div className="flex items-start gap-2 rounded-xl bg-falha/10 border border-falha/30 p-3 text-xs text-falha-400">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{erro}</span>
        </div>
      )}

      {/* Tabela */}
      <div className="glass-panel rounded-2xl border border-linha overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-linha text-slate-500">
                <th className="text-left font-semibold px-4 py-3">Empresa</th>
                <th className="text-left font-semibold px-4 py-3 hidden sm:table-cell">CNPJ/CPF</th>
                <th className="text-right font-semibold px-4 py-3">Chamados</th>
                <th className="text-left font-semibold px-4 py-3 hidden lg:table-cell">Principal motivo</th>
                <th className="text-right font-semibold px-4 py-3 hidden md:table-cell">Último</th>
                <th className="text-right font-semibold px-4 py-3">PDF</th>
              </tr>
            </thead>
            <tbody>
              {carregando && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                  <Loader2 size={16} className="inline animate-spin mr-2" /> Carregando...
                </td></tr>
              )}

              {!carregando && clientes.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                  {busca.trim()
                    ? 'Nenhuma empresa encontrada com esse termo.'
                    : 'Nenhuma empresa cadastrada em Clientes (CNPJ).'}
                </td></tr>
              )}

              {!carregando && clientes.slice(0, TETO_LINHAS).map((c) => (
                <tr key={c.cnpj} className="border-b border-linha/50 hover:bg-slate-800/30 transition-colors">
                  <td className="px-4 py-3 font-semibold text-slate-200">{c.razaoSocial}</td>
                  <td className="px-4 py-3 font-mono text-slate-500 hidden sm:table-cell">
                    {mascararDocumento(c.cnpj)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {/* Zero fica APAGADO, e nao escondido: "esta empresa nao
                        abriu chamado no periodo" e um fato do relatorio. */}
                    <span className={c.totalOS > 0 ? 'font-bold text-acao-200' : 'text-slate-600'}>
                      {c.totalOS}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400 hidden lg:table-cell">
                    {c.porMotivo?.[0]
                      ? `${c.porMotivo[0].nome} (${c.porMotivo[0].total})`
                      : <span className="text-slate-600">-</span>}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-500 hidden md:table-cell">
                    {c.ultimoFechamento ? fmtData(c.ultimoFechamento) : '-'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => gerarPdf(c.cnpj)}
                      disabled={gerando === c.cnpj}
                      title={c.totalOS === 0
                        ? 'Gera o PDF mesmo sem chamados: serve como comprovante de período sem ocorrências'
                        : `Gerar o relatório de ${c.razaoSocial}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-acao/10 hover:bg-acao/20 text-acao-200 border border-acao/30 text-[11px] font-semibold transition-all disabled:opacity-50"
                    >
                      {gerando === c.cnpj
                        ? <Loader2 size={12} className="animate-spin" />
                        : <Download size={12} />}
                      PDF
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {clientes.length > TETO_LINHAS && (
          <p className="px-4 py-3 text-[11px] text-slate-500 border-t border-linha">
            Mostrando as {TETO_LINHAS} primeiras de {clientes.length} empresas. Use a busca para
            encontrar uma específica.
          </p>
        )}
      </div>

      <p className="flex items-start gap-2 text-[11px] text-slate-500 px-1">
        <FileText size={13} className="shrink-0 mt-0.5" />
        <span>
          O relatório considera os chamados <strong className="text-slate-400">encerrados</strong> dentro
          do período, com o motivo escolhido no fechamento. Um chamado aberto em um mês e encerrado no
          seguinte entra no relatório do mês em que foi encerrado.
        </span>
      </p>
    </div>
  );
}
