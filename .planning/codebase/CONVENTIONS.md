# Coding Conventions

**Analysis Date:** 2026-08-27

Monorepo com dois pacotes independentes: `server/` (Node + Express + Prisma, CommonJS) e `client/` (React 18 + Vite + Tailwind, ESM). Não há linter nem formatter configurado — as convenções abaixo são as observadas de forma consistente no código e devem ser seguidas manualmente.

## Naming Patterns

**Idioma:** todo o domínio é escrito em **português** (nomes de funções, variáveis, campos de API, mensagens de erro). Somente termos técnicos consagrados ficam em inglês (`findAll`, `create`, `update`, `router`, `next`, `success`). Não traduza nem "anglicize" nomes existentes.

**Arquivos (server):** `dominio.papel.js` em camelCase, sufixo indicando a camada:
- `contato.controller.js`, `contato.service.js`, `contato.routes.js`, `contato.dto.js`
- `contato.repository.js` (em `server/src/infrastructure/repositories/`)
- `auth.middleware.js`, `cnpj.helper.js`, `evolution-api.client.js` (clients externos usam kebab-case)
- Domínio composto usa camelCase: `mensagemRapida.service.js` dentro da pasta `modules/mensagensRapidas/`

**Arquivos (client):**
- Componentes/páginas: PascalCase `.jsx` — `Avatar.jsx`, `ContatosPage.jsx`, `VisualFlowEditor.jsx`
- Utilitários/hooks/serviços: camelCase `.js` — `usePreferencia.js`, `mesclarConversa.js`, `api.js`
- Páginas de rota em `client/src/pages/` sempre com sufixo `Page` e default export

**Funções:** camelCase, verbo em português — `listar`, `criar`, `atualizar`, `remover`, `sincronizarDoWhatsApp`, `aplicarInatividade`, `limparTelefone`. Métodos de repositório são a exceção em inglês (`findAll`, `findById`, `findByTelefone`, `create`, `update`, `delete`).

**Variáveis:** camelCase. Constantes de módulo em SCREAMING_SNAKE_CASE — `TELEFONE_TESTE`, `MAX_MENSAGENS`, `API_BASE`, `TOKEN_KEY`, `FUSO_BR`, `CORES`, `TAMANHOS`, `PREFIXO`.

**Classes:** PascalCase, uma por arquivo, exportada já instanciada (singleton):

```js
class ContatoService { /* ... */ }
module.exports = new ContatoService();
```

Exceções que exportam a classe: `ChatbotEngine` (`server/src/modules/chatbot/chatbot.engine.js`, exportação nomeada, para injeção de dependência) e `AppError`.

**Schemas Zod:** `<verbo><Entidade>Schema` — `criarContatoSchema`, `atualizarContatoSchema`, `sincronizarContatosSchema` (`server/src/modules/contatos/contato.dto.js`).

**Códigos de erro:** SCREAMING_SNAKE_CASE — `NOT_FOUND`, `INVALID_PHONE`, `VALIDATION_ERROR`, `SYNC_CONTATOS_FALHOU`.

## Code Style

**Formatação:**
- Nenhum Prettier/ESLint/Biome configurado. Formatação é manual e consistente.
- Indentação: 2 espaços. Ponto e vírgula sempre.
- **Aspas duplas no server**, **aspas simples no client**. Respeite o lado em que estiver editando.
- Largura de linha: ~100 colunas nos comentários; linhas de código podem passar (ex.: definições de rota em `server/src/modules/contatos/contato.routes.js`).
- Comentários e strings de UI usam acentuação; comentários do server frequentemente aparecem **sem acento** (`invalido`, `nao`, `conversao`) por compatibilidade de encoding — siga o arquivo em que estiver.

**Linting:** não há. Diretivas `eslint-disable-next-line react-hooks/exhaustive-deps` aparecem no client (`client/src/hooks/usePreferencia.js`) como documentação de intenção, não porque algum linter rode.

