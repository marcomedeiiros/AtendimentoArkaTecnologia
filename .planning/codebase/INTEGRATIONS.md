# External Integrations

**Analysis Date:** 2026-08-27

## APIs & External Services

**Mensageria (WhatsApp):**
- **Evolution API** (`evoapicloud/evolution-api:v2.3.7`) — ponte com o WhatsApp: lê o QR code, envia e recebe mensagens e mídia
  - Cliente: `server/src/infrastructure/external/evolution-api.client.js` (classe `EvolutionApiClient`, `fetch` nativo)
  - Auth: header `apikey`, valor de `EVOLUTION_API_KEY`
  - URL: `EVOLUTION_API_URL` (`http://evolution-api:8080` na rede do compose)
  - Instância: `WHATSAPP_INSTANCE` (padrão `arka-wapi-oficial`)
  - **Config efetiva vem do banco**, não do env: `_config()` consulta `configuracao.service` a cada chamada e só cai no `.env` como fallback
  - Rotas administrativas do painel em `server/src/modules/whatsapp/whatsapp.routes.js` (`adminRouter`): `/status`, `/enviar`, `/conectar`, `/desconectar`, `/qrcode`, `/detalhes`, `/instancia`, `/webhook`, `/reiniciar`
  - Limitação conhecida: a 2.3.7 não entrega botões interativos (flag `WHATSAPP_BOTOES_INTERATIVOS`); o menu segue em texto numerado

**Automação:**
- **n8n** — orquestração de workflows disparados pelos fluxos do chatbot
  - Cliente: `server/src/infrastructure/external/n8n.client.js` (API pública v1, `${url}/api/v1${path}`)
  - Auth: header `X-N8N-API-KEY` (gerado em Settings > API do n8n), variável `N8N_API_KEY`
  - URL: `N8N_URL`; webhook de fluxo: `N8N_WEBHOOK_FLUXO`
  - Rotas do painel: `server/src/modules/n8n/n8n.routes.js` (`/api/n8n`) — listar/criar/atualizar/ativar/excluir workflows, protegidas por `authMiddleware` + `exigirModulo("fluxos")`
  - Erros mapeados: 401 vira `N8N_UNAUTHORIZED`; demais viram `N8N_ERROR` (502)
  - Artefatos de referência: `docs/fluxo-arka.json`, `docs/prompt-agente-n8n.md`

**IA / Transcrição de áudio:**
- **Groq** (padrão) — Whisper `whisper-large-v3-turbo` para transcrever áudio do WhatsApp em português
  - Cliente: `server/src/infrastructure/external/transcricao.client.js`
  - Endpoint: `TRANSCRICAO_URL` (padrão `https://api.groq.com/openai/v1/audio/transcriptions`)
  - Modelo: `TRANSCRICAO_MODELO` (padrão `whisper-large-v3-turbo`)
  - Auth: `Authorization: Bearer <chave>` — chave lida do banco (`transcricao.apiKey`) com fallback em `GROQ_API_KEY` ou `TRANSCRICAO_API_KEY`
  - Formato compatível com a OpenAI: trocar URL/modelo/chave permite usar a OpenAI sem mudar código
  - Sem chave configurada, a rota falha com `SEM_CHAVE_TRANSCRICAO` (400)

**ERP:**
- **Mock ERP** — `server/src/infrastructure/external/mock-erp.service.js`. Simula desconto de parceiro e geração de boleto (linha digitável fixa). Não há ERP real integrado; é o ponto de extensão para quando houver.

## Data Storage

**Bancos:**
- **SQLite (aplicação Arka)** — conversas, mensagens, contatos, usuários, fluxos, campanhas, agenda
  - Conexão: `DATABASE_URL` (`file:/data/arka.db` em produção; `server/prisma/dev.db` em dev)
  - Cliente: Prisma ORM — `server/prisma/schema.prisma` (20 models), `server/src/infrastructure/database/prisma.client.js`
  - Repositórios em `server/src/infrastructure/repositories/` (12 arquivos)
  - SQLite via Prisma não suporta enums nativos: campos que eram enum no Postgres viraram `String`, com os valores válidos controlados pelos DTOs Zod (documentado no topo do schema)
  - Schema aplicado a cada boot do container por `prisma db push` em `server/docker-entrypoint.sh`
