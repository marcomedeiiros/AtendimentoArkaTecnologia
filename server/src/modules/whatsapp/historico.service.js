const evolutionApi = require("../../infrastructure/external/evolution-api.client");
const conversaRepository = require("../../infrastructure/repositories/conversa.repository");
const instanciaRepository = require("../../infrastructure/repositories/instancia.repository");
const midiaStorage = require("../../infrastructure/storage/midia.storage");
const whatsappService = require("./whatsapp.service");
const AppError = require("../../shared/errors/AppError");
const { motivoParaIgnorarJid } = require("../../shared/helpers/jid.helper");
const logger = require("../../config/logger");

// Teto por importacao. Nao e limite tecnico: e o que impede um clique de virar
// uma requisicao de dez minutos. Quem tem mais historico clica de novo -- a
// operacao e idempotente, a segunda passada so traz o que faltou.
const MAX_POR_IMPORTACAO = 3000;
const POR_PAGINA = 100;
// Teto de PAGINAS VARRIDAS (nao de mensagens importadas). Pagina cujas mensagens
// a Central ja tem nao consome o teto de importacao, mas consome uma ida a
// Evolution -- e sem um limite aqui um historico enorme e quase todo conhecido
// faria a varredura andar indefinidamente. 150 paginas = 15.000 mensagens
// examinadas por clique; o que sobrar vem no `restante` e no clique seguinte.
const MAX_PAGINAS = 150;

// ── MIDIA ANTIGA QUASE SEMPRE NAO EXISTE MAIS ────────────────────────────────
//
// O WhatsApp guarda os bytes da midia nos servidores dele por tempo limitado; o
// que fica no historico e o PONTEIRO. Baixar imagem/audio de meses atras falha
// na maioria dos casos, e cada tentativa e um round-trip.
//
// Por isso duas travas: um teto de tentativas e uma desistencia por falhas
// seguidas. Oito falhas em sequencia nao sao azar -- e a resposta de que aquele
// trecho do historico nao tem mais bytes, e insistir so faria o operador
// esperar. A mensagem entra de qualquer forma, com o rotulo ([Imagem], [Audio])
// e a marca `midiaIndisponivel`.
const MAX_TENTATIVAS_MIDIA = 60;
const FALHAS_SEGUIDAS_PARA_DESISTIR = 8;

const ROTULOS = {
  imagem: "[Imagem]",
  figurinha: "[Figurinha]",
  video: "[Vídeo]",
  documento: "[Documento]",
  audio: "[Áudio]",
  localizacao: "[Localização]",
  contato: "[Contato]",
};

class HistoricoService {
  /**
   * O QUE EXISTE PARA IMPORTAR -- consulta de leitura, nao muda nada.
   *
   * Existe porque "importar histórico" pode simplesmente nao ter o que importar,
   * e o motivo importa: se a Evolution nunca guardou mensagem (instancia criada
   * sem `syncFullHistory`, ou `DATABASE_SAVE_DATA_NEW_MESSAGE` desligado), nao ha
   * nada no banco dela e nenhum codigo aqui resolve isso. Melhor dizer isso na
   * tela do que rodar uma importacao que insere zero e parece um bug.
   */
  async previa(conversaId) {
    const { conversa, instanceName } = await this._contexto(conversaId);
    const jid = await this._resolverJid(conversa.telefone, instanceName);

    if (!jid) {
      return {
        telefone: conversa.telefone,
        jid: null,
        disponivel: 0,
        jaNaCentral: await conversaRepository.contarMensagensComWaId(conversa.id),
        motivo: "sem_historico",
      };
    }

    const { total } = await evolutionApi.findMessages(jid, { pagina: 1, porPagina: 1 }, instanceName);
    return {
      telefone: conversa.telefone,
      jid,
      disponivel: total,
      jaNaCentral: await conversaRepository.contarMensagensComWaId(conversa.id),
      motivo: total > 0 ? null : "sem_historico",
    };
  }

