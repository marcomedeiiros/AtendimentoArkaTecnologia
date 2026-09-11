# Auditoria: "o sistema não registra toda a conversa do cliente" (11/09/2026)

**Escopo:** o relato de que mensagens do cliente não entram na Central -- e, junto
dele, três queixas que vieram no mesmo pacote: citação/resposta do cliente,
mensagem editada e mensagem apagada. Evolution API **2.4.0-rc2**.

**Método:** nada foi alterado. Todas as medições são de leitura -- consultas no
Postgres da Evolution, no `arka.db` e nos logs dos contêineres -- mais um harness
que alimenta o `processarWebhook` e os extratores reais com formas de payload
conhecidas, com os `_processar*` dublados (sem banco, sem escrita).

**Conclusão antecipada, e é a que importa: não existe nenhum filtro no código
descartando mensagem do cliente por causa da automação.** A perda real é de
**0,9%** -- nove mensagens em 48 horas --, e **sete das nove têm causa nomeada**:
dois tipos de mensagem que o extrator não reconhece. Sobram **duas mensagens de
texto em dois dias** sem explicação.

A investigação passou por estimativas de 4,1%, depois 2,4%, depois 1,7%, e só
chegou em 0,9% quando parou de comparar TOTAIS e foi comparar os **ids, um a um**
(§7). Cada estimativa anterior errava para mais pelo mesmo motivo: contava como
perda aquilo que o sistema descarta de propósito.

---

## 1 · O que foi derrubado

Cinco hipóteses plausíveis morreram com dado na mesa. Registrar isso vale tanto
quanto a conclusão: são cinco caminhos que ninguém precisa percorrer de novo.

| Hipótese | Veredito | O que decidiu |
| --- | --- | --- |
| "Se a mensagem não pertence ao fluxo, não salvar" | **MORTA** | A gravação (`chatbot.engine.js:4211`) acontece ANTES de `modoAtendimento()` e antes de qualquer passo de fluxo. Fora do modo `local` o motor grava, emite o SSE e só então devolve `controlado_por_<modo>` |
| Mensagem temporária / visualização única descartadas | **MORTA** | Os `messageType` da base são 21, e a lista completa não tem `ephemeralMessage` nem `viewOnceMessage`. O buraco existe no código (§4) mas não está sendo acionado aqui |
| `@lid` criando conversa fantasma | **MORTA** | 11.244 mensagens estão gravadas sob `@lid` no banco da Evolution, mas o `arka.db` não tem NENHUMA conversa com mais de 13 dígitos (`11→1, 12→7, 13→78`). A Evolution guarda por `@lid` internamente e entrega o telefone utilizável no webhook |
| Eventos barrados pelo mapa `WEBHOOK_EVENTS_*` | **MORTA** | `contacts.update`, `chats.update` e `contacts.upsert` chegam ao webhook **sem estar no mapa**. Na 2.4.0 o webhook global não filtra por esse mapa -- a premissa central de `auditoria-eventos-do-cliente.md` §2.1 não vale mais nesta versão |
| Contagem inflada (a Evolution gravando a mesma mensagem duas vezes) | **MORTA** | `2017 linhas = 2017 ids únicos`. A diferença é real, não contábil |

---

## 2 · A conta da perda

A conta por TOTAIS, que foi por onde esta auditoria começou, dá 2,9% em sete dias
(2.017 recebidas × 1.934 gravadas, menos 25 eventos que por decisão não viram
linha). **Esse número está errado**, e a razão é instrutiva: totais não sabem
distinguir "não gravamos" de "não era para gravar".

A conta certa é por **id**, e ela nomeia cada mensagem que falta (§7). Janela de
48 horas, 1.009 mensagens recebidas, **31 ausentes**:

