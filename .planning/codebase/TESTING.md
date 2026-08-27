# Testing Patterns

**Analysis Date:** 2026-08-27

> **Estado atual:** o projeto **não tem framework de testes instalado** — nenhum Jest, Vitest, Mocha, Playwright ou Cypress em `server/package.json` ou `client/package.json`, e nenhum arquivo `*.test.*` / `*.spec.*` no repositório. Não existe script `npm test`.
>
> O que existe é uma cultura de **verificação executável escrita à mão**, centrada no simulador do chatbot. Este documento descreve esse padrão real (que deve ser seguido e ampliado) e o caminho para formalizar testes quando isso for decidido.

## Test Framework

**Runner:** nenhum instalado.

**Harness em uso:** script Node autônomo executado direto pelo `node`.
- `server/verificar-tudo.js` — suíte de verificação do motor do chatbot (simulador, mapa de filas → setor, horário de atendimento, encerramento por inatividade).
- `server/testar-botoes.js` — teste manual descartável de envio de botões/lista pela Evolution API; exige número real e olhos no WhatsApp.

**Assertion:** função `check` local, sem biblioteca:

```js
const erros = [];
const check = (cond, msg) => { if (!cond) erros.push(msg); };
```

Ao final, imprime todas as falhas acumuladas e sai com código de saída não-zero:

```js
console.log("\n" + (erros.length ? `FALHAS (${erros.length}):\n  ` + erros.join("\n  ") : "TODAS AS VERIFICACOES PASSARAM"));
process.exit(erros.length ? 1 : 0);
```

Note que o padrão **acumula** falhas em vez de abortar na primeira — uma rodada mostra tudo o que quebrou.

**Run Commands:**

```bash
cd server && node verificar-tudo.js          # suíte do motor do chatbot (exit 1 se falhar)
cd server && node testar-botoes.js 55279XXXXXXXX   # teste manual de botões WhatsApp
cd server && node prisma/criar-conversa-teste.js   # semeia conversa de teste no banco
cd server && npm run db:seed                       # dados base para testar a UI
```

Nenhum desses roda em CI — não há workflow de CI configurado.

## Test File Organization

**Location:** scripts de verificação ficam na **raiz de `server/`**, não em pasta `tests/`. Fixtures reais moram em `docs/` (`docs/fluxo-arka.json`) e em `server/prisma/*.js` (seeds).

**Naming:** `verificar-*.js` para suíte repetível, `testar-*.js` para checagem manual descartável (o cabeçalho do arquivo diz explicitamente "pode apagar depois do teste").

**Structure:**

```
server/
├── verificar-tudo.js                    # suíte executável do motor
├── testar-botoes.js                     # sonda manual de integração
├── prisma/
│   ├── seed.js                          # dados base
│   └── criar-conversa-teste.js          # fixture de conversa
└── src/modules/chatbot/
    └── chatbot.simulador.js             # o "test double harness" de produção
docs/fluxo-arka.json                     # fluxo real usado como fixture
```

## Test Structure

O padrão é um IIFE async com seções numeradas por comentário, cada uma um cenário nomeado:

```js
(async () => {
  // ---- 1. simulador: caminho completo do suporte -------------------------
  let r = await simulador.simular(fluxo, ["oi", "1", "tenho contrato", "Empresa X, Joao, TI", "trocar toner"], {
    nomeCliente: "Maria",
    filas: { 33: "Suporte", 35: "Comercial" },
  });
  mostrar("simulador: suporte com contrato (fila 33 -> Suporte)", r);
  check(r.turnos.length === 5, `esperava 5 turnos, veio ${r.turnos.length}`);
  check(ultimo.setor === "Suporte", `setor=${ultimo.setor}, esperado Suporte (mapa de filas)`);

  // ---- 6. fora do horario de atendimento -------------------------------
  ...
})().catch((e) => { console.error("ERRO", e); process.exit(1); });
```

**Padrões:**
- **Setup:** nenhum `beforeEach`; cada cenário monta seus dados inline. O simulador é stateless de propósito — cada chamada replica a conversa do zero.
- **Mensagem de falha carrega o valor obtido**, sempre: `` `filaId=${ultimo.filaId}` ``. Nunca `check(x, "falhou")`.
- **Saída legível junto da asserção:** `mostrar(titulo, r)` imprime o diálogo turno a turno (`cliente:` / `bot:` / tags de estado) para que uma falha possa ser diagnosticada sem depurador.
- **Tabela de casos** para regras puras, em vez de repetir blocos:

```js
const casos = [
  [comercial, seg10h, false, "segunda 10h dentro do comercial"],
  [comercial, seg20h, true,  "segunda 20h fora"],
  [comercial, dom10h, true,  "domingo fora (dia nao atendido)"],
  [{ ativo: true, inicio: "22:00", fim: "06:00", dias: [1,2,3,4,5] }, new Date("2026-08-18T03:00:00"), false, "plantao 3h dentro"],
];
for (const [cfg, quando, esperado, rotulo] of casos) {
  const obtido = engine.foraDoHorario(cfg, quando);
  if (obtido !== esperado) erros.push(`horario "${rotulo}": esperado fora=${esperado}, obtido ${obtido}`);
  console.log(`  ${obtido === esperado ? "OK  " : "FALHA"} ${rotulo} -> fora=${obtido}`);
}
```

- **Datas fixas** (`new Date("2026-08-17T20:00:00")`) para regras de calendário; `Date.now() - 11 * 60 * 1000` para simular envelhecimento de sessão. Nunca dependa da hora do relógio para o resultado.

## Mocking

**Framework:** nenhum. Mocks são **objetos literais com funções async** injetados no construtor — viabilizados pela injeção de dependência do `ChatbotEngine`.

```js
const enviadas = [];
const engine = new ChatbotEngine({
  fluxoRepository:   { findById: async () => fluxo, createLog: async () => {} },
  conversaRepository: {
    findById: async () => conversa,
    addMensagem: async (_i, origem, texto) => { if (origem === "bot") enviadas.push(texto); return { id: "m" }; },
    vincularWaMessageId: async () => {},
    update: async (_i, d) => Object.assign(conversa, d),
  },
  sessaoRepository: { upsert: async () => ({}), update: async () => ({}) },
  evolutionApi:     { sendText: async () => ({ key: { id: "x" } }) },
  bus:              { emitConversa: () => {} },
});
```

O ambiente completo de dublês vive em `server/src/modules/chatbot/chatbot.simulador.js` (`criarAmbiente`) — conversa e sessão em memória, nada de WhatsApp, nada de banco, nenhum log gravado.

**What to Mock:**
- Repositórios Prisma (banco)
- `evolution-api.client` (envio ao WhatsApp)
- `n8n.client`, `transcricao.client`
- `event-bus` (SSE)
- Relógio, via parâmetro `agora` explícito

**What NOT to Mock:**
- **O motor nunca.** Regra explícita registrada no cabeçalho de `chatbot.simulador.js`: "A logica exercitada e byte a byte a mesma que atende o cliente de verdade... Uma copia da orquestracao aqui envelheceria sozinha e o teste passaria a mentir sobre o comportamento do bot."
- Helpers puros (`cnpj.helper`, `setor.helper`, `mapper.helper`) — teste-os diretamente.
- Zod / schemas de DTO.

**Regra de contrato:** um dublê deve implementar **todos** os métodos que o caminho de produção chama, inclusive os de performance (`findByIdParaEvento`, `findByTelefoneParaMotor`). Omitir um faz o simulador quebrar num caminho que o cliente real percorre a cada mensagem — o comentário no simulador documenta exatamente esse risco.

## Fixtures and Factories

**Test Data:** o fluxo real de produção é a fixture principal — `docs/fluxo-arka.json` é lido e convertido pelo mesmo conversor de importação usado pela UI (`client/src/components/flow/fluxoJson.js`), avaliado no Node com `new Function` já que o arquivo é ESM:

```js
const fonte = readFileSync(path.join(__dirname, "..", "client/src/components/flow/fluxoJson.js"), "utf8");
const mod = {};
new Function("exports", fonte.replace(/export /g, "") + "\n;exports.extrair = extrairFluxosImportados;")(mod);
const [convertido] = mod.extrair(JSON.parse(readFileSync(path.join(__dirname, "..", "docs", "fluxo-arka.json"), "utf8")));
```

Isso mantém o teste honesto: se o conversor da UI quebrar, a verificação quebra junto.

