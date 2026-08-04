const prisma = require("../../infrastructure/database/prisma.client");
const conversaRepository = require("../../infrastructure/repositories/conversa.repository");
const parceiroRepository = require("../../infrastructure/repositories/parceiro.repository");
const equipeService = require("../equipe/equipe.service");

class DashboardService {
  async obterMetricas() {
    // A equipe vem do service, nao de uma contagem SQL: "online" e uma janela
    // de tempo sobre o ultimo acesso, calculada la. Duplicar essa regra aqui
    // faria o Dashboard e a Gestao da Equipe divergirem com o tempo.
    const [statusCounts, parceirosAtivos, equipe, validacoesCnpj, contatos] = await Promise.all([
      conversaRepository.countByStatus(),
      prisma.parceiro.count({ where: { status: "ativo" } }),
      equipeService.listar(),
      prisma.conversa.count({ where: { cnpjVerificado: true } }),
      prisma.contato.count(),
    ]);
    const equipeOnline = equipe.filter((m) => m.status === "online").length;

    const mapStatus = Object.fromEntries(
      statusCounts.map((s) => [s.statusAtendimento, s._count.id])
    );

    const atendimentosAtivos =
      (mapStatus.pendente || 0) + (mapStatus.aberta || 0);

    return {
      clientesWhatsapp: contatos,
      atendimentosAtivos,
      atendimentosFinalizados: mapStatus.fechada || 0,
      validacoesCnpj,
      parceirosAtivos,
      equipeOnline,
      totalEquipe: equipe.length,
      filaAguardando: mapStatus.pendente || 0,
    };
  }
}

module.exports = new DashboardService();
