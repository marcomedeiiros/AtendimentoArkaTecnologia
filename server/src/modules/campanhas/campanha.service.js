const repo = require("../../infrastructure/repositories/campanha.repository");
const whatsappService = require("../whatsapp/whatsapp.service");
const AppError = require("../../shared/errors/AppError");
const logger = require("../../config/logger");
const { normalizarTelefoneBr } = require("../../shared/helpers/cnpj.helper");

/**
 * Envio em Massa -- orquestrado pelo SERVIDOR.
 *
 * Antes o laco de disparo rodava no navegador: fechar a aba parava a campanha
 * no meio, e o intervalo entre mensagens era so uma regra de tela -- a API
 * aceitava rajada, o que pode fazer o WhatsApp BLOQUEAR o numero.
 *
 * DEFESA EM PROFUNDIDADE (o servidor e a autoridade):
 *  - Intervalo MINIMO imposto aqui: nao adianta a tela mandar 0.
 *  - Teto de destinatarios por campanha.
 *  - UMA campanha por vez: duas em paralelo dobrariam o ritmo e furariam o
 *    proprio limite anti-bloqueio.
 *  - Telefones normalizados, validados e deduplicados antes de gravar.
 *  - Progresso e status vem do banco -- o front nao "declara" nada.
 */

// Piso de seguranca do ritmo. Mesmo que a tela peca 0, o servidor espaca.
const INTERVALO_MIN_SEG = 2;
const INTERVALO_MAX_SEG = 600;
const MAX_DESTINATARIOS = 1000;
const MAX_MENSAGEM = 4096;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Substitui {nome} e {primeiro_nome} pelo dado do destinatario.
function personalizar(mensagem, dest) {
  const nome = (dest.nome || "").trim();
  return String(mensagem)
    .replace(/\{nome\}/gi, nome)
    .replace(/\{primeiro_nome\}/gi, nome.split(/\s+/)[0] || "");
}

class CampanhaService {
  constructor() {
    // Controle do laco em memoria; o estado real vive no banco.
    this._rodando = new Set();
  }

  // Chamado no boot: campanha que ficou "enviando" apos restart vira "pausada".
  // Retomar e decisao humana, nao um disparo surpresa ao subir o servidor.
  async recuperarAposReinicio() {
    try {
      const r = await repo.pausarOrfas();
      if (r.count) logger.warn("Campanhas pausadas apos reinicio", { quantidade: r.count });
    } catch (e) {
      logger.warn("Falha ao pausar campanhas orfas", { message: e.message });
    }
  }

  listar() {
    return repo.listar();
  }

  async obter(id) {
    const c = await repo.findById(id);
    if (!c) throw new AppError("Campanha nao encontrada", 404, "NOT_FOUND");
    return c;
  }

  async criar({ nome, mensagem, destinatarios, intervaloDe, intervaloAte }, usuario = null) {
    const texto = String(mensagem || "").trim();
    if (!texto) throw new AppError("Escreva a mensagem da campanha", 400, "MENSAGEM_OBRIGATORIA");
    if (texto.length > MAX_MENSAGEM) {
      throw new AppError("Mensagem muito longa", 400, "MENSAGEM_LONGA");
    }

    // Normaliza e deduplica os telefones. Numero invalido nao entra na fila:
    // seria uma falha garantida consumindo o ritmo da campanha.
    const vistos = new Set();
    const lista = [];
    for (const d of Array.isArray(destinatarios) ? destinatarios : []) {
      const tel = normalizarTelefoneBr(d && d.telefone ? d.telefone : "");
      if (!tel || vistos.has(tel)) continue;
      vistos.add(tel);
      lista.push({ nome: String((d && d.nome) || "").slice(0, 120), telefone: tel });
    }
    if (!lista.length) {
      throw new AppError("Informe ao menos um destinatario valido", 400, "SEM_DESTINATARIOS");
    }
    if (lista.length > MAX_DESTINATARIOS) {
      throw new AppError("Destinatarios acima do limite por campanha", 400, "MUITOS_DESTINATARIOS");
    }

    // Piso/teto do ritmo: a autoridade e aqui, nao a tela.
    const de = Math.min(
      Math.max(Number(intervaloDe) || INTERVALO_MIN_SEG, INTERVALO_MIN_SEG),
      INTERVALO_MAX_SEG
    );
    const ate = Math.min(Math.max(Number(intervaloAte) || de, de), INTERVALO_MAX_SEG);

    const campanha = await repo.criar(
      {
        nome: String(nome || "").trim().slice(0, 120) || "Campanha",
        mensagem: texto,
        intervaloDe: de,
        intervaloAte: ate,
        status: "rascunho",
        criadoPorId: (usuario && usuario.sub) || null,
        criadoPorNome: (usuario && usuario.nome) || null,
      },
      lista
    );
    logger.info("Campanha criada", { id: campanha.id, total: campanha.total });
    return campanha;
  }

