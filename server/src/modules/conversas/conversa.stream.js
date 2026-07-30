const crypto = require("crypto");
const bus = require("../../shared/events/event-bus");
const logger = require("../../config/logger");

// Tickets de uso unico para autenticar o EventSource: o navegador nao consegue
// mandar o header Authorization no GET do SSE, e por privacidade nao colocamos o
// JWT na URL. O front faz um POST autenticado -> recebe um ticket curto -> abre
// o stream com ?ticket=. Ticket vive ~30s e some ao ser consumido.
const TICKET_TTL_MS = 30_000;
const HEARTBEAT_MS = 20_000;
const tickets = new Map(); // ticketId -> expiresAt

function limparExpirados() {
  const agora = Date.now();
  for (const [id, exp] of tickets) {
    if (exp < agora) tickets.delete(id);
  }
}

class ConversaStreamController {
  // POST /api/conversas/stream-ticket  (autenticada)
  criarTicket(req, res) {
    limparExpirados();
    const ticket = crypto.randomUUID();
    tickets.set(ticket, Date.now() + TICKET_TTL_MS);
    res.json({ success: true, data: { ticket } });
  }

  // GET /api/conversas/stream?ticket=...  (autenticada pelo ticket)
  stream(req, res) {
    const ticket = req.query.ticket;
    const exp = ticket && tickets.get(ticket);
    if (!exp || exp < Date.now()) {
      tickets.delete(ticket);
      return res.status(401).json({
        success: false,
        error: { code: "INVALID_TICKET", message: "Ticket de stream invalido ou expirado" },
      });
    }
    tickets.delete(ticket); // uso unico

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 3000\n\n");
    res.write(`event: ready\ndata: {"ok":true}\n\n`);

    const onConversa = (evento) => {
      try {
        res.write(`data: ${JSON.stringify(evento)}\n\n`);
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
