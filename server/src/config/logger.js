const winston = require("winston");
const env = require("./env");

const logger = winston.createLogger({
  level: env.nodeEnv === "production" ? "info" : "debug",
  format: winston.format.combine(
    // Horario de BRASILIA no log. O timestamp padrao do winston e UTC: quem lia
    // o log via "00:47" para um evento que aconteceu as 21:47, e comparar com o
    // relato de um atendente exigia fazer a conta de cabeca.
    winston.format.timestamp({
      format: () =>
        new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).replace(" ", "T"),
    }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: "arka-chatbot" },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp, ...meta }) => {
          const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
          return `${timestamp} [${level}]: ${message}${extra}`;
        })
      ),
    }),
  ],
});

module.exports = logger;
