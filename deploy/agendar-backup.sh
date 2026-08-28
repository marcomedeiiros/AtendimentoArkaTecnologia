#!/usr/bin/env bash
# Agenda o backup diario do Arka no cron do usuario.
#
# ── POR QUE ESTE ARQUIVO EXISTE ───────────────────────────────────────────
#
# O backup existia e era bom, mas so rodava dentro do `deploy/atualizar.sh` --
# ou seja, so quando alguem subia uma versao nova. Numa semana sem deploy, uma
# semana sem backup. O intervalo entre backups virava o intervalo entre deploys,
# que e uma decisao sobre CODIGO sendo usada para proteger DADO.
#
# Aqui o backup passa a rodar todo dia as 03:00, independente de deploy.
#
# Roda o script como o usuario atual (nao root): o `docker compose` do projeto ja
# funciona com este usuario, e usar o cron dele evita ter de resolver permissao
# de arquivo e de socket do Docker de novo, agora no root.
#
# Idempotente: rodar duas vezes nao duplica a linha.
#
#   bash deploy/agendar-backup.sh          # instala
#   bash deploy/agendar-backup.sh --tirar  # remove
set -euo pipefail

PROJETO="$(cd "$(dirname "$0")/.." && pwd)"
MARCA="# arka-backup-diario"
LOG="${PROJETO}/backups/backup.log"

# `cd` explicito e caminho absoluto: o cron nao roda de dentro do projeto, e o
# PATH dele e curto -- por isso `docker` costuma falhar em cron e funcionar na
# mao. Redirecionar a saida para um log e o que permite descobrir DEPOIS que o
# backup vinha falhando calado.
LINHA="0 3 * * * cd ${PROJETO} && /usr/bin/env bash deploy/backup.sh >> ${LOG} 2>&1 ${MARCA}"

atual="$(crontab -l 2>/dev/null || true)"
limpo="$(printf '%s\n' "$atual" | grep -v -F "$MARCA" || true)"

if [ "${1:-}" = "--tirar" ]; then
  printf '%s\n' "$limpo" | crontab -
  echo "agendamento removido."
  exit 0
fi

printf '%s\n%s\n' "$limpo" "$LINHA" | grep -v '^$' | crontab -

echo "agendado: backup diario as 03:00"
echo "  log:    ${LOG}"
echo "  conferir: crontab -l | grep arka-backup"
echo ""
echo "Teste agora, sem esperar ate amanha:"
echo "  bash deploy/backup.sh"