- **PostgreSQL 16 (Evolution API)** — instâncias, contatos e chats internos da Evolution
  - Serviço `evolution-db` em `docker-compose.prod.yml`, base `evolution`, senha em `EVOLUTION_DB_PASSWORD`
  - Privado da stack: não publica porta; a aplicação Arka **não** fala com este banco

**Armazenamento de arquivos:**
- Disco local via volume Docker — `server/src/infrastructure/storage/midia.storage.js`
  - Pasta: `MEDIA_DIR` (padrão `./dados/midia`; em produção `/data/midia`, dentro do volume `arka_data`)
  - Nome do arquivo é sempre gerado no servidor (uuid + extensão derivada do mimetype); nada vindo do cliente vira caminho — proteção contra path traversal
  - Na leitura, o caminho resolvido é conferido contra a pasta base, mesmo que o valor no banco tenha sido adulterado
  - Motivação: mídia era guardada como data URL base64 dentro do SQLite

**Cache:**
- Nenhum serviço externo. A Evolution roda com `CACHE_REDIS_ENABLED: "false"` e `CACHE_LOCAL_ENABLED: "true"`.

## Authentication & Identity

**Provedor:** Custom (implementação própria, sem IdP externo)
- Módulo: `server/src/modules/auth/`; middlewares em `server/src/shared/middlewares/`
- Senha: `bcryptjs`
- Token de acesso: JWT (`jsonwebtoken`), padrão `JWT_EXPIRES_IN=1h` — curto de propósito
- Sessão longa: refresh token com estado na tabela `SessaoRefresh` (`server/src/infrastructure/repositories/sessaoRefresh.repository.js`)
  - Rotação deslizante (`REFRESH_EXPIRES_IN`, padrão 30d) com **teto absoluto** desde o login (`SESSAO_MAX`, padrão 60d)
  - Detecção de reuso: fora da janela de tolerância (`SESSAO_REUSO_TOLERANCIA`, 15s) a família inteira de tokens é revogada
  - Teto de sessões simultâneas por conta: `SESSAO_MAX_POR_USUARIO` (padrão 10) — login novo derruba a mais antiga
  - Janela de inatividade (`SESSAO_INATIVIDADE`, 12h) enviada ao cliente no login/renovação; a autoridade da sessão continua no servidor
  - Limpeza de sessões vencidas no boot (`server/src/server.js`)
- No cliente: `client/src/services/api.js` — "Lembrar-me" decide se token e refresh moram em `localStorage` ou `sessionStorage`; contexto em `client/src/context/AuthContext.jsx`
- Autorização por módulo/permissão: `exigirModulo(...)`, `somenteAdmin` — módulo `server/src/modules/permissoes/`
- Cadastro protegido por `REGISTRO_CODIGO`; admin inicial semeado por `ADMIN_EMAIL`/`ADMIN_NOME`/`ADMIN_PASSWORD` (`server/prisma/seed.js`)

## Monitoring & Observability

**Rastreio de erros:** Nenhum serviço externo (sem Sentry/Datadog). Erros centralizados em `server/src/shared/middlewares/error.middleware.js` com `AppError` (`server/src/shared/errors/AppError.js`).

**Logs:**
- Winston em JSON no console — `server/src/config/logger.js`, `defaultMeta: { service: "arka-chatbot" }`, nível `info` em produção e `debug` fora dela
- Timestamp em horário de Brasília (o padrão do Winston é UTC)
- Coleta pelo `docker compose logs`
- Nginx com `log_format arka_sem_query`: registra `$uri` em vez de `$request`, para o token do webhook (`?token=...`) **não** ficar em texto puro no access log

**Health check:**
- `GET /health` em `server/src/app.js`; o `HEALTHCHECK` do Docker faz `fetch` nesse endpoint a cada 30s
- `pg_isready` como healthcheck do `evolution-db`

**Documentação viva:** Swagger UI em `/api-docs` e spec em `/api-docs.json` (`server/src/config/swagger.js`).

## CI/CD & Deployment

**Hospedagem:** VM própria com Docker Compose (stack `arka-chat`), conforme `DEPLOY.md`.

