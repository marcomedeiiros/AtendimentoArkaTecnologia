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

/**
 * A PALETA DO PDF -- os tokens do painel, na versao do TEMA CLARO.
 *
 * O laranja `[249, 115, 22]` que estava aqui nao existe em lugar nenhum da
 * plataforma: a marca da Arka e o teal do `--acao`, que e o que colore o botao
 * de enviar, a aba ativa e o selo de conversa aberta. Um relatorio com outra
 * cor primaria parece ter saido de outro sistema -- e ele vai para o cliente
 * junto do resto.
 *
 * SAO OS VALORES DO TEMA CLARO de propósito. Papel e branco: o `--acao` do tema
 * escuro (0 168 132) e calibrado para brilhar sobre quase-preto e sai lavado na
 * impressao; o do tema claro (1 117 97) foi escolhido justamente para ter
 * contraste sobre fundo claro. Mesma logica para o texto -- `--texto` no tema
 * claro e o quase-preto 17 27 33, e nao o cinza-claro do escuro.
 *
 * Nao da para LER as variaveis CSS aqui: o PDF pode ser gerado com a
 * plataforma no tema escuro, e ai `getComputedStyle` devolveria a paleta
 * errada. O documento nao acompanha o tema de quem o gerou.
 */
const MARCA = [1, 117, 97];          // --acao-600 (claro): teal profundo, para regra e titulos
const MARCA_FUNDO = [0, 143, 112];   // --acao (claro): preenchimento de cabecalho de tabela
const TINTA = [17, 27, 33];          // --texto (claro)
const TINTA_SUAVE = [84, 101, 110];  // --texto-suave (claro)
const LINHA = [209, 215, 219];       // --linha (claro)
const FAIXA = [246, 248, 249];       // zebra da tabela: um passo acima do branco
const VERMELHO = [176, 42, 56];      // --falha-600 (claro), para a nota interna

// Mantido como apelido para nao reescrever as ~20 chamadas existentes de uma
// vez so -- e o mesmo cinza de texto, agora vindo do token.
const CINZA = TINTA_SUAVE;

/**
 * CABECALHO PADRAO -- os tres PDFs passam a abrir igual.
 *
 * Ate agora cada exportador desenhava o proprio topo, com tamanhos e espacos
 * ligeiramente diferentes: lado a lado, os tres pareciam de sistemas
 * diferentes. Um so lugar significa que ajustar a marca ajusta tudo.
 *
 * Devolve o `y` de onde o conteudo comeca.
 */
function cabecalhoPdf(pdf, { logo, titulo, subtitulo, margem = 14 }) {
  const largura = pdf.internal.pageSize.getWidth();
  let y = margem;

  if (logo) {
    try { pdf.addImage(logo, 'PNG', margem, y, 26, 12); } catch { /* formato invalido */ }
  }
  const x = logo ? margem + 32 : margem;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(15);
  pdf.setTextColor(...TINTA);
  pdf.text(titulo, x, y + 6);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  pdf.setTextColor(...TINTA_SUAVE);
  pdf.text(subtitulo, x, y + 11);

  y += 17;
  // Regra dupla: um traco firme da marca e um fio claro logo abaixo. Custa duas
  // linhas e e o que separa "documento" de "impressao de tela".
  pdf.setDrawColor(...MARCA);
  pdf.setLineWidth(0.8);
  pdf.line(margem, y, largura - margem, y);
  pdf.setDrawColor(...LINHA);
  pdf.setLineWidth(0.2);
  pdf.line(margem, y + 1.1, largura - margem, y + 1.1);

  return y + 8;
}

/**
 * TITULO DE SECAO -- maiuscula, espacado, na cor da marca.
 *
 * E o que da ritmo ao documento: em corpo de texto do mesmo tamanho, o olho nao
 * acha onde uma parte termina e a outra comeca.
 */
function tituloSecao(pdf, texto, margem, y) {
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  pdf.setTextColor(...MARCA);
  // `charSpace` espaca as letras: e o detalhe que faz um titulo curto em
  // maiuscula parecer rotulo de relatorio, e nao grito.
  pdf.text(String(texto).toUpperCase(), margem, y, { charSpace: 0.4 });
  return y + 5;
}

