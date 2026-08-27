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
  /**
   * Publica um evento JA SERIALIZADO.
   *
   * O `JSON.stringify` vivia dentro do listener do SSE, que roda uma vez POR
   * CONEXAO: com cinco abas abertas, a mesma conversa era serializada cinco
   * vezes (2,4ms e 1MB cada, num historico de 3000 mensagens). Serializando
   * aqui, uma vez, todas as conexoes escrevem a mesma string.
   *
   * O objeto continua indo junto porque o stream precisa dele para o guard de
   * setor -- decidir quem pode receber exige ler o conteudo, nao a string.
   */
  _publicar(evento) {
    let json;
    try {
      json = JSON.stringify(evento);
    } catch {
      return; // payload nao serializavel: melhor nao emitir do que derrubar
    }
    this.emit("conversa", evento, json);
  }

  emitConversa(conversa) {
    if (!conversa?.id) return;
    this._publicar({ type: "conversa:update", conversa });
  }

  /**
   * SO O RISQUINHO DA MENSAGEM MUDOU.
   *
   * Cada ACK do WhatsApp (enviando -> enviada -> entregue -> lida) redesenhava a
   * conversa inteira no front: uma mensagem enviada custava ate 4 emissoes
   * completas -- 261ms de CPU e 1,08MB num historico de 800 mensagens, so para
   * mudar um icone de status.
   *
   * `setor` viaja junto porque o stream filtra por ele; sem isso o guard nao
   * teria como decidir e o patch vazaria para cargos que nao veem a conversa.
   */
  emitStatusMensagem({ conversaId, mensagemId, status, versao, setor }) {
    if (!conversaId || !mensagemId || !status) return;
    this._publicar({
      type: "mensagem:status",
      conversaId,
      mensagemId,
      status,
      versao: versao ?? null,
      setor: setor ?? null,
    });
  }

  emitDelete(id) {
    if (!id) return;
    this._publicar({ type: "conversa:delete", id });
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
    this._publicar({ type: "recurso:update", recurso });
  }
}

const bus = new EventBus();
// Muitas conexoes SSE simultaneas sao esperadas (uma por aba aberta).
bus.setMaxListeners(0);

module.exports = bus;
