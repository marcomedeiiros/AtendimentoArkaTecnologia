<!-- refreshed: 2026-08-27 -->
# Codebase Concerns

**Analysis Date:** 2026-08-27

Projeto: painel de atendimento WhatsApp (Express + Prisma/SQLite + React/Vite), backend em `server/src`, frontend em `client/src`, deploy por `docker-compose.prod.yml` em VM.

Observação de contexto: o código é fortemente comentado, com justificativas de decisão embutidas (segredos, sessão, mídia, event bus). Boa parte das armadilhas abaixo já está reconhecida no próprio código — o risco predominante é de operação e escala, não de desconhecimento.

## Tech Debt

**Ausência total de testes automatizados:**
- Issue: nenhum arquivo `*.test.*` / `*.spec.*`, nenhum runner (`jest`/`vitest`) configurado em `server/package.json` nem em `client/package.json`.
- Files: repositório inteiro (`server/src/**`, `client/src/**`)
- Impact: toda regressão é descoberta em produção; refatorar `chatbot.engine.js` (2357 linhas) é apostar.
- Fix approach: começar por testes de unidade do motor do bot e dos helpers puros (`server/src/shared/helpers/`), depois testes de integração das rotas com SQLite em arquivo temporário.

**Nenhum linter ou formatador:**
- Issue: não há `.eslintrc*`, `eslint.config.*`, `.prettierrc*` ou `biome.json` no repositório.
- Files: raiz, `server/`, `client/`
- Impact: convenções dependem de disciplina humana; erros triviais (variável não usada, `await` esquecido) não são pegos.
- Fix approach: ESLint flat config + Prettier, com regra equivalente a `no-floating-promises` no backend.

**Arquivos muito grandes / responsabilidade acumulada:**
- Issue: componentes e serviços monolíticos.
- Files: `client/src/components/pages/AtendimentoView.jsx` (3610 linhas), `server/src/modules/chatbot/chatbot.engine.js` (2357), `client/src/components/flow/VisualFlowEditor.jsx` (1529), `server/src/modules/conversas/conversa.service.js` (1113), `server/src/infrastructure/repositories/conversa.repository.js` (630)
- Impact: qualquer mudança carrega o arquivo inteiro no contexto; conflitos de merge frequentes; difícil isolar comportamento para teste.
- Fix approach: extrair de `AtendimentoView.jsx` a lista de conversas, a bolha de mensagem e o compositor para componentes próprios; quebrar o engine por responsabilidade (roteamento de gatilho, execução de passo, inatividade, CNPJ).

**Migrations do Prisma não existem — o deploy usa `db push --accept-data-loss`:**
- Issue: `server/prisma/migrations/` não existe; `server/docker-entrypoint.sh` aplica o schema com `npx prisma db push --skip-generate --accept-data-loss`.
- Files: `server/docker-entrypoint.sh`, `server/prisma/schema.prisma`
- Impact: uma mudança destrutiva de coluna passa silenciosa no deploy e apaga dados de produção; não há histórico versionado do schema nem rollback.
- Fix approach: adotar `prisma migrate deploy` com migrations commitadas; enquanto isso, backup obrigatório (`deploy/backup.sh`) antes de todo deploy que toca `schema.prisma`, e leitura do log do passo de push.

**Scripts de migração de dados avulsos, sem controle de execução:**
- Issue: uma coleção de scripts one-off convive com o schema, sem registro de quais já rodaram.
- Files: `server/prisma/backfill-atendente.js`, `server/prisma/backfill-atendimentos.js`, `server/prisma/backfill-status.js`, `server/prisma/migrar-blocos-de-espera.js`, `server/prisma/migrar-setor-do-menu.js`, `server/prisma/limpar-setor-adivinhado.js`
- Impact: depende de idempotência mantida à mão; `backfill-atendimentos.js` roda em TODA subida do container.
- Fix approach: mover para migrations versionadas ou uma tabela de controle de execução; aposentar os já aplicados.

**Artefatos de runtime versionados no git:**
- Issue: `server/prisma/dev.db-shm` está rastreado pelo git (aparece modificado no `git status`), e há mídias binárias commitadas em `server/dados/midia/2026/08/*.png|webp`.
- Files: `server/prisma/dev.db-shm`, `server/dados/midia/`, `.gitignore`
- Impact: ruído em todo diff, repositório inchando com binários, risco de commitar conteúdo real de conversas de clientes (dado pessoal) no histórico.
- Fix approach: `git rm --cached` nesses caminhos e estender `.gitignore` para `server/prisma/dev.db*` e `server/dados/`.

