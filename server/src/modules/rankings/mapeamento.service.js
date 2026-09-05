/**
 * MAPEAMENTOS TECNICOS -- o registro que a equipe externa entrega.
 *
 * ── QUEM PODE O QUE, E POR QUE A REGRA VIVE AQUI ───────────────────────────
 *
 *   tecnico          cria, edita e entrega o PROPRIO mapeamento; nunca ve nem
 *                    mexe no de outro.
 *   administrador    ve todos, aprova e devolve para correcao. E o unico papel
 *                    de supervisao -- nao ha marca separada no cadastro.
 *
 * A checagem e no SERVIDOR, a cada chamada, e nao no que a tela mostra: o
 * mapeamento vira PONTO no ranking, e um endpoint aberto seria um jeito de a
 * pessoa aprovar o proprio relatorio.
 *
 * ── O CICLO, E O QUE CADA PASSO SIGNIFICA NA PONTUACAO ─────────────────────
 *
 *   rascunho     ainda do tecnico. NAO pontua -- senao abrir formulario valeria
 *                ponto.
 *   entregue     saiu da mao dele. Ja conta em completude, prazo e evidencias.
 *   em_correcao  o supervisor devolveu. Continua contando, e cada devolucao
 *                desconta da parcela de retrabalho.
 *   aprovado     conta tambem no VOLUME, que e a parcela mais pesada.
 *
 * A data de entrega e gravada na PRIMEIRA entrega e nao se move depois. Sem
 * isso, uma correcao entregue com duas semanas de atraso reescreveria o carimbo
 * e o relatorio atrasado passaria a constar como no prazo.
 */
const prisma = require("../../infrastructure/database/prisma.client");
const midiaStorage = require("../../infrastructure/storage/midia.storage");
const AppError = require("../../shared/errors/AppError");
const logger = require("../../config/logger");
const bus = require("../../shared/events/event-bus");
const { ITENS_MAPEAMENTO, completudeDe, noPrazo } = require("./pontuacao.externa");

const STATUS = ["rascunho", "entregue", "em_correcao", "aprovado"];
// Teto por evidencia e por mapeamento. Visita rende foto de rack, de quadro e
// de etiqueta -- 12 cobre isso e ainda barra o album inteiro do celular.
const MAX_EVIDENCIAS = 12;
const MAX_BYTES_EVIDENCIA = 6 * 1024 * 1024;
// O PDF do relatorio. 15 MB cobre com folga um relatorio com fotos embutidas --
// o exemplo real de dois nobreaks e duas fotos tem 33 KB.
const MAX_BYTES_ARQUIVO = 15 * 1024 * 1024;

/**
 * E PDF DE VERDADE? -- confere os BYTES, e nao o que o cliente disse.
 *
 * O mimetype vem da data URL, que vem do navegador, que vem do que o usuario
 * escolheu: renomear "coisa.exe" para "relatorio.pdf" ja bastaria. O arquivo
 * fica guardado e depois e servido de volta para outras pessoas da empresa
 * baixarem -- entao o que ele E importa mais do que como ele se chama.
 *
 * "%PDF-" nos primeiros bytes e a assinatura do formato.
 */
async function ehPdf(caminhoRelativo) {
  const aberto = await midiaStorage.abrirParaLeitura(caminhoRelativo, { inicio: 0, fim: 4 });
  if (!aberto) return false;
  const pedacos = [];
  for await (const p of aberto.stream) pedacos.push(p);
  return Buffer.concat(pedacos).toString("latin1").startsWith("%PDF-");
}

// QUEM SUPERVISIONA E O ADMINISTRADOR, e so ele.
//
// Havia uma marca separada no cadastro (`supervisorRanking`) e ela saiu: o
// administrador ja tem acesso a tudo no sistema, e uma segunda marca dizendo a
// mesma coisa so criava um jeito de as duas discordarem -- alguem com a marca e
// sem o cargo, ou o contrario.
//
// Le o CARGO NO BANCO a cada chamada, e nao do token: rebaixar alguem vale na
// hora, sem esperar a sessao dela expirar.
async function ehSupervisor(usuarioId) {
  if (!usuarioId) return false;
  const u = await prisma.usuario.findUnique({
    where: { id: usuarioId },
    select: { cargo: true },
  });
  return u?.cargo === "Administrador";
}

