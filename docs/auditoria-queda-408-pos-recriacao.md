# Auditoria: o 408 depois de recriar o contêiner da Evolution

**Data:** 2026-09-09, 19:09–19:12 · **Escopo:** a queda da instância
`arka-wapi-oficial` logo após a recriação do contêiner da Evolution.
**Estado no momento do registro:** `RECONNECTING`, tentativa #3, motivo 408,
**cofre da sessão guardado às 19:11:16**.

Isto não é um bug novo. É o **custo previsto de recriar o contêiner** — e a
parte que eu não previ na auditoria anterior.

---

## 1. A linha do tempo, pelos próprios logs

| Hora | O quê |
| --- | --- |
| ~19:09:50 | contêiner da Evolution recriado (as duas variáveis novas entram) |
| 19:09:56 | `CONNECTED TO WHATSAPP`, wuid `552721030070` — **pareou** |
| 19:09:56 | `Timeout in AwaitingInitialSync, forcing state to Online and flushing buffer` |
| 19:09:56 | `timed out waiting for message` |
| 19:11:16 | o cofre salva a credencial |
| 19:12:17 | painel: `RECONNECTING`, tentativa #3, motivo **408 (temporário)** |

O pareamento **funcionou**. O que não terminou foi a **sincronização inicial**.

---

## 2. A causa: recriar o contêiner custa uma ressincronização inteira

O contêiner novo sobe com o Baileys do zero. A credencial está no volume e no
Postgres — por isso o `CONNECTED` saiu em seis segundos —, mas o **histórico**
não está em memória, e a instância foi criada com `syncFullHistory` ligado
(`env.js:146`, ligado por padrão; o comentário em `evolution-api.client` já
avisa que isso "estica bastante o tempo em `connecting`").

Então o que se seguiu ao `CONNECTED` foi o WhatsApp despejando dezenas de chats
e centenas de mensagens no socket. `AwaitingInitialSync` estourou, o Baileys
derrubou o socket com `timedOut`, e 408 é exatamente esse código.

**Isto não é queda de rede, nem sessão inválida.** É a sincronização não caber
no prazo que o próprio Baileys se dá.

---

## 3. O que a plataforma fez de certo (e por que dá para respirar)

Tudo o que foi construído depois do incidente de 03/09 funcionou:

* **408 é classificado como temporário.** `CODIGOS_LOGOUT_REAL` são só 401 e 403
  (`whatsapp.reconexao.js:66`). O painel escreveu "408 (temporário)" porque essa
  é a leitura correta, não um otimismo;
* **o cofre guardou a credencial às 19:11:16.** Se a Evolution apagar a
  credencial no ramo destrutivo, `cofre.restaurar` a devolve — e recusa fazê-lo
  em 401/403, para não adiar um QR que fosse legítimo;
* **o QR não foi oferecido.** Quem decide é o servidor (`podeMostrarQr`), e a
  tela mostrou o escudo com "a sessão continua válida" em vez do código. Era
  precisamente para esta situação;
* **a escada de reconexão não desiste.** `ESCADA_MS` termina em 60s e **fica**
  nesse degrau para sempre enquanto a sessão for válida. O modelo antigo (6
  tentativas, ~31 min) transformava apagão longo em pedido de QR.

Em resumo: o sistema está fazendo exatamente o que foi desenhado para fazer.
**Não escanear o QR é a ação correta**, e é a única que importa agora.

---

## 4. O risco de laço que precisa ser observado

Há uma interação entre dois prazos que pode prolongar isso, e ela merece ser
vigiada em vez de suposta:

* o Baileys leva **o tempo que a sincronização levar** para sair de `connecting`;
* o nosso vigia considera `connecting` normal por **3 minutos**
  (`LIMITE_CONNECTING_MS`) e, passado isso, **derruba o socket e religa**.

Se a ressincronização completa demorar mais que três minutos — e depois de uma
recriação de contêiner ela pode demorar —, o vigia mata o handshake no meio, o
Baileys reporta 408, e o ciclo recomeça do zero. Cada volta descarta o progresso
da anterior.

O prazo de 3 minutos foi calibrado para uma **queda comum**, onde não há
ressincronização nenhuma. Recriar o contêiner é outro cenário, e ele não foi
considerado quando esse número foi escolhido.

**Como saber se é isso**, e não a espera normal:

```bash
docker compose -f docker-compose.prod.yml logs --since 15m api | grep -iE "handshake|cofre|reconex|WhatsApp\]"
```

* `aguardando_handshake` → está esperando, como deve. Só paciência;
* `Handshake travado em 'connecting' -- vai religar`, repetido → **é o laço**. A
  correção está no §5.

---

## 5. Se for o laço: dar mais espaço ao handshake

`LIMITE_CONNECTING_MS` é lido de `process.env` **na API**, não na Evolution.
Mudá-lo reinicia só o `arka-api` — a Evolution fica intocada, e não há novo
risco de pareamento.

