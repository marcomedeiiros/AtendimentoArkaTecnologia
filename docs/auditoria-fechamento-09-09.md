# Auditoria de fechamento: o que ficou corrigido, o que falta

**Data:** 2026-09-09, fim do dia · **Escopo:** conferir, item por item, tudo o
que as cinco auditorias de hoje levantaram.
**Método:** cada linha da coluna "Evidência" foi **verificada agora**  no
código ou rodando. Nada aqui é lembrança do que foi feito.

Resultado curto: **os defeitos de código estão todos corrigidos e a suíte está
verde pela primeira vez.** O que falta não é código  é deploy, é o pareamento
de amanhã, e são três decisões pendentes (§4 e §5).

---

## 1. Placar

```
TUDO PASSOU.      58 scripts · 1.646 checagens · 0 falhas
```

### Mensagem recebida (`auditoria-mensagens-recebidas.md`)

| | Item | Estado | Evidência |
| --- | --- | --- | --- |
| B1 | risquinho em bolha de cliente | ✅ | 3 guardas conferidas: `origem === "cliente"` no repositório, `ack_de_mensagem_recebida` no webhook, `m.de !== 'cliente'` na bolha |
| B1 | dado sujo no banco | ✅ | `limpar-status-recebidas.js` existe e **rodou em produção: 1.350 linhas** |
| B2 | `findMensagemPorWaId` duplicada | ✅ | resta **uma** definição no repositório |
| B3 | edição do cliente | ⚠️ | `extrairProtocolo` existe e é testado  **não provado em produção** (§3) |
| B4 | reação apagando mídia | ✅ | cenário próprio; `metadata` e `conversaId` no `select` |
| B5 | "apagar para todos" do cliente | ⚠️ | mesma situação do B3 |

### Eventos e citação (`auditoria-eventos-do-cliente.md`, `auditoria-citacao-derivada.md`)

| Item | Estado | Evidência |
| --- | --- | --- |
| entrada do webhook cega | ✅ | `Webhook recebido e nao roteado` em `info`; diagnóstico cobre todos os eventos; boot **compara** a assinatura |
| assinatura da instância com 3 eventos | ✅ | `EVENTOS_PADRAO` = `MESSAGES_UPSERT, MESSAGES_UPDATE, MESSAGES_DELETE, MESSAGES_EDITED, CONNECTION_UPDATE` |
| eventos autorizados no contêiner | ✅ | `WEBHOOK_EVENTS_MESSAGES_DELETE/EDITED` no compose **e vivos na VM** (`printenv` conferido) |
| citação da resposta digitada | ✅ | `ultimaMensagemNossa` + retrato `derivada` |
| citação apontando para o robô | ✅ | cenário trava a cena da #OS00217 |

### Pareamento (`auditoria-queda-408-pos-recriacao.md`, `integracao-whatsapp-estabilidade.md`)

| Item | Estado | Evidência |
| --- | --- | --- |
| `EVOLUTION_SYNC_FULL_HISTORY=false` | ✅ | no compose **e** no `.env` da VM (`printenv` conferido) |
| `WHATSAPP_LIMITE_CONNECTING_MS=900000` | ✅ | idem |
| painel afirmando "sessão válida" em `UNKNOWN` | ✅ | ramo próprio, "Estado não confirmado" |
| QR falso desenhado na tela | ✅ | virou "Clique em Gerar QR"  **visto funcionando** no painel |
| `PowerOff` sem import | ✅ | reimportado antes de qualquer deploy |

### Projeto (`auditoria-do-projeto.md`)

| Item | Estado | Evidência |
| --- | --- | --- |
| crash do ranking externo | ✅ | `verificar-rankings.js` verde |
| zero ponto sumindo da Visão Geral | ✅ | `verificar-ranking-equipe.js` verde |
| `vh` na tela de erro | ✅ | `dvh`, e o build passa |
| duas asserções acusando errado | ✅ | regra de responsivo e do avatar corrigidas |
| assinatura antiga de `limparPainel` no teste | ✅ | descoberta no caminho; a exceção abortava a limpeza do próprio teste |
| seção do PDF reprovando por falta de insumo | ✅ | virou `PENDENTES` + `RANKINGS_PDF_EXEMPLO` |

---

## 2. O que mudou de verdade no código

Nove commits de correção, e vale separá-los pelo que cada um evita:

**Dado que era destruído**  a reação do cliente apagava mídia, citação e selo de
encaminhada do `metadata`. Era o único defeito do dia que **não voltava**.

**Informação errada na tela**  risquinho em bolha de cliente, citação apontando
para o robô três turnos atrás, texto antigo em mensagem editada, painel dizendo
"sessão válida" sem saber, QR falso desenhado, atendente sumindo da Visão Geral.

**Página derrubada**  o ranking externo, que estava em produção desde que a
linha foi escrita.

**Cegueira**  a porta de entrada não sabia dizer quais eventos chegavam, e a
conferência do boot imprimia a quantidade em vez dos nomes. Foi ela que, na
primeira execução depois de corrigida, revelou o filtro que faltava.

