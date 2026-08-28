require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const swaggerUi = require("swagger-ui-express");

const env = require("./config/env");
const logger = require("./config/logger");
const swaggerSpec = require("./config/swagger");
const errorMiddleware = require("./shared/middlewares/error.middleware");
const { apiLimiter } = require("./shared/middlewares/rateLimit.middleware");
const { csrfMiddleware } = require("./shared/middlewares/csrf.middleware");

const authRoutes = require("./modules/auth/auth.routes");
const equipeRoutes = require("./modules/equipe/equipe.routes");
const parceiroRoutes = require("./modules/parceiros/parceiro.routes");
const contatoRoutes = require("./modules/contatos/contato.routes");
const fluxoRoutes = require("./modules/fluxos/fluxo.routes");
const conversaRoutes = require("./modules/conversas/conversa.routes");
const dashboardRoutes = require("./modules/dashboard/dashboard.routes");
const helpdeskRoutes = require("./modules/helpdesk/helpdesk.routes");
const chatbotRoutes = require("./modules/chatbot/chatbot.routes");
const n8nRoutes = require("./modules/n8n/n8n.routes");
const configuracaoRoutes = require("./modules/configuracoes/configuracao.routes");
const permissaoRoutes = require("./modules/permissoes/permissao.routes");
const preferenciaRoutes = require("./modules/preferencias/preferencia.routes");
const bugRoutes = require("./modules/bugs/bug.routes");
const mensagemRapidaRoutes = require("./modules/mensagensRapidas/mensagemRapida.routes");
const campanhaRoutes = require("./modules/campanhas/campanha.routes");
const agendaRoutes = require("./modules/agenda/agenda.routes");
const {
  webhookRouter,
  adminRouter,
  webhookLimiter,
} = require("./modules/whatsapp/whatsapp.routes");
const webhookAuth = require("./shared/middlewares/webhook.middleware");

