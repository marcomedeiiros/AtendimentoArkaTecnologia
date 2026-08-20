#!/usr/bin/env bash
# Atualiza o Arka na VM para a versao mais recente do repositorio.
# Faz backup do banco antes de qualquer coisa.
#
#   bash deploy/atualizar.sh
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE="docker compose -f docker-compose.prod.yml"

echo "==> Backup antes de atualizar"
bash deploy/backup.sh

echo "==> Baixando o codigo novo"
git pull --ff-only

echo "==> Rebuildando e subindo"
# O entrypoint da API aplica sozinho as mudancas de schema (prisma db push)
# quando o container novo sobe.
$COMPOSE up -d --build

echo "==> Limpando imagens antigas"
docker image prune -f

echo
$COMPOSE ps
