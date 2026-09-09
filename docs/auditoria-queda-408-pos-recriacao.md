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
