#!/usr/bin/env bash
# Restaura o banco do Arka a partir de um backup.
#
# ── POR QUE ESTE ARQUIVO EXISTE ───────────────────────────────────────────
#
# Havia backup e nao havia restauracao. Isso e meio caminho: um backup que
# ninguem nunca restaurou e uma hipotese, nao uma garantia -- e a hora de
# descobrir que o procedimento tem um passo faltando nao e a hora em que o banco
# de producao acabou de morrer, com a equipe parada e cliente esperando.
#
# O que este script faz, em ordem, e por que cada passo existe:
#
#   1. CONFERE o backup antes de encostar no banco atual. Restaurar um arquivo
#      corrompido por cima de um banco que ainda respirava troca um problema por
#      um problema pior.
#   2. GUARDA o banco atual antes de sobrescrever. Se a restauracao for a
#      decisao errada (backup velho demais, arquivo trocado), da para voltar.
#   3. PARA a API. Trocar o arquivo com a aplicacao escrevendo nele e a receita
#      da corrupcao -- e foi mais ou menos assim que o banco de desenvolvimento
#      deste projeto se perdeu.
#   4. Restaura, sobe a API e CONFERE que ela responde.
#
#   bash deploy/restaurar.sh backups/arka-2026-08-28_0300.db
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE="docker compose -f docker-compose.prod.yml"

ORIGEM="${1:-}"
if [ -z "$ORIGEM" ]; then
  echo "uso: bash deploy/restaurar.sh <arquivo-de-backup>" >&2
  echo "" >&2
  echo "backups disponiveis:" >&2
  ls -1t backups/arka-*.db 2>/dev/null | head -10 | sed 's/^/  /' >&2 || echo "  (nenhum)" >&2
  exit 1
fi
if [ ! -f "$ORIGEM" ]; then
  echo "ERRO: nao encontrei '${ORIGEM}'." >&2
  exit 1
fi

NOME="$(basename "$ORIGEM")"

# ── 1. Conferir o backup ANTES de mexer no banco atual ──────────────────────
echo "==> Conferindo ${NOME} antes de restaurar"
INTEGRIDADE="$($COMPOSE exec -T api sqlite3 "/backups/${NOME}" "PRAGMA integrity_check;" | tr -d '\r\n')"
if [ "$INTEGRIDADE" != "ok" ]; then
  echo "ERRO: este backup esta corrompido (${INTEGRIDADE}). Nada foi alterado." >&2
  exit 1
fi
CONVERSAS="$($COMPOSE exec -T api sqlite3 "/backups/${NOME}" "SELECT COUNT(*) FROM conversas;" | tr -d '\r\n')"
echo "    integridade ok, ${CONVERSAS} conversas"

# ── 2. Guardar o banco atual ────────────────────────────────────────────────
ANTES="antes-de-restaurar-$(date +%Y-%m-%d_%H%M).db"
echo "==> Guardando o banco atual como backups/${ANTES}"
$COMPOSE exec -T api sqlite3 /data/arka.db ".backup '/backups/${ANTES}'" || {
  echo "aviso: nao consegui copiar o banco atual (ele pode estar corrompido)." >&2
  echo "       Continuando -- e provavel que seja justamente por isso que voce" >&2
  echo "       esta restaurando." >&2
}

# ── 3. Parar a API antes de trocar o arquivo ────────────────────────────────
echo "==> Parando a API"
$COMPOSE stop api

echo "==> Restaurando"
# `cp` dentro do container, com a API parada: aqui a copia simples e correta,
# porque nao ha ninguem escrevendo. Os arquivos -wal/-shm precisam sair junto:
# sobrando de um banco antigo, eles nao combinam com o restaurado e produzem
# exatamente o "database disk image is malformed".
$COMPOSE run --rm --entrypoint sh api -c \
  "rm -f /data/arka.db /data/arka.db-wal /data/arka.db-shm && cp '/backups/${NOME}' /data/arka.db"

echo "==> Subindo a API"
$COMPOSE start api

# ── 4. Conferir que a aplicacao voltou de pe ────────────────────────────────
echo "==> Conferindo"
for _ in $(seq 1 30); do
  if $COMPOSE exec -T api sqlite3 /data/arka.db "PRAGMA integrity_check;" 2>/dev/null | grep -q '^ok'; then
    FINAL="$($COMPOSE exec -T api sqlite3 /data/arka.db "SELECT COUNT(*) FROM conversas;" | tr -d '\r\n')"
    echo "restaurado: ${NOME} -> ${FINAL} conversas, integridade ok"
    echo "o banco anterior ficou em backups/${ANTES}"
    exit 0
  fi
  sleep 2
done

echo "ERRO: a API subiu mas o banco nao respondeu como esperado." >&2
echo "      O banco anterior esta em backups/${ANTES}." >&2
exit 1
