# Auditoria: a integração "cai e volta toda hora" (10/09/2026)

**Escopo:** o relato de que a conexão do WhatsApp fica caindo e voltando, com
base em quatro capturas do painel — três da manhã de 10/09 (a última consulta
marcada é **07:47:16**) e o pareamento `arka-wapi-oficial`.

**Método:** este registro separa o que as capturas **provam** do que elas apenas
**sugerem**. Onde só o log decide, está dito, com o comando.

---

## 1. As quatro telas, e o que cada uma diz

| # | Tela | O que mostra |
| --- | --- | --- |
| 1 | Integração WhatsApp | `RECONECTANDO` · `DISCONNECTED_TEMPORARY` · tentativa **#1** · motivo **–** · versão Evolution **2.4.0** · cofre **guardada 07:42:46** · último número pareado `+55 27 2103-0070` |
| 2 | Central de Atendimento | pílula **WhatsApp Online** |
| 3 | Central de Atendimento | mesma tela, mesma sessão: **WhatsApp Offline** |
| 4 | Integração WhatsApp | `OFFLINE` · **nenhum** número pareado · versão **–** · última sincronização **–** · saúde da conexão toda **–** · cofre **inativo** |

As três primeiras descrevem **um problema de conexão**. A quarta descreve
**outra coisa**, e confundir as duas é o principal risco de leitura aqui.

---

## 2. Telas 1–3: é oscilação real do socket, e o diagnóstico está correto

Na tela 1 o servidor diz exatamente o que deve dizer:

* **`DISCONNECTED_TEMPORARY`** — caiu, e a credencial está intacta
  (`whatsapp.reconexao.js`, `_classificar`). Só 401 e 403 são logout real;
* **o QR não foi oferecido.** O painel mostrou o escudo com "a sessão continua
  válida". Quem autoriza o QR é o servidor (`podeMostrarQr`), e ele recusou;
* **a Evolution está de pé** — a versão `2.4.0` só aparece se ela respondeu;
* **o cofre tem cópia** da credencial (07:42:46).

Ou seja: **não escanear o QR é a ação correta** nas telas 1–3. O sistema está
religando sozinho, como foi desenhado.

### 2.1 A pílula Online/Offline alternando é esperada — e enganosa

As telas 2 e 3 são a mesma página em dois instantes. A pílula do cabeçalho vem
de `whatsAppConectado`, alimentada por um `setInterval` de **10 segundos** em
[AppContext.jsx:668](client/src/context/AppContext.jsx:668) que faz
`setWhatsAppConectado(!!st.conectado)` — e `conectado` é **`state === "open"`,
nada mais** ([whatsapp.service.js:1088](server/src/modules/whatsapp/whatsapp.service.js:1088)).

O servidor distingue seis situações. A pílula tem duas. Então:

> qualquer queda de 15 segundos que o vigia resolve sozinho aparece na Central
> de Atendimento como **"WhatsApp Offline"**, e a volta aparece como
> **"WhatsApp Online"**.

O painel de Integração é honesto ("Reconectando", `DISCONNECTED_TEMPORARY`); a
Central de Atendimento **não é** — ela chama de "Offline" um religamento normal
em curso. Uma parte do "cai e volta toda hora" é literalmente essa pílula
piscando a cada poll de 10s. É a leitura da tela que está grossa, não
necessariamente a conexão que está pior do que parece.

**Isto não desmente o relato.** Só delimita: a pílula prova oscilação de
`state`, não prova gravidade.

### 2.2 A tentativa **#1** é o dado mais importante da tela 1

`tentativa` **zera a cada vez que o socket volta a `open`** (`_resetar()` no ramo
`state === "open"`). O backoff é `1s → 2s → 5s → 10s → 20s → 30s → 60s`, e nunca
desiste.

Daí a regra de leitura, que vale mais que qualquer suposição:

* **abrir o painel várias vezes e ver sempre `#1` ou `#2`** → cada queda está
  sendo resolvida em segundos e caindo **de novo**. É **flapping**: o socket
  sobe e cai em ciclo;
