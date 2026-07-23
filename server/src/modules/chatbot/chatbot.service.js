const chatbotEngine = require("./chatbot.engine");
const sessaoRepository = require("../../infrastructure/repositories/sessao.repository");
const fluxoRepository = require("../../infrastructure/repositories/fluxo.repository");
const conversaRepository = require("../../infrastructure/repositories/conversa.repository");
const instanciaRepository = require("../../infrastructure/repositories/instancia.repository");
const AppError = require("../../shared/errors/AppError");
const env = require("../../config/env");

class ChatbotService {
  async resolverInstancia(instanceName) {
    const nome = instanceName || env.evolutionApi.instance;
    const instancia = await instanciaRepository.findByNome(nome);
    if (!instancia) {
      throw new AppError(`Instancia ${nome} nao encontrada`, 404, "INSTANCE_NOT_FOUND");
    }
    return instancia;
  }

  async processar({ telefone, texto, nomeCliente, instanceName }) {
    const instancia = await this.resolverInstancia(instanceName);
    return chatbotEngine.processarMensagemEntrada({
      instanciaId: instancia.id,
      instanceName: instancia.nome,
      telefone,
      texto,
      nomeCliente,
    });
  }

  async executarFluxoManual(fluxoId, conversaId) {
    const fluxo = await fluxoRepository.findById(fluxoId);
    if (!fluxo) throw new AppError("Fluxo nao encontrado", 404, "NOT_FOUND");

    const conversa = await conversaRepository.findById(conversaId);
    if (!conversa) throw new AppError("Conversa nao encontrada", 404, "NOT_FOUND");

    const instancia = await instanciaRepository.findById(conversa.instanciaId);
    const result = await chatbotEngine.executarFluxo(
      fluxo,
      conversa,
      conversa.telefone,
      conversa.instanciaId,
      instancia?.nome
    );

    return { conversaId, ...result };
  }

  async obterSessao(telefone, instanceName) {
    const instancia = await this.resolverInstancia(instanceName);
    const sessao = await sessaoRepository.findByTelefone(instancia.id, telefone);
    if (!sessao) return null;

    return {
      telefone: sessao.telefone,
      fluxoAtualId: sessao.fluxoAtualId,
      passoAtualId: sessao.passoAtualId,
      aguardando: sessao.aguardando,
      ativo: sessao.ativo,
      contexto: sessao.contexto,
    };
  }
}

module.exports = new ChatbotService();
