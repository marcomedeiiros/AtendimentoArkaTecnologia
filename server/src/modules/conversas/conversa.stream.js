const crypto = require("crypto");
const bus = require("../../shared/events/event-bus");
const logger = require("../../config/logger");
const { podeAcessarSetor } = require("../../shared/helpers/setor.helper");

// Tickets de uso unico para autenticar o EventSource: o navegador nao consegue
// mandar o header Authorization no GET do SSE, e por privacidade nao colocamos o
// JWT na URL. O front faz um POST autenticado -> recebe um ticket curto -> abre
// o stream com ?ticket=. Ticket vive ~30s e some ao ser consumido.
const TICKET_TTL_MS = 30_000;
const HEARTBEAT_MS = 20_000;
const tickets = new Map(); // ticketId -> { exp, cargo }

function limparExpirados() {
  const agora = Date.now();
  for (const [id, t] of tickets) {
    if (t.exp < agora) tickets.delete(id);
  }
}

class ConversaStreamController {
  // POST /api/conversas/stream-ticket  (autenticada)
  criarTicket(req, res) {
    limparExpirados();
    const ticket = crypto.randomUUID();
    // Guarda o cargo de quem pediu (do token ja validado). O stream so entrega
    // eventos dos setores que esse cargo pode ver -- senao o SSE vazaria ao
    // vivo justamente o que listar/obter filtram na leitura.
    tickets.set(ticket, { exp: Date.now() + TICKET_TTL_MS, cargo: req.user?.cargo || null });
    res.json({ success: true, data: { ticket } });
  }

  // GET /api/conversas/stream?ticket=...  (autenticada pelo ticket)
  stream(req, res) {
    const ticket = req.query.ticket;
    const dados = ticket && tickets.get(ticket);
    if (!dados || dados.exp < Date.now()) {
      tickets.delete(ticket);
      return res.status(401).json({
        success: false,
        error: { code: "INVALID_TICKET", message: "Ticket de stream invalido ou expirado" },
      });
    }
    tickets.delete(ticket); // uso unico
    const cargo = dados.cargo;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 3000\n\n");
    res.write(`event: ready\ndata: {"ok":true}\n\n`);

    // `json` vem pronto do barramento: antes o stringify acontecia AQUI, ou
    // seja, uma vez por conexao aberta -- a mesma conversa era serializada
    // tantas vezes quantas abas houvesse. Ver event-bus._publicar.
    const onConversa = (evento, json) => {
      // Mesmo guard da leitura: quem nao pode ver o setor nao recebe o evento.
      //
      // O setor mora em `evento.conversa.setor`. Ler `evento.setor` (como era
      // antes) sempre dava `undefined`, `normalizarSetor` traduzia isso para
      // "Geral" -- que todo mundo ve -- e o stream entregava AO VIVO conversas
      // de setores que a listagem esconde daquele cargo.
      if (evento?.type === "conversa:update" && !podeAcessarSetor(cargo, evento.conversa?.setor)) {
        // ── PERDEU O ACESSO AGORA? ENTAO A CONVERSA TEM DE SAIR DA TELA ──────
        //
        // Descartar o evento em silencio protege o sigilo, mas nao termina o
        // trabalho: quem JA tinha a conversa na lista continuava com ela ali,
        // congelada no estado antigo, ate um F5. Transferir do Comercial para o
        // Tecnico "funcionava" no banco e nao aparecia na tela de ninguem.
        //
        // `setorAnterior` so vem quando a emissao MUDOU o setor. Se este cargo
        // via o setor de origem e nao ve o de destino, ele acabou de perder a
        // conversa -- e recebe uma remocao, com o id e nada mais. Sem
        // `setorAnterior` (a esmagadora maioria dos eventos), segue o descarte
        // silencioso de antes: nao da para mandar remocao de conversa que a
        // pessoa nunca teve, senao todo update de outro setor viraria trafego.
        if (evento.setorAnterior && podeAcessarSetor(cargo, evento.setorAnterior)) {
          try {
            res.write(
              `data: ${JSON.stringify({
                type: "conversa:saiu-do-setor",
                id: evento.conversa?.id,
                setor: evento.conversa?.setor || null,
              })}\n\n`
            );
          } catch (err) {
            logger.warn("Falha ao avisar saida de setor no stream SSE", { message: err.message });
          }
        }
        return;
      }
      // O patch de status carrega o setor no proprio evento (nao ha conversa
      // dentro dele). Sem este guard, o risquinho de uma conversa de outro setor
      // chegaria ao vivo para quem nem enxerga a conversa.
      if (evento?.type === "mensagem:status" && !podeAcessarSetor(cargo, evento.setor)) {
        return;
      }
      try {
        res.write(`data: ${json ?? JSON.stringify(evento)}\n\n`);
      } catch (err) {
        logger.warn("Falha ao escrever no stream SSE", { message: err.message });
      }
    };
    bus.on("conversa", onConversa);

    const heartbeat = setInterval(() => {
      res.write(": ping\n\n");
    }, HEARTBEAT_MS);

    req.on("close", () => {
      clearInterval(heartbeat);
      bus.off("conversa", onConversa);
    });
  }
}

module.exports = new ConversaStreamController();