function saneiaItens(itens) {
  if (!itens || typeof itens !== "object") return null;
  const out = {};
  // Allowlist pela lista da pontuacao: campo desconhecido nao entra. Sem isso o
  // cliente poderia inflar a completude mandando chaves inventadas.
  for (const item of ITENS_MAPEAMENTO) {
    const v = itens[item.chave];
    if (typeof v === "string" && v.trim()) out[item.chave] = v.trim().slice(0, 2000);
  }
  return Object.keys(out).length ? out : null;
}

class MapeamentoService {
  /**
   * Guarda as fotos em DISCO e devolve so os caminhos.
   *
   * Base64 no banco foi o que inchou a tabela de mensagens deste mesmo sistema
   * (2,6 s e 87 MB numa listagem) -- e uma visita rende mais foto do que uma
   * conversa. O `midiaStorage` ja resolve isso e ja e usado pelas conversas.
   */
  async _guardarEvidencias(lista, anteriores = []) {
    if (!Array.isArray(lista)) return anteriores;
    if (lista.length > MAX_EVIDENCIAS) {
      throw new AppError(`No máximo ${MAX_EVIDENCIAS} evidências por mapeamento.`, 400, "EVIDENCIAS_DEMAIS");
    }
    const guardadas = [];
    for (const item of lista) {
      // Item que ja esta gravado volta como referencia; so o que veio como data
      // URL e escrito de novo. Sem isso, editar o relatorio regravaria todas as
      // fotos a cada salvamento.
      if (item && typeof item === "object" && item.arquivo) {
        guardadas.push({ arquivo: item.arquivo, mimetype: item.mimetype || null, nome: item.nome || null });
        continue;
      }
      if (typeof item !== "string") continue;
      const salvo = await midiaStorage.salvarDataUrl(item, null, { maxBytes: MAX_BYTES_EVIDENCIA });
      if (!salvo) {
        throw new AppError("Evidência inválida ou acima de 6 MB.", 400, "EVIDENCIA_INVALIDA");
      }
      guardadas.push({ arquivo: salvo.arquivo, mimetype: salvo.mimetype, nome: null });
    }
    return guardadas;
  }

  /**
   * O PDF DO RELATORIO -- a entrega, e nao mais uma evidencia.
   *
   * Fica em campo proprio porque as duas coisas tem regras diferentes: a
   * contagem de evidencias PONTUA (3 fotos ja valem a faixa cheia), entao um
   * PDF entrando naquela lista daria ponto de "evidencia" para o documento que
   * a pessoa tinha que entregar de qualquer jeito.
   *
   * So PDF. Nao e frescura de formato: e o arquivo que vai para o cliente, e
   * aceitar qualquer coisa transformaria o historico numa pasta de downloads
   * onde ninguem sabe o que abre. O tipo e conferido pelos BYTES, e nao pelo
   * que o cliente diz -- ver `ehPdf`.
   *
   * Devolve `undefined` quando nao veio nada no corpo, para o `update` do
   * Prisma nao apagar um PDF ja enviado a cada salvamento do formulario.
   */
  async _guardarArquivo(entrada, atual = null) {
    if (entrada === undefined) return undefined;
    // `null` explicito = "remover o que estava la". O arquivo sai do DISCO
    // junto: limpar so a coluna deixaria o PDF orfao em `dados/midia`, sem
    // ninguem apontando para ele e sem ninguem sabendo que existe -- ocupando
    // espaco para sempre, e ainda por cima com dado de cliente dentro.
    if (entrada === null) {
      if (atual?.arquivoPath) await midiaStorage.remover(atual.arquivoPath).catch(() => {});
      return { arquivoPath: null, arquivoNome: null, arquivoBytes: null, arquivoEnviadoEm: null };
    }
    // Ja gravado: veio de volta na edicao, nao regrava.
    if (typeof entrada === "object" && entrada.arquivo) return undefined;

    const dataUrl = typeof entrada === "object" ? entrada.conteudo : entrada;
    const nome = (typeof entrada === "object" && entrada.nome) || "relatorio.pdf";
    if (typeof dataUrl !== "string" || !dataUrl) return undefined;

    const salvo = await midiaStorage.salvarDataUrl(dataUrl, "application/pdf", {
      maxBytes: MAX_BYTES_ARQUIVO,
    });
    if (!salvo) {
      throw new AppError(
        `Não foi possível guardar o relatório. Confira se é um PDF de até ${Math.round(MAX_BYTES_ARQUIVO / 1024 / 1024)} MB.`,
        400,
        "ARQUIVO_INVALIDO"
      );
    }
    if (!(await ehPdf(salvo.arquivo))) {
      // Apaga o que acabou de gravar: um arquivo recusado nao pode ficar
      // ocupando disco sem nenhuma linha no banco apontando para ele.
      await midiaStorage.remover(salvo.arquivo).catch(() => {});
      throw new AppError("O relatório precisa ser um arquivo PDF.", 400, "ARQUIVO_NAO_PDF");
    }
    // Descarta o PDF anterior: guardar todas as versoes seria outro recurso
    // (historico de versoes), e ninguem pediu -- ficariam so ocupando disco.
    if (atual?.arquivoPath) await midiaStorage.remover(atual.arquivoPath).catch(() => {});

    return {
      arquivoPath: salvo.arquivo,
      arquivoNome: String(nome).slice(0, 180),
      arquivoBytes: salvo.bytes,
      arquivoEnviadoEm: new Date(),
    };
  }

