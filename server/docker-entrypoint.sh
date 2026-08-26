#!/bin/sh
# Sobe a API garantindo que o banco existe e esta no formato do schema atual.
#
# `db push` e idempotente: na primeira subida cria o arquivo e as tabelas; nas
# seguintes so aplica o que mudou no schema.prisma. O seed tambem e idempotente
# (upsert), e ainda ressincroniza a senha do admin com o ADMIN_PASSWORD do .env.
set -e

echo "[arka] aplicando schema em ${DATABASE_URL}"
# --accept-data-loss: o `db push` no SQLite classifica como "perda de dados"
# qualquer alteracao de coluna existente (renomear, mudar tipo, largar), e sem
# esta flag ele PERGUNTA -- num container sem terminal isso vira erro, o
# entrypoint morre pelo `set -e` e a API entra em crash-loop (o 502 no painel).
#
# O preco de ter isto aqui: uma mudanca destrutiva de schema passa CALADA no
# deploy. Por isso a regra e olhar o log deste passo em todo deploy que mexe no
# schema.prisma -- se aparecer aviso de perda de dados, era intencional?
npx prisma db push --skip-generate --accept-data-loss

# Consolida o historico no modelo "uma conversa por cliente, uma OS por ciclo".
# Idempotente: nas subidas seguintes nao ha duplicata para fundir nem OS para
# criar, e o passo custa uma consulta. Precisa vir DEPOIS do db push (usa a
# tabela `atendimentos`) e antes da API subir, para nenhuma requisicao pegar o
# banco no meio da consolidacao.
echo "[arka] consolidando conversas e atendimentos (OS)"
node prisma/backfill-atendimentos.js

echo "[arka] seed (instancia + usuario administrador)"
node prisma/seed.js

echo "[arka] iniciando API na porta ${PORT}"
exec node src/server.js
