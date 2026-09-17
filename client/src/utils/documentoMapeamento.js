/**
 * O DOCUMENTO DO MAPEAMENTO -- uma descrição, dois desenhistas.
 *
 * ── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
 *
 * O relatório agora é MONTADO na plataforma: o técnico digita à esquerda e vê
 * a folha à direita, e é essa folha que vira o PDF entregue ao supervisor. São
 * dois renderizadores diferentes -- HTML na tela, jsPDF no arquivo -- e nada
 * garante que dois códigos que desenham "a mesma coisa" continuem desenhando a
 * mesma coisa depois do terceiro ajuste. O preview que mente é pior que não ter
 * preview: a pessoa confere na tela e quem valida recebe outro documento.
 *
 * Então o CONTEÚDO nasce aqui, uma vez: que seções existem, em que ordem, o que
 * entra em cada uma e o que está vazio. Os dois desenhistas recebem a mesma
 * lista e só decidem a aparência (fonte, cor, espaçamento). Acrescentar uma
 * seção é mexer neste arquivo -- e ela aparece nos dois lados junto.
 *
 * ── O QUE NÃO SE DECIDE AQUI ───────────────────────────────────────────────
 *
 * Nada de pontuação. A completude e a contagem de evidências continuam sendo
 * conta do servidor; este arquivo só descreve o papel.
 */
import { FUSO_BR } from './data';

/** Data pura (YYYY-MM-DD) sem passar pelo fuso -- ver o mesmo cuidado na tela. */
function dataBR(iso) {
  if (!iso) return '-';
  const puro = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (puro) return `${puro[3]}/${puro[2]}/${puro[1]}`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '-'
    : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: FUSO_BR });
}

function documento(cnpj) {
  const s = String(cnpj || '').replace(/\D/g, '');
  if (s.length === 14) return s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (s.length === 11) return s.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return s || null;
}

/**
 * MONTA A DESCRIÇÃO DO DOCUMENTO.
 *
 * `itensRegra` é o checklist EM VIGOR (vem do servidor): a ordem e os rótulos
 * do papel são os mesmos da configuração, e não uma segunda lista escrita aqui
 * que envelheceria na primeira vez que alguém mexesse nas regras.
 *
 * Seção sem conteúdo não some: ela volta marcada `vazia`. Na tela isso vira um
 * espaço reservado -- que é o que mostra à pessoa o que ainda falta escrever --
 * e no PDF ela é descartada, porque um título com nada embaixo não diz nada a
 * quem vai validar a visita.
 */
export function montarDocumentoMapeamento(dados = {}, itensRegra = []) {
  const {
    empresa, cnpj, dataVisita, prazoEm, resumo, itens = {},
    pendencias, tecnicoNome, evidencias = [],
  } = dados;

  const identificacao = [
    ['Empresa', String(empresa || '').trim() || null],
    ['CNPJ', documento(cnpj)],
    ['Data da visita', dataVisita ? dataBR(dataVisita) : null],
    ['Prazo de entrega', prazoEm ? dataBR(prazoEm) : null],
    ['Técnico responsável', tecnicoNome || null],
  ].map(([rotulo, valor]) => ({ rotulo, valor: valor || '-', vazia: !valor }));

  const doChecklist = (itensRegra || []).map((i) => ({
    chave: i.chave,
    rotulo: i.rotulo,
    texto: String(itens?.[i.chave] || '').trim(),
  }));

  const secoes = [
    {
      id: 'resumo',
      titulo: 'Resumo da visita',
      tipo: 'texto',
      texto: String(resumo || '').trim(),
      vazia: !String(resumo || '').trim(),
      espera: 'O que foi feito na visita, em poucas linhas.',
    },
    {
      id: 'checklist',
      titulo: 'Checklist técnico',
      tipo: 'itens',
      itens: doChecklist.filter((i) => i.texto),
      vazia: !doChecklist.some((i) => i.texto),
      espera: 'Cada item vistoriado, com o que foi encontrado.',
    },
    {
      id: 'pendencias',
      titulo: 'Pendências e recomendações',
      tipo: 'texto',
      texto: String(pendencias || '').trim(),
      vazia: !String(pendencias || '').trim(),
      espera: 'O que ficou em aberto e o que a empresa recomenda.',
    },
    {
      id: 'evidencias',
      titulo: 'Evidências fotográficas',
      tipo: 'fotos',
      fotos: evidencias.filter(Boolean),
      vazia: evidencias.length === 0,
      espera: 'As fotos da visita entram no fim do relatório.',
    },
  ];

  return {
    titulo: 'Relatório de Visita Técnica',
    subtitulo: [String(empresa || '').trim() || 'Empresa não informada', dataVisita ? dataBR(dataVisita) : null]
      .filter(Boolean)
      .join(' · '),
    identificacao,
    secoes,
    // O rodapé do PDF e a legenda da folha na tela -- o mesmo texto nos dois.
    // "Uso interno" no rodapé porque é o que este documento é: ele vai para o
    // supervisor, e não para o cliente visitado.
    legenda: `Arka Tecnologia · Relatório de visita técnica · uso interno${empresa ? ` · ${String(empresa).trim()}` : ''}`,
  };
}

/** Nome do arquivo entregue: empresa e data, sem acento nem espaço. */
export function nomeArquivoMapeamento({ empresa, dataVisita } = {}) {
  const slug = String(empresa || 'visita')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 60);
  return `relatorio-${slug || 'visita'}-${String(dataVisita || '').slice(0, 10) || 'sem-data'}.pdf`;
}
