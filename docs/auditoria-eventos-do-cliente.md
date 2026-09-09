# Auditoria: por que nada do que o cliente FAZ chega na Central

**Data:** 2026-09-09 (tarde) · **Escopo:** os eventos que não são mensagem  
editar, apagar e citar   no sentido **cliente → Central**.
**Origem:** depois do deploy de `ba4d647`, edição e "apagar para todos" do
cliente continuam não aparecendo. Relato: *"nada que o cliente envia aparece o
que ele fez, só aparece quando o atendente enviou."*

Continuação de `auditoria-mensagens-recebidas.md`, que corrigiu o lado de cá.
**Este documento é sobre a porta de entrada, e a conclusão é desconfortável: o
código de ontem está certo e não vai rodar nunca, porque o evento não sai da
Evolution.**

---

## 1. O relato tem duas metades, e elas não têm nada a ver uma com a outra

| O que falta | Natureza | De quem depende |
| --- | --- | --- |
| editar / apagar do cliente | **evento que não é entregue** | configuração da Evolution (§2) |
| citação da resposta do cliente | **funcionalidade que não existe** | nós (§3) |

Tratar as duas como "o mesmo bug de mensagem recebida" foi o que fez o conserto
de ontem parecer que não funcionou. Ele funciona   só não tem o que processar.

---

## 2. Editar e apagar: a porta está fechada antes de chegar aqui

### 2.1 · O que a topologia realmente é

Quem entrega os eventos **não** é o webhook por instância que o nosso código
configura em `createInstance`/`setWebhook`. É o **webhook GLOBAL** da Evolution,
declarado no `docker-compose.prod.yml`   o próprio painel já diz isso em
Integração WhatsApp ("Usando o webhook global da Evolution").

E o global entrega **exatamente** o que o mapa `WEBHOOK_EVENTS_*` autoriza:

```yaml
WEBHOOK_GLOBAL_ENABLED:            "true"
WEBHOOK_GLOBAL_URL:                "http://api:3000/api/webhook/v1/whatsapp?token=..."
WEBHOOK_EVENTS_MESSAGES_UPSERT:    "true"
WEBHOOK_EVENTS_CONNECTION_UPDATE:  "true"
WEBHOOK_EVENTS_MESSAGES_UPDATE:    "true"
WEBHOOK_EVENTS_QRCODE_UPDATED:     "true"
```

Quatro eventos. Mais nada.

### 2.2 · APAGAR   causa fechada, sem dúvida nenhuma

`WEBHOOK_EVENTS_MESSAGES_DELETE` **não existe** nesse arquivo. A revogação sai
da Evolution como `messages.delete`, e esse evento nunca é postado no nosso
webhook. Não há payload, não há requisição, não há log   do lado de cá o
"apagar para todos" do cliente **simplesmente não acontece**.

Nenhuma linha de código nossa muda isso. O `extrairProtocolo` de ontem está
correto e continuará ocioso enquanto a variável não existir.

**Conserto:** uma linha no `docker-compose.prod.yml`, e recriar o contêiner da
Evolution   o que **não é barato**, ver §4.

### 2.3 · EDITAR   o evento é permitido; falta saber se leva o conteúdo

`MESSAGES_UPDATE` está ligado, então a classe de evento chega. Restam duas
hipóteses, e elas pedem consertos diferentes:

1. **a Evolution manda o conteúdo da edição dentro do `messages.update`**   o
   código de ontem já pega, e o que falta é só o deploy ter chegado;
2. **a Evolution tem um evento próprio para edição** (`MESSAGES_EDITED`), e aí
   ele está desligado pelo mesmo motivo do `MESSAGES_DELETE`.

O comando que decide, e é só leitura, sem tocar em nada:

```bash
docker compose -f docker-compose.prod.yml exec evolution-api \
  grep -ril "MESSAGES_EDITED" /evolution/dist | head
```

Se aparecer alguma coisa, a hipótese 2 é a certa e a variável entra junto com a
do apagar. Se não aparecer, é a hipótese 1   e aí o que falta é observabilidade
(§2.4), não código.

### 2.4 · O defeito que sustenta os outros dois: a entrada é cega

Nada nesta plataforma sabe dizer **quais eventos chegam**.

* `logger.debug("Webhook ignorado", { event })`   em produção o nível é `info`
  (`config/logger.js:5`). Um evento que chega e não é roteado é **invisível**;