| Tipo | Qtd | O que é |
| --- | --- | --- |
| `reactionMessage` | 20 | **Por decisão.** Reação vira `metadata` da mensagem alvo, nunca linha própria (`_processarReacao`) |
| `protocolMessage` | 2 | **Por decisão.** Editar/apagar são eventos SOBRE uma mensagem, não mensagens |
| `secretEncryptedMessage` | 5 | **Não eram mensagens: eram as EDIÇÕES do cliente**, chegando cifradas. Identificado horas depois, ver §6 |
| `albumMessage` | 2 | **Descarte mudo.** Várias fotos de uma vez |
| `conversation` | 2 | **Sem explicação.** Texto puro que a Evolution tem e nós não |

```
ausentes                     31
− descarte por decisão      −22   ← reação (20) + protocolo (2)
= perda real                  9   (0,9%)
− edições, não mensagens     −5   ← secretEncrypted: perda REAL, mas de edição (§6)
− causa nomeada              −2   ← albumMessage
sem explicação                2   (0,2%)
```

**Correção posterior, no mesmo dia:** os 5 `secretEncryptedMessage` não eram
mensagens perdidas -- eram **edições** perdidas. Isso derruba a perda de MENSAGEM
para **4 em 1.009 (0,4%)**, e ao mesmo tempo revela um defeito maior do que o que
se estava caçando: *toda* edição feita por esses clientes era descartada. Uma
mensagem perdida é uma ausência, que se percebe; uma edição perdida é um texto
**errado** na tela, que não se percebe.

**O fato que orienta todo o resto: essas mensagens ESTÃO no banco da Evolution.**
Ela recebeu do WhatsApp e guardou. Isso elimina todos os filtros do nosso código
como causa -- eles só descartam o que chega, e o que não chega não deixa rastro,
nem de erro.

### A coluna que ninguém esperava: **as 31 ausentes são `@lid`. Todas.**

Cem por cento, sendo que `@lid` é ~36% do tráfego recebido. Mesmo olhando só as
nove perdas reais, nove em nove sob `@lid` é improvável por acaso.

Isso NÃO ressuscita a hipótese da conversa fantasma (§1: ela continua morta, não
há uma única conversa com mais de 13 dígitos). A leitura mais econômica é outra e
não acusa o `@lid` de nada: `@lid`, `secretEncryptedMessage` e `albumMessage` são
todos marcadores de **cliente WhatsApp recente**. O que correlaciona não é o jid
com a perda -- é a versão do aparelho do cliente com as duas coisas ao mesmo
tempo. Com n = 9, isto é uma observação a registrar, não uma conclusão a agir.

---

## 3 · O histograma, e a hipótese que ele matou

A suspeita inicial era janela de queda de conexão: o socket cai, as mensagens do
período ficam pendentes, e na volta a Evolution grava o lote no banco sem
disparar o webhook. O número que a sustentava é assustador: **3.562** linhas
`Connection closed` em 168h -- uma a cada 2,8 minutos.

O teste é simples: se a perda fosse por janela, ela apareceria **concentrada** em
algumas horas. Duas contagens por hora, 48h, lado a lado:

| hora | Evolution | Central | Δ |
| --- | --- | --- | --- |
| 09/09 21 | 25 | 27 | **+2** |
| 09/09 22 | 4 | 2 | −2 |
| 10/09 10 | 2 | 1 | −1 |
| 10/09 11 | 48 | 48 | 0 |
| 10/09 12 | 101 | 96 | −5 |
| 10/09 13 | 36 | 35 | −1 |
| 10/09 14 | 35 | 35 | 0 |
| 10/09 15 | 43 | 42 | −1 |
| 10/09 16 | 145 | 143 | −2 |
| 10/09 17 | 83 | 78 | −5 |
| 10/09 18 | 40 | 39 | −1 |
| 10/09 19 | 9 | 9 | 0 |
| 10/09 20 | 6 | 6 | 0 |
| 11/09 01 | 2 | 2 | 0 |
| 11/09 10 | 6 | 6 | 0 |
| 11/09 11 | 94 | 92 | −2 |
| 11/09 12 | 102 | 100 | −2 |
| 11/09 13 | 46 | 46 | 0 |
| 11/09 14 | 44 | 41 | −3 |
| 11/09 15 | 69 | 65 | −4 |
| 11/09 16 | 25 | 25 | 0 |
| 11/09 17 | 16 | 16 | 0 |
| 11/09 18 | 23 | 23 | 0 |
| 11/09 19 | 4 | 4 | 0 |
| 11/09 20 | 1 | 1 | 0 |
| **total** | **1.009** | **982** | **−27** |

