# Technology Stack

**Analysis Date:** 2026-08-27

## Languages

**Primary:**
- JavaScript (CommonJS) — backend, `server/src/**` (`"type": "commonjs"` em `server/package.json`)
- JavaScript + JSX (ESM) — frontend, `client/src/**` (`"type": "module"` em `client/package.json`)

**Secundárias:**
- SQL/Prisma Schema Language — `server/prisma/schema.prisma` (20 models)
- Shell (bash) — scripts de deploy em `deploy/instalar.sh`, `deploy/atualizar.sh`, `deploy/backup.sh` e `server/docker-entrypoint.sh`
- Nginx conf — `client/nginx.conf`
- YAML — `docker-compose.prod.yml`, `server/docker-compose.yml`, `server/docker-compose.evolution.yml`

Sem TypeScript: não há `tsconfig.json` no repositório.

## Runtime

**Ambiente:**
- Node.js 20 nas imagens Docker (`node:20-slim` em `server/Dockerfile` e `client/Dockerfile`)
- Node.js v24.19.0 na máquina de desenvolvimento atual
- Usa APIs globais do Node 18+ (`fetch`, `FormData`, `Blob`) — ver `server/src/infrastructure/external/transcricao.client.js`
- Timezone fixado no processo: `process.env.TZ = "America/Sao_Paulo"` em `server/src/server.js` (primeira linha, antes de qualquer require)

**Gerenciador de pacotes:**
- npm (v11.17.0 local); `npm ci` nos dois Dockerfiles
- Lockfiles: presentes — `server/package-lock.json`, `client/package-lock.json`

**Layout do repositório:** dois pacotes independentes (`server/`, `client/`), sem workspace npm nem `package.json` na raiz.

## Frameworks

**Core backend:**
- Express `^4.21.2` — HTTP server, `server/src/app.js`
- Prisma ORM `^6.5.0` + `@prisma/client` `^6.5.0` — acesso a dados, `server/src/infrastructure/database/prisma.client.js`

**Core frontend:**
- React `^18.3.1` + React DOM `^18.3.1`
- React Router DOM `^7.18.1` — SPA routing
- Tailwind CSS `^3.4.19` + PostCSS `^8.5.21` + autoprefixer `^10.5.4` — `client/tailwind.config.js` (inclui breakpoint de ALTURA customizado `baixa` para notebook)

**Testes:**
- Não detectado. Não há Jest/Vitest/Mocha configurados nem arquivos `*.test.*`/`*.spec.*`. Existem scripts manuais de verificação: `server/testar-botoes.js`, `server/verificar-tudo.js`.

**Build/Dev:**
- Vite `^5.4.1` + `@vitejs/plugin-react` `^4.3.1` — `client/vite.config.js` (proxy `/api` → `http://localhost:3000` em dev)
- nodemon `^3.1.9` — hot reload do backend (`npm run dev`)
- prisma CLI `^6.5.0` — devDependency mantida na imagem de produção de propósito (o entrypoint roda `prisma db push` a cada boot)

**Lint/format:** Não detectado. Sem ESLint, Prettier ou Biome no repositório.

## Key Dependencies

**Backend crítico:**
- `jsonwebtoken` `^9.0.2` — JWT de acesso (curto, padrão `1h`), configurado em `server/src/config/env.js`
- `bcryptjs` `^3.0.2` — hash de senha
- `zod` `^3.24.2` — validação na borda (DTOs), padrão de defesa em profundidade
- `express-rate-limit` `^7.5.0` — `apiLimiter` global + `webhookLimiter` dedicado (`server/src/shared/middlewares/rateLimit.middleware.js`)
- `cors` `^2.8.5` — origem de `CORS_ORIGIN`; em produção painel e API compartilham origem via nginx, então CORS deixa de existir
- `winston` `^3.17.0` — logging JSON com timestamp em horário de Brasília (`server/src/config/logger.js`)
- `dotenv` `^16.4.7` — carregado em `server/src/app.js` e `server/src/config/env.js`

**Documentação de API:**
- `swagger-jsdoc` `^6.2.8` + `swagger-ui-express` `^5.0.1` — `/api-docs` e `/api-docs.json`, spec em `server/src/config/swagger.js`

**Frontend:**
- `chart.js` `4.4.3` + `react-chartjs-2` `5.2.0` — gráficos do dashboard
- `jspdf` `^2.5.2` + `html2canvas` `^1.4.1` — exportação de relatórios em PDF
- `lucide-react` `^0.383.0` — ícones

