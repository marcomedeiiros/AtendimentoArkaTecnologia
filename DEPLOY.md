# Subir o Arka numa VM Linux

Guia de producao: VM Ubuntu/Debian, acesso pela rede interna, tudo em Docker.
O `README.md` continua valendo para desenvolvimento na sua maquina.

## O que muda do ambiente local para a VM

| | Local (Windows) | VM |
|---|---|---|
| Painel | `npm start` (Vite, porta 5173) | buildado e servido pelo nginx na porta 80 |
| API | `npm run dev` (nodemon) | container, sem porta publica so o nginx a alcanca |
| Chamada `/api` | proxy do Vite | proxy do nginx (mesma origem, sem CORS) |
| Banco | `server/prisma/dev.db` | volume `arka_data`, em `/data/arka.db` |
| Webhook da Evolution | `host.docker.internal:3000` | `http://api:3000` (rede do compose) |
| Ligar tudo | tres terminais | `docker compose up -d`, e religa sozinho no boot |

O painel, a API e a Evolution passam a viver na **mesma rede do compose**. Por
isso `localhost` deixa de ser o endereco certo entre eles: cada servico chama o
outro pelo nome (`api`, `evolution-api`).

## 1. A VM

Minimo confortavel: **2 vCPU, 4 GB de RAM, 40 GB de disco**, Ubuntu 22.04 ou
24.04 LTS. A RAM e puxada principalmente pelo build do painel e pelo Postgres da
Evolution.

Instale o Docker (uma vez so):

```bash
curl -fsSL https://get.docker.com | sh
```

```bash
sudo usermod -aG docker $USER
```

Saia e entre de novo no SSH para o grupo valer. Confira:

```bash
docker compose version
```

## 2. Baixar o projeto

O home do usuario serve: os scripts resolvem o proprio caminho, e assim a
instalacao nao depende de sudo para criar pasta em `/opt`.

```bash
git clone -b deploy/upstream https://github.com/davidcavassani/AtendimentoArkaTecnologia.git ~/arka-chat
```

```bash
cd ~/arka-chat
```

### Que branch e essa

`deploy/upstream` e o codigo de `marcomedeiiros/AtendimentoArkaTecnologia` (a
`main` oficial) **sem nenhuma alteracao**, mais a camada que falta para rodar em
Docker: `docker-compose.prod.yml`, os dois `Dockerfile`, o `nginx.conf`, os
scripts de `deploy/` e este guia. Do lado da aplicacao ela toca so duas coisas,
ambas exigidas pelo proxy: `app.set("trust proxy")` e a variavel `TRUST_PROXY`.

Para trazer novidades do upstream, **faca merge** (nao rebase) da `main` dele
nesta branch e de push. Assim a atualizacao continua sendo fast-forward e o
`deploy/atualizar.sh` da VM segue funcionando:

```bash
git fetch upstream && git merge upstream/main && git push origin deploy/upstream
```

## 3. Instalar

```bash
bash deploy/instalar.sh
```

O script confere o Docker, cria o `.env` sorteando todos os segredos, pergunta o
IP da VM e o e-mail do administrador, builda as imagens e sobe a stack.

**Ao terminar ele imprime a senha do administrador e o codigo de cadastro da
equipe. Anote a senha so aparece ali** (fica no `.env`, com permissao `600`).

<details>
<summary>Instalacao manual, se preferir nao usar o script</summary>

```bash
cp .env.example .env
```

Preencha `VM_IP`, `CORS_ORIGIN` e todos os segredos (`openssl rand -hex 24` gera
cada um), depois:

```bash
mkdir -p backups && sudo chown 1000:1000 backups
```

```bash
docker compose -f docker-compose.prod.yml up -d --build
```
</details>

## 4. Liberar a porta no firewall

```bash
sudo ufw allow OpenSSH
```

```bash
sudo ufw allow 80/tcp
```

```bash
sudo ufw enable
```

A porta 8080 da Evolution **nao** deve ser liberada: ela escuta apenas em
`127.0.0.1`, de proposito (veja "Manager da Evolution" abaixo).

## 5. Conectar o WhatsApp

1. Abra `http://IP_DA_VM` e entre com o administrador
2. **Integracao WhatsApp** → **Gerar QR** (renova a cada 25s)
3. No celular: WhatsApp → Aparelhos conectados → Conectar aparelho
4. O status vira 🟢 Online e as mensagens comecam a cair na Central

O pareamento fica no volume `evolution_instances` e sobrevive a restart e
atualizacao so um `down -v` obriga a escanear o QR de novo.

## 5.1 Consolidacao de conversas e OS (uma vez, no primeiro deploy desta versao)

A partir desta versao a **conversa e o fio permanente do cliente** (uma por
telefone) e cada ciclo de atendimento e uma **OS** (tabela `atendimentos`).
Antes, fechar um atendimento e o cliente escrever de novo criava uma conversa
NOVA -- o historico anterior ficava numa linha separada.

