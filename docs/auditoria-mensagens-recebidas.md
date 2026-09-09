# Auditoria da mensagem recebida: risquinho, citação, edição e reação

**Data:** 2026-09-09 · **Escopo:** tudo o que acontece com a mensagem que **vem
do cliente** — do webhook da Evolution até a bolha na Central.
**Origem:** três sintomas relatados na Central (risquinhos em bolha de cliente,
citação que não aparece, edição que não aparece).

Tudo o que está marcado como **medido** foi reproduzido contra o código real
(`whatsapp.service`, `conversa.repository`, `mapper.helper`) rodando sobre
`prisma/dev.db`, não deduzido da leitura. O roteiro está no §6.

**Resumo:** os três sintomas relatados se confirmaram, e são **três causas
diferentes**. No caminho apareceram mais dois defeitos que ninguém tinha
relatado — um deles apaga dados (§3, B4).

> **Estado:** B1 a B5 **corrigidos**, com cenário próprio em
> `verificar-mensagem-recebida.js` (25 checagens). O §4 (citação de resposta em
> texto) **não tem conserto deste lado** — o que era nosso foi corrigido junto
> com B2. Ver §7.

---

## 1. Os três sintomas, e o que cada um é

| Relato | Veredito | Onde nasce |
| --- | --- | --- |
| "aparecem riscos na mensagem do cliente, e somem quando eu mando mensagem" | **Defeito nosso, confirmado** (B1) | `atualizarStatusPorWaId` casa o ACK sem olhar `origem` |
| "quando o cliente responde, não gera a citação" | **Provável defasagem de deploy** (§4) | o conserto existe em `main` desde `c6ebf1b`; falta confirmar a VM |
| "quando o cliente edita, não aparece que editou" | **Lacuna nossa, confirmada** (B3) | não há tratamento de `editedMessage` em lugar nenhum |

O que faz os três parecerem "o código quebrando ao mesmo tempo" é que todos
chegam pela **mesma porta** (`processarWebhook`) e todos falham **em silêncio**:
nenhum deles produz erro, log de aviso ou bolha vermelha. A conversa continua
funcionando; só mente sobre o que aconteceu.

---

## 2. O mapa: por onde passa uma mensagem recebida

| Arquivo | O que ele decide |
| --- | --- |
| `whatsapp.service.processarWebhook` | **O roteador.** `messages.upsert` → mensagem; `messages.update` → ACK; o resto cai em "webhook ignorado". |
| `whatsapp.service._processarAck` | **O risquinho.** Traduz o status do Baileys e manda gravar. |
| `whatsapp.service._processarReacao` | **O 👍 do cliente.** |
| `chatbot.engine._processarMensagemEntrada` | **A gravação.** Resolve citação, grava a bolha do cliente, acorda o fluxo. |
| `conversa.repository` | **O banco.** `atualizarStatusPorWaId`, `findMensagemPorWaId`, `atualizarMetadata`. |
| `mapper.helper.mapMensagem` | **O que a tela vê** num retrato completo. |
| `event-bus` + `mesclarConversa` (front) | **O patch de tempo real**, que NÃO passa pelo mapper. |

A última linha é a chave para entender o §3: existem **dois caminhos** até a
bolha, e só um deles tem as regras de exibição.

---

## 3. Os defeitos

### B1 · ALTO — o ACK do WhatsApp carimba risquinho em mensagem do cliente

`conversa.repository.atualizarStatusPorWaId` procura a mensagem só pelo
`waMessageId`:

```js
const msg = await prisma.mensagem.findUnique({ where: { waMessageId } });
```

Só que **toda mensagem recebida também guarda um `waMessageId`** (é o `key.id`
do webhook, e é ele que impede o webhook reentregue de rodar o fluxo duas
vezes — `chatbot.engine.js:4016`). Ou seja: o índice usado para achar "a mensagem
que eu enviei" casa igualmente bem com a mensagem que o cliente enviou. Não há
nenhuma checagem de `origem`, nem aqui, nem em `_processarAck`.

**Medido** — um `messages.update` com `status: DELIVERY_ACK` apontando para uma
mensagem de cliente:

```
retorno  : { recebido: true, processado: true, status: 'entregue' }
origem   : cliente | status gravado: "entregue"
evento   : {"type":"mensagem:status","mensagemId":"4680b18…","status":"entregue",…}
```

E aqui está a explicação do "**somem quando eu mando mensagem**", que era a
parte mais estranha do relato. Os dois caminhos discordam:

* o **patch de tempo real** (`mensagem:status`) vai direto do event-bus para
  `aplicarStatusMensagem` no front. Ele é minúsculo de propósito e **não passa
  pelo mapper** — o risquinho aparece na bolha do cliente;
* o **retrato completo** passa por `mapMensagem`, que já tem a regra certa
  (`status: m.origem === "cliente" ? null : …`) e devolve `null`.

**Medido:** `status no DTO: null`. Então basta qualquer coisa que gere um
retrato — e enviar uma mensagem gera (`_emitirLeve`) — para os risquinhos
sumirem. Não é intermitência: é um caminho corrigindo o outro.

O front também não se defende: em `AtendimentoView`, `relogio` desenha
`<StatusMensagem status={m.status} />` sem olhar `m.de`, e
`mesclarConversa.aplicarStatusMensagem` aplica o patch a qualquer mensagem cujo
id casar.

> **Nota:** o dado sujo **fica no banco** (`status: "entregue"` numa linha de
> cliente). Hoje o mapper esconde, mas qualquer leitura que não passe por ele
> (relatório, exportação, consulta futura) vê a mentira.

**Correção proposta** — defesa em profundidade, nas três camadas:

1. `atualizarStatusPorWaId`: recusar quando `msg.origem === "cliente"`
   (devolver `null`, que `_processarAck` já trata como "mensagem desconhecida");
2. `_processarAck`: sair cedo quando `data.key.fromMe === false`;
3. `AtendimentoView`: não montar `<StatusMensagem>` para `m.de === 'cliente'`.

Mais uma limpeza única: `UPDATE mensagens SET status = NULL WHERE origem = 'cliente'`.

---

### B2 · MÉDIO — há DUAS `findMensagemPorWaId` na mesma classe

`conversa.repository.js` define o mesmo método duas vezes:

* linha 673 — a da **reação**: um argumento, `findUnique`, devolve a linha inteira;
* linha 868 — a da **citação**: dois argumentos, `findFirst` escopado na conversa,
  `select: { id, origem, texto }`.

Em corpo de classe, **a segunda vence**. Não há erro, aviso nem lint: a primeira
simplesmente deixa de existir.

**Medido:**

```
arity    : 1        (a sobrevivente aceita 2 parâmetros; o 2º tem default e não conta na arity)
campos   : id, origem, texto
metadata : undefined | conversaId: undefined
```

A citação continua funcionando (é ela que sobrevive). Quem paga é a reação — B4.

---

### B3 · MÉDIO — edição feita pelo cliente é descartada em silêncio

Não existe nenhuma referência a `editedMessage` ou `protocolMessage` no servidor
inteiro (`grep -rn "editedMessage\|protocolMessage" server/src` não retorna
nada). O campo `editadaEm` existe no schema e o mapper já expõe `editada`, mas o
**único** ponto que escreve nele é `editarMensagem` — a edição feita pela
Central.

Uma edição vinda do WhatsApp chega como `messages.update` sem `status`, e morre
no primeiro `if` de `_processarAck`.

**Medido:**

```
processarWebhook: { recebido: true, processado: false, motivo: 'ack_sem_dados', bruto: '' }
texto no banco  : "O pc ligou e nao pediu senha"   ← o texto ANTIGO
editadaEm       : null
```

O efeito é pior do que "falta uma etiqueta": **o atendente lê o texto errado.**
O cliente corrigiu o e-mail, o número de série ou o "não" que virou "sim", vê a
correção no aparelho dele, e a Central mostra a versão anterior sem nenhum sinal
de que existe outra.

**Correção proposta:** reconhecer `protocolMessage.type === 'MESSAGE_EDIT'` em
`processarWebhook`, resolver a mensagem alvo por `waMessageId` (escopada na
conversa) e chamar `editarMensagem` — que já grava `editadaEm` e já toca a
`versao` da conversa. A bolha não precisa de nada: `m.editada` já é desenhado.

---

### B4 · ALTO — a reação do cliente APAGA o metadata da mensagem

Consequência direta de B2. `_processarReacao` faz:

```js
const msg = await conversaRepository.findMensagemPorWaId(waMessageId);
const { metadata } = reacoes.aplicar(msg.metadata, { … });
await conversaRepository.atualizarMetadata(msg.id, metadata);
```

Como a definição sobrevivente traz só `{ id, origem, texto }`, `msg.metadata` é
`undefined`. `reacoes.aplicar` trata isso como "mensagem sem metadata" (`base =
{}`) — comportamento correto para o argumento que recebeu — e devolve um objeto
**só com as reações**. `atualizarMetadata` grava por cima do campo inteiro.