  /**
   * TRAZ O HISTORICO DO CELULAR PARA DENTRO DA CONVERSA.
   *
   * Escreve as mensagens DIRETO, sem passar pelo caminho do webhook. Isto e o
   * ponto central do desenho: `chatbotService.processar` faria o bot rodar
   * (menu, CNPJ, aviso de fora de horario), notificaria os painéis por SSE,
   * incrementaria nao-lidas e carimbaria tudo na OS em curso -- para cada uma
   * das mensagens antigas. Reprocessar historico como se fosse mensagem nova
   * mandaria resposta automatica para o cliente sobre conversa de meses atras.
   *
   * O que ele faz: le a pagina da Evolution, converte cada registro com os
   * MESMOS extratores do webhook (texto, midia, citacao), descarta o que ja
   * existe pelo `waMessageId`, cria uma OS sintetica para o trecho e insere.
   */
  async importar(conversaId, { limite = MAX_POR_IMPORTACAO, baixarMidia = true } = {}) {
    const { conversa, instanceName } = await this._contexto(conversaId);
    const jid = await this._resolverJid(conversa.telefone, instanceName);

    if (!jid) {
      return {
        importadas: 0,
        jaExistiam: 0,
        ignoradas: 0,
        disponivel: 0,
        motivo: "sem_historico",
      };
    }

    const teto = Math.min(Number(limite) || MAX_POR_IMPORTACAO, MAX_POR_IMPORTACAO);
    const { novos: mapaNovos, total, jaExistiam } = await this._coletar(jid, instanceName, teto);
    const novos = [...mapaNovos.entries()];

    if (novos.length === 0) {
      return {
        importadas: 0,
        jaExistiam,
        ignoradas: 0,
        disponivel: total,
        motivo: jaExistiam > 0 ? "tudo_ja_importado" : "sem_historico",
      };
    }

    const linhas = [];
    let semConteudo = 0;
    let midiaTentativas = 0;
    let falhasSeguidas = 0;

    // Ordem cronologica: a Evolution nao garante ordem, e `criadoEm` e o que
    // ordena a conversa na tela.
    novos.sort((a, b) => this._instante(a[1]) - this._instante(b[1]));

    for (const [waId, registro] of novos) {
      // Os extratores esperam o formato do webhook (`{ data: { message } }`).
      const envelope = { data: registro, message: registro.message };
      const texto = whatsappService.extrairTexto(envelope);
      let midia = whatsappService.extrairMidia(envelope);
      const citacao = whatsappService.extrairCitacao(envelope);

      if (!texto && !midia) {
        // Reacao, evento de protocolo, mensagem apagada: nada para mostrar.
        semConteudo += 1;
        continue;
      }

      if (midia && baixarMidia && midia.tipo !== "localizacao" && midia.tipo !== "contato") {
        const podeTentar =
          midiaTentativas < MAX_TENTATIVAS_MIDIA && falhasSeguidas < FALHAS_SEGUIDAS_PARA_DESISTIR;
        if (podeTentar) {
          midiaTentativas += 1;
          const arquivo = await this._baixarMidia(registro.key, midia, instanceName);
          if (arquivo) {
            midia = { ...midia, arquivo: arquivo.arquivo, mimetype: arquivo.mimetype };
            falhasSeguidas = 0;
          } else {
            midia = { ...midia, midiaIndisponivel: true };
            falhasSeguidas += 1;
          }
        } else {
          midia = { ...midia, midiaIndisponivel: true };
        }
      }

      const metadata = {
        ...(midia || {}),
        // MARCA DE ORIGEM. E o que permite distinguir, depois, o que a Central
        // registrou do que veio de fora dela -- inclusive para desfazer uma
        // importacao errada sem levar mensagem legitima junto.
        importada: true,
        importadaEm: new Date().toISOString(),
        ...(citacao?.texto ? { citacao: { texto: String(citacao.texto).slice(0, 500) } } : {}),
      };

      linhas.push({
        conversaId: conversa.id,
        origem: registro?.key?.fromMe ? "equipe" : "cliente",
        texto: texto || ROTULOS[midia?.tipo] || "[Mídia]",
        metadata,
        waMessageId: waId,
        // Mensagem antiga NAO recebe status de entrega: os risquinhos contam o
        // ciclo de vida de um envio NOSSO, acompanhado pelo ACK da Evolution.
        // Inventar "lida" aqui seria afirmar algo que nao foi observado.
        status: null,
        criadoEm: new Date(this._instante(registro)),
      });
    }

    if (linhas.length === 0) {
      return {
        importadas: 0,
        jaExistiam,
        ignoradas: semConteudo,
        disponivel: total,
        // Nada com conteudo para inserir tem duas causas diferentes, e o motivo
        // precisa distinguir: se o resto do historico ja estava na Central, o
        // desfecho e "ja importado" (o normal, ao clicar duas vezes). Reacao e
        // evento de protocolo nunca sao gravados, entao voltam a aparecer como
        // candidatos em toda passada -- eles sozinhos nao significam que o
        // historico esteja faltando.
        motivo: jaExistiam > 0 ? "tudo_ja_importado" : "sem_conteudo",
      };
    }

    const maisAntiga = linhas[0].criadoEm;
    const maisRecente = linhas[linhas.length - 1].criadoEm;

    const atendimento = await conversaRepository.criarAtendimentoImportado(conversa.id, {
      abertoEm: maisAntiga,
      fechadoEm: maisRecente,
    });
    for (const linha of linhas) linha.atendimentoId = atendimento.id;

    const { inseridas, ignoradas } = await conversaRepository.importarMensagens(conversa.id, linhas);

    logger.info("Histórico do WhatsApp importado", {
      conversaId: conversa.id,
      telefone: conversa.telefone,
      jid,
      inseridas,
      jaExistiam,
      semConteudo,
      numeroOS: atendimento.numeroOS,
    });

    return {
      importadas: inseridas,
      jaExistiam,
      ignoradas: ignoradas + semConteudo,
      disponivel: total,
      // Sobrou historico alem do teto desta passada? A tela precisa saber para
      // oferecer outra rodada em vez de dizer que acabou.
      restante: Math.max(0, total - (jaExistiam + inseridas + semConteudo)),
      periodo: { de: maisAntiga, ate: maisRecente },
      numeroOS: atendimento.numeroOS,
      motivo: null,
    };
  }

