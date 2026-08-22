const prisma = require("../database/prisma.client");

class ContatoRepository {
  findAll(filtros = {}) {
    const where = {};
    if (filtros.tag) where.tag = filtros.tag;
    // A tela manda `?q=`; `busca` fica aceito para nao quebrar chamadas antigas.
    const termo = String(filtros.q || filtros.busca || "").trim();
    if (termo) {
      const digitos = termo.replace(/\D/g, "");
      // Sem o DDI: a agenda importada do WhatsApp grava 5527999990000 e ninguem
      // digita o 55 na busca.
      const telefone = digitos.length > 11 && digitos.startsWith("55") ? digitos.slice(2) : digitos;
      where.OR = [
        { nome: { contains: termo } },
        { empresa: { contains: termo } },
        { email: { contains: termo } },
        ...(telefone ? [{ telefone: { contains: telefone } }] : []),
      ];
    }

    return prisma.contato.findMany({ where, orderBy: { nome: "asc" } });
  }

  findById(id) {
    return prisma.contato.findUnique({ where: { id } });
  }

  // Usado pela sincronizacao da agenda do WhatsApp (telefone nao e unico no
  // schema, entao findFirst).
  findByTelefone(telefone) {
    return prisma.contato.findFirst({ where: { telefone } });
  }

  create(data) {
    return prisma.contato.create({ data });
  }

  update(id, data) {
    return prisma.contato.update({ where: { id }, data });
  }

  delete(id) {
    return prisma.contato.delete({ where: { id } });
  }
}

module.exports = new ContatoRepository();
