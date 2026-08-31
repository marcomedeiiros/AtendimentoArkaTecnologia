const prisma = require("../database/prisma.client");
const { mesmoTelefoneBr, variantesTelefoneBr } = require("../../shared/helpers/cnpj.helper");
const logger = require("../../config/logger");

class ParceiroRepository {
  findAll(busca) {
    const where = busca ? {
      OR: [
        { razaoSocial: { contains: busca } },
        { cnpj: { contains: busca } },
      ],
    } : {};
    return prisma.parceiro.findMany({ where, orderBy: { razaoSocial: "asc" } });
  }

  findByCnpj(cnpj) {
    return prisma.parceiro.findUnique({ where: { cnpj } });
  }

  async findAtivoByCnpj(cnpj) {
    // Otimização: findUnique (usa PK/índice único) é mais rápido que findFirst
    // Valida status em memória depois
    const parceiro = await prisma.parceiro.findUnique({ where: { cnpj } });
    return parceiro?.status === "ativo" ? parceiro : null;
  }

  /**
   * QUAL PARCEIRO ATIVO TEM ESTE TELEFONE NO CADASTRO?
   *
   * É a "memória por perfil": o cliente escreve pela primeira vez e o sistema já
   * sabe de que empresa ele é, sem pedir o CNPJ. Funciona porque `telefones` do
   * cadastro é preenchido -- medido na base real: 179 dos 183 parceiros têm.
   *
   * ── POR QUE O FILTRO É EM MEMÓRIA, E NÃO NO SQL ──────────────────────────
   *
   * `telefones` é texto livre e escrito por humanos: `(27)99999-8888`,
   * `(27) 9 9999-8888`, dois números separados por vírgula ou por barra. O
   * WhatsApp entrega `5527999998888`. Nenhum `LIKE` casa as duas pontas -- e o
   * SQLite não tem função para normalizar isso.
   *
   * O custo é aceitável e conhecido: a tabela toda são 183 linhas de três
   * colunas, e esta consulta roda UMA vez por atendimento (quando o cliente diz
   * "tenho contrato"), não por mensagem.
   *
   * ── DUAS EMPRESAS COM O MESMO NÚMERO: NÃO ADIVINHA ───────────────────────
   *
   * Acontece de verdade -- contador que atende várias empresas, matriz e filial
   * com o mesmo celular. Escolher uma seria abrir o chamado no CNPJ errado e o
   * atendente só descobriria depois. Ambíguo devolve `null`, e o fluxo pede o
   * CNPJ digitado, que é a pergunta certa nesse caso.
   *
   * @param {string} telefone  número como o WhatsApp entrega (com DDI)
   * @returns {Promise<object|null>} o parceiro, ou null se nenhum ou mais de um
   */
  async findAtivoByTelefone(telefone) {
    if (!variantesTelefoneBr(telefone).size) return null;

    const candidatos = await prisma.parceiro.findMany({
      where: { status: "ativo", telefones: { not: null } },
      select: { cnpj: true, razaoSocial: true, telefones: true, status: true },
    });

    // `telefones` pode trazer mais de um número: vírgula, ponto-e-vírgula, barra
    // e quebra de linha são os separadores que aparecem na base.
    const casaram = candidatos.filter((p) =>
      String(p.telefones || "")
        .split(/[,;/|\r\n]+/)
        .some((n) => mesmoTelefoneBr(telefone, n))
    );

    if (casaram.length === 1) return casaram[0];
    if (casaram.length > 1) {
      logger.info("Telefone cadastrado em mais de um parceiro: nao ha como escolher", {
        parceiros: casaram.map((p) => p.cnpj),
      });
    }
    return null;
  }

  upsert(cnpj, data) {
    return prisma.parceiro.upsert({
      where: { cnpj },
      update: data,
      create: { cnpj, ...data },
    });
  }

  delete(cnpj) {
    return prisma.parceiro.delete({ where: { cnpj } });
  }
}

module.exports = new ParceiroRepository();
