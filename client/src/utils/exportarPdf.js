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
      const quem = m.de === 'cliente'
        ? (conversa.cliente || 'Cliente')
        : m.de === 'sistema' ? 'Sistema' : 'Atendente';
      const ehCliente = m.de === 'cliente';
      const prefixo = `[${m.hora || ''}] ${quem}: `;
      const texto = prefixo + (m.texto || '');
      const linhas = pdf.splitTextToSize(texto, larguraPg - margem * 2);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      linhas.forEach((linha, i) => {
        quebraPagina(5);
        // Cliente em cinza, equipe em laranja escuro, para diferenciar de relance.
        pdf.setTextColor(...(ehCliente ? CINZA : [180, 83, 9]));
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