function createApp() {
  const app = express();

  // QUEM E O CLIENTE. Precisa vir antes de qualquer limiter.
  //
  // Sem isto o Express nao confia no `X-Forwarded-For` do nginx e enxerga o IP
  // do container em toda requisicao -- o rate limiting deixa de ser por IP e
  // vira uma cota global, alem de o express-rate-limit avisar em cada chamada.
  // Numero exato de hops, nunca `true` (ver env.trustProxy).
  app.set("trust proxy", env.trustProxy);

  // ── CABECALHOS DE SEGURANCA ───────────────────────────────────────────────
  //
  // Ate aqui o app nao mandava NENHUM: sem CSP, sem HSTS, sem protecao contra
  // enquadramento. O nginx tambem nao repunha (client/nginx.conf so tem
  // Cache-Control), entao nao havia nada.
  //
  // A CSP e escrita para ESTE app, e nao a padrao do helmet -- a padrao
  // quebraria o Google Fonts e o Turnstile. Cada permissao abaixo existe por um
  // motivo concreto, e esta anotada: permissao de CSP sem justificativa vira
  // permissao para sempre, porque ninguem depois sabe se pode tirar.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],

          // SEM 'unsafe-inline' e SEM 'unsafe-eval'. E esta linha que faz a CSP
          // valer alguma coisa contra XSS -- as outras sao consequencia. O
          // painel e um bundle do Vite, nao ha script inline para acomodar.
          //
          // O Turnstile precisa estar aqui, e nao so em `frameSrc`: ele carrega
          // `challenges.cloudflare.com/turnstile/v0/api.js` como SCRIPT (ver
          // components/Turnstile.jsx). Declarar so o frame derrubaria o desafio
          // na tela de login, em producao.
          scriptSrc: ["'self'", "https://challenges.cloudflare.com"],

          // Estilo precisa de 'unsafe-inline': o Google Fonts injeta um <style>,
          // e o editor de fluxos posiciona os nos com `style=""`. E menos grave
          // que no script -- estilo nao executa codigo.
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],

          // `https:` liberado para IMAGEM, e nao por preguica: a foto de perfil
          // do cliente e uma URL da propria WhatsApp (`fotoUrl`, vinda do
          // `profilePictureUrl` da Evolution), o dominio muda sem aviso, e
          // travar isso apagaria o avatar de TODA conversa do painel. Imagem nao
          // executa nada; a protecao contra XSS mora no `scriptSrc` acima.
          // `data:`/`blob:` sao a midia local: preview antes do envio, audio
          // gravado no navegador e o QR Code em base64.
          imgSrc: ["'self'", "data:", "blob:", "https:"],
          mediaSrc: ["'self'", "data:", "blob:"],

          // Mesma origem cobre o SSE e o fetch da API -- o nginx serve o painel
          // e faz proxy de /api. O Turnstile conversa com a Cloudflare durante
          // o desafio.
          connectSrc: ["'self'", "https://challenges.cloudflare.com"],

          workerSrc: ["'self'", "blob:"],
          manifestSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],

          // CLICKJACKING: o painel nao pode ser embutido em lugar nenhum. Sem
          // isto, alguem enquadra a Central num site isca e colhe cliques reais.
          frameAncestors: ["'none'"],
          // O desafio do Turnstile roda num iframe da Cloudflare.
          frameSrc: ["'self'", "https://challenges.cloudflare.com"],

          ...(env.nodeEnv === "production" ? { upgradeInsecureRequests: [] } : {}),
        },
      },

      // HSTS so faz sentido sob HTTPS, e em producao ha a Cloudflare na frente.
      // Em desenvolvimento ficaria gravado no navegador e quebraria o
      // http://localhost de quem trabalha no projeto -- por isso, desligado.
      hsts: env.nodeEnv === "production" ? { maxAge: 15552000, includeSubDomains: true } : false,

      // A API serve midia das conversas. `same-origin` bloquearia o <img> do
      // painel se um dia ele passar a rodar noutra origem. Isto e sobre RECURSO,
      // nao sobre credencial: quem entra continua sendo decidido pelo token.
      crossOriginResourcePolicy: { policy: "cross-origin" },
      // Desligado: bloquearia o iframe do Turnstile e as fontes do Google.
      crossOriginEmbedderPolicy: false,

      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    })
  );

  // `credentials: true` e obrigatorio agora que a sessao vai em cookie: sem
  // ele o navegador simplesmente NAO manda o cookie numa requisicao de outra
  // origem, e o painel apareceria deslogado sem nenhum erro no servidor.
  // Em producao painel e API saem do mesmo host (o nginx), entao isto so
  // importa em desenvolvimento -- que e justamente onde o engano custaria uma
  // tarde de procura.
  app.use(cors({ origin: env.corsOrigin, credentials: true }));

  // Precisa vir ANTES de qualquer coisa que leia sessao: sem o parser,
  // `req.cookies` e indefinido e tanto o authMiddleware quanto o CSRF
  // concluiriam "nao ha cookie" -- caindo em silencio para o modo antigo.
  app.use(cookieParser());

  app.use(express.json({ limit: "30mb" })); // mídia enviada em base64 passa de 2mb
  app.use(apiLimiter);

  // CSRF: so morde requisicao que autenticou POR COOKIE (ver o middleware).
  // Quem usa `Authorization: Bearer` passa direto -- ali nao existe o vetor,
  // porque o atacante teria de LER o token para montar o header. E isso que
  // deixa o painel antigo seguir funcionando durante o deploy.
  app.use(csrfMiddleware);

  app.get("/health", (req, res) => {
    res.json({ success: true, data: { status: "ok", env: env.nodeEnv } });
  });

  // DOCUMENTACAO DA API -- fechada em producao.
  //
  // O Swagger lista TODA a superficie do sistema: cada rota, cada parametro,
  // cada formato de corpo esperado. Para quem desenvolve, e comodidade. Para
  // quem ataca, e o mapa pronto -- poupa justamente a parte demorada, que e
  // descobrir o que existe. E o nginx publica `/api-docs` para a internet
  // (client/nginx.conf), entao nao havia nada entre ele e o mundo.
  //
  // Nao e segredo que impede invasao: a protecao de verdade e a autorizacao de
  // cada rota. Mas nao ha motivo para entregar o indice.
  //
  // `API_DOCS=1` reabre em producao, para quando alguem precisar de propósito --
  // uma decisao consciente, e nao o padrao.
  const mostrarDocs = env.nodeEnv !== "production" || process.env.API_DOCS === "1";
  if (mostrarDocs) {
    app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
    app.get("/api-docs.json", (req, res) => res.json(swaggerSpec));
  }

  app.use("/api/auth", authRoutes);
  app.use("/api/equipe", equipeRoutes);
  app.use("/api/parceiros", parceiroRoutes);
  app.use("/api/contatos", contatoRoutes);
  app.use("/api/fluxos", fluxoRoutes);
  app.use("/api/conversas", conversaRoutes);
  app.use("/api/dashboard", dashboardRoutes);
  app.use("/api/helpdesk", helpdeskRoutes);
  app.use("/api/chatbot", chatbotRoutes);
  app.use("/api/n8n", n8nRoutes);
  app.use("/api/configuracoes", configuracaoRoutes);
  app.use("/api/permissoes", permissaoRoutes);
  app.use("/api/preferencias", preferenciaRoutes);
  app.use("/api/bugs", bugRoutes);
  app.use("/api/mensagens-rapidas", mensagemRapidaRoutes);
  app.use("/api/agenda", agendaRoutes);
  app.use("/api/campanhas", campanhaRoutes);
  app.use("/api/whatsapp", adminRouter);

  const mountWebhook = (path) => {
    app.use(path, webhookLimiter, webhookAuth, webhookRouter);
  };

  mountWebhook("/api/webhook/v1/whatsapp");
  mountWebhook("/webhook/v1/whatsapp");

  app.use((req, res) => {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "Rota nao encontrada" },
    });
  });

  app.use(errorMiddleware);

  return app;
}

module.exports = createApp;