**Não há um único buraco.** Não existe hora com 40 do lado de lá e 5 do lado de
cá. O déficit é uma garoa fina, e ela é **proporcional ao volume**: as horas de
pico (101, 145, 83, 94, 102, 69) carregam os déficits (−5, −2, −5, −2, −2, −4) e
as horas magras fecham em zero.

Isso é a assinatura de uma **taxa por mensagem**, não de um evento no tempo. A
hipótese da janela de queda está descartada -- e, por tabela, os 3.562
`Connection closed` **não estão custando mensagem nenhuma**. (O número, sozinho,
também não prova 3.562 quedas reais: o Baileys registra essa linha em mais
situações do que desconexão efetiva. Seja o que for, o histograma mostra que não
sai mensagem por ali.)

> A hora `09/09 21` fechou com a Central tendo **mais** que a Evolution (27 × 25).
> É borda de balde: mensagem carimbada pelo WhatsApp às 20:59 e gravada por nós
> às 21:00. Serve de régua -- oscilação de ±2 numa hora é ruído, não perda.

Descartado também o caminho alternativo "o webhook foi entregue e recusado":
`docker logs arka-evolution | grep -icE "webhook.*(error|fail|ECONNREFUSED|timeout)"`
devolveu **0** em 48h, e não há uma linha de `Webhook RECUSADO` do nosso lado. O
limitador de taxa foi descartado por leitura: `webhookLimiter` pula rede interna
desde o incidente de 01/09 (`rateLimit.middleware.js`).

**E a garoa tinha explicação prosaica:** ela é proporcional ao volume porque
**reação é proporcional ao volume**. Vinte dos vinte e sete "faltantes" por hora
eram reações, que nunca foram linha de mensagem. Conversa movimentada tem mais
reação; hora magra não tem nenhuma. O padrão que parecia sintoma era o
funcionamento normal (§2).

---

## 4 · Os descartes mudos, provados no harness

O roteador foi alimentado com as formas de payload conhecidas. Resultado
(`_processar*` dublados, nada tocou o banco):

| Caso | Destino | |
| --- | --- | --- |
| texto normal (upsert) | `_processarMensagem` | OK |
| `messages.delete` na forma "chave crua" | **NENHUM** → `"Webhook recebido e nao roteado"` | ✗ |
| `messages.delete` com `data.key` | `_processarMensagem` → `dados_incompletos` | ✗ |
| `messages.delete` com `protocolMessage` REVOKE | `_processarProtocolo` | OK |
| `messages.edited` com `protocolMessage` EDIT | `_processarProtocolo` | OK |
| `messages.edited` achatada, sem `protocolMessage` | `_processarMensagem` → `mensagem_duplicada` | ✗ |
| `messages.update` com edição dentro | `_processarProtocolo` | OK |
| `messages.update` = ACK | `_processarAck` | OK |

**Não existe branch por NOME de evento para `messages.delete` nem para
`messages.edited`** (`whatsapp.service.js:622-712`): os dois só funcionam quando a
Evolution embrulha o evento num `protocolMessage`. E o caso da edição achatada é
o pior dos três, porque ele é silencioso E convincente: a edição bate no dedupe
por `waMessageId`, sai como `mensagem_duplicada`, e **o texto antigo continua na
tela como se fosse o atual**.

E os extratores, na mesma bancada:

