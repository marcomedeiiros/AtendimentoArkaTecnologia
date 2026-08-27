<!-- refreshed: 2026-08-27 -->
# Architecture

**Analysis Date:** 2026-08-27

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│              SPA React (Vite)  —  `client/src`               │
├──────────────────┬──────────────────┬───────────────────────┤
│  Rotas/Layout    │  Telas (pages)   │  Cliente HTTP + SSE   │
│ `client/src/App  │ `client/src/     │ `client/src/services/ │
│  .jsx` + layout/ │  pages/` +       │  api.js`              │
│                  │  components/pages│                       │
└────────┬─────────┴────────┬─────────┴──────────┬────────────┘
         │  fetch /api/*    │                     │ EventSource
         ▼                  ▼                     ▼
┌─────────────────────────────────────────────────────────────┐
│         Express API  —  `server/src/app.js`                  │
│  middlewares: cors, json, rateLimit, auth, modulo, validate  │
├─────────────────────────────────────────────────────────────┤
│  Módulos (routes → controller → service → dto)               │
│  `server/src/modules/<dominio>/`                             │
│  + motor do chatbot `modules/chatbot/chatbot.engine.js`      │
├─────────────────────────────────────────────────────────────┤
│  Shared: event-bus, helpers, errors, middlewares             │
│  `server/src/shared/`                                        │
├─────────────────────────────────────────────────────────────┤
│  Infrastructure: repositories · external · storage           │
│  `server/src/infrastructure/`                                │
└──────┬────────────────────────────┬──────────────────┬──────┘
       ▼                            ▼                  ▼
┌──────────────┐          ┌──────────────────┐  ┌──────────────┐
│ Prisma / DB  │          │ Evolution API    │  │ Disco: mídia │
│ `server/     │          │ (WhatsApp), n8n, │  │ `server/     │
│ prisma/      │          │ transcrição, ERP │  │  dados/midia`│
│ schema.prisma│          │ mock             │  │              │
└──────────────┘          └──────────────────┘  └──────────────┘
```

Webhook de entrada do WhatsApp: `POST /api/webhook/v1/whatsapp` e `/webhook/v1/whatsapp`
(montados em `server/src/app.js`, protegidos por `shared/middlewares/webhook.middleware.js`).

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Fábrica do app Express | Middlewares globais, montagem das rotas, 404 e handler de erro | `server/src/app.js` |
| Bootstrap do processo | Fixa TZ, conecta Prisma, sobe HTTP, inicia varreduras | `server/src/server.js` |
| Motor do chatbot | Interpreta a mensagem recebida e caminha pelos passos do fluxo | `server/src/modules/chatbot/chatbot.engine.js` |
| Relógio da automação | Varre sessões paradas (sem resposta, fila, avaliação) | `server/src/modules/chatbot/chatbot.inatividade.js` |
| Parâmetros do bot | Resolve textos/prazos/tentativas a partir do fluxo ativo | `server/src/modules/fluxos/fluxo.automacao.js` |
| Ingestão WhatsApp | Normaliza payload do Baileys/Evolution, mídia, ACKs | `server/src/modules/whatsapp/whatsapp.service.js` |
| Central de Atendimento | Conversas, mensagens, mídia, setor, atendente, avaliação | `server/src/modules/conversas/conversa.service.js` |
| Barramento de eventos | Canal único em memória para o tempo real | `server/src/shared/events/event-bus.js` |
| Endpoint SSE | Entrega eventos ao painel, com guard de setor por cargo | `server/src/modules/conversas/conversa.stream.js` |
| Acesso a dados | Todas as queries Prisma, includes e `versao` | `server/src/infrastructure/repositories/*.repository.js` |
| Cliente HTTP do painel | Token, refresh deslizante, inatividade, chamadas `/api` | `client/src/services/api.js` |
| Sessão do painel | Estado de auth, tema por usuário, atividade humana | `client/src/context/AuthContext.jsx` |

## Pattern Overview

**Overall:** Monólito modular em camadas (module-per-domain) com SPA separada.

**Key Characteristics:**
- Backend CommonJS (`require`), sem TypeScript, sem build step.
- Cada domínio tem sempre o mesmo quarteto: `*.routes.js`, `*.controller.js`, `*.service.js`, `*.dto.js`.
- Toda persistência passa por um repository — services não chamam Prisma direto.
- Tempo real por um único canal SSE alimentado pelo `event-bus` (nunca polling paralelo).
- Autorização sempre reconferida no servidor; o front só esconde.

## Layers

**Routes (`server/src/modules/*/**.routes.js`):**
- Purpose: mapeia HTTP → controller, aplica `authMiddleware`, `exigirModulo`, `validate(schema)` e limitadores.
- Depends on: controller, DTOs Zod, middlewares compartilhados.
- Regra de ordenação: rotas literais (`/iniciar`, `/stream`) vêm antes de `/:id`.

**Controller (`*.controller.js`):**
- Purpose: extrai `req.params/body/query` e `req.user`, delega ao service, responde por `success(res, data)`.
- Não contém regra de negócio nem acesso a banco.

**Service (`*.service.js`):**
- Purpose: regra de negócio, reconferência de permissão (cargo/setor), orquestração e emissão de eventos.
- Depends on: repositories, clients externos, helpers, `event-bus`.

**DTO (`*.dto.js`):**
- Purpose: schemas Zod de entrada (allowlist única) e formatação de saída.

**Infrastructure (`server/src/infrastructure/`):**
- `database/prisma.client.js`: singleton do PrismaClient.
- `repositories/`: queries, includes padronizados (`INCLUDE_CONVERSA`), incremento de `versao`.
- `external/`: `evolution-api.client.js`, `n8n.client.js`, `transcricao.client.js`, `mock-erp.service.js`.
- `storage/midia.storage.js`: arquivos em `server/dados/midia/<ano>/<mês>`.

**Shared (`server/src/shared/`):**
- `errors/AppError.js`, `events/event-bus.js`, `helpers/`, `middlewares/`.

**Frontend (`client/src/`):**
- `App.jsx` (rotas) → `components/layout/` (portões) → `pages/` (casca da tela) → `components/pages/` (a tela pesada) → `services/api.js`.

## Data Flow

### Mensagem recebida do WhatsApp (caminho principal)

1. Evolution API chama `POST /api/webhook/v1/whatsapp` (`server/src/app.js`, `mountWebhook`).
2. `webhookLimiter` + `webhook.middleware.js` validam segredo/rate.
3. `modules/whatsapp/whatsapp.controller.js` → `whatsapp.service.js`: extrai telefone, texto (inclusive `buttonsResponseMessage`/`listResponseMessage`), mídia e flags de encaminhamento.
4. Contato e conversa resolvidos via `contato.service` e `conversa.repository` (mídia salva por `midia.storage.js`).
5. `chatbot.engine.js` roda o passo do fluxo (estado em `SessaoChatbot`, `sessao.aguardando`), consultando `fluxo.automacao.js` para textos e prazos.
6. Resposta do bot sai por `evolution-api.client.js`.
7. `bus.emitConversa(...)` / `bus.emitStatusMensagem(...)` publicam no `event-bus`.
8. `conversa.stream.js` filtra por setor/cargo e escreve `data: {...}` no SSE aberto do painel.

### Resposta de um atendente

1. `POST /api/conversas/:id/mensagens` (`conversa.routes.js`) → `validate(enviarMensagemSchema)`.
2. `conversa.controller.enviarMensagem` passa `req.user` adiante.
3. `conversa.service` registra quem respondeu como atendente, persiste via repository (`versao` incrementada) e envia pela Evolution API.
4. Evento publicado no bus; o painel recebe pelo SSE.

### Relógio (sem mensagem nenhuma)

1. `server.js` chama `inatividade.iniciar()`.
2. `chatbot.inatividade.varrer()` roda a cada `CHATBOT_INATIVIDADE_INTERVALO_MS` (padrão 60s), com guarda contra sobreposição.
3. Trata sem-resposta do cliente, espera de avaliação e fila de pendentes — estado sempre lido do banco.

**State Management:**
- Servidor: estado durável no SQLite/Prisma; estado efêmero só em memória (tickets SSE, `_conectadoDesde`).
- Front: `AuthContext`/`AppContext` + `versao` da conversa para descartar atualização mais velha que a de tela.

## Key Abstractions

**Envelope de resposta:**
- Sempre `{ success, data }` ou `{ success, error: { code, message } }`.
- Arquivos: `server/src/shared/helpers/response.helper.js`, `shared/middlewares/error.middleware.js`.

**Repository:**
- Um por agregado em `server/src/infrastructure/repositories/`; includes constantes e `comVersao()` centralizam a forma dos dados.

**Evento de tempo real:**
- `conversa:update`, `mensagem:status`, `conversa:delete`, `recurso:update` — serializados uma única vez em `EventBus._publicar`.

**Helpers de domínio:**
- `setor.helper.js` (setor só por declaração; `podeAcessarSetor`), `cnpj.helper.js`, `lock.helper.js` (`comLock`), `midiaToken.helper.js` (URL de mídia assinada), `mapper.helper.js`.

## Entry Points

**API HTTP:**
- Location: `server/src/server.js` → `server/src/app.js`
- Triggers: `npm run dev` / `npm start` no `server/`
- Responsibilities: monta rotas `/api/*`, `/health`, `/api-docs`, webhooks.

**Webhook WhatsApp:**
- Location: `server/src/modules/whatsapp/whatsapp.routes.js`
- Triggers: Evolution API
- Responsibilities: entrada de mensagens, ACKs e status de conexão.

**SPA:**
- Location: `client/src/main.jsx` → `client/src/App.jsx`
- Triggers: `npm run dev` no `client/` (proxy `/api` → `localhost:3000`, `client/vite.config.js`)

**Scripts de dados:**
- Location: `server/prisma/*.js` (`seed.js`, `backfill-*.js`, `migrar-*.js`, `importar-parceiros.js`)

## Architectural Constraints

- **Threading:** processo Node único, event loop; nenhuma worker thread. `chatbot.inatividade` e `campanha.service` rodam timers no mesmo processo.
- **Escala horizontal:** bloqueada pelo `event-bus` em memória e pelos tickets SSE em `Map` — mais de uma instância quebra o tempo real e a autenticação do stream.
- **Fuso:** `process.env.TZ` fixado em `America/Sao_Paulo` no topo de `server/src/server.js`, antes de qualquer `require`.
- **Estado global:** singletons de módulo em `infrastructure/database/prisma.client.js`, `shared/events/event-bus.js`, `modules/conversas/conversa.stream.js` (Map de tickets).
- **Concorrência:** seções críticas protegidas por `comLock` (`shared/helpers/lock.helper.js`) e por `upsert` atômico em `conversa.repository.proximoNumero`.
- **Payload:** `express.json({ limit: "30mb" })` porque mídia trafega em base64.
- **Injeção de dependência no motor:** `chatbot.engine.js` usa `this.deps.*` para o simulador (`chatbot.simulador.js`) rodar o mesmo código sem tocar o WhatsApp — não substituir por `require` direto.

## Anti-Patterns

### Deduzir setor a partir do texto

**What happens:** tentar adivinhar o setor da conversa por palavra-chave da mensagem.
**Why it's wrong:** conversa nova nasce sem setor; adivinhar cria roteamento errado e vazamento entre cargos (o guard do SSE filtra por setor).
**Do this instead:** usar `resolverSetorDeclarado` / `setorDaOpcaoEscolhida` de `server/src/shared/helpers/setor.helper.js`.

### Criar mais um mecanismo de tempo real

**What happens:** uma tela nova adiciona polling próprio para manter dado fresco.
**Why it's wrong:** vários mecanismos concorrentes discordam entre si e refazem o guard de permissão fora do lugar.
**Do this instead:** publicar em `server/src/shared/events/event-bus.js` (`emitConversa`, `emitStatusMensagem`, `emitRecurso`) e consumir pela conexão SSE já aberta.

### Empurrar conteúdo de lista pelo stream

**What happens:** mandar a lista inteira de parceiros/equipe dentro do evento SSE.
**Why it's wrong:** obriga a replicar as regras de acesso das rotas dentro do stream — é assim que o tempo real vaza o que a leitura esconde.
**Do this instead:** `bus.emitRecurso("<nome>")` e deixar o front reler pela API com as permissões aplicadas.

### Confiar na permissão que veio do front

**What happens:** aceitar cargo/módulo/setor enviados no body.
**Why it's wrong:** `RotaModulo`/`RotaProtegida` no client são só usabilidade.
**Do this instead:** ler de `req.user` (token validado) e reconferir no service, com `exigirModulo` na borda — ver `server/src/modules/permissoes/modulo.middleware.js`.

### Alongar o JWT para resolver queda de sessão

**What happens:** aumentar `JWT_EXPIRES_IN`.
**Why it's wrong:** token longo é token não revogável; a sessão longa é responsabilidade do refresh em `SessaoRefresh`.
**Do this instead:** manter o acesso curto e usar a rotação de `server/src/config/env.js` + `infrastructure/repositories/sessaoRefresh.repository.js`.

### Service chamando Prisma direto

**What happens:** `prisma.conversa.findMany` dentro de um service.
**Why it's wrong:** perde o include padronizado e o incremento de `versao`, e a tela passa a receber campos ora presentes, ora ausentes.
**Do this instead:** usar/estender o repository correspondente em `server/src/infrastructure/repositories/`.

## Error Handling

**Strategy:** exceções tipadas capturadas por um único middleware terminal.

**Patterns:**
- Lançar `AppError(mensagem, statusCode, code)` (`server/src/shared/errors/AppError.js`) para erro de negócio.
- Rotas encadeiam `.catch(next)` no handler assíncrono.
- `ZodError` vira `400 VALIDATION_ERROR` com `details[]`; erro desconhecido vira `500 INTERNAL_ERROR` e é logado com stack (`server/src/shared/middlewares/error.middleware.js`).

## Cross-Cutting Concerns

**Logging:** Winston em `server/src/config/logger.js`; nunca `console.log` no backend.
**Validação:** Zod na borda via `validate(schema)` + reconferência no service (defesa em profundidade).
**Autenticação:** JWT curto + refresh rotativo (`shared/middlewares/auth.middleware.js`); SSE por ticket de uso único; mídia por token assinado em `?t=` (`shared/helpers/midiaToken.helper.js`).
**Autorização:** `exigirModulo(<modulo>)` na rota + guard de setor (`podeAcessarSetor`) na leitura e no stream.
**Rate limiting:** `shared/middlewares/rateLimit.middleware.js` (`apiLimiter`, `midiaLimiter`, `webhookLimiter`).
**Documentação de API:** swagger-jsdoc em `server/src/config/swagger.js`, servido em `/api-docs`.

---

*Architecture analysis: 2026-08-27*
