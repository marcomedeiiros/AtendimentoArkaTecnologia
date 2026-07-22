const { mascararCnpj } = require("../../shared/helpers/cnpj.helper");
const logger = require("../../config/logger");

class MockErpService {
  async aplicarDescontoParceiro({ cnpj, razaoSocial, percentual = 15 }) {
    logger.info("ERP mock: desconto aplicado", { cnpj, percentual });
    return {
      sucesso: true,
      mensagem: `Desconto de ${percentual}% aplicado para ${razaoSocial || mascararCnpj(cnpj)}.`,
      percentual,
    };
  }

  async gerarBoleto({ cnpj, razaoSocial }) {
    logger.info("ERP mock: boleto gerado", { cnpj });
    const linhaDigitavel = "23793.38128 60000.000003 00000.000400 1 84340000015000";
    return {
      sucesso: true,
      mensagem: `Boleto gerado para ${razaoSocial || mascararCnpj(cnpj)}.`,
      linhaDigitavel,
      pixCopiaCola: "00020126580014BR.GOV.BCB.PIX0136mock-pix-arka-tecnologia",
      vencimento: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    };
  }
}

module.exports = new MockErpService();