```
texto / extendedText / imagem / áudio / documento / figurinha / botão / PTV   PASSA
mensagem temporária (ephemeralMessage)                              DESCARTADA
visualização única (viewOnceMessage v1 e v2)                        DESCARTADA
enquete criada                                                      DESCARTADA
```

`extrairTexto` e `extrairMidia` só olham o topo de `data.message`; qualquer
embrulho (`ephemeralMessage.message.*`, `viewOnceMessageV2.message.*`) cai no
filtro `!texto && !midia && !botaoId` -- **whatsapp.service.js:1049, que não emite
uma linha de log.** Por esses três tipos ele não está sendo acionado hoje -- mas
está sendo acionado por outros dois, e essa é a perda real medida no §2:
`secretEncryptedMessage` (5) e `albumMessage` (2) em 48h. Álbum é o cliente
mandando várias fotos de uma vez: ele manda seis, a Central mostra zero.

(`associatedChildMessage` aparece na base mas **não** na lista de ausentes -- as
fotos de dentro do álbum chegam por conta própria e são gravadas. O que se perde
é o contêiner, não necessariamente o conteúdo. Vale confirmar na hora de
consertar.)

---

## 5 · Citação recebida: causa fechada, e não é nossa

`"contextInfo recebido sem citacao reconhecida"` = **1** em 48 horas. Se a
Evolution mandasse o contexto numa forma que não lemos, esse contador estaria nas
centenas -- ele existe exatamente para separar "não mandou" de "mandou onde não
procuramos".

O harness confirma o outro lado: a extração funciona nas **três** formas
conhecidas -- v1 do Baileys (`contextInfo` dentro do `extendedTextMessage`), v2
normalizada (`contextInfo` irmão de `message`) e só `stanzaId` sem retrato.

**A Evolution 2.4.0 não entrega `contextInfo` em resposta digitada.** Toque em
botão cita porque ali o contexto vem junto; arrastar para responder e digitar,
não. Não há conserto deste lado, e isto bate com a medição histórica já
registrada (793 de 188.250, todas de toque em menu).

---

## 6 · Editar e apagar

### Editar -- ERA A QUARTA VIA, e ela chega CIFRADA

**Esta seção foi reescrita horas depois de publicada.** A conclusão original
("provavelmente funcionando") estava certa sobre os números e errada sobre o
mundo: as três vias conhecidas de edição realmente funcionavam, e mesmo assim a
edição do cliente não aparecia -- porque existia uma quarta que ninguém tinha
visto, justamente por ser a única sem rastro.

Teste feito na mão, com o log novo ligado: cliente manda "teste um", edita, e
chega

```
messageType:      "secretEncryptedMessage"
secretEncType:    2
targetMessageKey: { id: "3EB09064A99A61B8643CC9" }
```

O id casa com a linha do nosso banco -- `cliente | "teste um"`, `editada_em`
vazio. **A edição não se perde na Evolution: ela chega, e se perdia aqui**, em
`dados_incompletos`, que até `010ad33` não registrava nada.

O texto novo vai em `encPayload`, cifrado com chave derivada do `messageSecret`
da mensagem original, e a 2.4.0 não decifra. O **alvo** vem em claro -- e é o
suficiente para marcar a bolha como "editada (versão anterior)" (`8840a1e`).

Duas armadilhas que ficam registradas:

* **`targetMessageKey.fromMe` mente.** Veio `true` nas três amostras, para
  mensagens que o nosso banco registra como `origem: "cliente"` -- o alvo estava
  em `@lid`, onde esse campo se perde. Quem sabe de quem é a mensagem é o nosso
  banco, que a gravou quando ela chegou;
* **só o `secretEncType: 2`.** O envelope carrega mais de um tipo de evento;
  tratar todos como edição carimbaria "editada" em mensagem que ninguém editou.

### A conta ingênua que quase enterrou isto

O primeiro número parece um escândalo: **113** `protocolMessage` do cliente na
Evolution contra **1** mensagem com `editada_em` e `origem = "cliente"` no
`arka.db`.

