const { EventEmitter } = require("events");

// Barramento de eventos em memoria. O webhook/engine/service publicam aqui e o
// endpoint SSE (conversa.stream) assina para empurrar as atualizacoes ao front
// sem polling. Processo unico: nao sobrevive a restart nem escala horizontal --
// suficiente para o cenario atual (uma instancia de back-end).
//
// E UM canal so, de proposito. Quando uma tela precisava de dado fresco, a
// tentacao era criar mais um polling proprio; o resultado eram varios
// mecanismos de tempo real concorrendo e discordando. Aqui tudo sai pela mesma
// conexao SSE que o painel ja mantem aberta: conversa (o objeto inteiro) e
// "recurso" (um aviso de que uma LISTA mudou e vale reler).
class EventBus extends EventEmitter {
  emitConversa(conversa) {
    if (!conversa?.id) return;
    this.emit("conversa", { type: "conversa:update", conversa });
  }

  emitDelete(id) {
    if (!id) return;
    this.emit("conversa", { type: "conversa:delete", id });
  }

  /**
   * Avisa que uma lista mudou no servidor (parceiros, equipe, contatos...).
   *
   * Manda o NOME do recurso, nao o conteudo: quem escuta decide se aquela lista
   * lhe interessa e a rele pela API normal, ja com as permissoes daquele
   * operador aplicadas. Empurrar o conteudo pelo stream exigiria replicar aqui
   * cada regra de acesso das rotas -- e e assim que um stream comeca a vazar o
   * que a leitura esconde.
   */
  emitRecurso(recurso) {
    if (!recurso) return;
    this.emit("conversa", { type: "recurso:update", recurso });
  }
}

const bus = new EventBus();
// Muitas conexoes SSE simultaneas sao esperadas (uma por aba aberta).
bus.setMaxListeners(0);

module.exports = bus;
