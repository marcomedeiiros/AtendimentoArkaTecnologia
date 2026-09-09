# Integração WhatsApp: o que a mantém de pé, e o que a derruba

**Data:** 2026-09-09 · **Escopo:** a integração inteira — Evolution, pareamento,
webhook, vigia de reconexão e o painel.
**Por que existe:** em um único dia, três operações que pareciam inofensivas
derrubaram o atendimento por mais de uma hora. Nenhuma delas era um bug. Todas
eram interações entre prazos e limites que ninguém tinha escrito num lugar só.

Este documento é **operacional**: o que se pode fazer, o que não se pode, e por
quê. As auditorias de incidente (`auditoria-queda-408-pos-recriacao.md`,
`auditoria-eventos-do-cliente.md`) contam as histórias; aqui estão as regras que
sobraram delas.

---

## 1. As peças, e quem decide o quê

| Peça | Decide |
| --- | --- |
| **Evolution (contêiner)** | fala com o WhatsApp via Baileys. Guarda credencial no volume `evolution_instances` + Postgres |
| **Mapa `WEBHOOK_EVENTS_*`** (compose da Evolution) | quais eventos ela tem **permissão** de entregar |
| **`EVENTOS_PADRAO`** (`evolution-api.client.js`) | quais eventos a **instância assina** |
| **`whatsapp.reconexao`** | o único lugar que manda reconectar. Classifica o estado e escolhe `connect` ou `restart` |
| **`whatsapp.sessao`** (o cofre) | copia a credencial e a devolve quando a Evolution a apaga por engano |
| **`podeMostrarQr`** (servidor) | se o painel pode oferecer QR. A tela só obedece |
| **`whatsapp.conferirWebhook`** | confere a assinatura no boot e avisa o que falta |

Regra que atravessa tudo: **a tela nunca decide nada.** Ela mostra o veredito do
servidor. Toda vez que essa regra foi quebrada no passado, o resultado foi um QR
pedido à toa — e QR pedido à toa é a forma mais rápida de perder o pareamento.

---

## 2. Os dois filtros em série (a lição mais cara do dia)

Um evento do WhatsApp só chega na Central se passar por **dois** filtros
independentes:

```
WhatsApp → Baileys → [1] WEBHOOK_EVENTS_* do contêiner → [2] eventos assinados
                          pela instância → webhook → Arka
```

Ligar só o primeiro **não muda nada** — e o primeiro é o caro (exige recriar o
contêiner), enquanto o segundo é o barato (uma chamada HTTP pelo painel).

Foi exatamente esse engano que custou a recriação do contêiner de 09/09, e com
ela o pareamento. A conferência do boot agora avisa:

```
Webhook da Evolution assina MENOS eventos do que deveria
faltando: ["MESSAGES_DELETE","MESSAGES_EDITED"]
conserto: Painel > Integracao WhatsApp > configurar webhook (nao precisa recriar conteiner)
```

**Regra:** antes de tocar no contêiner por causa de eventos, confira a
assinatura da instância. Quase sempre o problema está no filtro barato.

---

## 3. Os quatro números que decidem se o pareamento sobrevive

| Onde | Valor | O que acontece se estiver errado |
| --- | --- | --- |
| `EVOLUTION_SYNC_FULL_HISTORY` | **false** | ligado, a ressincronização estoura e vira 408 |
| `WHATSAPP_LIMITE_CONNECTING_MS` | **900000** (15 min) | baixo, o vigia mata o handshake no meio e produz o 408 que deveria evitar |
| `QRCODE_LIMIT` (Evolution) | **3** | ao estourar, `client.logout()` **remove o aparelho no WhatsApp** |
| `CODIGOS_LOGOUT_REAL` | **[401, 403]** | qualquer outro código é queda temporária; alargar isso faria o cofre recusar restaurações legítimas |

Os dois primeiros agora estão **declarados no `docker-compose.prod.yml`**, não
mais só num `.env` escrito à mão. Isso importa mais do que parece: eles estavam
só no `.env` da VM, e um clone novo os perderia em silêncio — a perda só
apareceria horas depois, como pareamento caído.

### A cascata que esses números produzem quando desalinhados

Vale decorar, porque ela explica quase toda queda:

```
sincronização longa → AwaitingInitialSync estoura → 408
  → na 2.4.0, 408 entra no ramo destrutivo → credencial apagada
    → sem credencial, a instância emite QR sozinha
      → 3 QRs em ~1 min (QRCODE_LIMIT) → client.logout()
        → 401: o aparelho foi removido NO WHATSAPP. Só QR resolve.
```

Cada seta é rápida. Do primeiro 408 ao 401 foram **seis minutos** em 09/09.

---

## 4. O que fazer, por estado

O painel mostra a `Situação` em Saúde da Conexão. Ela é o que manda — não a cor
do badge nem a impressão de quem olha.

| Situação | O que é | O que fazer |
| --- | --- | --- |
| `CONNECTED` | tudo certo | nada |
| `RECONNECTING` / `DISCONNECTED_TEMPORARY` | caiu, credencial intacta | **esperar.** A escada termina em 60s e nunca desiste |
| `LOGGED_OUT` (401/403) | o WhatsApp removeu o aparelho | parear de novo — é o único caso em que o QR é a resposta |
| `UNKNOWN` | a Evolution não respondeu | esperar a próxima consulta. Não é queda do WhatsApp |
| `INSTÂNCIA NÃO EXISTE` (404) | o nome sumiu na Evolution | recriar pelo "Gerar QR", que oferece a criação |

### Nunca, em nenhum estado

* **Clicar "Reconectar" repetidamente.** Cada clique reinicia a sincronização do
  zero. É a forma mais rápida de transformar uma espera longa em espera infinita;