## Known Bugs

**Botões interativos do WhatsApp indisponíveis:**
- Symptoms: mensagens com botões não são entregues; menu segue como texto numerado.
- Files: `docker-compose.prod.yml` (`image: evoapicloud/evolution-api:v2.3.7`), `server/src/infrastructure/external/evolution-api.client.js`, `server/testar-botoes.js`
- Trigger: enviar mensagem de botão pela Evolution API 2.3.7 (regressão `this.isZero`).
- Workaround: menu textual numerado. A correção exige subir para a 2.4.0, que precisa de ativação no Manager.

**Consolidação de histórico pode falhar calada no boot:**
- Symptoms: conversas duplicadas ou atendimentos (OS) ausentes após deploy.
- Files: `server/docker-entrypoint.sh`, `server/prisma/backfill-atendimentos.js`
- Trigger: erro no script de backfill — a API sobe assim mesmo, por decisão explícita (evitar o crash-loop de 502 já vivido).
- Workaround: conferir o log do passo "consolidando conversas e atendimentos" a cada deploy.

## Security Considerations

**Credenciais de administrador com padrão embutido:**
- Risk: `ADMIN_EMAIL`/`ADMIN_PASSWORD` caem em `admin@arkatecnologia.com.br` / `Admin@123` se não definidos, e o seed do entrypoint ressincroniza a senha do admin a cada boot.
- Files: `server/src/config/env.js` (bloco `admin`), `server/prisma/seed.js`, `server/docker-entrypoint.sh`
- Current mitigation: `.env.example` documenta as variáveis; `JWT_SECRET` e `WEBHOOK_SECRET` já derrubam o boot em produção quando ausentes (função `segredo`).
- Recommendations: aplicar a mesma regra do `segredo()` ao `ADMIN_PASSWORD` — falhar o boot em produção em vez de usar padrão conhecido e público.

**Cadastro aberto por padrão:**
- Risk: `registroCodigo` vazio significa que qualquer um que alcance `POST /api/auth/cadastrar` cria conta e passa a ler conversas de clientes.
- Files: `server/src/config/env.js`, `server/src/modules/auth/auth.routes.js`
- Current mitigation: `authLimiter` (40/15min, `skipSuccessfulRequests`) e o alerta escrito no próprio código.
- Recommendations: exigir `REGISTRO_CODIGO` em produção (ou desativar a rota) em vez de deixar o padrão permissivo.

**Swagger exposto sem autenticação:**
- Risk: `/api-docs` e `/api-docs.json` são montados antes de qualquer auth e sem distinção de ambiente — mapa completo da superfície de API para quem alcançar a URL.
- Files: `server/src/app.js`, `server/src/config/swagger.js`
- Current mitigation: nenhuma.
- Recommendations: montar apenas quando `env.nodeEnv !== "production"`, ou proteger com o middleware de admin.

**Sem cabeçalhos de segurança HTTP:**
- Risk: nenhum `helmet` ou equivalente; sem CSP, `X-Content-Type-Options`, `Referrer-Policy`. O servidor entrega mídia arbitrária de clientes em `/midia` e `/anexo`.
- Files: `server/src/app.js`, `server/src/infrastructure/storage/midia.storage.js`
- Current mitigation: extensão derivada de uma allowlist de mimetypes (`EXTENSOES`), nome de arquivo sempre gerado por UUID, caminho validado contra a pasta base (anti-traversal), `midiaLimiter` de 300/min.
- Recommendations: adicionar `helmet`, forçar `Content-Disposition: attachment` e `Content-Type` sanitizado nas respostas de mídia.

**Token de sessão em `localStorage`/`sessionStorage`:**
- Risk: acessível a qualquer XSS no painel.
- Files: `client/src/services/api.js`, `client/src/pages/LoginPage.jsx`
- Current mitigation: JWT de acesso curto (1h) com refresh rotativo, detecção de reuso, teto absoluto de sessão, limite de sessões por usuário e expiração por inatividade (`server/src/config/env.js`, `server/src/infrastructure/repositories/sessaoRefresh.repository.js`).
- Recommendations: mover o refresh token para cookie `HttpOnly`+`SameSite`; sem CSP, uma dependência de frontend comprometida vira sequestro de sessão.

