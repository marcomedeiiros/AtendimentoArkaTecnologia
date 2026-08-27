# Codebase Structure

**Analysis Date:** 2026-08-27

## Directory Layout

```
AtendimentoArkaTecnologia/
├── client/                      # SPA React + Vite (painel de atendimento)
│   ├── public/                  # Estáticos servidos como estão (som, logo, wallpapers)
│   ├── src/
│   │   ├── components/
│   │   │   ├── flow/            # Editor visual de fluxos do chatbot
│   │   │   ├── layout/          # Cascas e portões de rota
│   │   │   └── pages/           # Telas pesadas usadas pelas páginas
│   │   ├── context/             # AuthContext, AppContext
│   │   ├── hooks/               # Hooks reutilizáveis
│   │   ├── pages/               # Uma página por rota do App.jsx
│   │   ├── services/            # api.js (HTTP + sessão + SSE)
│   │   ├── utils/               # Helpers puros de front
│   │   ├── App.jsx              # Tabela de rotas
│   │   └── main.jsx             # Bootstrap React
│   └── vite.config.js           # Proxy /api → localhost:3000
├── server/
│   ├── dados/midia/<ano>/<mês>/ # Mídia recebida/enviada, em disco
│   ├── prisma/                  # schema.prisma, dev.db, seed e scripts de dados
│   └── src/
│       ├── config/              # env.js, logger.js, swagger.js
│       ├── infrastructure/
│       │   ├── database/        # prisma.client.js (singleton)
│       │   ├── external/        # Evolution API, n8n, transcrição, ERP mock
│       │   ├── repositories/    # Único lugar com queries Prisma
│       │   └── storage/         # midia.storage.js
│       ├── modules/<dominio>/   # routes + controller + service + dto
│       ├── shared/              # errors, events, helpers, middlewares
│       ├── app.js               # Fábrica do Express
│       └── server.js            # Bootstrap do processo
├── deploy/                      # instalar.sh, atualizar.sh, backup.sh
├── docs/                        # fluxo-arka.json, prompt-agente-n8n.md
├── .planning/                   # Artefatos GSD
├── docker-compose.prod.yml      # web, api, evolution-api, evolution-db
├── DEPLOY.md
└── README.md
```

## Directory Purposes

**`server/src/modules/<dominio>/`:**
- Purpose: um domínio de negócio inteiro, isolado.
- Contains: `X.routes.js`, `X.controller.js`, `X.service.js`, `X.dto.js` e arquivos extras do domínio.
- Key files: `chatbot/chatbot.engine.js` (2357 linhas, motor do bot), `conversas/conversa.service.js`, `conversas/conversa.stream.js` (SSE), `fluxos/fluxo.automacao.js`, `whatsapp/whatsapp.service.js`, `permissoes/modulo.middleware.js`.
- Domínios existentes: agenda, auth, bugs, campanhas, chatbot, configuracoes, contatos, conversas, dashboard, equipe, fluxos, helpdesk, mensagensRapidas, n8n, parceiros, permissoes, preferencias, whatsapp.

**`server/src/infrastructure/`:**
- Purpose: tudo que fala com o mundo fora do processo.
- Key files: `database/prisma.client.js`, `repositories/conversa.repository.js`, `external/evolution-api.client.js`, `storage/midia.storage.js`.

**`server/src/shared/`:**
- Purpose: transversal, sem dono de domínio.
- Key files: `events/event-bus.js`, `errors/AppError.js`, `helpers/setor.helper.js`, `helpers/response.helper.js`, `middlewares/auth.middleware.js`, `middlewares/error.middleware.js`, `middlewares/validate.middleware.js`, `middlewares/rateLimit.middleware.js`, `middlewares/webhook.middleware.js`.

**`server/prisma/`:**
- Purpose: schema, banco de desenvolvimento e scripts de dados.
- Key files: `schema.prisma` (546 linhas, 20 models), `seed.js`, `backfill-atendimentos.js`, `importar-parceiros.js`, `migrar-setor-do-menu.js`.

**`client/src/pages/` vs `client/src/components/pages/`:**
- `pages/`: componente de rota — casca fina, busca de dados, título da tela.
- `components/pages/`: a implementação pesada da tela (ex.: `AtendimentoView.jsx`, 3610 linhas; `Dashboard.jsx`).

**`client/src/components/layout/`:**
- `AppLayout.jsx` (menu e moldura do painel), `AcessoLayout.jsx` (login/cadastro), `RotaProtegida.jsx` (exige sessão), `RotaModulo.jsx` (gate de módulo no front).

**`client/src/components/flow/`:**
- Editor visual de fluxos: `VisualFlowEditor.jsx`, `FlowPropertyPanel.jsx`, `FlowTestChat.jsx`, `FlowExecutionLogs.jsx`, `FlowMinimap.jsx`, `PainelAutomacoes.jsx`, `PainelN8n.jsx`, `fluxoJson.js`.

## Key File Locations