No `.env` da VM:

```
WHATSAPP_LIMITE_CONNECTING_MS=900000
```

```bash
docker compose -f docker-compose.prod.yml up -d api
```

Quinze minutos de folga para a sincronização terminar. Depois que a instância
voltar a `open` e ficar estável, o valor pode voltar ao padrão — ou ficar, que
o custo dele é só demorar mais para agir num handshake genuinamente travado.

**O que NÃO fazer:** clicar em "Reconectar" repetidamente. Cada clique reinicia
a sincronização do zero, e é a forma mais rápida de transformar uma espera longa
numa espera infinita.

---

## 6. O que ficou faltando na auditoria anterior

`auditoria-eventos-do-cliente.md` §4 avisou do risco de recriar o contêiner —
mas avisou do risco **errado**. Falou de perda de credencial (que não
aconteceu: o pareamento sobreviveu e o cofre está de pé) e não falou do custo
que de fato apareceu: **a ressincronização completa do histórico, e o 408 que
ela produz.**

A recomendação "faça fora do horário de atendimento" continua certa. A razão
estava incompleta: não é só pelo risco de precisar de um QR — é porque a
instância fica instável por vários minutos **mesmo quando tudo dá certo**.

Fica registrado para a próxima vez que alguém precisar tocar naquele contêiner:
recriar a Evolution é uma operação de janela, e o relógio dela é o da
sincronização do histórico, não o do `docker compose up`.

---

## 7. SEGUNDO ATO (19:17): o 408 virou 401, e agora o pareamento acabou mesmo

Quatro minutos depois do registro acima, o painel mudou de `RECONNECTING` para
`LOGGED_OUT`, motivo **401 (logout real)**, e passou a oferecer o QR.

**Isto não é a mesma falha continuando. É outra, causada pela primeira.**

### A cascata, elo por elo

1. **408** — a sincronização inicial estoura (§2);
2. na 2.4.0, 408 está no ramo destrutivo do Baileys: a Evolution roda
   `cleaningUp()` e **apaga a credencial** do banco dela;
3. sem credencial, a instância não tem o que reconectar e começa a **emitir QR**;
4. o Baileys renova o QR a cada ~20s e `QRCODE_LIMIT` é **3** — cerca de um
   minuto;
5. ao estourar o limite, a Evolution chama `client.logout()`
   (`monitor.service.ts:435`), que **remove o aparelho do lado do WhatsApp**;
6. logout do lado do WhatsApp = **401**.

O tempo bate: 408 às ~19:11, QR emitido, 401 às ~19:17.

### Por que o cofre não resolve isto

O cofre tem cópia (`guardada 19:13:16`) e **recusa restaurar em 401** — e a
recusa está certa, não é excesso de zelo. `client.logout()` desfez o pareamento
**no servidor do WhatsApp**. A credencial local virou papel sem valor: devolvê-la
ao banco só faria o vigia acreditar que há sessão e adiar para sempre o QR que
resolve. É exatamente o "cofre envenenado" que `restaurar` já sabia recusar.

**Conclusão: escanear o QR agora é a ação correta.** É o primeiro momento nesta
sequência em que ela é.

### O que endurecer ANTES de escanear

O risco real é o laço se repetir: parear → ressincronizar o histórico → estourar
→ 408 → 401 de novo. Duas coisas reduzem isso, e nenhuma exige tocar na
Evolution:

**1. Dar espaço ao handshake** (só reinicia o `arka-api`). No `.env`:

```
WHATSAPP_LIMITE_CONNECTING_MS=900000
```

**2. Escanear com o celular já na mão.** Com `QRCODE_LIMIT: 3` e renovação a
cada ~20s, a tela de QR dura **cerca de um minuto** antes de a Evolution chamar
`logout()`. Abrir o QR e ir procurar o telefone é literalmente o que dispara o
passo 5 da cascata. Se expirar, clique em "Gerar QR" de novo — aí sim sem
consequência.

O valor `3` continua certo pelo motivo pelo qual foi escolhido (uma tela de QR
esquecida aberta com `30` provoca logout depois de ~10 minutos). O que este
incidente mostra é que ele também limita o tempo de uma **reconexão automática
que passou a emitir QR sozinha** — cenário que não existia quando o número foi
decidido, porque a reconexão nunca chegava a esse ponto.

### O que isto muda na recomendação sobre recriar o contêiner

Sobe de "operação de janela" para **"operação de janela com risco real de
perder o pareamento"** — não pelo motivo que a auditoria anterior deu (a
credencial sobrevive ao `docker compose up`, e sobreviveu), mas pela cascata
acima, que começa numa ressincronização que não cabe no prazo.

Antes da próxima recriação da Evolution, considerar nesta ordem: subir
`WHATSAPP_LIMITE_CONNECTING_MS` **antes**, ter o celular à mão, e aceitar que o
pareamento pode ter de ser refeito.