**Location:**
- Fluxo de referência: `docs/fluxo-arka.json`
- Seeds de banco: `server/prisma/seed.js`, `server/prisma/criar-conversa-teste.js`, `server/prisma/importar-parceiros.js`
- Objetos inline (`conversaInat`, `sessaoVelha`) construídos no ponto de uso

**Constantes reservadas:** `TELEFONE_TESTE = "0000000000"` e `MAX_MENSAGENS = 40` em `chatbot.simulador.js` — o telefone sentinela impede que uma simulação colida com uma conversa real.

## Coverage

**Requirements:** nenhuma métrica de cobertura coletada ou exigida.

**Cobertura efetiva (manual):** boa no motor do chatbot (fluxo, gatilho, horário, inatividade, mapa de filas). Praticamente nula em: módulos CRUD (`contatos`, `parceiros`, `agenda`, `campanhas`), autenticação/refresh/inatividade de sessão, permissões por módulo, SSE (`conversa.stream.js`), armazenamento e tokens de mídia, e todo o front-end.

## Test Types

**Unit-ish (o que existe):** regras puras do engine testadas com entradas diretas — `engine.foraDoHorario(cfg, quando)`, `engine.configuracaoInatividade(fluxo)`.

**Integration-in-memory (o padrão principal):** motor real + repositórios falsos, exercitando conversas completas de ponta a ponta sem I/O. É o modelo a replicar para novos módulos.

**Manual / exploratório:** `server/testar-botoes.js` (WhatsApp real), rota `POST /api/chatbot/simular` (`server/src/modules/chatbot/chatbot.routes.js`) que expõe o mesmo simulador para o botão **Testar** da tela de Fluxos — o operador testa o bot pela UI usando exatamente o motor de produção.

**E2E:** não usado.

## Common Patterns

**Async Testing:**

```js
(async () => {
  const r = await simulador.simular(fluxo, ["oi", "4"], {});
  check(r.turnos[1].encerrado, "nao encerrou");
})().catch((e) => { console.error("ERRO", e); process.exit(1); });
```

O `.catch` final é obrigatório — sem ele uma rejeição sai com código 0 e a verificação passa mentindo.

**Testando o caso negativo (tão importante quanto o positivo):** todo cenário de ação vem acompanhado do cenário em que nada deve acontecer.

```js
// não pode agir numa sessão que ainda não estourou o tempo
const resNova = await engineInat.aplicarInatividade({ ...sessaoVelha, atualizadoEm: new Date(Date.now() - 60 * 1000) }, ctx);
check(resNova === null, "agiu numa sessao que ainda nao estourou o tempo");

// conversa entregue ao humano não é mais do bot
const resHumano = await engineInat.aplicarInatividade({ ...sessaoVelha, aguardando: "humano" }, ctx);
check(resHumano === null, "mexeu numa conversa que ja estava com atendente");
```

**Testando efeito colateral:** capture em array e asserte sobre o conteúdo, não sobre a chamada.

```js
const enviadas = [];
// ... addMensagem empurra para `enviadas`
check(/por falta de intera/i.test(enviadas[0] || ""), "nao enviou a mensagem de inatividade do fluxo");
```

**Testando mutação de estado:** o dublê aplica `Object.assign` no objeto em memória, e a asserção lê o objeto.

```js
update: async (_i, d) => Object.assign(conversaInat, d),
// ...
check(conversaInat.statusAtendimento === "fechada", `status=${conversaInat.statusAtendimento}`);
```

## Adding New Verification

Ao construir uma feature nova, siga o padrão existente:

1. Se a regra for pura (horário, formatação, CNPJ, setor), adicione uma **tabela de casos** a `server/verificar-tudo.js`.
2. Se envolver orquestração, injete dublês no serviço/motor real — **nunca** reimplemente a lógica no teste.
3. Sempre inclua o caso negativo ("não deve agir quando ...").
4. Mantenha `process.exit(erros.length ? 1 : 0)` para que a verificação sirva de portão.

Se for formalizar uma suíte, o encaixe natural é **Vitest** (o client já usa Vite; o server é CommonJS e Vitest lida com ambos), com os cenários de `verificar-tudo.js` portados 1:1 para `describe`/`it` sem mudar os dublês.

---

*Testing analysis: 2026-08-27*