## Import Organization

Server (CommonJS, `require` no topo, sem `import`):
1. Pacotes externos (`express`, `zod`, `winston`)
2. Camada de infraestrutura / clients (`../../infrastructure/...`)
3. Helpers e shared (`../../shared/helpers/...`, `../../shared/errors/AppError`)
4. Config (`../../config/logger`, `./config/env`)

Client (ESM):
1. React e libs (`react`, `react-router-dom`, `lucide-react`)
2. Serviços (`../services/api`)
3. Componentes (`../components/...`)
4. Utilitários (`../utils/...`)

**Path Aliases:** nenhum. Sempre caminhos relativos (`../../shared/...`). Não introduza aliases.

## Camadas e Responsabilidades (server)

Fluxo obrigatório para qualquer rota nova:

`routes` → `validate(schema)` → `controller` → `service` → `repository` → `prisma`

- **routes**: monta middlewares (`authMiddleware`, `exigirModulo('<modulo>')`, `validate(...)`) e encadeia `.catch(next)` em cada handler assíncrono. Docs OpenAPI em blocos `@openapi` acima da rota.
- **controller**: fino, sem regra de negócio. Chama o service e devolve via `success(res, data)`. Ver `server/src/modules/contatos/contato.controller.js`.
- **service**: regra de negócio, checagem de existência, lançamento de `AppError`, emissão de eventos (`bus.emitRecurso`, `bus.emitConversa`), mapeamento de saída (`mapContato`, `mapMensagem`). Ver `server/src/modules/contatos/contato.service.js`.
- **repository**: apenas Prisma. Sem `AppError`, sem `logger`, sem regra. Ver `server/src/infrastructure/repositories/contato.repository.js`.
- **mapper** (`server/src/shared/helpers/mapper.helper.js`): converte modelo Prisma → payload da API. Nunca devolva o objeto do Prisma cru para o cliente.

**Autorização (regra dura):** nunca confie no front. `router.use(authMiddleware, exigirModulo("contatos"))` na borda **e** reconferência no service quando a regra depender do usuário. Allowlist de campos vive só no DTO Zod.

## Error Handling

**Padrões:**
- Erros de negócio: `throw new AppError(mensagem, statusCode, CODIGO)` (`server/src/shared/errors/AppError.js`). Mensagem em português, voltada ao operador.
- Erros de validação: nunca lançados à mão — `server/src/shared/middlewares/validate.middleware.js` empurra o `ZodError` para o `next`.
- Falha de integração externa: capture e re-lance como `AppError` com status `502` e código próprio (ex.: `SYNC_CONTATOS_FALHOU` em `contato.service.js`).
- Handlers de rota assíncronos **sempre** terminam com `.catch(next)`.
- `server/src/shared/middlewares/error.middleware.js` é o único lugar que formata resposta de erro. Ordem: `ZodError` → `AppError` → log + 500 genérico.

**Formato de resposta (invariante da API):**

```js
// sucesso
{ success: true, data }
{ success: true, data, meta }        // paginated()
// erro
{ success: false, error: { code, message } }
{ success: false, error: { code: "VALIDATION_ERROR", message, details: [{ field, message }] } }
```

Use sempre `success(res, data, statusCode)` / `paginated(res, data, meta)` de `server/src/shared/helpers/response.helper.js`. `201` para criação.

**Client:** `try/catch` com fallback silencioso quando a falha não deve travar a tela — `catch { /* offline: cache basta */ }` (`client/src/hooks/usePreferencia.js`), `onError` para imagens quebradas (`client/src/components/Avatar.jsx`). Falhe fechado em segurança, falhe aberto em conforto de UI.

## Logging

**Framework:** `winston` via `server/src/config/logger.js`. Nível `info` em produção, `debug` fora.

