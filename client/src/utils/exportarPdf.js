import { hojeISO, FUSO_BR } from './data';

// ── AS DUAS BIBLIOTECAS PESADAS SO CHEGAM QUANDO ALGUEM EXPORTA ────────────
//
// `jspdf` + `html2canvas` somam 544 KB -- mais do que TODO o codigo do painel
// junto. Importados no topo, eles entravam no pacote que o navegador baixa para
// abrir a Central, e a Central nao gera PDF nenhum: quem gera e o botao de
// exportar do Dashboard e do Help Desk, que a maioria dos atendentes nunca
// aperta.
//
// Com o import dinamico o download acontece no primeiro clique em "Exportar", e
// fica em cache dali em diante. Quem nunca exporta, nunca paga.
let _libs = null;
async function libs() {
  if (!_libs) {
    const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
      import('jspdf'),
      import('html2canvas'),
    ]);
    _libs = { jsPDF, html2canvas };
  }
  return _libs;
}

const LOGO_URL = '/arka_tecnologia_logo-removebg-preview.png';
const LARANJA = [249, 115, 22];
const CINZA = [100, 116, 139];

// Carrega a logo como dataURL. Best-effort: sem ela o PDF sai só com o titulo.
async function carregarLogo() {
  try {
    const resp = await fetch(LOGO_URL);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Gera o relatorio em PDF da Visao Geral.
 * @param {Object}  opts
 * @param {HTMLElement} opts.elemento  Container a capturar (graficos).
 * @param {Array}   opts.metricas      Pares [rotulo, valor] para a tabela.
 * @param {string}  opts.filtros       Descricao dos filtros aplicados.
 * @param {string}  opts.resumo        Paragrafo de resumo.
 */
export async function exportarRelatorioPdf({ elemento, metricas = [], filtros = 'Nenhum', resumo = '' }) {
  const { jsPDF } = await libs();
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const larguraPg = pdf.internal.pageSize.getWidth();
  const alturaPg = pdf.internal.pageSize.getHeight();
  const margem = 14;
  let y = margem;

  // ---------- Cabecalho: logo + titulo + data ----------
  const logo = await carregarLogo();
  if (logo) {
    try { pdf.addImage(logo, 'PNG', margem, y, 26, 12); } catch { /* formato invalido */ }
  }

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.setTextColor(15, 23, 42);
  pdf.text('Relatório de Atendimentos', logo ? margem + 32 : margem, y + 6);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(...CINZA);
  pdf.text(`Gerado em ${new Date().toLocaleString('pt-BR', { timeZone: FUSO_BR })}`, logo ? margem + 32 : margem, y + 11);

  y += 18;
  pdf.setDrawColor(...LARANJA);
  pdf.setLineWidth(0.6);
  pdf.line(margem, y, larguraPg - margem, y);
  y += 7;

  // ---------- Filtros utilizados ----------
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(15, 23, 42);
  pdf.text('Filtros utilizados', margem, y);
  y += 5;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(...CINZA);
  pdf.splitTextToSize(filtros, larguraPg - margem * 2).forEach((linha) => {
    pdf.text(linha, margem, y);
    y += 4.5;
  });
  y += 4;

  // ---------- Tabela de metricas ----------
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(15, 23, 42);
  pdf.text('Indicadores', margem, y);
  y += 5;

  const alturaLinha = 7;
  const colValor = larguraPg - margem - 30;

  pdf.setFillColor(...LARANJA);
  pdf.rect(margem, y, larguraPg - margem * 2, alturaLinha, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(9);
  pdf.text('Métrica', margem + 3, y + 4.8);
  pdf.text('Valor', colValor, y + 4.8);
  y += alturaLinha;

  pdf.setFont('helvetica', 'normal');
  metricas.forEach(([rotulo, valor], i) => {
    if (i % 2 === 0) {
      pdf.setFillColor(244, 246, 250);
      pdf.rect(margem, y, larguraPg - margem * 2, alturaLinha, 'F');
    }
    pdf.setTextColor(30, 41, 59);
    pdf.text(String(rotulo), margem + 3, y + 4.8);
    pdf.setFont('helvetica', 'bold');
    pdf.text(String(valor), colValor, y + 4.8);
    pdf.setFont('helvetica', 'normal');
    y += alturaLinha;
  });
  y += 6;

  // ---------- Resumo ----------
  if (resumo) {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10);
    pdf.setTextColor(15, 23, 42);
    pdf.text('Resumo', margem, y);
    y += 5;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(...CINZA);
    pdf.splitTextToSize(resumo, larguraPg - margem * 2).forEach((linha) => {
      pdf.text(linha, margem, y);
      y += 4.5;
    });
    y += 4;
  }

  // ---------- Graficos (captura da tela) ----------
  if (elemento) {
    try {
      const { html2canvas } = await libs();
      const canvas = await html2canvas(elemento, {
        backgroundColor: '#0F1219',
        scale: 2,
        logging: false,
        useCORS: true,
      });
      const img = canvas.toDataURL('image/png');
      const larguraImg = larguraPg - margem * 2;
      const alturaImg = (canvas.height * larguraImg) / canvas.width;

      // Cabe no espaco restante? Senao vai para a proxima pagina.
      if (y + alturaImg > alturaPg - margem) {
        pdf.addPage();
        y = margem;
      }
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(10);
      pdf.setTextColor(15, 23, 42);
      pdf.text('Gráficos', margem, y);
      y += 5;

      // Imagem muito alta: fatia entre paginas para nao cortar conteudo.
      let restante = alturaImg;
      let deslocamento = 0;
      while (restante > 0) {
        const disponivel = alturaPg - y - margem;
        const fatia = Math.min(restante, disponivel);
        pdf.addImage(img, 'PNG', margem, y - deslocamento, larguraImg, alturaImg, undefined, 'FAST');
        restante -= fatia;
        deslocamento += fatia;
        if (restante > 0) {
          pdf.addPage();
          y = margem;
        }
      }
    } catch {
      // Falha na captura nao invalida o relatorio: segue sem os graficos.
    }
  }

  // ---------- Rodape em todas as paginas ----------
  const totalPgs = pdf.internal.getNumberOfPages();
  for (let i = 1; i <= totalPgs; i++) {
    pdf.setPage(i);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(...CINZA);
    pdf.text('Arka Tecnologia • Central de Atendimento', margem, alturaPg - 8);
    pdf.text(`Página ${i} de ${totalPgs}`, larguraPg - margem - 20, alturaPg - 8);
  }

  pdf.save(`relatorio-arka-${hojeISO()}.pdf`);
}

// Formata ISO -> data/hora pt-BR curta (ou '-').
function fmtDataHora(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '-' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: FUSO_BR });
}

