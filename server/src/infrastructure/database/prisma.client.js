const { PrismaClient } = require("@prisma/client");
const logger = require("../../config/logger");

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development"
    ? [{ emit: "event", level: "query" }, "error", "warn"]
    : ["error", "warn"],
});

if (process.env.NODE_ENV === "development") {
  prisma.$on("query", (event) => {
    logger.debug("Prisma query", { query: event.query, duration: event.duration });
  });
}

// Otimizacao do SQLite: por padrao ele usa journal "DELETE", que trava o banco
// INTEIRO a cada escrita -- e o painel le muito (SSE), entao apagar/enviar
// ficavam esperando o lock. WAL deixa leitura e escrita acontecerem juntas;
// busy_timeout espera o lock em vez de falhar; synchronous=NORMAL acelera as
// escritas (seguro com WAL). Roda uma vez no boot; nao se aplica a Postgres
// (nesse caso os PRAGMAs falham e sao ignorados).
const dbUrl = process.env.DATABASE_URL || "";
const ehPostgresOuMysql = /^(postgres|postgresql|mysql):/i.test(dbUrl);
if (!ehPostgresOuMysql) {
  (async () => {
    // $queryRawUnsafe: alguns PRAGMAs (ex.: journal_mode) retornam uma linha, o
    // que o $executeRawUnsafe recusa. Cada um isolado: se um falhar, os outros
    // ainda aplicam.
    const pragma = async (sql) => {
      try {
        await prisma.$queryRawUnsafe(sql);
      } catch (e) {
        logger.warn("Falha no PRAGMA do SQLite", { sql, message: e.message });
      }
    };
    await pragma("PRAGMA journal_mode=WAL;");
    await pragma("PRAGMA busy_timeout=5000;");
    await pragma("PRAGMA synchronous=NORMAL;");
    logger.info("SQLite otimizado: WAL + busy_timeout + synchronous=NORMAL");
  })();
}

module.exports = prisma;