  async iniciar(id) {
    const campanha = await repo.findByIdBasico(id);
    if (!campanha) throw new AppError("Campanha nao encontrada", 404, "NOT_FOUND");
    if (["concluida", "cancelada"].includes(campanha.status)) {
      throw new AppError("Campanha ja finalizada", 400, "CAMPANHA_FINALIZADA");
    }
    if (campanha.status === "enviando") return campanha;

    // UMA por vez: duas campanhas juntas dobrariam o ritmo de disparo e
    // furariam o proprio limite anti-bloqueio.
    const outra = await repo.emAndamento();
    if (outra && outra.id !== id) {
      throw new AppError(
        "Ja existe uma campanha em andamento. Pause-a antes de iniciar outra.",
        409,
        "CAMPANHA_EM_ANDAMENTO"
      );
    }

    const atualizada = await repo.atualizar(id, {
      status: "enviando",
      erro: null,
      iniciadoEm: campanha.iniciadoEm || new Date(),
    });
    this._processar(id); // segundo plano: nao bloqueia a resposta
    return atualizada;
  }

  async pausar(id) {
    const campanha = await repo.findByIdBasico(id);
    if (!campanha) throw new AppError("Campanha nao encontrada", 404, "NOT_FOUND");
    if (campanha.status !== "enviando") return campanha;
    return repo.atualizar(id, { status: "pausada" });
  }

  async cancelar(id) {
    const campanha = await repo.findByIdBasico(id);
    if (!campanha) throw new AppError("Campanha nao encontrada", 404, "NOT_FOUND");
    return repo.atualizar(id, { status: "cancelada", concluidoEm: new Date() });
  }

  async remover(id) {
    const campanha = await repo.findByIdBasico(id);
    if (!campanha) throw new AppError("Campanha nao encontrada", 404, "NOT_FOUND");
    if (campanha.status === "enviando") {
      throw new AppError("Pause a campanha antes de excluir", 400, "CAMPANHA_ATIVA");
    }
    await repo.remover(id);
    return { removido: true, id };
  }

  // Laco de envio. Roda no servidor: sobrevive a fechar a aba do operador.
  // Reconsulta o status a cada volta -- e assim que "pausar"/"cancelar" fazem
  // efeito, sem precisar de sinal em memoria.
  async _processar(id) {
    if (this._rodando.has(id)) return; // ja ha um laco para esta campanha
    this._rodando.add(id);
    try {
      for (;;) {
        const campanha = await repo.findByIdBasico(id);
        if (!campanha || campanha.status !== "enviando") break;

        const alvo = await repo.proximoPendente(id);
        if (!alvo) {
          await repo.atualizar(id, { status: "concluida", concluidoEm: new Date() });
          logger.info("Campanha concluida", { id });
          break;
        }

        // Espaca ANTES de enviar: e o que reduz o risco de bloqueio.
        const de = campanha.intervaloDe;
        const ate = Math.max(campanha.intervaloAte, de);
        await sleep((de + Math.random() * (ate - de)) * 1000);

        // Pode ter sido pausada durante a espera.
        const agora = await repo.findByIdBasico(id);
        if (!agora || agora.status !== "enviando") break;

        try {
          await whatsappService.responderCliente({
            telefone: alvo.telefone,
            texto: personalizar(campanha.mensagem, alvo),
          });
          await repo.marcarDestinatario(alvo.id, "enviado");
          await repo.atualizar(id, { enviados: { increment: 1 } });
        } catch (e) {
          await repo.marcarDestinatario(alvo.id, "erro", String(e.message).slice(0, 300));
          await repo.atualizar(id, { falhas: { increment: 1 } });
          logger.warn("Falha ao enviar na campanha", {
            id,
            telefone: alvo.telefone,
            message: e.message,
          });
        }
      }
    } catch (e) {
      logger.error("Campanha interrompida por erro", { id, message: e.message });
      await repo
        .atualizar(id, { status: "pausada", erro: String(e.message).slice(0, 300) })
        .catch(() => {});
    } finally {
      this._rodando.delete(id);
    }
  }
}

module.exports = new CampanhaService();
module.exports.INTERVALO_MIN_SEG = INTERVALO_MIN_SEG;
module.exports.MAX_DESTINATARIOS = MAX_DESTINATARIOS;
