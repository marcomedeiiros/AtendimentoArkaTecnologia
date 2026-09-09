# Auditoria: a citação derivada estava citando o bot no lugar do atendente

**Data:** 2026-09-09 (noite) · **Escopo:** a citação derivada entregue em
`a618abc`, e o estado de editar/apagar depois do deploy.
**Origem:** duas evidências lado a lado — a Central e o WhatsApp do cliente, na
mesma conversa (#OS00217, 18:55–18:57).

Continuação de `auditoria-eventos-do-cliente.md`. A citação passou a aparecer,
que era o pedido — **e passou a apontar para a mensagem errada** assim que a
conversa saiu do bot e foi para o atendente.

---

## 1. O que as duas telas provam, juntas

| Mensagem do cliente | O WhatsApp cita | A Central citou | |
| --- | --- | --- | --- |
| "impressora tá ruim" (18:56) | *Descreva sua solicitação* | *Descreva sua solicitação* | ✅ |
| "oii" (18:56) | Marco Medeiros · "opaaa" | *Solicitação recebida!* | ❌ |
| "ajuda eu" (18:57) | Marco Medeiros · "opaaa" | *Solicitação recebida!* | ❌ |

O corte é exato: **enquanto o bot conduzia, acertou; depois que o atendente
assumiu, passou a citar a última fala do bot** — uma mensagem de três turnos
atrás, que já não era resposta de nada.

E há um detalhe que fecha o diagnóstico: as duas erradas citam **a mesma**
mensagem. Não é uma escolha ruim entre candidatas; é uma escolha que parou de
avançar.

---

## 2. A causa: um estado que não é pergunta

O motor grava, ao entregar a conversa para a equipe
(`chatbot.engine.js:2074`):

```js
aguardando: AGUARDANDO.HUMANO,
ativo: true,
```

E a condição que eu escrevi para a citação derivada era:

```js
if (!respondendoAId && !retrato && sessaoAberta?.ativo && sessaoAberta.aguardando)
```

`aguardando: "humano"` é verdadeiro. Só que ele **não significa "o bot
perguntou algo"** — significa o contrário: o bot terminou e passou a bola. A
condição, do jeito que ficou, dizia "há alguma coisa pendente", quando o que
precisava dizer era "há uma PERGUNTA em aberto".

Somando a isso, `ultimaPerguntaDoBot` filtra `origem: "bot"` — então, com a
conversa já em mãos humanas, ela devolve para sempre a última coisa que o robô
disse. Daí as duas citações idênticas.

**O mais incômodo é que a lista certa já existia no arquivo.**
`AGUARDA_RESPOSTA_DO_CLIENTE` (`chatbot.engine.js:129`) é exatamente a allowlist
dos estados em que o bot fez uma pergunta, e o comentário dela já explica, por
escrito, por que `humano` e `null` ficam de fora. Ela foi criada para a
inatividade — pelo mesmo engano, cometido antes: decidir por exclusão
(`aguardando !== "humano"`) em vez de por lista positiva. Eu não a usei.

---

## 3. O que fazer: a regra muda de "pergunta do bot" para "a última coisa que o cliente recebeu"

Corrigir só o estado (usar `AGUARDA_RESPOSTA_DO_CLIENTE`) resolve o defeito —
mas **não** entrega o que foi pedido: com a conversa em mãos humanas, a citação
simplesmente sumiria. E o print mostra o WhatsApp citando "opaaa", do atendente.

A regra que reproduz as três linhas da tabela do §1 é mais simples do que a que
está lá:

> A bolha cita **a última mensagem que saiu daqui** — do bot ou do atendente,
> tanto faz — quando o WhatsApp não mandou citação nenhuma.

Aplicada às evidências: "impressora tá ruim" → a pergunta do bot; "oii" e "ajuda
eu" → "opaaa", do Marco. As três batem com o WhatsApp.

Isto **derruba a restrição** que eu mesmo escrevi em `a618abc` ("só pergunta do
BOT; para o atendente seria adivinhação"). Ela estava certa sobre a natureza da
coisa e errada sobre a conclusão: de fato não há estado no banco dizendo que o
atendente perguntou algo — mas também não é isso que a citação afirma. Ela
afirma *"esta mensagem chegou depois daquela"*, que é verdade verificável, e é a
mesma aposta que o WhatsApp faz ao desenhar a conversa em ordem.

### O preço, dito por extenso

Quando o cliente manda quatro mensagens seguidas, o WhatsApp cita só aquelas em
que ele realmente respondeu; nós vamos citar as quatro. **É citação a mais, não
citação errada** — todas apontam para a última coisa que ele recebeu, que é o
que ele estava respondendo em quase todo caso real.

Duas proteções mantêm isso honesto:

* **`derivada: true` continua gravado.** A bolha desenha igual (foi a decisão),
  mas o dado nunca perde a origem;
* **ciclo novo não cita.** Quando o cliente volta depois do atendimento
  encerrado (`cicloReaberto`), a mensagem dele abre um chamado novo — citar o
  "obrigado pelo contato" de semana passada seria ligar duas conversas que não
  têm relação. O motor já calcula isso.

E **nota interna nunca entra**: ela não foi enviada a ninguém. Citá-la numa
bolha de cliente faria parecer que ele leu o que a equipe escreveu em segredo.

---

## 4. Editar e apagar: continua sendo o item 4, e dá para provar

O print do WhatsApp mostra "Mensagem apagada" às 18:56; a Central segue
mostrando "oii". Isso é **esperado** enquanto o contêiner da Evolution não for
recriado — `WEBHOOK_EVENTS_MESSAGES_DELETE` está no compose desde `951201b`, mas
variável de ambiente só passa a valer no contêiner novo.

Agora dá para confirmar em vez de deduzir, o que antes não dava. Dois comandos,
os dois só de leitura:

```bash
docker compose -f docker-compose.prod.yml exec evolution-api printenv | grep WEBHOOK_EVENTS
```

Se `MESSAGES_DELETE` não aparecer, o contêiner ainda é o antigo — e nada do lado
de cá pode funcionar.

```bash
docker compose -f docker-compose.prod.yml logs --since 30m api | grep -iE "nao roteado|protocolo"
```

Com o contêiner novo, apagar uma mensagem tem de produzir uma destas duas
linhas: `Evento de protocolo do cliente aplicado` (funcionou) ou `Webhook
recebido e nao roteado` (chegou com outro nome — e aí o nome está na linha).
Silêncio nas duas significa que o evento não saiu da Evolution.

---

## 5. Lição que vale registrar

Dois enganos, o mesmo formato: **decidir por exclusão sobre um campo de
estado**. `aplicarInatividade` já tinha caído nisso com
`aguardando !== "humano"`, e a correção foi criar uma allowlist positiva. Eu
repeti o erro em outra forma — `sessaoAberta.aguardando` como se fosse booleano
— num arquivo onde a lista certa estava setenta linhas acima.

Quando um campo tem quatro valores e só três significam a mesma coisa, testar a
presença dele é sempre um bug esperando data.

---

## 6. O que foi feito

| Onde | O quê |
| --- | --- |
| `conversa.repository` | `ultimaPerguntaDoBot` → `ultimaMensagemNossa` (bot **ou** equipe; nota, sistema e apagada de fora) |
| `chatbot.engine` | a condição deixou de consultar `sessaoAberta.aguardando`; agora é `!respondendoAId && !retrato && !cicloReaberto` |

A correção **não** foi trocar `sessaoAberta.aguardando` por
`AGUARDA_RESPOSTA_DO_CLIENTE`, que era o reflexo óbvio. Aquela lista responde
"o bot está esperando resposta?", e essa pergunta parou de importar: quem sabe
o que o cliente estava respondendo é a **conversa**, não o estado da automação.
Consultar o estado era o erro de origem, não o valor consultado.

Cobertura: 36 → **40 checagens**, e duas delas travam exatamente a cena da
produção — a transferência deixa a sessão em `humano`, o atendente fala, e a
mensagem seguinte do cliente tem de citar **ele**, não o robô. Baseline da
suíte inalterado (as mesmas 4 falhas pré-existentes).