Não é. O tratamento de edição nasceu em `f3f50c9`, **09/09** -- tinha dois dias
quando esta medição foi feita. Os 113 são de toda a história da base, quase todos
anteriores ao código existir. A conta honesta é a da janela: **5**
`protocolMessage` recebidos em 7 dias, dos quais no máximo ~2 caíram depois do
deploy, contra **1** registrado. Está dentro do esperado.

O buraco do caso "edição achatada" (§4) continua real no código, mas **não há
evidência de que esteja sendo acionado nesta instalação**.

E é exatamente aqui que a conta ingênua quase encerrou a investigação: os números
batiam, a conclusão "está funcionando" era defensável, e estava errada. O que
salvou foi um teste manual com o log ligado -- não mais uma consulta. **Números
consistentes provam que a hipótese não foi refutada, nunca que ela é verdadeira.**

### Apagar -- FUNCIONANDO, e nunca esteve quebrado

**Confirmado em produção (11/09, 19:10:07)**, com o teste manual que faltava:

```
Evento de protocolo do cliente aplicado   acao: apagar   waMessageId: 3EB09AED56ED7C980B93D6
```

A exclusão chega **embrulhada em `protocolMessage`** -- o caminho que já existia
desde `f3f50c9`. Nenhum `messages.delete` apareceu como "não roteado", então os
branches por nome (`a7177ba`) não chegaram a ser exercitados: eles cobrem formas
que esta versão não usa, e ficam como rede para quando ela mudar.

O que segue abaixo é a análise que se fazia **antes** do teste, preservada porque
o raciocínio estava certo e a conclusão que ele permitia -- "não dá para saber
daqui" -- era a honesta. O que decidiu não foi mais uma consulta ao banco: foi
apagar uma mensagem com o log aberto.

```
protocolMessage por tipo:   14 (MESSAGE_EDIT) → 293        0 (REVOKE) → 0
```

Nenhuma revogação em toda a base. As 9 "apagadas" do `arka.db` vieram do botão do
próprio painel, não do cliente. Duas leituras, e elas pedem consertos opostos:

* **(a)** nenhum cliente apagou mensagem no período -- não há nada quebrado;
* **(b)** a 2.4.0 não persiste revoke como linha nova (ela altera o registro
  original), e nesse caso **o banco dela não serve de prova** e o descarte do §4
  pode estar acontecendo sem deixar rastro.

O único juiz é o log no instante em que alguém apagar (§7).

---

## 7 · O comando que fechou a conta, e o que sobrou aberto

**Foi ele que derrubou três estimativas seguidas.** Enquanto a comparação era de
TOTAIS, cada rodada devolvia um número diferente e nenhum deles nomeava uma
mensagem sequer. Comparar **ids** responde de uma vez quantas faltam, quais são e
de que tipo -- e mostrou que 22 das 31 não deveriam estar lá. Sem arquivo
temporário:

```bash
comm -23 \
  <(docker exec arka-evolution-db psql -U evolution -d evolution -At -c "SELECT key->>'id' FROM \"Message\" WHERE key->>'fromMe'='false' AND \"messageTimestamp\" > extract(epoch from now() - interval '48 hours')" | sort) \
  <(docker exec arka-api sqlite3 /data/arka.db "SELECT wa_message_id FROM mensagens WHERE origem='cliente' AND criado_em > (strftime('%s','now')-172800)*1000 AND wa_message_id IS NOT NULL;" | sort)
```

Com a lista na mão, o tipo de cada uma (`'id1','id2',...`):

```bash
docker exec arka-evolution-db psql -U evolution -d evolution -c "SELECT \"messageType\", count(*) FROM \"Message\" WHERE key->>'id' IN ('<ids>') GROUP BY 1 ORDER BY 2 DESC;"
```

Resultado em 11/09 (§2): 20 reações, 2 protocolos, 5 `secretEncryptedMessage`, 2
`albumMessage`, 2 `conversation`.