O `docker-entrypoint.sh` ja roda a consolidacao sozinho, entre o `prisma db
push` e o seed:

```bash
node prisma/backfill-atendimentos.js
```

O que ele faz: funde as conversas duplicadas do mesmo telefone na mais antiga
(movendo as mensagens, nunca apagando nenhuma), cria uma OS para cada conversa
fundida preservando o numero que ela ja tinha, e preenche a razao social das
conversas que ja tinham CNPJ identificado. E **idempotente**: nos deploys
seguintes ele nao acha nada para fazer e custa uma consulta.

> **Antes do primeiro deploy desta versao, gere um backup** (secao 6). A fusao
> reescreve linhas de `conversas` e `mensagens`; com o backup em maos, uma base
> com dado estranho pode ser restaurada e reavaliada sem pressa.
>
> No log do deploy procure a linha `[arka] backfill de atendimentos: ...` --
> ela diz quantos clientes foram consolidados e quantas OS foram criadas.

O `prisma db push` desta versao tambem **remove a chave estrangeira** de
`conversas.cnpj` para `parceiros`. Era ela que derrubava com erro 500 a
identificacao de qualquer CNPJ que nao estivesse cadastrado como parceiro. O
`--accept-data-loss` do entrypoint cobre a reconstrucao da tabela; nenhum dado e
perdido.

## 6. Backup

O unico dado insubstituivel e o banco do Arka (conversas, contatos, usuarios).

```bash
bash deploy/backup.sh
```

Gera `backups/arka-DATA.db` usando o `.backup` do proprio SQLite (copiar o
arquivo com a API escrevendo produziria backup corrompido) e apaga os que
passaram de 14 dias.

Agende no cron:

```bash
crontab -e
```

```
0 2 * * * cd ~/arka-chat && bash deploy/backup.sh >> ~/arka-backup.log 2>&1
```

### Tirar o backup da VM

Backup no mesmo disco do original protege contra o banco corromper. **Nao**
protege contra o disco falhar, a VM ser apagada ou o provedor suspender a conta
-- nesses casos o backup vai junto.

O `backup.sh` ja chama `deploy/enviar-backup.sh` sozinho, passando o arquivo
recem-conferido. Basta o arquivo existir:

```bash
cp deploy/enviar-backup.exemplo.sh deploy/enviar-backup.sh && nano deploy/enviar-backup.sh
```

Descomente **uma** das tres opcoes (SSH, S3/B2/Wasabi ou rclone) e preencha o
destino. Ele nao entra no git de proposito: costuma carregar endereco de
servidor e caminho de credencial.

Teste antes de confiar nele:

```bash
bash deploy/backup.sh
```

A saida tem de trazer `==> Enviando para fora da VM` seguido de `enviado: ...`.
Enquanto ele nao existir, cada execucao avisa que a copia esta so na maquina.

> Na opcao S3, use credencial que so possa **escrever** no bucket. Se ela puder
> apagar e alguem tomar a VM, apagam os backups tambem -- que e exatamente o
> cenario do qual isto deveria proteger.

<details>
<summary>Restaurar um backup</summary>

```bash
docker compose -f docker-compose.prod.yml stop api
```

```bash
docker run --rm -v arka-chat_arka_data:/data -v "$PWD/backups":/backups alpine cp /backups/arka-2026-08-17_0200.db /data/arka.db
```

```bash
docker compose -f docker-compose.prod.yml start api
```
</details>

## 7. Atualizar

```bash
bash deploy/atualizar.sh
```

Faz backup, `git pull`, rebuilda e sobe. Mudancas no `schema.prisma` sao
aplicadas sozinhas quando o container novo inicia.

## 8. Operacao no dia a dia

Sempre a partir de `~/arka-chat`:

```bash
docker compose -f docker-compose.prod.yml ps
```

```bash
docker compose -f docker-compose.prod.yml logs -f api
```

```bash
docker compose -f docker-compose.prod.yml restart api
```

```bash
docker compose -f docker-compose.prod.yml logs -f evolution-api
```

Instancias e status direto no banco da Evolution:

```bash
docker exec arka-evolution-db psql -U evolution -d evolution -c "SELECT name, \"connectionStatus\", \"ownerJid\" FROM \"Instance\";"
```

### Manager da Evolution

Fica fechado para a rede. Para abrir do seu PC, faca um tunel SSH:

```bash
ssh -L 8080:127.0.0.1:8080 usuario@IP_DA_VM
```

Com o tunel aberto, acesse `http://localhost:8080/manager` no seu navegador.

## 9. Seguranca o que conferir antes de liberar para a equipe

- **`REGISTRO_CODIGO` preenchido.** Vazio significa cadastro aberto: qualquer
  pessoa que alcance a URL cria conta e passa a ler as conversas dos clientes.
  O `instalar.sh` ja sorteia um codigo.
- **Segredos trocados.** Os valores que estao em `server/.env.example` sao
  publicos no GitHub e nao servem para producao. O `instalar.sh` gera novos.
