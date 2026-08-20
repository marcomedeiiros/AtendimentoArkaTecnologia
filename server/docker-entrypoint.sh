#!/bin/sh
# Sobe a API garantindo que o banco existe e esta no formato do schema atual.
#
# `db push` e idempotente: na primeira subida cria o arquivo e as tabelas; nas
# seguintes so aplica o que mudou no schema.prisma. O seed tambem e idempotente
# (upsert), e ainda ressincroniza a senha do admin com o ADMIN_PASSWORD do .env.
set -e

echo "[arka] aplicando schema em ${DATABASE_URL}"
npx prisma db push --skip-generate

echo "[arka] seed (instancia + usuario administrador)"
node prisma/seed.js

echo "[arka] iniciando API na porta ${PORT}"
exec node src/server.js
