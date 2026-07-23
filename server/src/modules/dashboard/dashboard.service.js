const prisma = require("../../infrastructure/database/prisma.client");
const conversaRepository = require("../../infrastructure/repositories/conversa.repository");
const parceiroRepository = require("../../infrastructure/repositories/parceiro.repository");
const equipeRepository = require("../../infrastructure/repositories/equipe.repository");

class DashboardService {
  async obterMetricas() {
    const [statusCounts, parceirosAtivos, equipeOnline, validacoesCnpj, contatos] = await Promise.all([
      conversaRepository.countByStatus(),
      prisma.parceiro.count({ where: { status: "ativo" } }),
      prisma.equipe.count({ where: { status: "online" } }),
      prisma.conversa.count({ where: { cnpjVerificado: true } }),
      prisma.contato.count(),
    ]);

    const mapStatus = Object.fromEntries(
      statusCounts.map((s) => [s.statusAtendimento, s._count.id])
    );

    const atendimentosAtivos =
      (mapStatus.aguardando || 0) + (mapStatus.em_atendimento || 0);

    return {
      clientesWhatsapp: contatos,
      atendimentosAtivos,
      atendimentosFinalizados:
        (mapStatus.finalizado || 0) + (mapStatus.resolvido || 0),
      validacoesCnpj,
      parceirosAtivos,
      equipeOnline,
      totalEquipe: await prisma.equipe.count(),
      filaAguardando: mapStatus.aguardando || 0,
    };
  }
}

module.exports = new DashboardService();