## Configuration

**Ambiente:**
- Modelo versionado: `.env.example` na raiz (o `.env` real está no `.gitignore`)
- Módulo central de config: `server/src/config/env.js` — segredos (`JWT_SECRET`, `WEBHOOK_SECRET`) têm fallback apenas em desenvolvimento; em produção a ausência **derruba o boot** (função `segredo()`)
- Helper `duracaoMs()` converte `"30d"`, `"12h"`, `"90m"` em milissegundos, com queda para o padrão quando o valor é inválido
- **Configuração em duas camadas:** a tela de Configurações grava na tabela `Configuracao` (chave/valor no SQLite) e esses valores **sobrepõem o `.env`**. Quem lê usa banco primeiro e cai no env como fallback — ver `server/src/modules/configuracoes/configuracao.service.js` e `_config()` nos clientes externos.

**Variáveis de ambiente lidas pelo código** (`process.env.*` em `server/src`):
`NODE_ENV`, `PORT`, `TZ`, `DATABASE_URL`, `CORS_ORIGIN`, `MEDIA_DIR`,
`JWT_SECRET`, `JWT_EXPIRES_IN`, `REFRESH_EXPIRES_IN`, `SESSAO_MAX`, `SESSAO_MAX_POR_USUARIO`, `SESSAO_INATIVIDADE`, `SESSAO_REUSO_TOLERANCIA`, `REGISTRO_CODIGO`,
`ADMIN_EMAIL`, `ADMIN_NOME`, `ADMIN_PASSWORD`,
`EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `WHATSAPP_INSTANCE`, `WHATSAPP_BOTOES_INTERATIVOS`, `WEBHOOK_SECRET`,
`N8N_URL`, `N8N_API_KEY`, `N8N_WEBHOOK_FLUXO`,
`GROQ_API_KEY`, `TRANSCRICAO_API_KEY`, `TRANSCRICAO_URL`, `TRANSCRICAO_MODELO`,
`ATENDIMENTO_MODO`, `HELPDESK_SLA`,
`CHATBOT_FILAS`, `CHATBOT_HORARIO`, `CHATBOT_PESQUISA`, `CHATBOT_RESPOSTAS_AUTOMATICAS`, `CHATBOT_SESSAO_TTL_MIN`, `CHATBOT_HUMANO_TTL_MIN`, `CHATBOT_INATIVIDADE_INTERVALO_MS`, `CHATBOT_MAX_DELAY_MS`, `CHATBOT_MAX_PASSOS`, `CHATBOT_MAX_TENTATIVAS_CNPJ`, `CHATBOT_MAX_TENTATIVAS_MENU`, `CHATBOT_MAX_TENTATIVAS_OPCAO`

**Build:**
- `client/vite.config.js` — build do SPA
- `client/tailwind.config.js`, `client/postcss.config.js`
- `server/Dockerfile` (multi-stage não; instala openssl + sqlite3, roda `prisma generate`, usuário `node`, healthcheck em `/health`)
- `client/Dockerfile` (build Vite → nginx 1.27-alpine servindo `dist/` + proxy)

## Platform Requirements

**Desenvolvimento:**
- Node 20+ e npm
- `cd server && npm run db:setup` (`prisma generate && prisma db push && node prisma/seed.js`)
- Backend em `http://localhost:3000`, frontend Vite em `http://localhost:5173` (proxy `/api`)
- Docker Desktop para subir a Evolution API local (`server/docker-compose.evolution.yml`)
- Repositório editado no Windows — o `server/Dockerfile` normaliza CRLF do entrypoint com `sed -i 's/\r$//'`

**Produção:**
- VM Linux com Docker + Docker Compose, stack `arka-chat` em `docker-compose.prod.yml`
- Quatro containers: `arka-web` (nginx, única porta pública), `arka-api` (Express, sem porta publicada), `arka-evolution` (`evoapicloud/evolution-api:v2.3.7`, exposta só em `127.0.0.1:8080`), `arka-evolution-db` (`postgres:16-alpine`, privado)
- Volumes nomeados: `arka_data` (SQLite + mídia em `/data`), `evolution_instances` (sessão pareada do WhatsApp), `evolution_pg`
- `TRUST_PROXY=1` na API (um proxy nginx à frente)
- Procedimento completo em `DEPLOY.md`; scripts em `deploy/instalar.sh`, `deploy/atualizar.sh`, `deploy/backup.sh`

---

*Stack analysis: 2026-08-27*