**Padrões:**
- Timestamp fixado no fuso `America/Sao_Paulo` — não use `console.log` no server, perde timestamp e contexto.
- Mensagem curta em português + objeto de metadados: `logger.error("Erro nao tratado", { message, stack, path, method })`.
- Nunca logue token, senha, header `Authorization` ou base64 de mídia.
- `console.log` é aceitável apenas em scripts descartáveis na raiz de `server/` (`server/verificar-tudo.js`, `server/testar-botoes.js`) e no client.

## Comments

Esta é a convenção mais marcante do projeto: **comentários explicam o PORQUÊ, não o QUÊ**, e frequentemente registram o bug concreto que motivou o código. Mantenha esse padrão — remover esses comentários apaga conhecimento operacional.

Exemplos representativos:
- `client/src/utils/data.js` — por que o fuso é fixo em Brasília (a Agenda marcava o dia errado após as 21h)
- `client/src/services/api.js` — por que `registrarAtividade()` NÃO pode ser chamado na renovação (a sessão virava imortal)
- `server/src/shared/helpers/lock.helper.js` — por que existe fila por chave (webhooks paralelos duplicavam conversa)
- `server/src/shared/helpers/mapper.helper.js` — por que base64 virou URL assinada (502 por payload de ~27MB)

Regras:
- Cabeçalho de arquivo com bloco `//` explicando o papel do módulo quando ele não é óbvio.
- Separadores visuais `// ── Título ────` para seções longas.
- Avisos em caixa alta para invariantes perigosas: `// ATENCAO: NAO chamar ...`.
- JSDoc em utilitários e hooks públicos com `@param`/`@returns` (`client/src/hooks/usePreferencia.js`, `client/src/utils/data.js`).
- JSDoc `@openapi` nas rotas que devem aparecer no Swagger (`/api-docs`).

## Function Design

- Funções pequenas, um propósito. Services concentram os métodos maiores, mas cada um cabe numa tela.
- Parâmetros: até 2 posicionais; a partir daí, **objeto de opções desestruturado** — `criarAmbiente({ fluxo, nomeCliente, horario, filas, agora, pesquisaAtiva = true })` em `server/src/modules/chatbot/chatbot.simulador.js`.
- Defaults nos parâmetros em vez de `if (!x) x = ...`.
- Guard clauses no topo (`if (!existente) throw new AppError(...)`), sem `else` profundo.
- `async/await` no server; `.then()` só na casca fina do controller.
- Retorno consistente: services devolvem o objeto mapeado ou `{ removido: true }`; funções que "não fizeram nada" devolvem `null` (ex.: `aplicarInatividade`).

## Module Design

- **Server:** `module.exports = new Classe()` (singleton) para controller/service/repository; `module.exports = funcao` para middlewares; `module.exports = { a, b }` para helpers e DTOs.
- **Client:** `export default` para componentes e páginas; exportações nomeadas para hooks, utilitários e objetos de API (`PreferenciasAPI`, `getToken`, `dataISO`).
- **Barrel files:** não são usados. Importe o arquivo diretamente.
- Injeção de dependência é deliberada no `ChatbotEngine`: ele recebe `{ fluxoRepository, conversaRepository, sessaoRepository, evolutionApi, bus }`. É isso que permite simular o bot sem banco — mantenha esse contrato ao mexer no motor.

## Front-end (React)

- Componentes funcionais, sem classes. Hooks no topo, nunca condicionais.
- Estilização exclusivamente por classes Tailwind inline; tokens semânticos de tema (`bg-acao`, `text-ativo-400`, `border-espera/40`) em vez de cores cruas quando existir token (`client/tailwind.config.js`).
- Estado de servidor via `client/src/services/api.js`; preferências persistidas via `usePreferencia` (debounce de 600 ms + cache local), nunca `localStorage` direto para preferência de usuário.
- Cleanup obrigatório em `useEffect` (flag `ativo`, `clearTimeout`) para evitar setState após desmontar.

---

*Convention analysis: 2026-08-27*