/**
 * Gera a transcricao de UMA conversa em PDF (substitui o antigo .txt).
 * Inclui o ID da conversa no cabecalho.
 * @param {Object} conversa  DTO da conversa (com `id`, `mensagens`, etc).
 * @param {Object} [opts]
 * @param {string} [opts.atendente]   Nome do atendente.
 * @param {string} [opts.statusLabel] Rotulo do status (ex.: "Fechada").
 */
export async function exportarTranscricaoPdf(conversa, { atendente = '-', statusLabel = '' } = {}) {
  const { jsPDF } = await libs();
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const larguraPg = pdf.internal.pageSize.getWidth();
  const alturaPg = pdf.internal.pageSize.getHeight();
  const margem = 14;
  let y = margem;

  const quebraPagina = (precisa = 6) => {
    if (y + precisa > alturaPg - margem) { pdf.addPage(); y = margem; }
  };

  // ---------- Cabecalho ----------
  const logo = await carregarLogo();
  if (logo) {
    try { pdf.addImage(logo, 'PNG', margem, y, 26, 12); } catch { /* formato invalido */ }
  }
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(15);
  pdf.setTextColor(15, 23, 42);
  pdf.text('Transcrição da Conversa', logo ? margem + 32 : margem, y + 6);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(...CINZA);
  pdf.text(`Gerado em ${new Date().toLocaleString('pt-BR', { timeZone: FUSO_BR })}`, logo ? margem + 32 : margem, y + 11);

  y += 18;
  pdf.setDrawColor(...LARANJA);
  pdf.setLineWidth(0.6);
  pdf.line(margem, y, larguraPg - margem, y);
  y += 7;

  // ---------- Metadados (com o ID da conversa) ----------
  // Protocolo curto (igual ao da Central: #408619D2) + o UUID completo.
  const protocolo = String(conversa.id || '').replace(/-/g, '').slice(0, 8).toUpperCase();
  const idTexto = conversa.id ? `#${protocolo}  (${conversa.id})` : '-';
  const meta = [
    ['OS', conversa.ticket || '-'],
    ['ID da conversa', idTexto],
    ['Cliente', conversa.cliente || 'Cliente'],
    ['Telefone', conversa.telefone || '-'],
    ['Setor', conversa.setor || 'Geral'],
    ['Status', statusLabel || conversa.statusAtendimento || '-'],
    ['Início', fmtDataHora(conversa.criadoEm)],
    ['Fim', fmtDataHora(conversa.fechadoEm)],
    ['Atendente', atendente || '-'],
    ['Avaliação', conversa.avaliacao ? `${conversa.avaliacao}/5${conversa.feedback ? ` ${conversa.feedback}` : ''}` : '-'],
  ];
  const rotuloX = margem;
  const valorX = margem + 34;
  pdf.setFontSize(9);
  meta.forEach(([rotulo, valor]) => {
    quebraPagina(6);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(30, 41, 59);
    pdf.text(`${rotulo}:`, rotuloX, y);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(...CINZA);
    const linhas = pdf.splitTextToSize(String(valor), larguraPg - valorX - margem);
    linhas.forEach((linha, i) => {
      if (i > 0) { y += 4.5; quebraPagina(6); }
      pdf.text(linha, valorX, y);
    });
    y += 5.5;
  });

  y += 2;
  pdf.setDrawColor(...CINZA);
  pdf.setLineWidth(0.2);
  pdf.line(margem, y, larguraPg - margem, y);
  y += 7;

  // ---------- Mensagens ----------
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(15, 23, 42);
  quebraPagina(6);
  pdf.text('Mensagens', margem, y);
  y += 6;

  const mensagens = conversa.mensagens || [];
  if (mensagens.length === 0) {
    pdf.setFont('helvetica', 'italic');
    pdf.setFontSize(9);
    pdf.setTextColor(...CINZA);
    pdf.text('Sem mensagens registradas.', margem, y);
    y += 5;
  } else {
    mensagens.forEach((m) => {
      // A NOTA INTERNA PRECISA GRITAR QUE É INTERNA.
      //
      // Sem este caso ela cairia no "Atendente" do final da expressão e sairia
      // no PDF como se tivesse sido dita ao cliente. E a transcrição é
      // justamente o arquivo que alguém um dia anexa num e-mail para o próprio
      // cliente ("segue o histórico do seu atendimento") -- lá, uma anotação de
      // bastidor lida como fala oficial da empresa.
      //
      // Ela continua saindo, e não some do arquivo: este PDF também serve de
      // registro interno, e export que descarta dado em silêncio é pior. O que
      // muda é que ninguém consegue confundir as duas coisas.
      const ehNota = m.de === 'nota';
      const quem = m.de === 'cliente'
        ? (conversa.cliente || 'Cliente')
        : ehNota ? 'NOTA INTERNA (nao enviada ao cliente)'
        : m.de === 'sistema' ? 'Sistema' : 'Atendente';
      const ehCliente = m.de === 'cliente';
      const prefixo = `[${m.hora || ''}] ${quem}: `;
      const texto = prefixo + (m.texto || '');
      const linhas = pdf.splitTextToSize(texto, larguraPg - margem * 2);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      linhas.forEach((linha, i) => {
        quebraPagina(5);
        // Cliente em cinza, equipe em laranja escuro, para diferenciar de
        // relance. A nota interna sai em vermelho: terceira cor, terceira
        // categoria -- quem folheia o PDF não precisa ler o rótulo para ver que
        // aquela linha não é da conversa com o cliente.
        pdf.setTextColor(...(ehNota ? [153, 27, 27] : ehCliente ? CINZA : [180, 83, 9]));
        pdf.text(linha, margem, y);
        y += 4.6;
        if (i === 0) { /* mantem cor nas continuacoes */ }
      });
      y += 1.5;
    });
  }

  // ---------- Rodape ----------
  const totalPgs = pdf.internal.getNumberOfPages();
  for (let i = 1; i <= totalPgs; i++) {
    pdf.setPage(i);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(...CINZA);
    pdf.text('Arka Tecnologia • Transcrição de Atendimento', margem, alturaPg - 8);
    pdf.text(`Página ${i} de ${totalPgs}`, larguraPg - margem - 20, alturaPg - 8);
  }

  const slug = String(conversa.cliente || 'cliente').replace(/[^\w]+/g, '-').toLowerCase();
  const idCurto = String(conversa.id || '').slice(0, 8);
  pdf.save(`conversa-${slug}${idCurto ? `-${idCurto}` : ''}.pdf`);
}