**CORS de origem única, sem lista:**
- Risk: `corsOrigin` cai em `http://localhost:5173` se `CORS_ORIGIN` não estiver definido, e só aceita uma origem.
- Files: `server/src/app.js`, `server/src/config/env.js`
- Current mitigation: falha ruidosa (painel não conecta) em vez de vazamento.
- Recommendations: aceitar lista separada por vírgula e falhar o boot em produção se ausente.

## Performance Bottlenecks

**SQLite como banco de produção:**
- Problem: escritas serializam no arquivo; webhook do WhatsApp, motor do bot, campanha em massa e o painel disputam o mesmo writer.
- Files: `server/prisma/schema.prisma` (`provider = "sqlite"`), `docker-compose.prod.yml` (`DATABASE_URL: "file:/data/arka.db"`)
- Cause: um único arquivo, um escritor por vez; transações longas em `server/src/infrastructure/repositories/conversa.repository.js` (linhas 254, 355, 467) bloqueiam o resto.
- Improvement path: migrar para PostgreSQL — o compose já sobe um `postgres:16-alpine` para a Evolution API, então a infraestrutura existe.

**Payload JSON de 30MB e mídia em base64:**
- Problem: `express.json({ limit: "30mb" })` permite que uma única requisição aloque dezenas de MB no heap do Node.
- Files: `server/src/app.js`, `server/src/infrastructure/storage/midia.storage.js`
- Cause: mídia trafega como data URL base64 em vez de `multipart/form-data`.
- Improvement path: upload via `multipart` com streaming direto para disco; o teto de 25MB por arquivo já existe em `MAX_BYTES_PADRAO`.

**Polling remanescente no painel apesar do SSE:**
- Problem: vários `setInterval` convivem com o stream — reconciliação a cada 300s e checagens a cada 10s em `client/src/context/AppContext.jsx` (linhas 259, 377, 386), polling de status/QR em `client/src/pages/WhatsAppPage.jsx` (98, 104), progresso de campanha em `client/src/components/pages/EnvioEmMassa.jsx` (186).
- Cause: telas que precisavam de dado fresco antes do event bus existir.
- Improvement path: o `apiLimiter` já foi elevado de 500 para 2000/15min por causa disso (`server/src/shared/middlewares/rateLimit.middleware.js`) — sinal de que a cota é consumida por polling, não por uso. Migrar essas telas para o evento `recurso` de `server/src/shared/events/event-bus.js`.

## Fragile Areas

**Motor do chatbot:**
- Files: `server/src/modules/chatbot/chatbot.engine.js` (2357 linhas), `server/src/modules/chatbot/chatbot.inatividade.js`, `server/src/modules/chatbot/chatbot.simulador.js`
- Why fragile: máquina de estado grande sem testes; o comportamento depende de gatilhos configurados pelo usuário (`"*"` vs palavra-chave), o que faz "bot silencioso" parecer bug do motor quando é configuração.
- Safe modification: reproduzir o cenário primeiro no simulador e no `client/src/components/flow/FlowTestChat.jsx`; conferir o gatilho antes de mexer no código.
- Test coverage: zero.

**Fluxo de atendimento no frontend:**
- Files: `client/src/components/pages/AtendimentoView.jsx`, `client/src/context/AppContext.jsx`
- Why fragile: 3610 linhas com estado local, otimismo de UI, reconciliação SSE e relógios compartilhados no mesmo arquivo; um `setState` fora de ordem desalinha o painel de todos os operadores.
- Safe modification: preservar os invariantes já documentados — evento SSE leva só a cauda, ACK é patch, um único relógio por lista (linhas 2593-2601).
- Test coverage: zero.

**Instância única obrigatória:**
- Files: `server/src/shared/events/event-bus.js`, `server/src/modules/chatbot/chatbot.inatividade.js` (linha 165), `server/src/modules/campanhas/campanha.service.js` (`recuperarAposReinicio`), `server/src/server.js`
- Why fragile: barramento de eventos em memória, varredura de inatividade por `setInterval` e recuperação de campanha no boot. Rodar duas réplicas duplica disparos e divide o SSE.
- Safe modification: manter uma réplica só até que fila e pub/sub externos existam.

## Scaling Limits

**Backend single-process:**
- Current capacity: uma instância, um processo Node, SQLite local.
- Limit: escala horizontal quebra o SSE (event bus em memória) e duplica timers/campanhas; escala vertical esbarra na serialização de escrita do SQLite.
- Scaling path: PostgreSQL + Redis (pub/sub para o event bus) + fila para campanhas e inatividade.