**O que continua aberto, e é pouco:** as **duas mensagens `conversation`**. Texto
puro, tipo que o extrator lê desde sempre, sob `@lid`, presentes na Evolution e
ausentes aqui. Duas em 1.009 é indistinguível de ruído de borda (relógio,
recorte da janela), e por isso NÃO justifica caçada. O que justifica é o item 2
do §9: com log no `dados_incompletos`, a próxima ocorrência se explica sozinha em
vez de custar outra auditoria.

**O apagar.** Peça a alguém para apagar uma mensagem para todos e, em seguida:

```bash
docker logs --since 5m arka-api 2>&1 | grep -iE "nao roteado|protocolo"
```

Saiu `messages.delete` → é a leitura (b), e o conserto é nosso: falta branch no
roteador. Não saiu nada → é (a), e não há o que consertar.

---

## 8 · Cliente × atendente: por que um "funciona" e o outro não

Não é sorte nem diferença de tratamento -- são caminhos independentes:

| | Cliente → Central | Atendente → cliente |
| --- | --- | --- |
| Origem do dado | webhook da Evolution | requisição da própria Central |
| Gravação | depende de 8 filtros e da forma do payload | `addMensagem` **antes** de enviar (`conversa.service.js:446`) |
| Citação | precisa do `contextInfo` do aparelho, que a 2.4.0 quase nunca manda | `respondendoAId` vem da tela -- nunca falha |
| Integração caída | a mensagem não existe aqui | grava assim mesmo, marca `erro` |

Corolário que vale estar escrito: mensagem que o atendente manda **pelo celular**,
fora da Central, chega com `key.fromMe = true` e é descartada em
`whatsapp.service.js:893`. Nunca entra. Quem atende pelo aparelho produz buracos
do lado da EQUIPE, e eles não têm nada a ver com o que esta auditoria mediu.

---

## 9 · Ordem sugerida de conserto

| | O quê | Risco | Por quê nesta ordem |
| --- | --- | --- | --- |
| 1 | Dar log ao `dados_incompletos` | nenhum | O descarte mudo é o que fez 0,9% de perda parecer 50% para quem usa. Mesmo com a perda pequena, a cegueira é um defeito por si só -- e é ela que faz cada suspeita virar uma auditoria |
| 2 | `albumMessage` e `secretEncryptedMessage` | baixo | São **7 das 9** perdas reais. É o conserto de maior retorno, e é pequeno |
| 3 | Branch por NOME de evento para `messages.delete` / `messages.edited` | baixo | Fecha os casos provados no §4 mesmo que hoje estejam dormindo |
| 4 | Embrulhos `ephemeral` / `viewOnce` no extrator | baixo | Hoje não acontece; no dia em que um cliente ligar mensagem temporária, perde-se a conversa INTEIRA dele, e em silêncio |
| 5 | Reconciliação periódica pela importação de histórico | médio | Rede de segurança para o que o webhook perder. Já existe, é idempotente, hoje é manual e por conversa. **Com 0,9% de perda, isto deixou de ser urgente** |

**Não faz sentido mexer em:** citação recebida (§5, não é nosso), `@lid` (§1, não
está mordendo), filtros de mensagem por automação (§1, não existem), e o flapping
da conexão **como causa de perda de mensagem** (§3) -- ele pode ser um problema
de disponibilidade, mas não é por ali que mensagem some.

---

## 10 · O que foi feito (11/09/2026, tarde)

Cinco commits, todos **só no servidor** -- saem com `docker compose up -d --build
api`, sem recriar o contêiner da Evolution e sem tocar no pareamento. Nenhuma
migration: `deletada` mora no `metadata`, que já existe.

