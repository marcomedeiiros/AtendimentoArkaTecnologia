# Projeto: Atendimento Arka Tecnologia

## Core Value

Central de atendimento WhatsApp multi-operador: a equipe conversa com clientes
pelo painel, um chatbot de fluxos faz a triagem antes do humano, e cada conversa
tem UM responsavel visivel para toda a equipe.

## Arquitetura (levantada em 2026-08-28)

| Camada | Stack | Onde |
|---|---|---|
| Front | React 18 + Vite + Tailwind, sem gerenciador de estado externo | `client/src` |
| API | Express 4 (CommonJS), modulos `routes -> controller -> service -> repository` | `server/src/modules` |
| Dados | Prisma 6 sobre SQLite | `server/prisma/schema.prisma` |
| WhatsApp | Evolution API (Baileys) via HTTP | `server/src/infrastructure/external/evolution-api.client.js` |
| Tempo real | SSE proprio (`conversa.stream.js`) + event-bus em memoria | `server/src/shared/events` |
| Sessao | JWT em cookie HttpOnly + CSRF double-submit + refresh rotativo | `shared/helpers/sessaoCookie.helper.js` |
| CAPTCHA | Cloudflare Turnstile, site key servida pela API | `infrastructure/external/turnstile.client.js` |
| Testes | Scripts `verificar-*.js` que sobem o app real e batem no HTTP | `server/verificar-*.js` |

## Constraints

- Projeto em producao. Nao remover APIs, campos de banco nem tipos de bloco.
- Nao enfraquecer CSRF, Turnstile ou o escopo por setor para "fazer funcionar".
- Toda autorizacao relevante e do SERVIDOR. O front nunca e a fonte da verdade.
- Codigo e comentarios em portugues, seguindo o estilo denso ja existente
  (o comentario explica POR QUE, e cita o incidente que motivou a regra).
- Sem framework de teste: a convencao e `node verificar-<assunto>.js`, que cria e
  apaga os proprios dados.

## Key Decisions

| # | Decisao | Por que |
|---|---|---|
| D1 | Corrigir o DTO de fluxos para aceitar `null`, em vez de o front limpar os nulos | O contrato quebrado e do servidor: ele EMITE `null` no GET e RECUSA `null` no PUT. Consertar so o front deixaria a rota podre para qualquer outro cliente. |
| D2 | Preservar o id dos passos no update, em vez de recriar UUIDs | Identidade estavel e pre-requisito para salvar bloco a bloco e para o front nao ficar com ids fantasma. |
| D3 | Transferencia autorizada por dono da conversa + UPDATE condicional | Mesma regra ja usada em `assumirAtomico`: quem decide o dono e o banco, nao a leitura anterior. |
| D4 | Enviar `X-CSRF-Token` no XHR de midia, em vez de isentar a rota do CSRF | A rota MUDA estado com a sessao em cookie -- e exatamente o alvo do CSRF. Isenta-la seria abrir o buraco que o guard fecha. |
| D5 | Renderizar o Turnstile no cadastro, em vez de tirar o guard da rota | O guard esta certo; a tela e que nao produz o token. |
