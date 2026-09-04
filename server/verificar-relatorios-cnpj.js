// Verificacao dos RELATORIOS POR CLIENTE (CNPJ) -- `node verificar-relatorios-cnpj.js`.
//
// Este relatorio SAI DA EMPRESA para o cliente dela. Isso muda o que precisa
// ser provado: nao basta "nao quebra". Um numero errado aqui vira um documento
// assinado com a conta errada, e ninguem do outro lado tem como conferir.
//
// O que o script vigia, em ordem de gravidade:
//
//   1. A JANELA DO PERIODO. Fuso de Brasilia, janelas de CALENDARIO (o mes
//      fechado, nao "os ultimos 30 dias"), virada de mes e de ano. Um erro de
//      uma hora aqui move chamados de um mes para o outro.
//   2. O RECORTE POR EMPRESA. Chamado de outro CNPJ nao pode vazar para o
//      relatorio de ninguem -- e o pior defeito possivel neste arquivo.
//   3. A ANCORA. O corte e por `fechadoEm`, e a consequencia (aberto em um mes,
//      fechado no outro) e deliberada e precisa continuar valendo.
//   4. Motivo ausente vira categoria nomeada, e nao some.
//
// Nao toca no banco: substitui o Prisma e os repositorios por dubles.
const path = require("path");

const erros = [];
const check = (cond, msg) => {
  if (!cond) erros.push(msg);
  console.log(`  ${cond ? "OK   " : "FALHA"} ${msg}`);
};

let atendimentosNoBanco = [];
let parceirosNoBanco = [];
let ultimoWhere = null;

