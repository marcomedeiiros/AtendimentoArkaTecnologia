/**
 * Paginação de tabela o estado e o rodapé, numa casa só.
 *
 * Nasceu na tabela de Feedbacks (Visão Geral) e o Registro de Conversas pediu a
 * mesma coisa. Copiar as ~50 linhas para lá criaria duas paginações que
 * envelheceriam separadas: a correção de uma borda (página que aponta para
 * depois do fim, filtro que muda o total) seria feita num lugar e esquecida no
 * outro. É o mesmo caso do `utils/imagem`, que a auditoria de 14/09 pegou com a
 * casa construída e ninguém morando dentro.
 */
import { useState, useEffect, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export const TAMANHOS_PAGINA = [10, 30, 50, 100];

/**
 * Recorta uma lista em páginas.
 *
 * `chaveDosFiltros` é qualquer valor que mude quando o recorte muda (uma string
 * juntando os filtros serve). Quando ele muda, a lista volta para a primeira
 * página: ficar na página 7 de um recorte que agora tem 2 mostraria uma tabela
 * vazia, e a pessoa leria isso como "nenhum resultado" tendo resultados de sobra.
 *
 * A página é DERIVADA, e não guardada: o total é recalculado a cada render e a
 * página fica presa dentro dele. As listas aqui chegam por SSE e mudam sozinhas
 * sem isso, uma linha nova entrando deixaria o índice apontando para depois do
 * fim, e a tabela ficaria em branco por causa de um número velho.
 */
export function usePaginacao(itens, { chaveDosFiltros = '', tamanhoInicial = TAMANHOS_PAGINA[0] } = {}) {
  const [porPagina, setPorPagina] = useState(tamanhoInicial);
  const [paginaPedida, setPaginaPedida] = useState(1);

  useEffect(() => {
    setPaginaPedida(1);
  }, [chaveDosFiltros, porPagina]);

  const total = itens.length;
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
  const pagina = Math.min(paginaPedida, totalPaginas);
  const inicio = (pagina - 1) * porPagina;
  const visiveis = useMemo(
    () => itens.slice(inicio, inicio + porPagina),
    [itens, inicio, porPagina]
  );

  return {
    visiveis,
    total,
    pagina,
    totalPaginas,
    inicio,
    porPagina,
    setPorPagina,
    // `Math.min(p, totalPaginas)` antes de andar: a página pedida pode estar
    // além do fim (a lista encolheu), e "Anterior" a partir dali tem de voltar
    // do fim real, não do número velho.
    anterior: () => setPaginaPedida((p) => Math.max(1, Math.min(p, totalPaginas) - 1)),
    proxima: () => setPaginaPedida((p) => Math.min(totalPaginas, Math.min(p, totalPaginas) + 1)),
  };
}

/**
 * O rodapé: onde a lista está, à esquerda; por onde andar, à direita.
 *
 * Sem os números, Anterior e Próximo viram dois botões cegos dá para andar,
 * mas não para saber onde se está nem quanto falta. Nas pontas eles desabilitam
 * em vez de aceitar o clique e não fazer nada.
 */
export default function Paginacao({ estado, rotulo = 'itens' }) {
  const { total, pagina, totalPaginas, inicio, visiveis, porPagina, setPorPagina, anterior, proxima } = estado;
  if (total === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-center sm:justify-between gap-3 pt-4">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-slate-500">
          {inicio + 1}–{inicio + visiveis.length} de {total}
        </span>
        <select
          value={porPagina}
          onChange={(e) => setPorPagina(Number(e.target.value))}
          title={`Quantos ${rotulo} por página`}
          className="bg-grafite-700 border border-linha rounded-xl px-2 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-acao/50">
          {TAMANHOS_PAGINA.map((n) => (
            <option key={n} value={n}>{n} por página</option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={anterior}
          disabled={pagina <= 1}
          className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[11px] font-semibold bg-grafite-700 border border-linha text-slate-200 hover:border-acao/50 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-linha disabled:hover:text-slate-200">
          <ChevronLeft size={12} /> Anterior
        </button>
        <span className="text-[11px] text-slate-400 font-mono px-1">
          {pagina} / {totalPaginas}
        </span>
        <button
          onClick={proxima}
          disabled={pagina >= totalPaginas}
          className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[11px] font-semibold bg-grafite-700 border border-linha text-slate-200 hover:border-acao/50 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-linha disabled:hover:text-slate-200">
          Próximo <ChevronRight size={12} />
        </button>
      </div>
    </div>
  );
}