**Estado do WhatsApp concentrado na Evolution API:**
- Current capacity: uma instância (`WHATSAPP_INSTANCE`, padrão `arka-wapi-oficial`).
- Limit: um número de WhatsApp; a Evolution é ponto único de falha para envio e recebimento.
- Scaling path: multi-instância já modelada no schema (`model Instancia` em `server/prisma/schema.prisma`), mas o caminho de código assume uma só.

## Dependencies at Risk

**`evoapicloud/evolution-api:v2.3.7`:**
- Risk: versão com a regressão de botões; API não oficial de WhatsApp, sujeita a quebra a cada mudança do protocolo.
- Impact: envio de mensagens interativas indisponível; risco de banimento do número inerente a Baileys.
- Migration plan: subir para 2.4.0 (ativação gratuita no Manager) ou migrar para a Cloud API oficial.

**`express@4` e `zod@3`:**
- Risk: ambos com major seguinte disponível (`express@5`, `zod@4`); o atraso acumulado encarece a atualização.
- Files: `server/package.json`
- Impact: baixo hoje; cresce com o tempo.
- Migration plan: atualizar com testes no lugar — hoje não há rede de segurança para validar a troca.

**`html2canvas` + `jspdf` para exportação:**
- Risk: `html2canvas` está estagnado; a exportação depende de renderização fiel do DOM.
- Files: `client/src/utils/exportarPdf.js`, `client/package.json`
- Impact: PDF de relatório quebra silenciosamente quando o CSS muda.
- Migration plan: gerar o PDF no servidor a partir dos dados, não da tela.

## Missing Critical Features

**Sem observabilidade além de log em arquivo:**
- Problem: `winston` (`server/src/config/logger.js`) grava logs; não há rastreio de erro (Sentry), métrica nem alerta.
- Blocks: descobrir falha antes do cliente reclamar; medir latência real do recebimento de mensagem.

**Sem CI:**
- Problem: não há `.github/workflows/`; deploy é por script manual (`deploy/atualizar.sh`) na VM.
- Blocks: qualquer portão automático de qualidade — o que só passa a importar depois que existirem testes e lint.

**Backup do banco sem verificação de restauração:**
- Problem: `deploy/backup.sh` existe, mas nada valida que um backup restaura.
- Blocks: confiança no plano de recuperação, especialmente dado o `db push --accept-data-loss` do entrypoint.

## Test Coverage Gaps

Não há um único teste no repositório. Prioridades por risco:

**Motor do chatbot:**
- What's not tested: seleção de gatilho, avanço de passo, blocos de espera, encerramento por inatividade, vínculo/desvínculo de CNPJ.
- Files: `server/src/modules/chatbot/chatbot.engine.js`, `server/src/modules/chatbot/chatbot.inatividade.js`
- Risk: bot responde errado ou fica mudo para clientes reais.
- Priority: High

**Autenticação e sessão:**
- What's not tested: rotação de refresh token, detecção de reuso (janela de tolerância de 15s), teto absoluto, limite de sessões por usuário, expiração por inatividade.
- Files: `server/src/modules/auth/auth.service.js`, `server/src/infrastructure/repositories/sessaoRefresh.repository.js`, `server/src/config/env.js`
- Risk: falha aqui é falha de segurança, não de funcionalidade; a lógica de reuso é sutil demais para validar só à mão.
- Priority: High

**Concorrência de atendimento:**
- What's not tested: "quem responde, atende", corrida entre dois operadores assumindo a mesma conversa, abertura de OS.
- Files: `server/src/modules/conversas/conversa.service.js` (linhas 91, 876), `server/src/infrastructure/repositories/conversa.repository.js`
- Risk: conversa roubada ou atendimento duplicado sob carga.
- Priority: High

**Autorização por setor no stream SSE:**
- What's not tested: o guard que filtra por setor tanto no `conversa:update` quanto no patch `mensagem:status`.
- Files: `server/src/modules/conversas/conversa.stream.js`, `server/src/shared/events/event-bus.js`
- Risk: vazamento de conversa de um setor para cargos que não deveriam vê-la.
- Priority: High

**Campanhas em massa:**
- What's not tested: retomada após reinício, intervalo entre envios, contabilidade de destinatários.
- Files: `server/src/modules/campanhas/campanha.service.js`
- Risk: disparo duplicado para clientes reais — dano externo e irreversível.
- Priority: Medium

---

*Concerns audit: 2026-08-27*