**Medido**, numa mensagem com imagem e citação:

```
metadata ANTES : {"tipo":"imagem","arquivo":"foto.jpg","mimetype":"image/jpeg","citacao":{"texto":"menu"}}
metadata DEPOIS: {"reacoes":[{"emoji":"👍","de":"cliente",…}]}
```

**O cliente reagir 👍 numa foto apaga a foto da Central.** Junto vão a citação, o
selo de encaminhada, a marca de automação, o autor da nota interna, o
`respostaPesquisa` e o `botaoId`. É perda de dado, não de exibição: o arquivo
continua em disco, mas a mensagem deixa de saber que é mídia.

`msg.conversaId` também vem `undefined` — o log "Reacao do cliente registrada"
sai sem conversa, e o retorno do webhook devolve `conversaId: undefined`.

**Correção proposta:** dar nomes distintos aos dois métodos (a duplicação é um
acidente, não uma sobrecarga) e incluir `metadata` e `conversaId` no `select` de
quem serve à reação.

---

### B5 · BAIXO — "apagar para todos" feito pelo cliente não chega

Mesma família de B3: o `protocolMessage` de revogação não é reconhecido. A
mensagem cai em `dados_incompletos` (sem texto e sem mídia) e a bolha segue na
tela como se nada tivesse acontecido.

**Medido:** `{ recebido: true, processado: false, motivo: 'dados_incompletos' }`,
`metadata.deletada: (ausente)`.

O `metadata.deletada` e a bolha "Mensagem apagada" já existem — só são escritos
quando **nós** apagamos. Custo baixo, prioridade baixa: aqui a Central mostra
informação a mais, não informação errada.

---

## 4. A citação: o que NÃO é defeito nosso (e o que verificar antes)

O caminho da citação recebida foi reconstruído há poucos commits e está
completo em `main`:

* `_contextos` procura o `contextInfo` **por assinatura, em qualquer
  profundidade** — não numa lista fixa de nós (`c6ebf1b`);
* o `stanzaId` é resolvido **contra o banco inteiro**, não contra a janela
  carregada na tela, e o retrato é gravado no metadata;
* mídia citada sem legenda vira rótulo (`📷 Imagem`);
* "era resposta e não sabemos a que" tem marca própria (`desconhecida`).

Sobram duas hipóteses, e elas pedem checagens opostas:

1. **A VM está atrás de `main`.** `c6ebf1b` e `cf97ff7` são recentes. Esta é a
   primeira coisa a conferir, e é a mais barata: `git log --oneline -3` na VM.
2. **A Evolution 2.4.0 não manda o `contextInfo`** em resposta de texto — é o
   que já estava registrado. Nesse caso não há conserto possível deste lado, e a
   evidência é o log `contextInfo recebido sem citacao reconhecida`.

**Cuidado ao ler esse log:** ele só dispara quando **existe** `contextInfo` e a
citação não saiu. Se a Evolution não mandar nada, **não há linha nenhuma** — e a
ausência de log seria lida como "está tudo bem". Para separar as duas hipóteses
é preciso `WHATSAPP_LOG_PAYLOAD=1` por alguns minutos, com o cliente respondendo
citando uma mensagem.

Enquanto isso não for feito, "a citação não aparece" **não tem causa
determinada** — e chutar aqui é o que faz consertar o lado errado.

---

## 5. Prioridade sugerida

| | Defeito | Efeito | Custo |
| --- | --- | --- | --- |
| 1 | **B4** | apaga mídia e citação do banco | baixo (renomear método + `select`) |
| 2 | **B3** | atendente lê o texto errado | médio (novo ramo no webhook) |
| 3 | **B1** | risquinho falso + dado sujo no banco | baixo (3 guardas + 1 UPDATE) |
| 4 | **§4** | citação ausente | só diagnóstico, por enquanto |
| 5 | **B5** | bolha que deveria ter sumido | baixo |

B4 vem antes de B1 mesmo com um sintoma menos visível: B1 mostra um ícone a
mais e some sozinho no retrato seguinte; B4 destrói metadata e **não volta**.

---

## 6. Como reproduzir

As cinco medições saíram de um script único rodado em `server/`, contra
`prisma/dev.db` (base local, vazia), criando uma conversa de teste e apagando-a
no fim. Ele **não** foi versionado — o roteiro é o que importa:

1. gravar uma mensagem `origem: "cliente"` com `waMessageId` e um `metadata` com
   mídia e citação;
