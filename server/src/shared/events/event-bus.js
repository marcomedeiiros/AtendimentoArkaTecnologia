const { EventEmitter } = require("events");

// Barramento de eventos em memoria. O webhook/engine/service publicam aqui e o
// endpoint SSE (conversa.stream) assina para empurrar as atualizacoes ao front
// sem polling. Processo unico: nao sobrevive a restart nem escala horizontal --
// suficiente para o cenario atual (uma instancia de back-end).
class EventBus extends EventEmitter {
  emitConversa(conversa) {
    if (!conversa?.id) return;
    this.emit("conversa", { type: "conversa:update", conversa });
  }

  emitDelete(id) {
    if (!id) return;
    this.emit("conversa", { type: "conversa:delete", id });
  }
}

const bus = new EventBus();
// Muitas conexoes SSE simultaneas sao esperadas (uma por aba aberta).
bus.setMaxListeners(0);

module.exports = bus;