- **`TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY` preenchidas.** Sao elas que
  protegem o login e o cadastro contra robo. **Vazias, a protecao fica
  desligada em silencio**: o servidor aprova toda verificacao e a tela continua
  funcionando igual, sem nenhum aviso. As chaves saem do painel da Cloudflare
  (Turnstile -> Add site). O `instalar.sh` **nao** as sorteia -- elas vem de
  fora, e precisam ser coladas no `.env` a mao.
- **Segredo nenhum entra no Git.** `server/.env` foi versionado por engano
  entre 22 e 30/07/2026, com `JWT_SECRET`, `EVOLUTION_API_KEY`,
  `WEBHOOK_SECRET` e `ADMIN_PASSWORD` dentro. Apagar o arquivo num commit
  posterior **nao o tira do historico**, e o repositorio e publico: aqueles
  quatro valores seguem legiveis por qualquer pessoa. Nenhum deles vale nesta
  producao (o `instalar.sh` sorteou outros), mas se algum ambiente ainda usar
  os antigos, troque hoje.
- **Sem HTTPS.** Como combinado, o acesso e por IP na rede interna, entao senha
  e token de sessao trafegam em texto claro dentro da rede. Se um dia o painel
  for para a internet, e obrigatorio por um dominio com certificado na frente.
- **Duas vulnerabilidades de dependencia estao ACEITAS, e nao esquecidas**
  (conferido em 01/09/2026). `npm audit` acusa `deepmerge-ts` (3 high, via
  `@prisma/config`) e `esbuild` (via `vite`). Nenhuma das duas alcanca a
  producao: a primeira roda no CLI do Prisma, ao ler um arquivo de configuracao
  que e nosso, e a segunda so afeta o SERVIDOR DE DESENVOLVIMENTO do Vite, que
  nunca sobe na VM (o painel vai para o nginx ja buildado). As correcoes
  disponiveis sao Prisma 8 (release candidate) e Vite 8 (quebra
  compatibilidade) -- os dois saltos trazem mais risco do que os defeitos.
  Reavalie quando sair uma versao estavel.
- **`ADMIN_PASSWORD` e reaplicada a cada subida.** O seed ressincroniza a senha
  do administrador com o `.env` toda vez que o container inicia. Uma troca de
  senha feita pelo painel seria desfeita no proximo restart troque no `.env`.

## 10. Problemas comuns

**Painel abre mas mostra "back-end offline"**
A API nao subiu. `docker compose -f docker-compose.prod.yml logs api` mostra o
motivo quase sempre uma variavel faltando no `.env`.

**WhatsApp conecta mas as mensagens nao chegam**
O webhook nao esta alcancando a API. Confira nos logs da Evolution se ela chama
`http://api:3000/...` e nao `host.docker.internal` (esse era o endereco do setup
local em Windows).

**O WhatsApp caiu esta pedindo QR de novo?**
Antes de escanear qualquer coisa, confira se a sessao ainda existe. Escanear um
QR sem necessidade nao e inofensivo: ele substitui o pareamento que estava la.

```bash
docker exec arka-evolution-db psql -U evolution -d evolution -c \
  'SELECT i.name, i."connectionStatus", i."disconnectionReasonCode", length(s.creds) AS creds FROM "Instance" i LEFT JOIN "Session" s ON s."sessionId"=i.id;'
```

- `creds` com numero: **a sessao esta viva**. Nao escaneie nada o vigia religa
  sozinho (`docker logs arka-api | grep "\[WhatsApp\]"` mostra as tentativas).
- `creds` vazio e `disconnectionReasonCode` **401 ou 403**: logout de verdade.
  So aqui o QR e necessario.
- `creds` vazio com qualquer OUTRO codigo (408, 428, 440, 515...): a Evolution
  apagou a credencial numa queda temporaria, que e um bug conhecido da 2.4.0-rc2
  (ver `server/src/modules/whatsapp/whatsapp.sessao.js`). O cofre devolve a
  credencial sozinho no proximo ciclo procure `[Cofre] CREDENCIAL RESTAURADA`
  nos logs da API.

Estado completo pelo painel: `GET /api/whatsapp/status` traz `situacao`
(`CONNECTED` / `RECONNECTING` / `DISCONNECTED_TEMPORARY` / `LOGGED_OUT`),
`motivoDesconexao` (o `statusCode` do Baileys) e `cofreSessao`.

**A tela de Configuracoes sobrepoe o `.env`**
A URL da Evolution salva pelo painel tem prioridade sobre a variavel de
ambiente. Se alguem salvar `http://localhost:8080` ali, a API para de achar a
Evolution dentro do container o valor correto e `http://evolution-api:8080`.

**`permission denied` ao gerar backup**
A pasta `backups/` precisa pertencer ao uid 1000, que e quem roda a API dentro
do container: `sudo chown 1000:1000 backups`.

**Porta 80 ocupada**
Ajuste `WEB_PORT` no `.env` (e inclua a porta em `CORS_ORIGIN`), depois
`docker compose -f docker-compose.prod.yml up -d`.