  // ── internos ──────────────────────────────────────────────────────────────

  async _contexto(conversaId) {
    const conversa = await conversaRepository.dadosParaImportacao(conversaId);
    if (!conversa) throw new AppError("Conversa não encontrada", 404, "NAO_ENCONTRADO");
    const instancia = await instanciaRepository.findById(conversa.instanciaId);
    if (!instancia) {
      throw new AppError("Instância do WhatsApp não encontrada", 404, "NAO_ENCONTRADO");
    }
    return { conversa, instanceName: instancia.nome };
  }

  // `messageTimestamp` vem em SEGUNDOS. Sem o *1000 toda mensagem cairia em
  // 1970 e o historico apareceria antes de tudo, na ordem errada.
  _instante(registro) {
    const bruto = Number(registro?.messageTimestamp) || 0;
    if (!bruto) return Date.now();
    return bruto < 1e12 ? bruto * 1000 : bruto;
  }

  /**
   * O JID REAL do telefone.
   *
   * `<numero>@s.whatsapp.net` cobre a maioria, mas nao todos: contato de Android
   * recente e identificado por `<id>@lid`, um numero que NAO e o telefone (ver
   * issue 1916 da Evolution). Filtrar mensagem por um jid que nao existe devolve
   * `total: 0` sem erro nenhum -- silencio que pareceria "nao tem historico".
   *
   * Por isso: tenta o obvio e, se vier vazio, procura nos chats da instancia um
   * fio cujo jid contenha os digitos do telefone.
   */
  async _resolverJid(telefone, instanceName) {
    const digitos = String(telefone || "").replace(/\D/g, "");
    if (!digitos) return null;

    const direto = `${digitos}@s.whatsapp.net`;
    if (await this._temMensagem(direto, instanceName)) return direto;

    const chats = await evolutionApi.findChats(instanceName);
    for (const chat of chats) {
      const jid = chat?.remoteJid || chat?.id || chat?.jid;
      if (!jid || String(jid).endsWith("@g.us")) continue;
      const dono = String(chat?.remoteJidAlt || "").replace(/\D/g, "");
      const proprio = String(jid).split("@")[0].replace(/\D/g, "");
      // Casa pelo fim do numero: o 9 extra e o codigo do pais aparecem de forma
      // inconsistente entre o que guardamos e o que o WhatsApp devolve.
      const casa = this._mesmoNumero(proprio, digitos) || this._mesmoNumero(dono, digitos);
      if (casa && (await this._temMensagem(jid, instanceName))) return jid;
    }
    return null;
  }