function substituir(rel, exports) {
  const id = require.resolve(path.join(__dirname, rel));
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

// Duble do Prisma: aplica o `where` que o service montou sobre a lista em
// memoria. E o unico jeito de provar que o RECORTE esta certo sem um banco.
substituir("src/infrastructure/database/prisma.client.js", {
  atendimento: {
    findMany: async ({ where }) => {
      ultimoWhere = where;
      return atendimentosNoBanco.filter((a) => {
        if (where.status && a.status !== where.status) return false;
        if (where.fechadoEm) {
          const t = new Date(a.fechadoEm).getTime();
          if (where.fechadoEm.gte && t < where.fechadoEm.gte.getTime()) return false;
          if (where.fechadoEm.lt && t >= where.fechadoEm.lt.getTime()) return false;
        }
        const filtroCnpj = where.conversa?.cnpj;
        if (filtroCnpj?.in && !filtroCnpj.in.includes(a.conversa?.cnpj)) return false;
        if (filtroCnpj?.not === null && !a.conversa?.cnpj) return false;
        return true;
      });
    },
  },
});
substituir("src/infrastructure/repositories/parceiro.repository.js", {
  findAll: async () => parceirosNoBanco,
  findByCnpj: async (c) => parceirosNoBanco.find((p) => p.cnpj === c) || null,
});
substituir("src/modules/configuracoes/configuracao.service.js", {
  motivosEncerramento: async () => ["Backup e restauracao", "Financeiro e boleto"],
});

const servico = require("./src/modules/relatorios/relatorio.service");

// Instante em Brasilia -> Date. Sao Paulo e UTC-3 o ano inteiro desde 2019.
const brt = (iso) => new Date(`${iso}-03:00`);

function os(over = {}) {
  return {
    id: over.id || Math.random().toString(36).slice(2),
    numeroOS: over.numeroOS ?? 1,
    status: "fechada",
    setor: "Técnico",
    motivo: "Backup e restauracao",
    atendenteNome: "Fulano",
    avaliacao: null,
    avaliacaoStatus: null,
    feedback: null,
    abertoEm: brt("2026-09-10T09:00:00"),
    fechadoEm: brt("2026-09-10T11:00:00"),
    conversa: { cnpj: "11111111000111", empresa: "Alfa", cliente: "Contato", telefone: "5527900000000" },
    ...over,
  };
}

(async () => {
  // ── 1. A JANELA DO PERIODO ────────────────────────────────────────────────
  console.log("\n=== 1. janelas de periodo (fuso de Brasilia) ===");
  const j = (p, ref) => servico.janela(p, ref);

  const dia = j("dia", "2026-09-03");
  check(dia.inicio.toISOString() === "2026-09-03T03:00:00.000Z", "dia comeca a meia-noite de Brasilia (03:00Z)");
  check(dia.fim.toISOString() === "2026-09-04T03:00:00.000Z", "e termina na meia-noite seguinte (fim exclusivo)");
  check(dia.fimIso === "2026-09-03", "o rotulo mostra o ultimo dia INCLUIDO, nao o limite exclusivo");

  const sete = j("7dias", "2026-09-03");
  check(sete.inicioIso === "2026-08-28" && sete.fimIso === "2026-09-03", "7 dias INCLUI hoje (28/08 a 03/09)");

  const mes = j("mes", "2026-09-15");
  check(mes.inicioIso === "2026-09-01" && mes.fimIso === "2026-09-30", "mes = calendario fechado, nao ultimos 30 dias");
  const dez = j("mes", "2026-12-10");
  check(dez.fim.toISOString() === "2027-01-01T03:00:00.000Z", "virada de ANO no periodo mensal");
  const fev = j("mes", "2026-02-10");
  check(fev.fimIso === "2026-02-28", "fevereiro nao inventa dia 30");

  const ano = j("ano", "2026-06-01");
  check(ano.inicioIso === "2026-01-01" && ano.fimIso === "2026-12-31", "ano = calendario");

  const seteVirada = j("7dias", "2026-03-02");
  check(seteVirada.inicioIso === "2026-02-24", "7 dias atravessa a virada de mes corretamente");

  let recusou = false;
  try { j("semestre", "2026-09-03"); } catch (e) { recusou = e?.statusCode === 400; }
  check(recusou, "periodo desconhecido e recusado com 400");

  // ── 2. O RECORTE POR EMPRESA ──────────────────────────────────────────────
  //
  // O defeito mais grave possivel neste arquivo: o chamado de um cliente
  // aparecer no relatorio de outro.
  console.log("\n=== 2. o recorte nao vaza entre empresas ===");
  parceirosNoBanco = [
    { cnpj: "11111111000111", razaoSocial: "Alfa Ltda", status: "ativo" },
    { cnpj: "22222222000122", razaoSocial: "Beta SA", status: "ativo" },
  ];
  atendimentosNoBanco = [
    os({ numeroOS: 1 }),
    os({ numeroOS: 2, motivo: "Financeiro e boleto" }),
    os({ numeroOS: 3, conversa: { cnpj: "22222222000122" } }),
    // Sem CNPJ: nao pertence a relatorio de cliente nenhum.
    os({ numeroOS: 4, conversa: { cnpj: null } }),
  ];

  const alfa = await servico.relatorioEmpresa("11.111.111/0001-11", { periodo: "mes", referencia: "2026-09-15" });
  check(alfa.resumo.totalOS === 2, `Alfa ve so as 2 OS dela (viu ${alfa.resumo.totalOS})`);
  check(alfa.chamados.every((c) => c.os !== "OS00003"), "a OS da Beta NAO aparece no relatorio da Alfa");
  check(ultimoWhere?.conversa?.cnpj?.in?.length === 1, "a consulta filtra por UM cnpj, e nao no codigo depois");
  check(alfa.empresa.cnpj === "11111111000111", "o CNPJ mascarado da entrada e normalizado");

  const beta = await servico.relatorioEmpresa("22222222000122", { periodo: "mes", referencia: "2026-09-15" });
  check(beta.resumo.totalOS === 1, "Beta ve so a dela");

  console.log("\n=== 2b. OS sem CNPJ nao entra em relatorio nenhum ===");
  const soma = alfa.resumo.totalOS + beta.resumo.totalOS;
  check(soma === 3, `a soma dos relatorios (${soma}) exclui a OS sem empresa -- e isso e esperado`);

  // ── 3. A ANCORA E O FECHAMENTO ────────────────────────────────────────────
  console.log("\n=== 3. o periodo recorta por fechadoEm ===");
  atendimentosNoBanco = [
    // Aberta em agosto, fechada em setembro: conta em SETEMBRO.
    os({ numeroOS: 10, abertoEm: brt("2026-08-28T10:00:00"), fechadoEm: brt("2026-09-02T10:00:00") }),
    // Aberta e fechada em agosto: nao conta em setembro.
    os({ numeroOS: 11, abertoEm: brt("2026-08-10T10:00:00"), fechadoEm: brt("2026-08-11T10:00:00") }),
  ];
  const set = await servico.relatorioEmpresa("11111111000111", { periodo: "mes", referencia: "2026-09-15" });
  check(set.resumo.totalOS === 1, "so a OS FECHADA em setembro conta");
  check(set.chamados[0].os === "OS00010", "e e a que atravessou a virada do mes");

  console.log("\n=== 3b. bordas exatas do dia ===");
  atendimentosNoBanco = [
    os({ numeroOS: 20, fechadoEm: brt("2026-09-03T00:00:00") }), // 1o instante
    os({ numeroOS: 21, fechadoEm: brt("2026-09-03T23:59:59") }), // ultimo instante
    os({ numeroOS: 22, fechadoEm: brt("2026-09-04T00:00:00") }), // ja e o dia seguinte
  ];
  const umDia = await servico.relatorioEmpresa("11111111000111", { periodo: "dia", referencia: "2026-09-03" });
  check(umDia.resumo.totalOS === 2, `pega a meia-noite e o 23:59, e NAO o dia seguinte (viu ${umDia.resumo.totalOS})`);

  // ── 4. MOTIVO AUSENTE VIRA CATEGORIA ──────────────────────────────────────
  //
  // OS fechada antes do campo existir, ou fechada pelo bot, tem motivo nulo.
  // Sumir com ela faria as contagens nao baterem com o total.
  console.log("\n=== 4. motivo ausente e nomeado, nao sumido ===");
  atendimentosNoBanco = [
    os({ numeroOS: 30, motivo: null }),
    os({ numeroOS: 31, motivo: "   " }),
    os({ numeroOS: 32, motivo: "Backup e restauracao" }),
  ];
  const semMotivo = await servico.relatorioEmpresa("11111111000111", { periodo: "mes", referencia: "2026-09-15" });
  const cat = semMotivo.porMotivo.find((m) => m.nome === servico.SEM_MOTIVO);
  check(!!cat && cat.total === 2, "null e string vazia caem em 'Não informado'");
  check(semMotivo.resumo.totalOS === 3, "e continuam contando no total");
  const somaPct = semMotivo.porMotivo.reduce((a, m) => a + m.total, 0);
  check(somaPct === 3, "as fatias somam o total (nada some pelo caminho)");
  check(
    semMotivo.porMotivo.every((m) => m.pct <= 100) &&
      Math.abs(semMotivo.porMotivo.reduce((a, m) => a + m.pct, 0) - 100) < 0.5,
    "os percentuais usam a base DESTA empresa e somam ~100"
  );

  // ── 5. CSAT SO COM AMOSTRA ────────────────────────────────────────────────
  console.log("\n=== 5. satisfacao exige amostra minima ===");
  atendimentosNoBanco = [os({ numeroOS: 40, avaliacao: 5 })];
  const umaNota = await servico.relatorioEmpresa("11111111000111", { periodo: "mes", referencia: "2026-09-15" });
  check(umaNota.resumo.avaliacaoMedia === null, "com 1 nota, a media NAO e publicada");
  check(umaNota.resumo.avaliacoesRecebidas === 1, "mas o numero de avaliacoes e informado");

  atendimentosNoBanco = [
    os({ numeroOS: 41, avaliacao: 5 }), os({ numeroOS: 42, avaliacao: 4 }), os({ numeroOS: 43, avaliacao: 3 }),
  ];
  const tresNotas = await servico.relatorioEmpresa("11111111000111", { periodo: "mes", referencia: "2026-09-15" });
  check(tresNotas.resumo.avaliacaoMedia === 4, "com 3 notas, publica a media (4)");

  // ── 6. O MAPA DE TODOS OS CLIENTES ────────────────────────────────────────
  console.log("\n=== 6. mapa de clientes ===");
  parceirosNoBanco = [
    { cnpj: "11111111000111", razaoSocial: "Alfa Ltda", status: "ativo" },
    { cnpj: "22222222000122", razaoSocial: "Beta SA", status: "ativo" },
    { cnpj: "33333333000133", razaoSocial: "Gama ME", status: "inativo" },
  ];
  atendimentosNoBanco = [os({ numeroOS: 50 }), os({ numeroOS: 51 })];
  const mapa = await servico.mapaClientes({ periodo: "mes", referencia: "2026-09-15" });
  check(mapa.clientes.length === 2, "empresa INATIVA fica de fora do mapa");
  check(mapa.clientes[0].razaoSocial === "Alfa Ltda", "ordena por volume: quem teve movimento primeiro");
  const beta2 = mapa.clientes.find((c) => c.razaoSocial === "Beta SA");
  check(!!beta2 && beta2.totalOS === 0, "empresa SEM chamados aparece com zero, e nao some da lista");
  check(mapa.totalOS === 2, "o total do periodo confere");

  // ── 7. EMPRESA QUE NAO EXISTE ─────────────────────────────────────────────
  console.log("\n=== 7. empresa fora de Clientes (CNPJ) ===");
  let deu404 = false;
  try { await servico.relatorioEmpresa("99999999000199", { periodo: "mes" }); }
  catch (e) { deu404 = e?.statusCode === 404; }
  check(deu404, "404 para CNPJ que nao esta cadastrado");

  console.log("\n" + "=".repeat(70));
  if (erros.length) {
    console.log(`${erros.length} FALHA(S):`);
    erros.forEach((e) => console.log(`  - ${e}`));
    process.exit(1);
  }
  console.log("Relatorios por cliente (CNPJ): tudo OK");
})().catch((e) => {
  console.error("Erro inesperado na verificacao:", e);
  process.exit(1);
});
