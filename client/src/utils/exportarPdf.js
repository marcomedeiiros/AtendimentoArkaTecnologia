import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

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
  pdf.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, logo ? margem + 32 : margem, y + 11);

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

  pdf.save(`relatorio-arka-${new Date().toISOString().slice(0, 10)}.pdf`);
}