  _mesmoNumero(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    const curto = a.length < b.length ? a : b;
    const longo = a.length < b.length ? b : a;
    // 8 digitos = numero local sem DDD; abaixo disso a comparacao aceitaria
    // qualquer coisa.
    return curto.length >= 8 && longo.endsWith(curto);
  }

  async _temMensagem(jid, instanceName) {
    try {
      const r = await evolutionApi.findMessages(jid, { pagina: 1, porPagina: 1 }, instanceName);
      return r.total > 0;
    } catch {
      return false;
    }
  }

  /**
   * PERCORRE AS PAGINAS ATE JUNTAR `teto` MENSAGENS NOVAS.
   *
   * O teto conta o que e NOVO, nao o que foi lido -- e a diferenca importa.
   *
   * A Evolution nao documenta (nem garante) a ordem de `findMessages`. Se ela
   * devolver as mais RECENTES primeiro, encher o teto com os primeiros registros
   * lidos significaria arrastar justamente as mensagens que a Central ja tem, e
   * o trecho antigo -- o unico motivo de existir esta funcao -- nunca seria
   * alcancado. Pior: clicar de novo repetiria as mesmas paginas e daria "tudo ja
   * importado" para sempre, com o historico velho intacto do outro lado.
   *
   * Conferindo o que ja existe PAGINA POR PAGINA (uma consulta por 100 ids), a
   * pagina inteiramente conhecida custa quase nada e a varredura continua. Assim
   * cada clique avanca de verdade, em qualquer ordem que a Evolution use.
   *
   * `jaExistiam` sai daqui somado, e nao recontado depois: quem viu cada pagina
   * foi este laco.
   */
  async _coletar(jid, instanceName, teto) {
    const novos = new Map();
    let total = 0;
    let jaExistiam = 0;
    let pagina = 1;
    let paginas = 1;

    while (pagina <= paginas && pagina <= MAX_PAGINAS && novos.size < teto) {
      const r = await evolutionApi.findMessages(
        jid,
        { pagina, porPagina: POR_PAGINA },
        instanceName
      );
      total = r.total || total;
      paginas = r.paginas || 1;
      if (r.registros.length === 0) break;

      // Dedupe DENTRO da pagina e contra o que ja foi colhido: a janela da
      // Evolution desloca quando chega mensagem nova durante a paginacao, e o
      // mesmo id pode aparecer duas vezes. Duas linhas iguais no mesmo
      // `createMany` estouram o unique sem que nenhuma delas seja "a duplicada".
      const daPagina = new Map();
      for (const registro of r.registros) {
        const waId = registro?.key?.id ? String(registro.key.id) : null;
        if (!waId || novos.has(waId) || daPagina.has(waId)) continue;
        // Grupo, transmissao e canal nao sao conversa de atendimento: o fio aqui
        // e de um telefone. Mesma regra do recebimento ao vivo (jid.helper) --
        // duas listas do que ignorar acabariam divergindo, e a importacao
        // traria de volta exatamente o que o webhook aprendeu a barrar.
        if (motivoParaIgnorarJid(registro?.key?.remoteJid)) continue;
        daPagina.set(waId, registro);
      }

      const existentes = await conversaRepository.waIdsExistentes([...daPagina.keys()]);
      jaExistiam += existentes.size;
      for (const [waId, registro] of daPagina) {
        if (existentes.has(waId)) continue;
        novos.set(waId, registro);
        if (novos.size >= teto) break;
      }
      pagina += 1;
    }
    return { novos, total, jaExistiam };
  }

  async _baixarMidia(key, midia, instanceName) {
    try {
      const baixado = await evolutionApi.getBase64FromMediaMessage(key, instanceName);
      if (!baixado?.base64) return null;
      const mimetype = baixado.mimetype || midia.mimetype;
      const url = baixado.base64.startsWith("data:")
        ? baixado.base64
        : `data:${mimetype};base64,${baixado.base64}`;
      const salvo = await midiaStorage.salvarDataUrl(url, mimetype, {
        maxBytes: 20 * 1024 * 1024,
      });
      return salvo ? { arquivo: salvo.arquivo, mimetype } : null;
    } catch {
      return null;
    }
  }
}

module.exports = new HistoricoService();