* **ver o número subir (`#3`, `#5`, `#7`) e ficar preso** → é **uma** queda
  longa, não muitas. Problema diferente: rede ou Evolution.

A tela 1 mostra `#1` — compatível com flapping, **mas uma captura só não
distingue "flapping" de "a queda começou agora"**. Quem decide é o log (§5).

> Nota sobre o cofre às 07:42:46: **não** é a hora da última conexão de pé. O
> cofre só escreve quando o hash da credencial muda (`whatsapp.sessao.js`).
> Aquele horário não serve para datar a queda.

### 2.3 O motivo em branco (`–`) é um sinal, não um dado faltando

`motivoDesconexao` vem do `disconnectionReasonCode` da própria Evolution
([evolution-api.client.js:415](server/src/infrastructure/external/evolution-api.client.js:415)).
Estar **nulo** com a instância fora do ar significa que a Evolution **não
registrou código** para esta queda — o socket fechou sem o Baileys atribuir um
`statusCode`.

Isso afasta duas hipóteses e aponta uma terceira:

* **não** é 401/403 (logout — o painel diria "Reescaneie o QR");
* **não** é o 408 do histórico documentado em
  [auditoria-queda-408-pos-recriacao.md](docs/auditoria-queda-408-pos-recriacao.md) — aquele grava código;
* **é compatível** com o socket sendo fechado por fora: rede da VM, o contêiner
  da Evolution reiniciando, ou o próprio vigia derrubando um handshake que
  passou de `LIMITE_CONNECTING_MS`.

---

## 3. Tela 4: esta NÃO é uma queda do WhatsApp

Na tela 4 **todos** os campos independentes estão vazios ao mesmo tempo: versão,
última sincronização, situação, tentativa, motivo, número pareado. Esses valores
vêm de fontes diferentes e não somem juntos por acidente.

Somam-se a isso dois detalhes decisivos:

* o rótulo é **"Offline"**, não "Evolution indisponível" nem "Instância não
  existe". Esses dois rótulos vêm do servidor (`_rotuloStatus`); **"Offline" é o
  texto de fallback do cliente** quando `detalhes` é nulo
  ([WhatsAppPage.jsx:64](client/src/pages/WhatsAppPage.jsx:64));
* **"Última sincronização: –"**. O servidor preenche esse campo com
  `new Date().toISOString()` — ele é **impossível** de vir vazio numa resposta
  bem-sucedida.

**Conclusão: na tela 4 o painel não conseguiu ler `GET /api/whatsapp/detalhes`.**
`detalhes` ficou `null` desde a primeira carga (o `catch` de `carregarDetalhes`
preserva o valor anterior — então nulo só sobrevive se a **primeira** leitura
falhou). Nada nessa tela afirma qualquer coisa sobre o pareamento.

Duas causas prováveis, nesta ordem:

1. **sessão do painel expirada / sem permissão.** `/detalhes` é restrito a
   Administrador; um 401/403 produz exatamente esta tela. **Recarregar a página
   e refazer o login é o primeiro teste** — custa nada e é reversível;
2. **o `arka-api` não respondeu** (reinício, timeout).

### 3.1 Dois defeitos de tela confirmados aqui

**(a) "Cofre da sessão: inativo" é falso.** O painel renderiza "inativo" no ramo
`else` de `detalhes?.cofreSessao?.disponivel`
([WhatsAppPage.jsx:781](client/src/pages/WhatsAppPage.jsx:781)) — e com
`detalhes` nulo o `else` é o que sobra. A tela 1, minutos antes, mostra o cofre
**guardado às 07:42:46**. O cofre não foi a lugar nenhum; a tela confundiu **"não
sei"** com **"não existe"**, no campo que responde justamente "dá para recuperar
a sessão?".