* **Pedir QR com a sessão válida.** O painel esconde o botão de propósito, e o
  atalho "Preciso parear de novo mesmo assim" avisa o custo. Com `QRCODE_LIMIT=3`,
  um QR pedido à toa termina em logout de verdade;
* **Escanear um QR sem o celular já em "Aparelhos conectados".** A tela vale
  ~1 minuto. Abrir o QR e ir buscar o telefone é literalmente o passo que dispara
  o `logout()`.

---

## 5. Recriar o contêiner da Evolution: quando e como

**É operação de janela, com risco real de reparear.** Não pelo motivo intuitivo
(a credencial sobrevive ao `docker compose up` — e sobreviveu), mas pela cascata
do §3: o contêiner novo sobe o Baileys do zero, e a ressincronização é o
estopim.

Faça **só** quando não houver outro caminho, e nesta ordem:

1. `bash deploy/backup.sh`
2. confirmar `EVOLUTION_SYNC_FULL_HISTORY=false` e
   `WHATSAPP_LIMITE_CONNECTING_MS` dentro do contêiner da API
   (`exec api printenv | grep -E "SYNC_FULL|LIMITE_CONNECTING"`);
3. fora do horário de atendimento, com o celular por perto;
4. `docker compose -f docker-compose.prod.yml up -d evolution-api`;
5. acompanhar `logs -f evolution-api` até `CONNECTED TO WHATSAPP`, e depois
   ficar de olho por ~15 min — o perigo é **depois** do CONNECTED, não durante.

Para **subir código nosso** (que é o caso comum), não recrie a Evolution:

```bash
docker compose -f docker-compose.prod.yml up -d --build api web
```

---

## 6. Se o pareamento cair mesmo assim

A sequência que funcionou em 09/09, depois de várias que não funcionaram:

1. **Diagnosticar antes de clicar.** O estado real vem da Evolution, não da tela:
   ```bash
   docker compose -f docker-compose.prod.yml exec api node -e "fetch('http://evolution-api:8080/instance/connectionState/arka-wapi-oficial',{headers:{apikey:process.env.EVOLUTION_API_KEY}}).then(r=>r.text()).then(console.log)"
   ```
2. **Procurar ENOENT no log da Evolution.** Linhas como
   `ENOENT ... lid-mapping-*.json` e `Failed to create own LID session` significam
   que o `cleaningUp()` apagou as chaves do Signal: o diretório da instância está
   pela metade e **nenhum QR vai parear**. Aí não adianta insistir na tela;
3. **Excluir a instância** (pelo terminal, que não depende do painel estar no
   estado certo no instante do clique):
   ```bash
   docker compose -f docker-compose.prod.yml exec api node -e "fetch('http://evolution-api:8080/instance/delete/arka-wapi-oficial',{method:'DELETE',headers:{apikey:process.env.EVOLUTION_API_KEY}}).then(r=>r.text()).then(console.log)"
   ```
4. **Painel → "Gerar QR" → confirmar a criação → escanear.**

O histórico de conversas **não** é afetado por nada disso: ele vive no nosso
SQLite (`/data/arka.db`), separado da Evolution. O que se perde ao excluir a
instância é o pareamento e a agenda de contatos importada.

---

## 7. Como saber que está saudável

Três linhas no log da API dizem tudo, e as três aparecem no boot:

```
Vigia de reconexao do WhatsApp iniciado ... "cofre":"ativo"
Webhook da Evolution conferido ... eventos:[... cinco nomes ...]
```

E o que **não** pode aparecer:

| Linha | Significa |
| --- | --- |
| `Webhook da Evolution assina MENOS eventos do que deveria` | filtro 2 desatualizado (§2) — conserto pelo painel |
| `WEBHOOK AUSENTE` | nenhuma mensagem vai entrar |
| `Webhook recebido e nao roteado` | chegou um evento que o roteador não conhece — o nome está na linha |
| `LOGOUT REAL DETECTADO` | 401/403 vigente: só QR resolve |

Verificação de rotina, quando quiser confirmar que nada regrediu:

```bash
cd server && node verificar-mensagem-recebida.js
```

40 checagens, e elas cobrem o caminho que mais quebrou: risquinho, reação,
edição, apagar e citação.

---

## 8. O que continua frágil (e é honesto dizer)

Nem tudo aqui está resolvido. O que segue em aberto, com o tamanho real:

* **`QRCODE_LIMIT: 3` é uma faca de dois gumes.** Ele protege de uma tela de QR
  esquecida aberta, mas converte uma reconexão automática que passou a emitir QR
  num logout de verdade em ~1 minuto. Revisar esse número exige recriar o
  contêiner, então fica para a próxima janela — não vale abrir uma só por isso;
* **A citação de resposta em texto não chega** (regressão da Evolution, issue
  #2065). Não há conserto deste lado, e trocar de versão custaria os botões do
  menu. Ver `auditoria-mensagens-recebidas.md` §7;
* **`connectionState` às vezes responde 200 sem o campo `state`.** Nosso código
  lê isso como `close`. Foi observado logo após excluir a instância, e se
  corrigiu sozinho na consulta seguinte — mas é um estado que a leitura não
  distingue de uma queda real;
* **A Evolution 2.4.0 não tem para onde subir.** A 2.3.7 é a última estável e
  quebra os botões do menu. Ficamos onde estamos, conscientemente.

---

## 9. A regra que resume o dia

Toda queda de hoje começou com uma mudança pequena, correta e bem-intencionada,
aplicada sem olhar o que ela desencadeava dois passos adiante.

O que teria evitado as três: **antes de tocar na Evolution, perguntar se o
conserto não está do lado barato** — na assinatura da instância, num `.env` da
API, num rebuild de contêiner nosso. Na esmagadora maioria das vezes, está.
