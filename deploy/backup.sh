#!/usr/bin/env bash
# Backup quente do banco do Arka (conversas, contatos, usuarios).
#
# Usa o `.backup` do proprio SQLite em vez de um `cp`: copiar o arquivo com a
# API escrevendo nele produz backup corrompido. Guarda 14 dias.
#
# ── O QUE MUDOU, E POR QUE ────────────────────────────────────────────────
#
# Antes o script copiava e ia embora. O problema disso a gente viveu: um banco
# SQLite pode estar corrompido e continuar PARECENDO um banco -- abre, lista
# tabelas, e so quebra quando alguem tenta ler a tabela errada. Um backup nessa
# condicao e pior que backup nenhum, porque voce so descobre no dia em que
# precisa dele, quando nao ha mais o original para comparar.
#
# Entao agora, depois de copiar:
#
#   1. roda `PRAGMA integrity_check` NA COPIA. Se nao voltar "ok", a copia e
#      apagada e o script falha -- melhor nao ter backup e saber, do que ter um
#      arquivo que engana.
#   2. confere que a copia tem CONTEUDO (conta as conversas). Um banco vazio
#      passa no integrity_check com louvor.
#   3. so DEPOIS disso apaga os antigos. A ordem importa: rodar a rotacao antes
#      de conferir a copia nova pode apagar o ultimo backup bom por causa de um
#      backup ruim.
#   4. se existir `deploy/enviar-backup.sh`, chama passando o arquivo -- e por
#      onde a copia sai da VM (ver enviar-backup.exemplo.sh). Backup guardado no
#      mesmo disco do original protege contra corrupcao, nao contra perder a
#      maquina.
#
#   bash deploy/backup.sh
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE="docker compose -f docker-compose.prod.yml"

DIAS_MANTIDOS=14
STAMP="$(date +%Y-%m-%d_%H%M)"
ARQUIVO="arka-${STAMP}.db"

echo "==> Copiando o banco (a quente)"
$COMPOSE exec -T api sqlite3 /data/arka.db ".backup '/backups/${ARQUIVO}'"

echo "==> Conferindo a copia"
# `tr -d` limpa o \r que o exec do docker costuma trazer junto.
INTEGRIDADE="$($COMPOSE exec -T api sqlite3 "/backups/${ARQUIVO}" "PRAGMA integrity_check;" | tr -d '\r\n')"
if [ "$INTEGRIDADE" != "ok" ]; then
  echo "ERRO: a copia saiu corrompida (integrity_check: ${INTEGRIDADE})." >&2
  echo "      Apagando para nao deixar um arquivo que parece backup." >&2
  rm -f "backups/${ARQUIVO}"
  exit 1
fi

CONVERSAS="$($COMPOSE exec -T api sqlite3 "/backups/${ARQUIVO}" "SELECT COUNT(*) FROM conversas;" | tr -d '\r\n')"
if [ "${CONVERSAS:-0}" -eq 0 ]; then
  echo "ERRO: a copia esta VAZIA (0 conversas). Banco vazio passa no" >&2
  echo "      integrity_check, entao a checagem acima nao pegaria isso." >&2
  rm -f "backups/${ARQUIVO}"
  exit 1
fi

# So agora: com a copia nova conferida, da para apagar as velhas em paz.
echo "==> Rotacao (mantendo ${DIAS_MANTIDOS} dias)"
find ./backups -name 'arka-*.db' -type f -mtime "+${DIAS_MANTIDOS}" -delete

TAMANHO="$(du -h "backups/${ARQUIVO}" | cut -f1)"
echo "backup: backups/${ARQUIVO} (${TAMANHO}, ${CONVERSAS} conversas, integridade ok)"

# Copia para FORA da VM. Opcional, e de proposito: cada um guarda num lugar
# diferente (outro servidor, S3, rclone...). Ver deploy/enviar-backup.exemplo.sh.
if [ -f deploy/enviar-backup.sh ]; then
  echo "==> Enviando para fora da VM"
  bash deploy/enviar-backup.sh "backups/${ARQUIVO}"
else
  echo "aviso: deploy/enviar-backup.sh nao existe -- o backup esta SO nesta maquina." >&2
  echo "       Se a VM morrer, ele morre junto. Ver deploy/enviar-backup.exemplo.sh." >&2
fi
