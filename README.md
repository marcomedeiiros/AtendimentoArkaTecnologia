

https://github.com/user-attachments/assets/160966dd-cf6e-4c69-93e7-f4eab1ff9d5d

# AtendimentoArkaTecnologia

Central de Atendimento (estilo Chatwoot) integrada ao WhatsApp via **Evolution API**.

- **client/** — painel React (Vite) → `http://localhost:5173`
- **server/** — API Node/Express + Prisma → `http://localhost:3000`
- **Evolution API** — ponte com o WhatsApp (Docker) → `http://localhost:8080`

---

## 0. Instalar em uma máquina nova (do zero)

Para quem já tem **Node.js**, **Docker Desktop** e **WSL2** instalados.
Rode um comando por linha (no PowerShell o `&&` não funciona).

**Baixando o projeto** — escolha uma opção:

- **ZIP:** no GitHub, **Code → Download ZIP** → extraia a pasta → abra o
  PowerShell dentro dela.
- **Git:**

```bash
git clone https://github.com/marcomedeiiros/AtendimentoArkaTecnologia.git
```

```bash
cd AtendimentoArkaTecnologia
```

**1) Criar o `.env` do back-end** — ele **não vem no git** (contém segredos):

```bash
cd server
```

```bash
copy .env.example .env
```

Gere as chaves e preencha `JWT_SECRET`, `EVOLUTION_API_KEY`, `WEBHOOK_SECRET` e
`ADMIN_PASSWORD` no `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

> O `docker-compose.evolution.yml` lê esse mesmo `.env` automaticamente, então a
> chave da Evolution e a do Arka **nunca ficam fora de sincronia**.

**2) Back-end** — dependências e banco:

```bash
npm install
```

```bash
npm run db:setup
```

*(`db:setup` = gera o Prisma Client, cria as tabelas e popula os dados iniciais.)*

**3) Evolution API** (com o Docker Desktop aberto):

```bash
docker compose -f docker-compose.evolution.yml up -d
```

**4) Front-end:**

```bash
cd ../client
```

```bash
copy .env.example .env
```

Preencha `VITE_ADMIN_SENHA` com o **mesmo** valor de `ADMIN_PASSWORD` do
`server/.env` (o painel usa isso para autenticar sozinho, já que ainda não há
tela de login).

```bash
npm install
```

**5) Subir tudo** — em **dois terminais separados**:

```bash
cd server
```
```bash
npm run dev
```

```bash
cd client
```
```bash
npm start
```

**6) Conectar o WhatsApp:** abra `http://localhost:5173/whatsapp` → **Gerar QR** →
escaneie no celular. Status vira 🟢 Online e as mensagens caem na Central.

---

## 1. Front-end e back-end

Baixe o **Node.js** antes.

**Painel (client):**

```bash
cd client
```

```bash
npm install
```

```bash
npm start
```

Abre em `http://localhost:5173/`

**Back-end (server):**

```bash
cd server
```

```bash
npm install
```

```bash
npm run dev
```

> **PowerShell:** o operador `&&` **não funciona**. Rode um comando por linha
> (no CMD o `&&` funciona normalmente).

---

## 2. Evolution API com Docker

A Evolution é quem conecta o número do WhatsApp (lê o QR Code, igual WhatsApp Web)
e avisa o back-end por webhook. Rodando **na mesma máquina** que o Arka, não é
preciso túnel nem domínio público.

### 2.1. Pré-requisitos (uma vez só)

**a) WSL2** — o Docker no Windows roda os containers dentro dele. Sem isso o
Docker Desktop instala mas o motor **não sobe** (`docker info` devolve erro 500).

Abra o PowerShell **como Administrador** e rode:

```bash
wsl --install
```

**Reinicie o computador** ao terminar.

> Se acusar virtualização desabilitada, ative na BIOS:
> **Intel VT-x / Virtualization Technology** ou **SVM Mode** (AMD).

**b) Docker Desktop** — https://www.docker.com/products/docker-desktop/

Abra o app e espere o ícone da baleia 🐳 parar de animar.

### 2.2. Subir a Evolution

```bash
cd server
```

```bash
docker compose -f docker-compose.evolution.yml up -d
```

Na primeira vez ele baixa as imagens (alguns minutos). Sobem dois containers:
`arka-evolution` (API) e `arka-evolution-db` (Postgres da Evolution).

**Conferir se subiu:**

```bash
docker ps
```

```bash
curl http://localhost:8080
```

Deve responder `"Welcome to the Evolution API, it is working!"`.

### 2.3. Conectar o WhatsApp

1. Abra o painel em **Integração WhatsApp** (`http://localhost:5173/whatsapp`)
2. Clique em **Gerar QR** (renova sozinho a cada 25s)
3. No celular: **WhatsApp → Aparelhos conectados → Conectar aparelho**
4. O status vira 🟢 **Online**

Pronto: as mensagens caem na **Central de Atendimento** em tempo real.

---

## 3. Comandos úteis do Docker

Sempre a partir da pasta `server`:

```bash
docker compose -f docker-compose.evolution.yml logs -f evolution-api
```

```bash
docker compose -f docker-compose.evolution.yml restart evolution-api
```

```bash
docker compose -f docker-compose.evolution.yml down
```

Apagar **tudo**, inclusive o pareamento do WhatsApp (exige escanear o QR de novo):

```bash
docker compose -f docker-compose.evolution.yml down -v
```

Inspecionar o banco da Evolution (instâncias, contatos, chats):

```bash
docker exec arka-evolution-db psql -U evolution -d evolution -c "SELECT name, \"connectionStatus\", \"ownerJid\" FROM \"Instance\";"
```

---

## 4. Configuração

As chaves ficam em `server/.env` e o compose **já usa as mesmas** — não precisa
duplicar nada:

| Variável | Para que serve |
|---|---|
| `EVOLUTION_API_URL` | `http://localhost:8080` |
| `EVOLUTION_API_KEY` | autentica o Arka na Evolution |
| `WHATSAPP_INSTANCE` | nome da instância (`arka-wapi-oficial`) |
| `WEBHOOK_SECRET` | protege o webhook que recebe as mensagens |

Também dá para editar tudo pela tela **Configurações** do painel (Evolution e
n8n), com botão de **Testar conexão**. O que é salvo ali **tem prioridade sobre
o `.env`**.

> ⚠️ **Nunca comite o `.env`** — ele contém segredos. Já está no `.gitignore`.

---

## 5. Problemas comuns

**`docker: command not found`, mas o Docker Desktop está aberto**
O instalador pode ter colocado o Docker em
`C:\Users\<você>\AppData\Local\Programs\DockerDesktop\resources\bin`.
Feche e reabra o terminal (o PATH só é lido ao abrir) ou use o caminho completo.

**`docker info` devolve erro 500 / motor não sobe**
Falta o WSL2 → volte ao passo 2.1.

**`pull access denied for atendai/evolution-api`**
Essa imagem foi **despublicada** do Docker Hub. A correta é
**`evoapicloud/evolution-api`** (já configurada no compose).

**WhatsApp aparece Offline / mensagens não chegam**
Confira se o webhook aponta para `host.docker.internal:3000` — de dentro do
container, `localhost` seria o próprio container, não a sua máquina.

**Contatos e conversas vazios na Evolution**
A instância precisa ser criada com `syncFullHistory` ativo (já é o padrão do
projeto). Se ela foi criada antes disso, exclua e crie novamente pelo painel.

---

## 6. Ordem para ligar tudo

```bash
docker compose -f docker-compose.evolution.yml up -d
```

```bash
cd server
```

```bash
npm run dev
```

```bash
cd client
```

```bash
npm start
```

A Evolution sobe sozinha junto com o Docker (`restart: unless-stopped`) — só o
back-end e o painel precisam ser iniciados manualmente.
