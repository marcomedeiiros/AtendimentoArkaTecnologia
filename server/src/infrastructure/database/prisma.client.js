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

module.exports = prisma;
