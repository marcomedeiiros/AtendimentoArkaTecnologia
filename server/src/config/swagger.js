const swaggerJsdoc = require("swagger-jsdoc");
const env = require("./env");

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Arka Chatbot API",
      version: "1.0.0",
      description: "API REST para integracao de chatbot WhatsApp - Arka Tecnologia",
    },
    servers: [{ url: `http://localhost:${env.port}`, description: "Desenvolvimento" }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
        webhookToken: {
          type: "apiKey",
          in: "header",
          name: "x-webhook-token",
        },
      },
    },
  },
  apis: ["./src/modules/**/*.routes.js", "./src/app.js"],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