2. **B1** — chamar `whatsappService._processarAck` com
   `{ data: { key: { id: <waMessageId>, fromMe: false }, status: 'DELIVERY_ACK' } }`
   e comparar a coluna `status` com o que `mapConversa` devolve;
3. **B2** — imprimir `conversaRepository.findMensagemPorWaId.length` e
   `Object.keys(await findMensagemPorWaId(waId))`;
4. **B4** — chamar `_processarReacao({ waMessageId, emoji: '👍' }, jid)` e comparar
   o `metadata` antes e depois;
5. **B3/B5** — passar por `processarWebhook` um `messages.update` com
   `message.editedMessage` e um `messages.upsert` com
   `protocolMessage.type: 'REVOKE'`, e conferir `texto`, `editadaEm` e
   `metadata.deletada`.

A suíte `verificar-tudo.js` **não** cobria nenhum destes caminhos, e é isso que
explica B4 ter sobrevivido tanto tempo: `verificar-reacoes.js` até diz cobrir "o
metadata da mídia intacto", mas testa o helper puro (`reacoes.aplicar`), que
sempre esteve certo. O defeito morava no **argumento** que o helper recebia — e
nenhum cenário chegava a passar pelo repositório de verdade.

Isso virou `verificar-mensagem-recebida.js`, registrado na suíte.

---

## 7. O que foi corrigido (2026-09-09)

| | Onde | O quê |
| --- | --- | --- |
| B1 | `conversa.repository.atualizarStatusPorWaId` | recusa ACK quando `origem === "cliente"` |
| B1 | `whatsapp.service._processarAck` | sai cedo em `key.fromMe === false` |
| B1 | `AtendimentoView` | não desenha `<StatusMensagem>` em bolha de cliente |
| B1 | `prisma/limpar-status-recebidas.js` | limpeza única das linhas já sujas |
| B2/B4 | `conversa.repository` | **uma** `findMensagemPorWaId`, com `metadata` e `conversaId` no `select` |
| B3/B5 | `whatsapp.service` | `extrairProtocolo` + `_processarProtocolo`, roteados antes do ACK |

As três guardas de B1 são deliberadamente redundantes: a do repositório protege
o **banco** (único estado permanente), a do webhook evita a ida ao banco, e a da
bolha é a única que vale para dado que **já** esteja sujo.

O ramo de protocolo é **idempotente** — a Evolution reentrega webhooks, e edição
com o mesmo texto ou revogação já aplicada saem em `edicao_repetida` /
`apagar_repetido` sem tocar na `versao` da conversa.

**Baseline da suíte:** as mesmas 4 falhas pré-existentes antes e depois
(ranking da equipe, rankings, fotos de contatos, responsividade) — nenhuma delas
neste caminho.

### E a citação: o que mudou de verdade

Um pedaço da citação **era** defeito nosso, e caiu junto com B2. O motor monta o
retrato do trecho citado a partir da mensagem original:

```js
const tipoOriginal = original.metadata?.tipo || null;
```

Só que o `select` não trazia `metadata`. Então `tipoOriginal` era **sempre**
`null`: citar uma foto, um áudio ou um PDF que nós mandamos — que quase nunca
têm legenda — caía no `{ desconhecida: true }`, e a bolha dizia "↩ Em resposta a
uma mensagem anterior" **mesmo com a original no banco**, em vez de "📷 Imagem".
Agora mostra o tipo.

O que **não** tem conserto aqui é a resposta em **texto** (arrastar para
responder): medido em 08/09 com o payload e o banco da Evolution na mão, o
`contextInfo` de citação não chega no webhook **e a Evolution 2.4.0 não o tem
guardado** — `POST /chat/findMessages` devolve só metadado de criptografia. Não
há de onde buscar; qualquer código nosso aqui seria fingimento. É a regressão
conhecida do evolution-api (issue #2065, a partir da v2.3.4), e a decisão de
ficar na 2.4.0 está registrada — descer custaria os botões do menu.

Duas coisas ainda separam as hipóteses restantes, e nenhuma é código:

1. **conferir se a VM está em `main`** (`git log --oneline -3` lá): `c6ebf1b` e
   `cf97ff7` são recentes, e sem eles nem o que funciona funciona;
2. **responder arrastando pelo aplicativo do celular**, não pelo WhatsApp Web. O
   payload medido veio com `source: "web"` e `addressingMode: "lid"`, que é
   justamente onde o Baileys tem histórico de não popular o `contextInfo`. Se
   funcionar pelo celular, é limitação de quem envia — e não há o que consertar.

Toque em **botão/lista** continua citando corretamente (cenário próprio no
`verificar-mensagem-recebida.js`, §6).