  /**
   * O PDF PARA DOWNLOAD -- e a mesma regra de quem pode ver.
   *
   * A checagem e refeita AQUI, e nao herdada da listagem: a listagem esconde a
   * linha, mas o link do arquivo e um endereco proprio, e quem tivesse um id de
   * outro tecnico baixaria o relatorio dele direto. E o tipo de buraco que so
   * aparece quando alguem procura.
   */
  async arquivoDe(id, usuario) {
    const m = await prisma.mapeamentoTecnico.findUnique({ where: { id } });
    if (!m) throw new AppError("Mapeamento não encontrado", 404, "NOT_FOUND");
    if (m.tecnicoId !== usuario?.sub && !(await ehSupervisor(usuario?.sub))) {
      throw new AppError("Sem acesso a este relatório", 403, "SEM_PERMISSAO");
    }
    if (!m.arquivoPath) throw new AppError("Este mapeamento não tem relatório anexado", 404, "SEM_ARQUIVO");
    const aberto = await midiaStorage.abrirParaLeitura(m.arquivoPath);
    if (!aberto) throw new AppError("Arquivo do relatório não encontrado no servidor", 404, "ARQUIVO_SUMIU");
    return { ...aberto, nome: m.arquivoNome || "relatorio.pdf" };
  }

  async listar(filtros, usuario) {
    const supervisor = await ehSupervisor(usuario?.sub);
    const where = {};
    // Tecnico ve SO o proprio. A restricao e aqui, e nao um filtro que a tela
    // manda: quem mandaria o filtro tambem poderia deixar de mandar.
    if (!supervisor) where.tecnicoId = usuario?.sub || "__ninguem__";
    else if (filtros?.tecnicoId) where.tecnicoId = filtros.tecnicoId;
    if (filtros?.status && STATUS.includes(filtros.status)) where.status = filtros.status;
    if (filtros?.competencia && /^\d{4}-\d{2}$/.test(filtros.competencia)) {
      const [ano, mes] = filtros.competencia.split("-").map(Number);
      where.dataVisita = { gte: new Date(ano, mes - 1, 1), lt: new Date(ano, mes, 1) };
    }

    const linhas = await prisma.mapeamentoTecnico.findMany({
      where,
      orderBy: [{ dataVisita: "desc" }, { criadoEm: "desc" }],
      take: 300,
    });
    return linhas.map((m) => this._mapear(m));
  }

  async obter(id, usuario) {
    const m = await prisma.mapeamentoTecnico.findUnique({ where: { id } });
    if (!m) throw new AppError("Mapeamento não encontrado", 404, "NOT_FOUND");
    if (m.tecnicoId !== usuario?.sub && !(await ehSupervisor(usuario?.sub))) {
      throw new AppError("Sem acesso a este mapeamento", 403, "SEM_PERMISSAO");
    }
    return this._mapear(m, { completo: true });
  }