**(b) "Nenhum número pareado" + "Sessão preservada", juntos.** A tela afirma que
o número se foi e, três dedos abaixo, que a sessão está preservada. Uma das duas
está errada — e é a primeira, pelo mesmo motivo: falta de dado renderizada como
ausência de pareamento. Para quem está olhando, isso lê como "perdi o
pareamento", que é precisamente a conclusão que faz o operador ir buscar o QR e
disparar a cascata do §7 da auditoria de 09/09.

> Este é o mesmo defeito de classe que já foi corrigido duas vezes neste módulo
> (o `catch` cego do vigia; o "401 ao lado de CONNECTED"): **tratar ausência de
> informação como veredito negativo.** Ele sobreviveu na camada de renderização.

---

## 4. O agravante estrutural: cada religamento pode pagar uma ressincronização

`syncFullHistory` está **ligado por padrão**
([env.js:146](server/src/config/env.js:146)) e vale **desde a criação da
instância** — não se desliga numa instância já pareada.

Com ele, um religamento pode arrastar sincronização de histórico, que é
exatamente o que produziu o 408 do incidente de 09/09 — e 408, na Evolution
2.4.0, cai no ramo destrutivo: apaga credencial → emite QR → `QRCODE_LIMIT: 3`
([docker-compose.prod.yml:209](docker-compose.prod.yml:209)) → `client.logout()`
→ **401 de verdade**.

Por isso a oscilação das telas 1–3, mesmo sendo "só temporária", **não é
inofensiva**: ela é o começo conhecido de um caminho que termina em pareamento
perdido. Vale tratar como urgente por essa razão — não porque a tela pisca.

---

## 5. O que rodar agora, na ordem

**1. Recarregar o painel** (F5) e refazer o login se ele pedir. Isso resolve a
tela 4 se a causa for a sessão do painel — e distingue "o painel não lê" de "a
conexão caiu".

**2. Ver se é flapping ou uma queda longa** (é a pergunta do §2.2):

```bash
docker compose -f docker-compose.prod.yml logs --since 60m api | grep -iE "WhatsApp\]|handshake|cofre|Reconnect attempt|Online"
```

* muitos `[WhatsApp] Online` intercalados com `Reconnect attempt: 1` →
  **flapping**, siga para o passo 3;
* `Handshake travado em 'connecting' -- vai religar` repetido → o vigia está
  matando o handshake no meio; suba `WHATSAPP_LIMITE_CONNECTING_MS` (§6);
* `Reconnect attempt` subindo sem nenhum `Online` → **uma** queda longa: o
  problema é rede/Evolution, não pareamento.

**3. Ver se a Evolution está reiniciando por baixo** (explicaria queda sem código
de motivo, §2.3):

```bash
docker compose -f docker-compose.prod.yml ps
```

```bash
docker inspect --format "{{.RestartCount}} {{.State.OOMKilled}} {{.State.StartedAt}}" $(docker compose -f docker-compose.prod.yml ps -q evolution)
```

`RestartCount` alto ou `OOMKilled: true` **é a resposta** — e nenhuma correção no
nosso lado ajuda enquanto for isso.

**O que NÃO fazer, em nenhum dos casos:** clicar em "Reconectar" repetidamente, e
**não** gerar QR. Cada QR à toa aproxima o `QRCODE_LIMIT: 3` do `client.logout()`
do §4 — é a forma mais rápida de transformar uma oscilação temporária em
pareamento perdido de verdade.

---

## 6. Se for handshake travado

Só reinicia o `arka-api`; a Evolution fica intocada e não há risco de pareamento.
No `.env` da VM:

```
WHATSAPP_LIMITE_CONNECTING_MS=900000
```

```bash
docker compose -f docker-compose.prod.yml up -d api
```

---

## 7. O que fica pendente de correção no código

> **Atualização:** os três itens abaixo **foram corrigidos** — ver §10.1. A lista
> fica como registro do que estava aberto no momento em que o log foi lido.

Em ordem de dano:

1. **Ausência de dado renderizada como veredito negativo** (§3.1). Com `detalhes`
   nulo, a tela deve dizer **"não foi possível ler o estado"** — nunca "Offline",
   "nenhum número pareado" ou "cofre inativo". Os três afirmam fatos que ninguém
   verificou, e os três empurram o operador para o QR.
   Arquivo: [WhatsAppPage.jsx](client/src/pages/WhatsAppPage.jsx) (linhas 64, 460, 781).
2. **A pílula da Central de Atendimento colapsa seis estados em dois** (§2.1).
   `RECONNECTING` e `DISCONNECTED_TEMPORARY` merecem um terceiro rótulo
   ("Reconectando", âmbar) em vez de "Offline" — o `statusLabel` que o servidor
   já devolve resolve, e a Central o ignora.
   Arquivos: [AppContext.jsx:668](client/src/context/AppContext.jsx:668),
   [AtendimentoView.jsx:5211](client/src/components/pages/AtendimentoView.jsx:5211).
3. **Nada no painel conta as quedas.** A pergunta que originou esta auditoria —
   "quantas vezes caiu na última hora?" — só tem resposta no log, e ela é o dado
   que separa flapping de queda longa. Um contador de transições `open → close`
   desde o boot, exibido na Saúde da Conexão, dispensaria o `docker logs` para
   diagnosticar exatamente este relato.

---

## 8. SEGUNDO ATO (log de 07:42–07:55): é flapping, e há um laço de realimentação

O log do `arka-api` resolve a pergunta do §2.2 e traz **dois fatos que as
capturas não mostravam**.

### 8.1 A contagem: 6 quedas em 8 minutos, três delas com 15 segundos de vida