**Entry Points:**
- `server/src/server.js`: bootstrap do backend (TZ, Prisma, listen, varreduras).
- `server/src/app.js`: montagem de middlewares e rotas.
- `client/src/main.jsx`: bootstrap React.
- `client/src/App.jsx`: tabela de rotas do painel.

**Configuration:**
- `server/src/config/env.js`: leitura e validação de variáveis de ambiente.
- `server/src/config/logger.js`: Winston.
- `server/src/config/swagger.js`: spec OpenAPI.
- `client/vite.config.js`, `client/tailwind.config.js`, `client/postcss.config.js`.
- `.env.example`, `docker-compose.prod.yml`, `DEPLOY.md`.

**Core Logic:**
- `server/src/modules/chatbot/chatbot.engine.js`: máquina de estados do bot.
- `server/src/modules/chatbot/chatbot.inatividade.js`: relógio das automações.
- `server/src/modules/conversas/conversa.service.js`: Central de Atendimento.
- `server/src/shared/events/event-bus.js`: canal único de tempo real.

**Testing:**
- Nenhuma suíte automatizada no repositório. Verificação manual: simulador do bot (`server/src/modules/chatbot/chatbot.simulador.js`) e o chat de teste do editor (`client/src/components/flow/FlowTestChat.jsx`).

## Naming Conventions

**Arquivos backend:**
- `<dominio>.<papel>.js` em minúsculas/camelCase: `conversa.service.js`, `mensagemRapida.controller.js`, `cnpj.helper.js`, `auth.middleware.js`, `evolution-api.client.js` (clients externos usam kebab-case).

**Arquivos frontend:**
- Componentes em `PascalCase.jsx`: `AtendimentoView.jsx`, `RotaProtegida.jsx`.
- Módulos não-componente em camelCase `.js`: `api.js`, `mesclarConversa.js`, `fluxoJson.js`.

**Diretórios:**
- Backend: plural em português para módulos (`conversas`, `parceiros`, `mensagensRapidas`); singular para camadas (`config`, `shared`).
- Frontend: minúsculas (`components`, `context`, `utils`).

**Rotas HTTP:**
- `/api/<recurso-em-kebab>` — `/api/mensagens-rapidas`, `/api/conversas/:id/mensagens`.

## Where to Add New Code

**Nova funcionalidade de um domínio existente:**
1. Schema Zod em `server/src/modules/<dominio>/<x>.dto.js`.
2. Rota em `<x>.routes.js` com `authMiddleware`, `exigirModulo(...)` e `validate(schema)` — literais antes de `/:id`.
3. Handler fino em `<x>.controller.js` respondendo por `success(res, data)`.
4. Regra e reconferência de permissão em `<x>.service.js`.
5. Query nova em `server/src/infrastructure/repositories/<x>.repository.js`.
6. Tempo real (se a tela precisar) por `bus.emitConversa` / `bus.emitRecurso`.

**Novo domínio:**
- Criar `server/src/modules/<dominio>/` com o quarteto de arquivos e registrar em `server/src/app.js`.
- Se for uma tela do painel, adicionar o módulo à matriz de permissões (`server/src/modules/permissoes/`).

**Nova tela do painel:**
- Rota em `client/src/App.jsx` (dentro de `RotaModulo` se houver gate).
- Casca em `client/src/pages/<Nome>Page.jsx`; implementação em `client/src/components/pages/<Nome>.jsx` se passar de ~300 linhas.
- Chamadas HTTP só via `client/src/services/api.js`.

**Nova integração externa:**
- `server/src/infrastructure/external/<servico>.client.js`, com config em `server/src/config/env.js`.

**Utilitários:**
- Backend transversal: `server/src/shared/helpers/`.
- Front puro: `client/src/utils/`.

**Migração/backfill de dados:**
- Script one-off em `server/prisma/<acao>-<alvo>.js`, com script npm em `server/package.json` quando for reutilizável.

## Special Directories

**`server/dados/midia/`:**
- Purpose: mídia recebida/enviada, particionada por `<ano>/<mês>`.
- Generated: Sim (runtime, `infrastructure/storage/midia.storage.js`).
- Committed: Não.

**`server/prisma/dev.db*`:**
- Purpose: SQLite de desenvolvimento (`dev.db`, `-wal`, `-shm`).
- Generated: Sim. Committed: `dev.db` está versionado; arquivos `-wal`/`-shm` aparecem sujos no git com frequência.

**`client/dist/`:**
- Purpose: build de produção do Vite. Generated: Sim. Committed: Não.

**`node_modules/` (client e server):**
- Generated: Sim. Committed: Não.

**`.planning/`:**
- Purpose: artefatos GSD (roadmap, fases, este mapa). Committed: Sim.

**`deploy/`:**
- Purpose: scripts de VM (`instalar.sh`, `atualizar.sh`, `backup.sh`), usados com `docker-compose.prod.yml`.

---

*Structure analysis: 2026-08-27*