/** Rodape identico em todas as paginas de todos os PDFs. */
function rodapePdf(pdf, { legenda, margem = 14 }) {
  const largura = pdf.internal.pageSize.getWidth();
  const altura = pdf.internal.pageSize.getHeight();
  const total = pdf.internal.getNumberOfPages();
  for (let i = 1; i <= total; i += 1) {
    pdf.setPage(i);
    pdf.setDrawColor(...LINHA);
    pdf.setLineWidth(0.2);
    pdf.line(margem, altura - 11, largura - margem, altura - 11);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(...TINTA_SUAVE);
    pdf.text(legenda, margem, altura - 7);
    pdf.text(`Página ${i} de ${total}`, largura - margem, altura - 7, { align: 'right' });
  }
}

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

  // ---------- Cabecalho ----------
  const logo = await carregarLogo();
  y = cabecalhoPdf(pdf, {
    logo,
    titulo: 'Relatório de Atendimentos',
    subtitulo: `Gerado em ${new Date().toLocaleString('pt-BR', { timeZone: FUSO_BR })}`,
    margem,
  });

  // ---------- Filtros utilizados ----------
  y = tituloSecao(pdf, 'Filtros utilizados', margem, y);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(...CINZA);
  pdf.splitTextToSize(filtros, larguraPg - margem * 2).forEach((linha) => {
    pdf.text(linha, margem, y);
    y += 4.5;
  });
  y += 4;

  // ---------- Tabela de metricas ----------
  y = tituloSecao(pdf, 'Indicadores', margem, y);

  const alturaLinha = 7;
  const colValor = larguraPg - margem - 30;

  pdf.setFillColor(...MARCA_FUNDO);
  pdf.rect(margem, y, larguraPg - margem * 2, alturaLinha, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(9);
  pdf.text('Métrica', margem + 3, y + 4.8);
  pdf.text('Valor', colValor, y + 4.8);
  y += alturaLinha;

  pdf.setFont('helvetica', 'normal');
  metricas.forEach(([rotulo, valor], i) => {
    if (i % 2 === 0) {
      pdf.setFillColor(...FAIXA);
      pdf.rect(margem, y, larguraPg - margem * 2, alturaLinha, 'F');
    }
    pdf.setTextColor(...TINTA);
    pdf.text(String(rotulo), margem + 3, y + 4.8);
    pdf.setFont('helvetica', 'bold');
    pdf.text(String(valor), colValor, y + 4.8);
    pdf.setFont('helvetica', 'normal');
    y += alturaLinha;
  });
  y += 6;

  // ---------- Resumo ----------
  if (resumo) {
    y = tituloSecao(pdf, 'Resumo', margem, y);
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
      pdf.setTextColor(...TINTA);
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

  rodapePdf(pdf, { legenda: 'Arka Tecnologia · Central de Atendimento', margem });
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
  y = cabecalhoPdf(pdf, {
    logo,
    titulo: 'Transcrição da Conversa',
    subtitulo: `Gerado em ${new Date().toLocaleString('pt-BR', { timeZone: FUSO_BR })}`,
    margem,
  });

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
    pdf.setTextColor(...TINTA);
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
  pdf.setDrawColor(...LINHA);
  pdf.setLineWidth(0.2);
  pdf.line(margem, y, larguraPg - margem, y);
  y += 7;

  // ---------- Mensagens ----------
  quebraPagina(6);
  y = tituloSecao(pdf, 'Mensagens', margem, y) + 1;

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
        pdf.setTextColor(...(ehNota ? VERMELHO : ehCliente ? TINTA_SUAVE : MARCA));
        pdf.text(linha, margem, y);
        y += 4.6;
        if (i === 0) { /* mantem cor nas continuacoes */ }
      });
      y += 1.5;
    });
  }

  rodapePdf(pdf, { legenda: 'Arka Tecnologia · Transcrição de Atendimento', margem });

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
  y = cabecalhoPdf(pdf, {
    logo,
    titulo: 'Relatório de Atendimento',
    subtitulo: `${periodo.rotulo || 'Período'} · ${fmtDataCurta(periodo.inicio)} a ${fmtDataCurta(periodo.fim)}`,
    margem,
  });

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
    pdf.setTextColor(...TINTA);
    pdf.text(`${rotulo}:`, margem, y);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(...CINZA);
    pdf.text(String(valor), margem + 30, y);
    y += 5.5;
  });
  y += 3;

  // ---------- Resumo ----------
  quebra(24);
  y = tituloSecao(pdf, 'Resumo do período', margem, y) + 1;

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
    // Cartao com fundo suave e um filete da marca na lateral esquerda -- o
    // mesmo recurso que o painel usa para marcar o que e numero de destaque,
    // e que na impressao sobrevive melhor que uma borda cinza fina.
    pdf.setFillColor(...FAIXA);
    pdf.rect(x, y, largCartao - 3, 16, 'F');
    pdf.setFillColor(...MARCA);
    pdf.rect(x, y, 1, 16, 'F');
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(...TINTA_SUAVE);
    pdf.text(rotulo, x + 4, y + 6);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(13);
    pdf.setTextColor(...TINTA);
    pdf.text(valor, x + 4, y + 13);
  });
  y += 22;

  // ---------- Distribuicoes ----------
  const distribuicao = (titulo, itens) => {
    if (!itens.length) return;
    quebra(14);
    y = tituloSecao(pdf, titulo, margem, y) + 1;
    const maior = itens[0].total || 1;
    pdf.setFontSize(9);
    itens.forEach((it) => {
      quebra(7);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(...TINTA);
      pdf.text(pdf.splitTextToSize(String(it.nome), util - 40)[0], margem, y);
      pdf.setTextColor(...CINZA);
      pdf.text(`${it.total}  (${it.pct}%)`, larguraPg - margem, y, { align: 'right' });
      // Barrinha proporcional: o numero ja esta escrito ao lado; a barra existe
      // para o olho achar o maior sem ler a coluna inteira.
      pdf.setFillColor(...MARCA_FUNDO);
      pdf.rect(margem, y + 1.4, Math.max(1, (util - 45) * (it.total / maior)), 0.8, 'F');
      y += 6.5;
    });
    y += 3;
  };

  distribuicao('Por que os chamados foram abertos', porMotivo);
  distribuicao('Por área de atendimento', porSetor);

  // ---------- Extrato ----------
  quebra(14);
  y = tituloSecao(pdf, 'Chamados encerrados no período', margem, y) + 1;

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

    // Cabecalho preenchido na cor da marca, com texto branco -- o mesmo
    // tratamento da tabela de Indicadores do outro relatorio. Duas tabelas com
    // desenhos diferentes no mesmo sistema e o que faz o conjunto parecer
    // improvisado.
    const cabecalhoTabela = () => {
      pdf.setFillColor(...MARCA_FUNDO);
      pdf.rect(margem, y - 3.6, util, 6, 'F');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7.5);
      pdf.setTextColor(255, 255, 255);
      let x = margem;
      COLS.forEach((c) => { pdf.text(c.t, x + 1.5, y); x += c.w; });
      y += 5.5;
    };
    cabecalhoTabela();

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    let zebra = 0;
    chamados.forEach((c) => {
      // O motivo pode ocupar mais de uma linha, e a ALTURA DA LINHA acompanha.
      // Sem isto o texto do motivo invadiria a linha de baixo -- e numa tabela
      // de trinta chamados o estrago vira uma mancha ilegivel.
      const linhasMotivo = pdf.splitTextToSize(String(c.motivo || '-'), COLS[2].w - 2);
      const altura = Math.max(5, linhasMotivo.length * 4);
      if (y + altura > alturaPg - margem - 12) {
        pdf.addPage();
        y = margem + 4;
        cabecalhoTabela();
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
      }
      // Zebra: numa tabela de seis colunas estreitas, e o que impede o olho de
      // pular de linha no meio do caminho. Pintada ANTES do texto.
      if (zebra % 2 === 1) {
        pdf.setFillColor(...FAIXA);
        pdf.rect(margem, y - 3.4, util, altura, 'F');
      }
      zebra += 1;

      let x = margem;
      pdf.setTextColor(...TINTA);
      pdf.text(String(c.os || '-'), x + 1.5, y); x += COLS[0].w;
      pdf.text(fmtDataCurta(c.fechadoEm), x + 1.5, y); x += COLS[1].w;
      pdf.setTextColor(...TINTA_SUAVE);
      linhasMotivo.forEach((l, i) => pdf.text(l, x + 1.5, y + i * 4));
      x += COLS[2].w;
      pdf.text(String(c.setor || '-'), x + 1.5, y); x += COLS[3].w;
      pdf.text(c.duracaoHoras != null ? `${c.duracaoHoras}h` : '-', x + 1.5, y); x += COLS[4].w;
      pdf.text(c.avaliacao != null ? `${c.avaliacao}/5` : '-', x + 1.5, y);
      y += altura;
    });
  }

  rodapePdf(pdf, { legenda: 'Arka Tecnologia · Relatório de Atendimento', margem });

  const slug = String(empresa.razaoSocial || 'empresa')
    .replace(/[^\w]+/g, '-').toLowerCase().slice(0, 40);
  pdf.save(`relatorio-${slug}-${periodo.inicioIso || ''}.pdf`);
}