---

## 3. Corrigido, mas **ainda não provado em produção**

Três coisas dependem do WhatsApp estar pareado, o que fica para amanhã:

1. **Edição feita pelo cliente**  o código trata, o teste cobre, o evento agora
   é autorizado no contêiner **e** assinado pela instância. Falta o cliente
   editar uma mensagem de verdade;
2. **"Apagar para todos" do cliente**  idem;
3. **Citação da resposta digitada**  o motor grava, o mapper entrega, a bolha
   desenha. Falta ver na tela.

O roteiro de verificação, com o WhatsApp online:

```bash
docker compose -f docker-compose.prod.yml logs -f --since 1m api | grep -iE "protocolo|nao roteado"
```

Peça ao cliente para **editar** e depois **apagar** uma mensagem. Deve sair
`Evento de protocolo do cliente aplicado`. Se sair `Webhook recebido e nao
roteado`, o nome do evento está na linha e o ajuste é de minutos.

### E confirme o que está de fato rodando lá

O `main` andou bastante depois do último deploy. Na VM:

```bash
cd ~/arka-chat && git log --oneline -1
```

Tem que aparecer **`05d54e2`**. Se não aparecer, ficaram de fora, entre outros:
o **crash do ranking externo** (`47e4b12`), a **Visão Geral** (`8707842`) e o
painel deixando de mentir em `UNKNOWN` (`fd75dbc`).

> As duas variáveis de estabilidade **já estão vivas** no contêiner da API 
> você as colocou no `.env` à mão. A declaração no compose é a rede para o
> próximo clone; o deploy não é urgente por causa delas.

---

## 4. O que continua aberto  e por quê

Nada aqui é esquecimento; cada um tem um motivo.

| # | Item | Por que não foi feito |
| --- | --- | --- |
| 1 | **`QRCODE_LIMIT: 3`** | Mudar exige recriar o contêiner da Evolution  a operação que custou o pareamento hoje. Vale na próxima janela, não numa aberta só para isso |
| 2 | **Citação de resposta em texto** | Regressão da Evolution (issue #2065). Não há dado a extrair; medido em 08/09 no payload e no banco dela |
| 3 | **`connectionState` respondendo 200 sem `state`** | Observado uma vez, logo após excluir a instância; corrigiu-se sozinho na consulta seguinte. Nosso código lê como `close`. Falta evidência para saber se é regra ou acidente |
| 4 | **Cobertura ausente**: agenda, campanhas, helpdesk, preferências, n8n, configurações | Áreas sem nenhum cenário. É trabalho de dias, não de horas |
| 5 | **`chatbot.engine.js` com 4.987 linhas** | Risco estrutural sem urgência. Mexer sem necessidade é o próprio risco |

---

## 5. O que a limpeza da tela removeu, e não voltou

O commit `a6fa897` ("atualizando a tela de zap") tirou 77 linhas do
`WhatsAppPage.jsx`. Uma delas era o `PowerOff`, que eu reimportei porque
derrubaria a página. **Duas outras continuam fora**, e as duas são de segurança
operacional  por isso ficam registradas em vez de eu decidir sozinho:

**O bloco "A instância não existe mais" (404).** Era o botão *"Recriar instância
e gerar QR"*. O comentário que saiu junto dizia, textualmente, que era dali que
saía o beco sem saída: quando a Evolution responde que o nome não existe,
reconectar não resolve, e sem esse botão não há caminho pela tela  só restava
desconectar tudo e parear na mão.

Hoje isso não travou porque o `gerarQr` **ainda** sabe tratar o 404 e oferecer a
criação; o que se perdeu foi o aviso explicando ao operador o que houve, antes do
diálogo de confirmação.

**O rótulo "Último número pareado".** Agora a tela sempre escreve "Número:", e
foi possível ver o efeito nos prints de hoje: **"Número: +552721030070" ao lado
do badge dizendo `REESCANEIE O QR`.** O comentário removido explicava exatamente
isso  o número vem da linha `Instance` no banco da Evolution e sobrevive ao
logout; ele é o registro do último pareamento, não prova de conexão viva.

Nenhum dos dois é urgente. Os dois são baratos de devolver, e a decisão é sua.

---

## 6. Amanhã, em ordem

1. **Parear**  celular em *Aparelhos conectados*, "Gerar QR", escanear na hora;
2. **Confirmar o webhook**  depois de online:
   `logs --since 3m api | grep -i webhook` deve trazer os **cinco** nomes. Se
   vier o `warn`, é um clique em configurar webhook no painel;
3. **Deploy do que falta**  `git pull` + `up -d --build api web` (só isso; a
   Evolution não precisa ser tocada);
4. **Provar os três pendentes** do §3;
5. **Abrir o ranking externo**  ele estava derrubado em produção e ninguém
   tinha relatado. Vale ver com os próprios olhos que a página abre.