  async criar(dados, usuario) {
    const nome = await this._nomeDe(usuario);
    const evidencias = await this._guardarEvidencias(dados.evidencias);
    const arquivo = (await this._guardarArquivo(dados.arquivo)) || {};
    const criado = await prisma.mapeamentoTecnico.create({
      data: {
        // O TECNICO E SEMPRE QUEM ESTA LOGADO. Aceitar do corpo deixaria
        // qualquer um lancar mapeamento no nome de outro -- e mapeamento e ponto.
        tecnicoId: usuario.sub,
        tecnicoNome: nome,
        empresa: String(dados.empresa || "").trim(),
        cnpj: dados.cnpj ? String(dados.cnpj).replace(/\D/g, "") : null,
        dataVisita: new Date(dados.dataVisita),
        prazoEm: new Date(dados.prazoEm),
        resumo: String(dados.resumo || "").trim(),
        itens: saneiaItens(dados.itens),
        pendencias: dados.pendencias ? String(dados.pendencias).trim() : null,
        evidencias,
        ...arquivo,
        status: dados.entregar ? "entregue" : "rascunho",
        entregueEm: dados.entregar ? new Date() : null,
      },
    });
    bus.emitRecurso("mapeamentos");
    return this._mapear(criado, { completo: true });
  }

  async atualizar(id, dados, usuario) {
    const atual = await prisma.mapeamentoTecnico.findUnique({ where: { id } });
    if (!atual) throw new AppError("Mapeamento não encontrado", 404, "NOT_FOUND");
    if (atual.tecnicoId !== usuario?.sub) {
      throw new AppError("Só quem fez a visita edita o mapeamento", 403, "SEM_PERMISSAO");
    }
    if (atual.status === "aprovado") {
      // Depois de aprovado o relatorio virou ponto no ranking. Editar ali
      // mudaria a pontuacao de um mes ja fechado sem passar por ninguem.
      throw new AppError("Mapeamento aprovado não pode ser editado.", 409, "JA_APROVADO");
    }

    const evidencias = await this._guardarEvidencias(dados.evidencias, atual.evidencias || []);
    const arquivo = await this._guardarArquivo(dados.arquivo, atual);
    const entregando = !!dados.entregar;

    const salvo = await prisma.mapeamentoTecnico.update({
      where: { id },
      data: {
        empresa: dados.empresa !== undefined ? String(dados.empresa).trim() : undefined,
        cnpj: dados.cnpj !== undefined ? (dados.cnpj ? String(dados.cnpj).replace(/\D/g, "") : null) : undefined,
        dataVisita: dados.dataVisita ? new Date(dados.dataVisita) : undefined,
        prazoEm: dados.prazoEm ? new Date(dados.prazoEm) : undefined,
        resumo: dados.resumo !== undefined ? String(dados.resumo).trim() : undefined,
        itens: dados.itens !== undefined ? saneiaItens(dados.itens) : undefined,
        pendencias: dados.pendencias !== undefined ? (dados.pendencias ? String(dados.pendencias).trim() : null) : undefined,
        evidencias,
        // Espalhado so quando ha o que gravar: `_guardarArquivo` devolve
        // `undefined` para "nao mexeram no PDF", e um spread de undefined nao
        // adiciona campo nenhum -- entao salvar o formulario nao apaga o
        // relatorio que ja estava anexado.
        ...(arquivo || {}),
        status: entregando ? "entregue" : undefined,
        // A PRIMEIRA entrega e a que vale para o prazo. Uma correcao devolvida e
        // reenviada duas semanas depois nao pode reescrever o carimbo e
        // transformar um atraso em entrega pontual.
        entregueEm: entregando && !atual.entregueEm ? new Date() : undefined,
      },
    });
    bus.emitRecurso("mapeamentos");
    return this._mapear(salvo, { completo: true });
  }

  /**
   * O supervisor aprova ou devolve.
   *
   * Devolver INCREMENTA `devolucoes`, e o contador nunca e zerado -- nem quando
   * o relatorio e aprovado depois. O retrabalho aconteceu; apagar o registro na
   * aprovacao faria a parcela de qualidade premiar quem errou e corrigiu igual a
   * quem acertou de primeira.
   */
  async validar(id, { aprovado, observacao }, usuario) {
    if (!(await ehSupervisor(usuario?.sub))) {
      throw new AppError("Só o supervisor valida mapeamentos", 403, "SEM_PERMISSAO");
    }
    const atual = await prisma.mapeamentoTecnico.findUnique({ where: { id } });
    if (!atual) throw new AppError("Mapeamento não encontrado", 404, "NOT_FOUND");
    if (atual.status === "rascunho") {
      throw new AppError("Este mapeamento ainda não foi entregue.", 409, "AINDA_RASCUNHO");
    }

    const nome = await this._nomeDe(usuario);
    const salvo = await prisma.mapeamentoTecnico.update({
      where: { id },
      data: {
        status: aprovado ? "aprovado" : "em_correcao",
        devolucoes: aprovado ? undefined : { increment: 1 },
        validadoPorId: usuario.sub,
        validadoPorNome: nome,
        validadoEm: new Date(),
        observacaoValidacao: observacao ? String(observacao).trim() : null,
      },
    });
    logger.info("Mapeamento validado", { id, aprovado: !!aprovado, por: nome });
    bus.emitRecurso("mapeamentos");
    return this._mapear(salvo, { completo: true });
  }