| Caiu | Voltou | Tentativas | Tempo de pé antes |
| --- | --- | --- | --- |
| 07:42:31 | 07:42:46 | 1 | — |
| 07:45:31 | 07:47:01 | 4 | **2m45s** |
| 07:47:16 | 07:48:31 | 5 | **15s** |
| 07:48:46 | 07:49:16 | 2 | **15s** |
| 07:50:01 | 07:50:16 | 1 | **45s** |
| 07:50:31 | 07:54:02 | 8 (408 a partir da #5) | **15s** |

**É flapping, confirmado.** Três dos seis intervalos de "online" duram
exatamente 15 segundos — um único ciclo do vigia. Ou seja: em metade dos casos a
instância já estava fora de novo na primeira verificação depois de subir. Ela
nunca chegou a funcionar; só apareceu como `open` uma vez.

Nada de logout: `credencial intacta` nas seis, nenhum 401/403, nenhum QR emitido.
O cofre gravou três vezes. **Em nenhum momento escanear o QR teria ajudado.**

### 8.2 FATO NOVO 1 — as chaves do Signal foram apagadas (817 → 28)

Os três registros do cofre, com o mesmo `bytes` e contagens de arquivo
radicalmente diferentes:

| Hora | bytes | chaves |
| --- | --- | --- |
| 07:42:46 | 2034 | **817** |
| 07:54:02 | 2034 | **28** |
| 07:54:47 | 2034 | **33** |

`chaves` é a contagem de **arquivos** copiados de
`/evolution/instances/<id>/` — as chaves do Signal: pre-keys, sessões por
contato, `app-state-sync-key-*` (`whatsapp.sessao.js`, `salvar`).

A credencial de pareamento **não mudou** (2034 bytes nas três). O que
desapareceu foram **789 arquivos de chave**, e as 33 da última linha são chaves
**novas**, recriadas do zero.

Isto é a `cleaningUp()` da Evolution — o ramo destrutivo do 408 descrito em
[auditoria-queda-408-pos-recriacao.md](docs/auditoria-queda-408-pos-recriacao.md) §7.
Aqui ele rodou **sem chegar ao logout**: apagou as chaves e parou aí.

**E é isso que sustenta o laço.** Sem as `app-state-sync-key`, cada religamento
precisa ressincronizar o estado do aplicativo **inteiro** do lado do WhatsApp.
Com `syncFullHistory` ligado (§4), essa ressincronização não cabe no prazo do
Baileys → **408** → o ramo destrutivo apaga chaves outra vez → a próxima
reconexão tem ainda menos com que trabalhar. **A queda produz a condição da
próxima queda.**

Confere no tempo: os primeiros seis `Reason` são `desconhecido`; **o 408 só
aparece às 07:52:01**, na tentativa #5 — depois de as chaves já terem sido
perdidas.

### 8.3 FATO NOVO 2 — a enxurrada de webhooks anula o nosso backoff

`[WhatsApp] Queda sinalizada pela Evolution` aparece **centenas de vezes**, às
vezes 5 no mesmo segundo (07:49:41), e — o ponto decisivo — **continua chegando
depois de a instância voltar**:

```
07:54:47 [info]  [WhatsApp] Online  situacao: CONNECTED
07:54:48 [warn]  [WhatsApp] Queda sinalizada pela Evolution  state: close
07:54:49 [warn]  [WhatsApp] Queda sinalizada pela Evolution  state: close
07:54:50 [warn]  [WhatsApp] Queda sinalizada pela Evolution  state: close
```

A Evolution está afirmando `close` pelo webhook **enquanto o
`/connectionState` dela mesma responde `open`**. As duas coisas não podem ser
verdade ao mesmo tempo — o que aponta para **mais de um socket vivo com a mesma
credencial** (a armadilha 1 do cabeçalho de `whatsapp.reconexao.js`) ou entrega
atrasada em lote.

E isso tem uma consequência direta no **nosso** código. `notificarQueda` faz
`proximaTentativaEm = 0` a cada webhook, sem qualquer freio
([whatsapp.reconexao.js](server/src/modules/whatsapp/whatsapp.reconexao.js), `notificarQueda`).
Sob enxurrada, **a escada de backoff deixa de existir**. A prova está no log:

```
07:53:16  Reconnect attempt: 7   proximoEmMs: 58854
07:53:31  Reconnect attempt: 8            ← 15 segundos depois, não 59
```

A tentativa #8 saiu no **tick seguinte** do vigia. O `proximoEmMs` de 59
segundos foi zerado por um webhook no meio do caminho.

**Isso nos coloca dentro do laço, não só observando.** Com o backoff anulado, o
vigia dispara `/instance/connect` a cada 15s — inclusive sobre um socket que a
Evolution ainda está levantando, que é exatamente a receita de um segundo socket
e do `conflict: replaced` do WhatsApp. As três janelas de 15 segundos do §8.1 são
compatíveis com isso.

### 8.4 Veredito

Das três causas do §5, é a **primeira: flapping** — e o mecanismo tem três elos,
sendo que **um é nosso**:

1. as chaves do Signal foram apagadas (§8.2) → toda reconexão exige
   ressincronização completa;
2. a ressincronização estoura → 408 → apaga chaves de novo → **realimenta**;
3. a enxurrada de `connection.update` zera o nosso backoff (§8.3) → `connect` a
   cada 15s → socket concorrente → mais `close`.

O elo 3 é o único que se corrige do nosso lado, com risco baixo, sem tocar na
Evolution e **sem reparear**.

### 8.5 O que fazer, em ordem

**1. Pôr freio no `notificarQueda` (correção de código, elo 3).** Ele deve
ignorar o aviso quando já existe backoff em curso e quando a situação é
`CONNECTED` há poucos segundos. Hoje um webhook atrasado cancela uma espera de
59 segundos. Sem isso, subir qualquer prazo é inútil — o backoff não está
valendo.

**2. Dar espaço ao handshake** (§6). Só faz efeito **depois** do item 1.

**3. Confirmar o lado da Evolution.** O log acima é só do `arka-api`; o que
apagou as chaves está no outro contêiner:

```bash
docker compose -f docker-compose.prod.yml logs --since 30m evolution | grep -iE "conflict|replaced|logout|cleaning|error|408|sync"
```

```bash
docker compose -f docker-compose.prod.yml exec evolution sh -c 'ls /evolution/instances/*/ | wc -l'
```

Se a contagem estiver na casa das dezenas (e não das centenas), as chaves
seguem perdidas e o elo 2 continua armado.

**4. Só então considerar `syncFullHistory=false`.** Ele vale a partir da
**criação** da instância, então exige repareamento — é a última carta, não a
primeira, e não deve ser jogada enquanto o elo 3 estiver aberto.

**O que continua valendo:** não gerar QR e não martelar "Reconectar". O
pareamento está intacto nas seis quedas, e cada `connect` extra alimenta o elo 3.

---

## 9. TERCEIRO ATO: `conflict: replaced` — dois sockets disputando a mesma sessão

O log da Evolution muda o diagnóstico de novo, e para melhor: **a causa raiz tem
nome, e não é o 408.**

### 9.1 O que o log diz, em 12 segundos

Todas as linhas colhidas caem entre os epochs `1789037867476` e `1789037879329`
— **uma janela de 12 segundos**. Nela aparecem, em rajada:

```
"reasonNode":{"tag":"conflict","attrs":{"type":"replaced"}}   msg: "stream errored out"
```

**Vinte e três vezes em 12 segundos.** Mais:

```
uploadError: "Error: Connection Closed"  count: 5   msg: "Failed to upload pre-keys to server"
statusCode: 408  "Pre-key upload timeout"           msg: "Failed to check/upload pre-keys during initialization"
statusCode: 428  "Connection Closed"                msg: "failed to send initial passive iq"
msg: "Timeout in AwaitingInitialSync, forcing state to Online and flushing buffer"
```

### 9.2 A leitura: a inicialização nunca termina, porque o socket é substituído no meio dela

`conflict: replaced` é o WhatsApp dizendo **"outra conexão assumiu esta
sessão"**. Não é rede, não é timeout, não é sessão inválida: é **disputa**.

E a sequência dos erros diz exatamente onde ele bate. Toda conexão nova precisa,
na largada: mandar o `passive iq` inicial, subir as pre-keys e fazer o
`AwaitingInitialSync`. As três coisas falham, sempre com `Connection Closed` /
`428 Precondition Required` — ou seja, **o socket morre antes de a inicialização
acabar**, porque foi substituído.

Daí decorre tudo o que já tínhamos observado:

* **as pre-keys nunca são gravadas** (`Failed to upload pre-keys`, 5 tentativas).
  Isso explica por que a contagem de chaves **não recupera**: `ls
  /evolution/instances/*/ | wc -l` devolveu **43** arquivos — contra os **817**
  do cofre às 07:42:46. Não foi só um apagamento no passado: **a reposição está
  bloqueada agora**;
* **o 408 é consequência, não causa.** Ele é o `Pre-key upload timeout` e o
  estouro do `AwaitingInitialSync` — os dois provocados pelo `replaced`. Isto
  **corrige o §8.2**: o 408 não iniciou o laço, ele é um sintoma dele;
* **`Timeout in AwaitingInitialSync, forcing state to Online`** é a Evolution
  declarando `open` sem ter concluído a sincronização. É por isso que o
  `/connectionState` responde `open` no mesmo instante em que o webhook manda
  `close` (§8.3) — **as duas respostas são honestas**, vêm de sockets diferentes.

### 9.3 Quantos sockets, e de onde vêm

Vinte e três substituições em 12 segundos é **muito** mais do que o nosso vigia
consegue provocar: com o backoff anulado (§8.3) ele dispara no máximo um
`/instance/connect` a cada 15 segundos. **A maior parte dessas conexões não é
nossa.** Duas origens possíveis, e elas não se excluem:

1. **o Baileys dentro da Evolution reconectando por conta própria.** Cada
   `Connection Closed` dispara a retentativa interna dele, que abre outro socket,
   que é substituído, que fecha — laço fechado dentro do contêiner, sem passar
   pela nossa API;
2. **outro processo pareado com a mesma credencial.** É o significado literal de
   `replaced`, e é a hipótese que explica melhor a rajada: uma segunda instância
   na própria Evolution, um contêiner antigo ainda no ar, outra VM com uma cópia
   do volume, ou um dispositivo em "Aparelhos conectados" no celular. Dois donos
   da mesma sessão se derrubam mutuamente **para sempre** — cada um vê o outro
   como intruso, e nenhum dos dois consegue completar a inicialização.

**A hipótese 2 precisa ser descartada antes de qualquer correção de código**, e é
barata de testar (§9.5). Se houver um segundo dono, nenhum ajuste de backoff,
prazo ou repareamento resolve: os dois vão continuar se derrubando.

### 9.4 O que isto muda no plano do §8.5

| Antes (§8.5) | Agora |
| --- | --- |
| elo 1: chaves apagadas | **consequência** — as chaves não voltam porque o upload é interrompido |
| elo 2: 408 realimenta | **consequência** — o 408 é o timeout provocado pelo `replaced` |
| elo 3: nosso backoff anulado | **continua real, mas é agravante, não causa** |

A causa raiz é **a disputa pela sessão**. O freio no `notificarQueda` continua
valendo — ele para de jogar sockets nossos numa briga que já está acontecendo —
mas **não é mais a correção principal**, e sozinho não estabiliza nada.

**E o repareamento está desaconselhado até isto ser resolvido:** parear de novo
com um segundo dono ativo entrega uma credencial nova para a mesma disputa.

### 9.5 As três checagens que fecham a causa raiz

**1. Quantas instâncias existem na Evolution** (e se alguma duplica o número):

```bash
docker compose -f docker-compose.prod.yml exec evolution-api sh -c 'ls -1 /evolution/instances/'
```

```bash
curl -s -H "apikey: $EVOLUTION_API_KEY" http://127.0.0.1:8080/instance/fetchInstances | head -c 3000
```

Mais de uma instância com o mesmo `ownerJid`/número **é a resposta** — e a
correção é apagar a duplicada, não reparear.

**2. Se há outro contêiner no ar com a mesma credencial:**

```bash
docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}' | grep -iE "evolution|wapi|baileys"
```

**3. No celular — "Aparelhos conectados" (Dispositivos vinculados).** Se houver
mais de uma sessão do painel listada, as extras devem ser desconectadas **pelo
celular**. Esta é a checagem que só uma pessoa pode fazer, e é a mais provável de
explicar `replaced` numa rajada dessa intensidade.

Enquanto isso não estiver respondido, o resto é paliativo.

---

## 10. QUARTO ATO (08:01:17): o pareamento acabou mesmo — e o que foi corrigido

Enquanto as correções abaixo eram escritas, o painel passou a `LOGGED_OUT`,
motivo **401**, cofre guardado às 07:59:47, badge **"Reescaneie o QR"**.

**A cascata chegou ao fim previsto.** É a mesma sequência já documentada em
[auditoria-queda-408-pos-recriacao.md](docs/auditoria-queda-408-pos-recriacao.md) §7:
408 → a Evolution emite QR sozinha → `QRCODE_LIMIT: 3` estoura em ~1 minuto →
`client.logout()` → o WhatsApp remove o aparelho → **401**.

Duas leituras importam aqui:

* **agora escanear o QR é a ação correta.** É o primeiro momento em toda esta
  sequência em que é. O cofre tem cópia e **recusa restaurar em 401** — e a
  recusa está certa: `client.logout()` desfez o pareamento no servidor do
  WhatsApp, a credencial local virou papel sem valor;
* **mas a checagem de "Aparelhos conectados" (§9.5.3) vem ANTES do QR.** Se
  houver um segundo dono da sessão, parear de novo entrega uma credencial nova
  para a mesma disputa, e a cascata recomeça.

### 10.1 O que foi corrigido no código

Três defeitos, nenhum deles a causa raiz — todos eles **agravantes que nos
punham dentro do laço** ou **mentiras de tela que empurram o operador para o QR**
(e o QR pedido à toa é o que dispara `client.logout()`).

**1. O aviso do webhook anulava o backoff**
([whatsapp.reconexao.js](../server/src/modules/whatsapp/whatsapp.reconexao.js), `notificarQueda`)

`proximaTentativaEm = 0` cru, em todo `connection.update`. Com centenas de
avisos por minuto, a escada de 1s–60s virou decoração e o vigia abriu socket a
cada 15s por cima dos que a Evolution ainda levantava. Agora o aviso pode
**adiantar** uma verificação, nunca **encurtar** uma espera já decidida. O log
do aviso também passou a ser um por minuto, com a conta do que foi suprimido —
as centenas de linhas idênticas enterravam as que importavam.

**2. A escada recomeçava no primeiro degrau a cada religamento**
(mesmo arquivo, `_esperaMs` + histórico de quedas)

`_resetar()` a cada `open` zerava `tentativa`. Numa sessão disputada isso
significava reabrir socket **1 segundo** depois de uma sessão que durou 15 —
quanto pior a briga, mais rápido jogávamos sockets nela. Agora as quedas são
contadas numa janela de 10 minutos; a partir de 3, a escada passa a começar no
4º degrau (10s). **Frear não é desistir:** segue religando para sempre enquanto
a sessão for válida, e não pede QR.

**3. A tela afirmava o que ninguém verificou**
([WhatsAppPage.jsx](../client/src/pages/WhatsAppPage.jsx), [AppContext.jsx](../client/src/context/AppContext.jsx), [AtendimentoView.jsx](../client/src/components/pages/AtendimentoView.jsx))

* com `detalhes` nulo, "Offline" + "Nenhum número pareado" + "cofre inativo" +
  "sessão preservada" — quatro afirmações, nenhuma verificada, duas delas
  contraditórias entre si (§3.1). Agora há um estado próprio: **"Estado não
  lido"**, e o texto diz que isso não fala do pareamento e não se resolve com QR;
* **o rótulo do motivo ignorava `motivoDesconexaoVigente`.** O servidor já
  resolvia a questão "este 401 é da queda de agora ou sobrou de antes?" e
  mandava a resposta; a tela rotulava todo 401 como "logout real" de qualquer
  forma. Era o defeito do "401 ao lado de CONNECTED" sobrevivendo na
  renderização;
* **a pílula da Central de Atendimento** deixou de colapsar seis estados em
  dois. `Reconectando`/`Conectando` agora saem em âmbar ("o servidor está
  religando, nada foi perdido") em vez de vermelho "Offline" — que era metade do
  "cai e volta toda hora" relatado. Sem leitura, ela diz "sem leitura", não
  "Offline".

**4. O contador de quedas** (o item 3 dos pendentes do §7) entrou na Saúde da
Conexão: `quedasNaJanela`, a janela, e o aviso **"sessão disputada"** quando
passa do limite. É o dado que separa "caiu uma vez e está demorando" de "caiu
oito vezes" — e que nesta auditoria só existiu via `docker logs`.

### 10.2 Verificação

`verificar-reconexao-whatsapp.js` ganhou três seções novas — **7c** (200 avisos
de webhook não mexem no backoff), **7d** (o freio de flapping entra, e frear não
é pedir QR) e **7e** (uma queda longa com 8 tentativas **não** é flapping, para
o freio não atrasar uma queda de rede comum). Suíte inteira verde, 118
asserções. Build do cliente limpo.

Uma correção de contrato: o helper `liberarBackoff` do próprio verificador usava
`notificarQueda` para atravessar a espera — ou seja, **o teste dependia do
defeito**. Agora usa uma costura de teste explícita, que produção não chama.

### 10.3 O que continua fora do alcance do código

A **causa raiz do §9 não é corrigível daqui.** `conflict: replaced` é disputa
pela sessão, e quem a resolve é a checagem do §9.5: instância duplicada,
contêiner antigo no ar, ou um segundo aparelho vinculado. As correções acima
reduzem a nossa contribuição para o laço e fazem a tela parar de empurrar o
operador para o QR — **não substituem aquela checagem.**
