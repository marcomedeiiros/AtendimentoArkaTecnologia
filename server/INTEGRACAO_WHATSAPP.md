# Integração WhatsApp (Evolution API) — Passo a passo

O back-end já está **pronto** para o WhatsApp: existe o cliente da Evolution API
(`server/src/infrastructure/external/evolution-api.client.js`), o webhook que recebe
mensagens e cria conversas automaticamente, e o motor de chatbot que dispara os fluxos.
Falta apenas **subir a Evolution API** e **ligar os fios**. Este guia mostra como.

> Evolution API é um servidor gratuito e open-source que conecta um número de
> WhatsApp (via QR Code, como o WhatsApp Web) e expõe uma API REST + webhooks.

---

## 1. Subir a Evolution API (Docker)

Crie um `docker-compose.evolution.yml` (ou adicione ao seu compose) e suba:

```yaml
services:
  evolution-api:
    image: atendai/evolution-api:v2.1.1
    container_name: evolution-api
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      AUTHENTICATION_API_KEY: "arka-chave-super-secreta"   # <- sua chave
      DEL_INSTANCE: "false"
      DATABASE_ENABLED: "false"
      CACHE_REDIS_ENABLED: "false"
    volumes:
      - evolution_instances:/evolution/instances

volumes:
  evolution_instances:
```

```bash
docker compose -f docker-compose.evolution.yml up -d
```

A Evolution ficará em `http://localhost:8080`. Painel/manager: `http://localhost:8080/manager`.

---

## 2. Configurar o `.env` do back-end

No `server/.env`, preencha:

```env
EVOLUTION_API_URL=http://localhost:8080
EVOLUTION_API_KEY=arka-chave-super-secreta   # a mesma AUTHENTICATION_API_KEY acima
WHATSAPP_INSTANCE=arka-wapi-oficial          # nome da instância (livre)
WEBHOOK_SECRET=arka-webhook-secret           # protege o webhook (mantido)
```

Reinicie o back-end (`npm run dev` na pasta `server`).

---

## 3. Criar a instância e conectar o número

Crie a instância na Evolution **já apontando o webhook** para o nosso back-end.
Troque `SUA_URL_PUBLICA` pela URL onde o back-end está acessível pela Evolution
(em desenvolvimento local com os dois em Docker, use `http://host.docker.internal:3000`):

```bash
curl -X POST http://localhost:8080/instance/create \
  -H "apikey: arka-chave-super-secreta" \
  -H "Content-Type: application/json" \
  -d '{
    "instanceName": "arka-wapi-oficial",
    "qrcode": true,
    "integration": "WHATSAPP-BAILEYS",
    "webhook": {
      "url": "http://SUA_URL_PUBLICA:3000/api/webhook/v1/whatsapp",
      "byEvents": false,
      "headers": { "x-webhook-secret": "arka-webhook-secret" },
      "events": ["MESSAGES_UPSERT", "CONNECTION_UPDATE"]
    }
  }'
```

Depois pegue o QR Code e escaneie no celular (WhatsApp → Aparelhos conectados):

- Pela interface: **Integração WhatsApp** no painel → botão **Conectar WhatsApp**.
- Ou via API: `GET http://localhost:8080/instance/connect/arka-wapi-oficial` (campo `base64`).

Quando o telefone parear, o ícone **WhatsApp Online** (verde) aparece no topo do
Central de Atendimento — ele é sincronizado a cada 10s com o status real da Evolution.

---

## 4. Fluxo de uma mensagem real (o que já funciona sozinho)

1. Cliente manda mensagem no WhatsApp → Evolution chama
   `POST /api/webhook/v1/whatsapp` (protegido pelo `x-webhook-secret`).
2. O back-end extrai telefone/texto, cria/atualiza a **conversa** e roda o
   **chatbot** (casa o texto com o `gatilho` de um fluxo ativo e responde).
3. O painel faz *polling* a cada 8s: a conversa nova aparece em **Abertos**, o
   **sino toca** e surge a notificação "*fulano lhe enviou uma mensagem*".
4. O atendente responde pelo chat → `POST /conversas/:id/mensagens` → o back-end
   envia de volta pelo WhatsApp via Evolution (`/message/sendText`).

---

## 5. Produção (resumo)

- Exponha o back-end numa URL pública **HTTPS** (a Evolution precisa alcançar o webhook).
- Troque `JWT_SECRET`, `WEBHOOK_SECRET` e a `AUTHENTICATION_API_KEY` por segredos fortes.
- Mantenha a Evolution atrás do mesmo domínio/rede e restrinja o acesso à porta 8080.
- Opcional: habilitar Postgres/Redis na Evolution para escalar.

## Checklist rápido

- [ ] Evolution no ar em `:8080` respondendo com a `apikey`
- [ ] `EVOLUTION_API_URL` / `EVOLUTION_API_KEY` no `server/.env`
- [ ] Instância criada com webhook para `/api/webhook/v1/whatsapp` + header `x-webhook-secret`
- [ ] QR Code escaneado → status **Online** no painel
- [ ] Mensagem de teste do celular apareceu em **Abertos**