// ── RELATORIO DE UMA EMPRESA (CNPJ) ────────────────────────────────────────
//
// POR QUE jsPDF PROGRAMATICO, e nao `exportarRelatorioPdf` (html2canvas).
//
// O html2canvas fotografa um elemento DA TELA -- e a tela esta no tema do
// operador. Um relatorio gerado no tema escuro sairia com fundo quase preto:
// ilegivel impresso e constrangedor de mandar para o cliente. E nem forcar
// `bg-white` resolveria, porque neste projeto `--c-white` vale 17 27 33 no tema
// claro (index.css) -- "branco" aqui nao e branco.
//
// Desenhando o PDF, as cores sao literais, o documento fica igual em qualquer
// tema e a paginacao e de verdade, em vez de uma imagem gigante cortada. E o
// mesmo caminho da transcricao de conversa, acima.
//
// O QUE NAO ENTRA, de proposito: nada de outro cliente, nenhuma nota interna e
// nenhuma comparacao ("voce abriu mais chamados que a media"). Este arquivo sai
// da empresa para o cliente dela.
function fmtDataCurta(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '-' : d.toLocaleDateString('pt-BR', { timeZone: FUSO_BR });
}

function fmtDocumento(cnpj) {
  const s = String(cnpj || '').replace(/\D/g, '');
  if (s.length === 14) return s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (s.length === 11) return s.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return s || '-';
}

