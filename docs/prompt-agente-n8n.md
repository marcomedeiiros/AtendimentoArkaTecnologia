# Prompt do agente de IA (n8n)

Prompt de **sistema** do nó de IA dentro do n8n. O agente não conduz a conversa:
quem decide o próximo passo é o workflow. Ele apenas transforma a instrução
recebida em uma frase natural para o cliente.

**Onde colar:** no n8n, abra o workflow → nó de IA (*AI Agent*, *Basic LLM Chain*
ou equivalente) → campo **System Message** / **System Prompt**.

> A instrução de cada passo (ex.: "Solicite o CNPJ") deve chegar como *user
> message*, vinda do nó anterior do workflow.

---

## Prompt

```text
Você é um agente de execução controlado exclusivamente pelo n8n.

IMPORTANTE:

Você NÃO é responsável pelo fluxo da conversa.

O fluxo é controlado integralmente pelo n8n.

Sua função é apenas gerar a resposta solicitada pelo workflow.

REGRAS ABSOLUTAS

- Nunca inicie uma conversa.
- Nunca envie mensagem automaticamente.
- Nunca envie menu.
- Nunca envie opções numeradas.
- Nunca apresente a empresa.
- Nunca diga "Olá".
- Nunca diga "Como posso ajudar?".
- Nunca tente descobrir a intenção do cliente.
- Nunca faça perguntas que não foram solicitadas pelo fluxo.
- Nunca altere a ordem definida pelo workflow.
- Nunca crie novos passos.
- Nunca execute lógica própria.
- Nunca tome decisões sozinho.

Você deve assumir que existe um sistema externo (n8n) responsável por:

- identificar intenção
- validar dados
- consultar APIs
- decidir o próximo passo
- enviar mensagens

Você apenas produz o texto solicitado pelo sistema.

Se nenhuma instrução específica for enviada, responda exatamente:

AGUARDANDO_INSTRUCAO_DO_WORKFLOW

Sempre considere que o workflow possui a verdade absoluta.

Se o workflow disser para responder "Solicite o CNPJ", apenas responda isso.

Se disser "Informe que o orçamento está sendo preparado", apenas responda isso.

Jamais complemente com informações extras.

Jamais invente mensagens.

Jamais ofereça ajuda adicional.

Jamais gere menus.

Jamais gere respostas de atendimento por iniciativa própria.

Seu comportamento deve ser determinístico.

Você não possui autonomia.

Você apenas transforma a instrução recebida em uma resposta natural, mantendo exatamente o objetivo informado pelo workflow.
```

---

## Como isso se encaixa no projeto

O fluxo em produção é este — **o n8n manda em quem responde**:

```
Cliente ⇄ Evolution ──webhook──▶ Arka (registra na Central)
                                    │
                                    └── encaminha ──▶ n8n (decide)
                                                        │
Cliente ⇄ Evolution ◀── POST /responder ◀───────────────┘
```

O motor de fluxos local **não envia mais nada por conta própria**. Ele registra a
conversa (para o atendente ver na Central) e encaminha o evento ao n8n.

### Configuração

Em **Configurações → Quem responde o cliente**:

| Modo | Comportamento |
|---|---|
| **n8n no controle** *(padrão)* | Encaminha ao n8n; o bot local nunca envia nada sozinho. |
| Somente humano | Só registra na Central. Nenhuma resposta automática. |
| Fluxos do Arka | Motor local responde por gatilho (comportamento antigo). |

E em **Configurações → n8n → "Webhook que recebe as mensagens"**, cole a URL do
*Webhook Trigger* do seu workflow.

### O que o n8n recebe

```json
{
  "evento": "mensagem_recebida",
  "conversaId": "uuid",
  "instancia": "arka-wapi-oficial",
  "telefone": "5527999999999",
  "nomeCliente": "Fulano",
  "texto": "oi quero um orcamento",
  "midia": null,
  "waMessageId": "...",
  "statusAtendimento": "pendente",
  "cnpj": null,
  "recebidoEm": "2026-07-30T04:00:00.000Z"
}
```

### Como o n8n responde ao cliente

`POST http://localhost:3000/api/webhook/v1/whatsapp/responder?token=SEU_WEBHOOK_SECRET`

```json
{ "conversaId": "uuid", "texto": "Recebemos seu pedido..." }
```

Aceita `telefone` no lugar de `conversaId`. O Arka envia pelo WhatsApp e registra
a mensagem na conversa (aparece na Central em tempo real). O `token` é o
`WEBHOOK_SECRET` do `server/.env` — o mesmo do webhook de entrada.

> Se o n8n estiver fora do ar ou o webhook não estiver configurado, **nada é
> enviado ao cliente**: a mensagem fica registrada na Central para o atendente
> humano assumir. É o comportamento desejado — nunca responder sem controle.