* o diagnóstico `WHATSAPP_LOG_PAYLOAD=1` mora **dentro** de
  `_processarMensagem`, ou seja, só vê `messages.upsert`. Uma edição chegando
  por `messages.update` não seria impressa nem com ele ligado;
* a conferência do boot (`whatsapp.conferirWebhook`) registra
  `eventos: <quantidade>`   o **número**, não os nomes. Um mapa com quatro
  eventos e um com os quatro certos são indistinguíveis no log.

É a mesma armadilha da citação, e ela já custou uma investigação inteira: *"não
chegou"* e *"chegou numa forma que não lemos"* produzem o mesmo silêncio, e
pedem consertos opostos. Enquanto a entrada for cega, toda conclusão aqui é
palpite   inclusive as minhas duas hipóteses acima.

**Conserto (nosso, barato e sem risco):** registrar em `info` o tipo de cada
evento recebido (só o nome, nunca o conteúdo), e listar os **nomes** dos eventos
na conferência do boot.

---

## 3. A citação que foi pedida é outra coisa   e essa é nossa

O print mostra o comportamento desejado: a resposta do cliente ("Tenho
contrato") aparece com **a pergunta do bot citada em cima**.

Isso **já funciona**, e é importante entender por quê: o cliente **tocou num
botão**, e o WhatsApp manda o `contextInfo` junto da resposta de botão. A
citação ali é real   veio do aparelho.

O pedido é que apareça **também quando ele digita a resposta**, sem arrastar
para responder. E aí o `contextInfo` não vem: para o WhatsApp, digitar "1" não é
responder a nada, é uma mensagem nova. Não há dado a extrair   é por isso que
isto **não é o mesmo assunto** da citação de resposta em texto do documento
anterior (aquela é uma regressão da Evolution, e não tem conserto deste lado).

**A diferença é que aqui nós sabemos a resposta sem precisar do WhatsApp.** A
sessão do chatbot guarda, no banco:

* `aguardando`   que tipo de resposta está pendente (`opcao`, `texto`, …);
* `aguardandoDesde`   o instante em que o bot perguntou;
* e a pergunta em si é a última mensagem `origem: "bot"` daquele fio.

Ou seja: quando o cliente responde com uma pergunta em aberto, "esta mensagem
responde àquela" é **fato do nosso estado**, não palpite sobre o conteúdo.

### O que precisa ser decidido antes de codar

Este projeto tem uma regra explícita e repetida: **nunca deduzir pela
aparência**. O selo "Encaminhada" só existe quando o WhatsApp o manda; o retrato
citado só aparece quando há retrato. Uma citação montada por nós é a primeira
coisa na bolha que o cliente **não** vê no aparelho dele.

Duas leituras, e elas levam a implementações diferentes:

* **é informação verdadeira**   a pergunta estava aberta, a mensagem responde a
  ela, e mostrar isso é o que faz um "1" solto ser legível na Central;
* **é uma bolha que mente sobre o WhatsApp**   o atendente lê uma citação e
  supõe que o cliente a viu ali.

Proposta: implementar, gravando `metadata.citacao.derivada = true`, para que a
origem do retrato nunca se perca   e a bolha possa, se um dia se quiser,
distinguir "o cliente citou" de "isto responde à pergunta acima". O dado fica
honesto no banco de qualquer forma; só a aparência é ajustável depois.

**Escopo deliberadamente estreito:** só quando há pergunta do BOT em aberto.
Estender para "o atendente perguntou e o cliente respondeu" seria exatamente a
dedução que a regra proíbe   ali não há estado nenhum dizendo que uma pergunta
foi feita.

---

## 4. O custo de mexer no contêiner da Evolution

Ligar um evento é uma linha no compose, mas ela só passa a valer **recriando o
contêiner**   e nesta versão isso não é rotina:

* na **2.4.0-rc2**, um timeout de rede (408) entra no ramo destrutivo e **apaga
  a credencial** do WhatsApp; já aconteceu em produção (03/09);
* `QRCODE_LIMIT` está em `3` de propósito, porque estourá-lo dispara `logout()`
  de verdade   remove o aparelho do lado do WhatsApp.

O que reduz o risco a aceitável, e existe:

1. a credencial vive no volume `evolution_instances` + no Postgres, e o
   contêiner recriado a reencontra;
2. `whatsapp.sessao.js` é o cofre que copia e restaura o pareamento;
3. `deploy/backup.sh` antes de tudo.

**Recomendação:** fazer fora do horário de atendimento, com backup na mão, e
conferir logo depois que a instância voltou a `open`   não confiar no painel
dizer "Online" sem olhar o `disconnectionReasonCode`.

---

## 5. Ordem sugerida

| | O quê | De quem | Risco |
| --- | --- | --- | --- |
| 1 | Tornar a entrada observável (nome de cada evento em `info`; nomes no boot) | nosso | nenhum |
| 2 | Ler se a Evolution tem `MESSAGES_EDITED` (§2.3) | um comando de leitura | nenhum |
| 3 | Citação derivada da pergunta do bot (§3) | nosso | nenhum   decisão de produto |
| 4 | Ligar `MESSAGES_DELETE` (+ `MESSAGES_EDITED`, se existir) e recriar a Evolution | compose + janela | **alto** (§4) |

O item 1 vem antes de tudo porque é ele que transforma os itens seguintes em
verificação, em vez de tentativa. E o item 4 vem por último não por ser o menos
importante   é o único que resolve o apagar   mas porque é o único que pode
derrubar o atendimento, e não se faz isso às cegas.

---

## 6. O que foi feito (2026-09-09, tarde)

**Itens 1 e 3 aplicados.** O item 4 está **preparado, não aplicado**: as linhas
já estão no compose e só passam a valer quando o contêiner for recriado   a
janela é sua.

| | Onde | O quê |
| --- | --- | --- |
| 1 | `whatsapp.service.processarWebhook` | evento não roteado agora sai em `info` ("Webhook recebido e nao roteado") |
| 1 | `whatsapp.service` | `WHATSAPP_LOG_PAYLOAD=1` passou a cobrir **todos** os eventos, não só `messages.upsert` |
| 1 | `whatsapp.conferirWebhook` | o boot lista os **nomes** dos eventos, não a quantidade |
| 3 | `conversa.repository.ultimaPerguntaDoBot` | a última fala do bot no fio (ignora mensagem apagada) |
| 3 | `chatbot.engine` | citação derivada quando há pergunta em aberto e o WhatsApp não mandou contexto |
| 3 | `mapper.helper` | `citacao.derivada` chega à tela |
| 4 | `docker-compose.prod.yml` e `server/docker-compose.evolution.yml` | `WEBHOOK_EVENTS_MESSAGES_DELETE` e `..._MESSAGES_EDITED` |

Sobre a citação derivada, três limites que valem estar escritos:

* **nunca ganha da citação real.** Só entra quando o WhatsApp não mandou nada
  (`!respondendoAId && !retrato`). O que o cliente citou de fato continua sendo
  o que a bolha mostra;
* **só pergunta do BOT.** `ultimaPerguntaDoBot` filtra `origem: "bot"` de
  propósito: a espera do bot está registrada no banco (`aguardando`), e é isso
  que faz a ligação ser fato. "O atendente perguntou e o cliente respondeu" não
  tem estado nenhum por trás   ali seria adivinhação;
* **a origem sobrevive no dado.** A bolha desenha os dois iguais (foi a
  decisão), mas `metadata.citacao.derivada` fica gravado. Sem ele não haveria
  como voltar atrás nem como auditar depois.

Cobertura: `verificar-mensagem-recebida.js` foi de 25 para **36 checagens**  
inclui o ciclo inteiro no motor (o bot pergunta, o cliente **digita** a
resposta, a bolha cita e a escolha continua roteando). Baseline da suíte
inalterado: as mesmas 4 falhas pré-existentes.

Uma correção de contrato foi junto: `verificar-webhook-entrada.js` fixava a
forma exata de `citacao`, e o campo novo a quebrou. A expectativa foi atualizada
e ganhou o caso de `derivada: true`   o teste estava certo em ser rígido.

### Como aplicar o item 4, quando quiser

Fora do horário de atendimento, nesta ordem:

```bash
bash deploy/backup.sh
```

```bash
docker compose -f docker-compose.prod.yml up -d evolution-api
```

E logo depois confirmar que o pareamento voltou   sem confiar no "Online" do
painel:

```bash
docker compose -f docker-compose.prod.yml logs --tail 40 evolution-api
```

Se a instância não voltar a `open`, o caminho é `/instance/connect` (nunca
`restart`, que recusa instância em `close`) e o cofre em `whatsapp.sessao.js`.
