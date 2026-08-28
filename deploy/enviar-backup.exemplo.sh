#!/usr/bin/env bash
# MODELO -- copie para `deploy/enviar-backup.sh` e escolha UM dos destinos.
#
#   cp deploy/enviar-backup.exemplo.sh deploy/enviar-backup.sh
#   nano deploy/enviar-backup.sh
#
# ── POR QUE TIRAR O BACKUP DA VM ──────────────────────────────────────────
#
# Backup guardado no mesmo disco do original protege contra UMA coisa: o banco
# corromper. Nao protege contra o disco falhar, a VM ser apagada, o provedor
# suspender a conta, ou alguem entrar na maquina e apagar tudo -- e nesses casos
# o backup vai junto, porque esta do lado.
#
# Como `deploy/backup.sh` chama este arquivo passando o caminho do backup recem
# conferido, basta ele existir para a copia sair da maquina.
#
# O `deploy/enviar-backup.sh` NAO entra no git: ele costuma carregar endereco de
# servidor, bucket ou caminho de credencial (ver .gitignore).
set -euo pipefail

ARQUIVO="${1:?uso: enviar-backup.sh <arquivo>}"
NOME="$(basename "$ARQUIVO")"

# ── Opcao A: outro servidor por SSH ────────────────────────────────────────
# Precisa de chave sem senha para o cron conseguir rodar sozinho.
#
# scp -q -i ~/.ssh/backup_arka "$ARQUIVO" usuario@outro-servidor:/backups/arka/
# echo "enviado: ${NOME} -> outro-servidor"

# ── Opcao B: S3, Backblaze B2, Wasabi (aws cli) ────────────────────────────
# Use uma credencial que so possa ESCREVER no bucket. Se ela puder apagar e
# alguem tomar a VM, apagam os backups tambem -- que e o cenario do qual isto
# deveria proteger.
#
# aws s3 cp "$ARQUIVO" "s3://meu-bucket/arka/${NOME}" --only-show-errors
# echo "enviado: ${NOME} -> s3"

# ── Opcao C: qualquer nuvem via rclone (Drive, OneDrive, Dropbox, B2...) ────
# rclone config  # uma vez, para criar o destino chamado "arka"
#
# rclone copy "$ARQUIVO" arka:backups-arka/ --quiet
# echo "enviado: ${NOME} -> rclone"

echo "aviso: deploy/enviar-backup.sh nao esta configurado -- nenhuma copia saiu" >&2
echo "       da VM. Descomente uma das opcoes neste arquivo." >&2
exit 0