export async function exportarRelatorioEmpresaPdf(relatorio) {
  const { jsPDF } = await libs();
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const larguraPg = pdf.internal.pageSize.getWidth();
  const alturaPg = pdf.internal.pageSize.getHeight();
  const margem = 14;
  const util = larguraPg - margem * 2;
  let y = margem;

  const quebra = (precisa = 6) => {
    if (y + precisa > alturaPg - margem - 6) { pdf.addPage(); y = margem; }
  };

  const {
    empresa = {}, periodo = {}, resumo = {},
    porMotivo = [], porSetor = [], chamados = [],
  } = relatorio || {};

  // ---------- Cabecalho ----------
  const logo = await carregarLogo();
  if (logo) {
    try { pdf.addImage(logo, 'PNG', margem, y, 26, 12); } catch { /* formato invalido */ }
  }
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(15);
  pdf.setTextColor(15, 23, 42);
  pdf.text('Relatório de Atendimento', logo ? margem + 32 : margem, y + 6);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(...CINZA);
  pdf.text(
    `${periodo.rotulo || 'Período'} · ${fmtDataCurta(periodo.inicio)} a ${fmtDataCurta(periodo.fim)}`,
    logo ? margem + 32 : margem,
    y + 11
  );

  y += 18;
  pdf.setDrawColor(...LARANJA);
  pdf.setLineWidth(0.6);
  pdf.line(margem, y, larguraPg - margem, y);
  y += 7;

  // ---------- Identificacao ----------
  const meta = [
    ['Empresa', empresa.razaoSocial || '-'],
    ['CNPJ/CPF', fmtDocumento(empresa.cnpj)],
    ['Período', `${fmtDataCurta(periodo.inicio)} a ${fmtDataCurta(periodo.fim)}`],
    ['Gerado em', new Date().toLocaleString('pt-BR', { timeZone: FUSO_BR })],
  ];
  pdf.setFontSize(9);
  meta.forEach(([rotulo, valor]) => {
    quebra(6);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(30, 41, 59);
    pdf.text(`${rotulo}:`, margem, y);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(...CINZA);
    pdf.text(String(valor), margem + 30, y);
    y += 5.5;
  });
  y += 3;

  // ---------- Resumo ----------
  quebra(24);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.setTextColor(15, 23, 42);
  pdf.text('Resumo do período', margem, y);
  y += 6;

  const cartoes = [
    ['Chamados encerrados', String(resumo.totalOS ?? 0)],
    ['Tempo médio', resumo.duracaoMediaHoras != null ? `${resumo.duracaoMediaHoras} h` : '-'],
    // Sem amostra suficiente a media NAO e publicada: "5,0 (1 avaliação)" e
    // ruido que o cliente leria como fato sobre o ano inteiro.
    ['Satisfação', resumo.avaliacaoMedia != null ? `${resumo.avaliacaoMedia}/5` : 'Sem amostra'],
  ];
  const largCartao = util / cartoes.length;
  cartoes.forEach(([rotulo, valor], i) => {
    const x = margem + i * largCartao;
    pdf.setDrawColor(226, 232, 240);
    pdf.setLineWidth(0.3);
    pdf.roundedRect(x, y, largCartao - 3, 16, 2, 2);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(...CINZA);
    pdf.text(rotulo, x + 3, y + 6);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(13);
    pdf.setTextColor(15, 23, 42);
    pdf.text(valor, x + 3, y + 13);
  });
  y += 22;

  // ---------- Distribuicoes ----------
  const distribuicao = (titulo, itens) => {
    if (!itens.length) return;
    quebra(14);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.setTextColor(15, 23, 42);
    pdf.text(titulo, margem, y);
    y += 6;
    const maior = itens[0].total || 1;
    pdf.setFontSize(9);
    itens.forEach((it) => {
      quebra(7);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(30, 41, 59);
      pdf.text(pdf.splitTextToSize(String(it.nome), util - 40)[0], margem, y);
      pdf.setTextColor(...CINZA);
      pdf.text(`${it.total}  (${it.pct}%)`, larguraPg - margem, y, { align: 'right' });
      // Barrinha proporcional: o numero ja esta escrito ao lado; a barra existe
      // para o olho achar o maior sem ler a coluna inteira.
      pdf.setFillColor(...LARANJA);
      pdf.rect(margem, y + 1.4, Math.max(1, (util - 45) * (it.total / maior)), 0.8, 'F');
      y += 6.5;
    });
    y += 3;
  };

  distribuicao('Por que os chamados foram abertos', porMotivo);
  distribuicao('Por área de atendimento', porSetor);

  // ---------- Extrato ----------
  quebra(14);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.setTextColor(15, 23, 42);
  pdf.text('Chamados encerrados no período', margem, y);
  y += 6;

  if (!chamados.length) {
    pdf.setFont('helvetica', 'italic');
    pdf.setFontSize(9);
    pdf.setTextColor(...CINZA);
    pdf.text('Nenhum chamado encerrado neste período.', margem, y);
    y += 6;
  } else {
    // As larguras somam `util`. O motivo leva toda a folga porque e a coluna
    // que o cliente de fato le -- as outras sao dado curto e previsivel.
    const COLS = [
      { t: 'OS', w: 22 },
      { t: 'Encerrado', w: 22 },
      { t: 'Motivo', w: util - 100 },
      { t: 'Área', w: 26 },
      { t: 'Duração', w: 16 },
      { t: 'Nota', w: 14 },
    ];

    const cabecalhoTabela = () => {
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8);
      pdf.setTextColor(...CINZA);
      let x = margem;
      COLS.forEach((c) => { pdf.text(c.t, x, y); x += c.w; });
      y += 2;
      pdf.setDrawColor(...CINZA);
      pdf.setLineWidth(0.2);
      pdf.line(margem, y, larguraPg - margem, y);
      y += 4;
    };
    cabecalhoTabela();

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    chamados.forEach((c) => {
      // O motivo pode ocupar mais de uma linha, e a ALTURA DA LINHA acompanha.
      // Sem isto o texto do motivo invadiria a linha de baixo -- e numa tabela
      // de trinta chamados o estrago vira uma mancha ilegivel.
      const linhasMotivo = pdf.splitTextToSize(String(c.motivo || '-'), COLS[2].w - 2);
      const altura = Math.max(5, linhasMotivo.length * 4);
      if (y + altura > alturaPg - margem - 6) {
        pdf.addPage();
        y = margem;
        cabecalhoTabela();
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
      }
      let x = margem;
      pdf.setTextColor(30, 41, 59);
      pdf.text(String(c.os || '-'), x, y); x += COLS[0].w;
      pdf.text(fmtDataCurta(c.fechadoEm), x, y); x += COLS[1].w;
      pdf.setTextColor(...CINZA);
      linhasMotivo.forEach((l, i) => pdf.text(l, x, y + i * 4));
      x += COLS[2].w;
      pdf.text(String(c.setor || '-'), x, y); x += COLS[3].w;
      pdf.text(c.duracaoHoras != null ? `${c.duracaoHoras}h` : '-', x, y); x += COLS[4].w;
      pdf.text(c.avaliacao != null ? `${c.avaliacao}/5` : '-', x, y);
      y += altura;
    });
  }

  // ---------- Rodape ----------
  const totalPgs = pdf.internal.getNumberOfPages();
  for (let i = 1; i <= totalPgs; i++) {
    pdf.setPage(i);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(...CINZA);
    pdf.text('Arka Tecnologia • Relatório de Atendimento', margem, alturaPg - 8);
    pdf.text(`Página ${i} de ${totalPgs}`, larguraPg - margem - 20, alturaPg - 8);
  }

  const slug = String(empresa.razaoSocial || 'empresa')
    .replace(/[^\w]+/g, '-').toLowerCase().slice(0, 40);
  pdf.save(`relatorio-${slug}-${periodo.inicioIso || ''}.pdf`);
}