| Commit | O quê | Fecha |
| --- | --- | --- |
| `abc356f` | Mesmo `waMessageId` com texto diferente passa a ser **edição**, não reentrega descartada | §4, caso F |
| `a7177ba` | Branch por **nome** para `messages.delete` (chave crua, embrulhada, lote) | §4, casos B e C |
| `d1a7aa1` | Branch por **nome** para `messages.edited` | §4 |
| `010ad33` | `dados_incompletos` passa a **registrar** o que descartou (só os nomes dos nós) | §4, §9 item 1 |
| `69eecc1` | Abre os **envelopes** (`ephemeralMessage`, `viewOnce*`, `associatedChildMessage`) | §4, §9 item 4 |
| `c26c46f` | Anúncio de álbum sai marcado, para o aviso novo não virar ruído | §9 item 2 |
| `8b0f18c` | Agenda deixa de reimportar a cada oscilação do socket (teto de 6h) | §3 |
| `c821497` | O alarme `WEBHOOK AUSENTE` para de gritar falso todo boot; confirmação passa a vir do tráfego | — |
| `8840a1e` | **A edição cifrada do cliente passa a marcar a bolha** ("editada (versão anterior)") | §6 |

**Cobertura:** `verificar-webhook-entrada.js` foi de 11 para 17 checagens e
`verificar-mensagem-recebida.js` de 37 para 43. As duas suítes passam inteiras.
Os casos travados incluem os três que garantem que o conserto não vire estrago:
texto igual continua sendo reentrega, resposta de botão nunca edita, e edição sem
texto legível não esvazia a bolha.

**O que NÃO foi feito, e por quê:**

* **citação recebida** -- não é conserto nosso (§5). Só muda de status se a
  consulta do `stanzaId` no banco da Evolution mostrar que ela guarda o que não
  entrega;
* **as 2 mensagens `conversation` sem explicação** (§2) -- 0,2%, indistinguível
  de ruído de borda. O log novo as identifica na próxima vez que acontecer, que é
  mais barato do que caçá-las agora;
* **`secretEncryptedMessage`** -- *(resolvido horas depois: era a edição do
  cliente, ver §6. A decisão de deixá-lo gritando no aviso foi o que permitiu
  identificá-lo no mesmo dia, com um teste manual de dois minutos.)*
* **o flapping da conexão** -- é problema de disponibilidade, não de perda de
  mensagem (§3). Merece investigação própria, não esta.

**Verificado em produção no mesmo dia** (§6): editar e apagar foram testados à
mão, com o log aberto, e os dois aparecem na Central. A citação de resposta
digitada continua impossível nesta versão -- e essa é a única das três queixas
iniciais que não tem conserto.

---

## 11 · A lição, para a próxima investigação

Três hipóteses desta investigação eram boas, tinham mecanismo plausível e número
grande do lado: `@lid` com 26% das mensagens, 3.562 quedas de conexão, 113
edições contra 1. **As três estavam erradas**, e cada uma levou menos de um
comando para cair -- quando o comando certo foi feito.

E a estimativa da perda caiu quatro vezes: 4,1% → 2,4% → 1,7% → **0,9%**. Nenhuma
dessas revisões veio de ler mais código. Todas vieram de **parar de contar e
começar a nomear**: enquanto a comparação era `count(*)` contra `count(*)`, cada
evento que o sistema descarta de propósito -- reação, protocolo -- entrava na
conta como se fosse mensagem perdida. Bastou listar os **ids** para 22 das 31
"perdas" virarem funcionamento normal.

Fica a regra, que vale além deste caso: **um total não sabe o que ele está
contando.** Quando os dois lados de uma fronteira discordam, a pergunta útil não
é "quantos faltam" -- é "quais faltam, e o que são". A primeira produz um número
que parece resposta; a segunda produz uma lista que se explica sozinha.

O corolário para o produto é mais desconfortável: a perda sempre foi de 0,9%, e
mesmo assim o relato era "não registra a conversa do cliente". Não havia mentira
nenhuma nisso -- **o descarte é mudo**, então cada mensagem que alguém procura e
não acha é indistinguível de uma falha sistêmica. Silêncio não é ausência de
defeito; é ausência de medida.