  async remover(id, usuario) {
    const atual = await prisma.mapeamentoTecnico.findUnique({ where: { id } });
    if (!atual) throw new AppError("Mapeamento não encontrado", 404, "NOT_FOUND");
    const supervisor = await ehSupervisor(usuario?.sub);
    if (atual.tecnicoId !== usuario?.sub && !supervisor) {
      throw new AppError("Sem acesso a este mapeamento", 403, "SEM_PERMISSAO");
    }
    // Rascunho o proprio tecnico descarta; entregue em diante so o supervisor,
    // porque a partir dali o registro ja entrou na conta do mes.
    if (atual.status !== "rascunho" && !supervisor) {
      throw new AppError("Mapeamento já entregue só pode ser removido pelo supervisor.", 403, "JA_ENTREGUE");
    }
    // O PDF sai do disco junto com o registro -- mesma razao do `arquivo: null`
    // acima: sem isto o arquivo fica orfao, com dado de cliente dentro.
    if (atual.arquivoPath) await midiaStorage.remover(atual.arquivoPath).catch(() => {});
    await prisma.mapeamentoTecnico.delete({ where: { id } });
    bus.emitRecurso("mapeamentos");
    return { removido: true };
  }

  async _nomeDe(usuario) {
    if (usuario?.nome) return usuario.nome;
    const u = await prisma.usuario.findUnique({ where: { id: usuario?.sub }, select: { nome: true } });
    return u?.nome || "Desconhecido";
  }

  /**
   * O DTO. Leva a completude e o "no prazo" JA CALCULADOS pelas mesmas funcoes
   * da pontuacao -- a tela mostra exatamente o numero que virou ponto, e nao uma
   * segunda leitura do mesmo relatorio.
   */
  _mapear(m, { completo = false } = {}) {
    const base = {
      id: m.id,
      tecnicoId: m.tecnicoId,
      tecnicoNome: m.tecnicoNome,
      empresa: m.empresa,
      cnpj: m.cnpj,
      dataVisita: m.dataVisita,
      prazoEm: m.prazoEm,
      entregueEm: m.entregueEm,
      status: m.status,
      devolucoes: m.devolucoes,
      completude: Math.round(completudeDe(m) * 100),
      noPrazo: noPrazo(m),
      evidencias: Array.isArray(m.evidencias) ? m.evidencias.length : 0,
      // O PDF: nome, tamanho e quando foi enviado. O CAMINHO em disco nunca sai
      // daqui -- quem quer o arquivo pede pela rota, que reconfere a permissao.
      arquivo: m.arquivoPath
        ? { nome: m.arquivoNome || "relatorio.pdf", bytes: m.arquivoBytes || 0, enviadoEm: m.arquivoEnviadoEm }
        : null,
      validadoPorNome: m.validadoPorNome,
      validadoEm: m.validadoEm,
      observacaoValidacao: m.observacaoValidacao,
      criadoEm: m.criadoEm,
    };
    if (!completo) return base;
    return {
      ...base,
      resumo: m.resumo,
      itens: m.itens || {},
      pendencias: m.pendencias,
      // Os caminhos so vao no detalhe: a listagem nao precisa deles e mandar
      // caminho de arquivo em toda linha e superficie exposta de graca.
      arquivos: Array.isArray(m.evidencias) ? m.evidencias : [],
    };
  }
}

module.exports = new MapeamentoService();
module.exports.STATUS = STATUS;
module.exports.MAX_EVIDENCIAS = MAX_EVIDENCIAS;
module.exports.ehSupervisor = ehSupervisor;