**Pipeline de CI:** Nenhum. Não há `.github/workflows/` nem outra configuração de CI. O deploy é manual via scripts:
- `deploy/instalar.sh` — instalação inicial na VM
- `deploy/atualizar.sh` — atualização (reconciliar com MERGE, nunca reset; não dar push a partir da VM)
- `deploy/backup.sh` — backup quente do SQLite com `sqlite3` (por isso o binário está na imagem da API), gravado em `./backups` montado como `/backups`

**Fluxo de build:** `docker compose -f docker-compose.prod.yml up -d --build`. O entrypoint da API aplica `prisma db push` a cada subida — mudança de schema com perda de dados derruba o `arka-api` em crash-loop até se usar `--accept-data-loss`.

**Rede:** só `arka-web` publica porta (`WEB_PORT`, padrão 80). A API não publica porta; a Evolution escuta apenas em `127.0.0.1:8080` (acesso ao `/manager` por túnel SSH).

## Environment Configuration

**Variáveis críticas:** `JWT_SECRET`, `WEBHOOK_SECRET`, `EVOLUTION_API_KEY`, `EVOLUTION_DB_PASSWORD`, `DATABASE_URL`, `N8N_API_KEY`, `GROQ_API_KEY` / `TRANSCRICAO_API_KEY`, `VM_IP`, `WEB_PORT`, `CORS_ORIGIN`, `MEDIA_DIR`, `TZ`, `ADMIN_PASSWORD`, `REGISTRO_CODIGO`.

**Onde ficam os segredos:**
- Arquivo `.env` na pasta do compose na VM, consumido via `env_file` pelo serviço `api` e por interpolação `${...}` nos demais serviços
- `.env` e `.env.*` estão no `.gitignore` (exceto `.env.example`, que é o modelo versionado)
- Chaves editáveis pela tela de Configurações são gravadas na tabela `Configuracao` e marcadas com `segredo: true` no `server/src/modules/configuracoes/configuracao.service.js` — esses valores têm precedência sobre o `.env`
- Em produção, a ausência de `JWT_SECRET`/`WEBHOOK_SECRET` derruba o boot em vez de usar um fallback público (`server/src/config/env.js`)

## Webhooks & Callbacks

**Entrada (Evolution API para Arka):**
- `POST /api/webhook/v1/whatsapp` e `POST /webhook/v1/whatsapp` (montados nos dois caminhos em `server/src/app.js`); há também `GET /` de verificação e `POST /responder`
- Configurado na Evolution por `WEBHOOK_GLOBAL_URL: http://api:3000/api/webhook/v1/whatsapp?token=${WEBHOOK_SECRET}`
- Eventos assinados: `MESSAGES_UPSERT`, `CONNECTION_UPDATE`, `MESSAGES_UPDATE`; `WEBHOOK_BASE64: "true"` (mídia chega em base64 — daí o limite de 30mb no `express.json` e 32m no nginx)
- Auth: `server/src/shared/middlewares/webhook.middleware.js` — token via header `x-webhook-token` ou query `token`, comparação em tempo constante (`crypto.timingSafeEqual`); **token ausente é rejeitado**, não só o errado
- Rate limit dedicado: `webhookLimiter`, aplicado antes da autenticação
- O nginx tem um `location /webhook/` próprio; sem ele o segundo caminho cairia no SPA e devolveria 405 silenciosamente

**Saída (Arka para externos):**
- Chamadas à Evolution API para envio de mensagens/mídia e gestão de instância
- Disparo de workflows do n8n (`N8N_WEBHOOK_FLUXO`) a partir dos fluxos do chatbot
- Upload multipart de áudio para a API de transcrição (Groq/OpenAI)

**Tempo real (Arka para o painel):**
- SSE em `GET /api/conversas/stream` — o painel mantém a conexão aberta para receber mensagens ao vivo
- O nginx tem bloco dedicado com `proxy_buffering off`, `gzip off`, `chunked_transfer_encoding off` e `proxy_read_timeout 24h`; precisa vir antes de `location /api/`
- O evento carrega só a cauda (patch), nunca o histórico completo

---

*Integration audit: 2026-08-27*
