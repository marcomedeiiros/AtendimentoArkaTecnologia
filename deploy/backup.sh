#!/usr/bin/env bash
# Backup quente do banco do Arka (conversas, contatos, usuarios).
#
# Usa o `.backup` do proprio SQLite em vez de um `cp`: copiar o arquivo com a
# API escrevendo nele produz backup corrompido. Guarda 14 dias.
#
#   bash deploy/backup.sh
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE="docker compose -f docker-compose.prod.yml"

DIAS_MANTIDOS=14
STAMP="$(date +%Y-%m-%d_%H%M)"
ARQUIVO="arka-${STAMP}.db"

$COMPOSE exec -T api sqlite3 /data/arka.db ".backup '/backups/${ARQUIVO}'"

# Rotacao: apaga os backups mais velhos que DIAS_MANTIDOS.
find ./backups -name 'arka-*.db' -type f -mtime "+${DIAS_MANTIDOS}" -delete

echo "backup: backups/${ARQUIVO} ($(du -h "backups/${ARQUIVO}" | cut -f1))"
